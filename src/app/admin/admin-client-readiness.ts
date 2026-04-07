"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ReadinessDotState } from "@/components/readiness-dot";
import {
  fetchAdminReadinessPreflight,
  postAdminReadinessRun,
  type ProviderSwitcherResponse,
  type ReadinessPreflightResponse,
  type SkillsAdminResponse,
  type WebSearchProviderResponse,
} from "@/app/admin/admin-client-api";

type UseAdminClientReadinessInput = {
  buildAdminHeaders: () => Record<string, string>;
  providerSwitcher: ProviderSwitcherResponse | null;
  refreshInventory: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  skills: SkillsAdminResponse | null;
  webSearchConfig: WebSearchProviderResponse | null;
};

export function resolveAdminReadinessStateFromStatus(input: {
  allowedStates: ReadinessDotState[];
  fallback: ReadinessDotState;
  status: string;
}): ReadinessDotState {
  const normalizedStatus = String(input.status ?? "").trim();
  return input.allowedStates.find((state) => state === normalizedStatus)
    ?? input.fallback;
}

export function classifyAdminSkillPreflightState(input: {
  detectedTools: string[];
  preflight: ReadinessPreflightResponse;
}): ReadinessDotState {
  const wantsHue = input.detectedTools.some((tool) => tool === "hueGateway");
  const wantsOv = input.detectedTools.some((tool) => tool === "ovNlGateway");
  const hue = wantsHue ? input.preflight.tools.hueGateway : "enabled";
  const ov = wantsOv ? input.preflight.tools.ovNlGateway : "enabled";

  if (hue === "blocked" || ov === "blocked") return "blocked";
  if (hue === "disabled" || ov === "disabled") return "disabled";
  return "untested";
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  const max = Math.max(1, Math.floor(concurrency));
  let idx = 0;
  const runners = Array.from(
    { length: Math.min(max, items.length) },
    async () => {
      while (true) {
        const current = idx;
        idx += 1;
        const item = items[current];
        if (item === undefined) return;
        await worker(item);
      }
    }
  );
  await Promise.all(runners);
}

export function useAdminClientReadiness({
  buildAdminHeaders,
  providerSwitcher,
  refreshInventory,
  refreshSkills,
  skills,
  webSearchConfig,
}: UseAdminClientReadinessInput) {
  const [readinessPreflight, setReadinessPreflight] =
    useState<ReadinessPreflightResponse | null>(null);
  const [llmReadinessByProviderId, setLlmReadinessByProviderId] = useState<
    Record<string, ReadinessDotState>
  >({});
  const [webSearchReadinessByProviderId, setWebSearchReadinessByProviderId] =
    useState<Record<string, ReadinessDotState>>({});
  const [skillReadinessByName, setSkillReadinessByName] = useState<
    Record<string, ReadinessDotState>
  >({});
  const [readinessRetesting, setReadinessRetesting] = useState(false);

  const llmRunIdRef = useRef(0);
  const webSearchRunIdRef = useRef(0);
  const skillsRunIdRef = useRef(0);
  const llmAutoStartedRef = useRef(false);
  const webSearchAutoStartedRef = useRef(false);
  const skillsAutoStartedRef = useRef(false);

  const loadReadinessPreflight = useCallback(async () => {
    const data = await fetchAdminReadinessPreflight({
      headers: buildAdminHeaders(),
    });
    if (!data) return null;
    setReadinessPreflight(data);
    return data;
  }, [buildAdminHeaders]);

  const postReadinessRun = useCallback(
    async (body: unknown) => {
      return postAdminReadinessRun({
        body,
        headers: buildAdminHeaders(),
      });
    },
    [buildAdminHeaders]
  );

  useEffect(() => {
    loadReadinessPreflight().catch(() => {});
  }, [loadReadinessPreflight]);

  const startLlmReadiness = useCallback(async () => {
    const providerIds = (providerSwitcher?.providers ?? [])
      .map((provider) => provider.id)
      .filter(Boolean);
    if (providerIds.length === 0) return;

    llmRunIdRef.current += 1;
    const runId = llmRunIdRef.current;

    setLlmReadinessByProviderId((prev) => {
      const next = { ...prev };
      for (const id of providerIds) next[id] = "untested";
      return next;
    });

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        if (llmRunIdRef.current !== runId) return resolve();
        setLlmReadinessByProviderId((prev) => {
          const next = { ...prev };
          for (const id of providerIds) next[id] = "testing";
          return next;
        });
        resolve();
      });
    });

    await runWithConcurrency(providerIds, 2, async (providerId) => {
      if (llmRunIdRef.current !== runId) return;
      const json = await postReadinessRun({ kind: "llm_provider", providerId });
      if (llmRunIdRef.current !== runId) return;
      setLlmReadinessByProviderId((prev) => ({
        ...prev,
        [providerId]: resolveAdminReadinessStateFromStatus({
          allowedStates: ["passed"],
          fallback: "failed",
          status: String(json?.status ?? ""),
        }),
      }));
    });
  }, [postReadinessRun, providerSwitcher]);

  const startWebSearchReadiness = useCallback(async () => {
    const providerIds = (webSearchConfig?.providers ?? [])
      .map((provider) => provider.id)
      .filter(Boolean);
    if (!webSearchConfig || providerIds.length === 0) return;

    webSearchRunIdRef.current += 1;
    const runId = webSearchRunIdRef.current;

    if (!webSearchConfig.enabled) {
      setWebSearchReadinessByProviderId((prev) => {
        const next = { ...prev };
        for (const id of providerIds) next[id] = "disabled";
        return next;
      });
      return;
    }

    setWebSearchReadinessByProviderId((prev) => {
      const next = { ...prev };
      for (const id of providerIds) next[id] = "untested";
      return next;
    });

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        if (webSearchRunIdRef.current !== runId) return resolve();
        setWebSearchReadinessByProviderId((prev) => {
          const next = { ...prev };
          for (const id of providerIds) next[id] = "testing";
          return next;
        });
        resolve();
      });
    });

    await runWithConcurrency(providerIds, 2, async (providerId) => {
      if (webSearchRunIdRef.current !== runId) return;
      const json = await postReadinessRun({
        kind: "web_search_provider",
        providerId,
      });
      if (webSearchRunIdRef.current !== runId) return;
      setWebSearchReadinessByProviderId((prev) => ({
        ...prev,
        [providerId]: resolveAdminReadinessStateFromStatus({
          allowedStates: ["passed", "disabled"],
          fallback: "failed",
          status: String(json?.status ?? ""),
        }),
      }));
    });
  }, [postReadinessRun, webSearchConfig]);

  const startSkillsReadiness = useCallback(
    async (overridePreflight?: ReadinessPreflightResponse | null) => {
      if (!skills?.enabled) return;

      const skillDependencies = (skills.skills ?? [])
        .map((skill) => ({
          name: skill.name,
          detectedTools: Array.isArray(skill.detectedTools)
            ? skill.detectedTools
            : [],
        }))
        .filter((skill) => skill.detectedTools.length > 0);
      if (skillDependencies.length === 0) return;

      const preflight = overridePreflight ?? readinessPreflight;
      if (!preflight) return;

      skillsRunIdRef.current += 1;
      const runId = skillsRunIdRef.current;

      const preclassified = new Map<string, ReadinessDotState>();
      for (const skill of skillDependencies) {
        preclassified.set(
          skill.name,
          classifyAdminSkillPreflightState({
            detectedTools: skill.detectedTools,
            preflight,
          })
        );
      }

      setSkillReadinessByName((prev) => {
        const next = { ...prev };
        for (const [name, state] of preclassified.entries()) next[name] = state;
        return next;
      });

      const testable = Array.from(preclassified.entries())
        .filter(([, state]) => state === "untested")
        .map(([name]) => name);
      if (testable.length === 0) return;

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          if (skillsRunIdRef.current !== runId) return resolve();
          setSkillReadinessByName((prev) => {
            const next = { ...prev };
            for (const name of testable) next[name] = "testing";
            return next;
          });
          resolve();
        });
      });

      await runWithConcurrency(testable, 2, async (skillName) => {
        if (skillsRunIdRef.current !== runId) return;
        const json = await postReadinessRun({ kind: "skill", skillName });
        if (skillsRunIdRef.current !== runId) return;
        setSkillReadinessByName((prev) => ({
          ...prev,
          [skillName]: resolveAdminReadinessStateFromStatus({
            allowedStates: [
              "passed",
              "disabled",
              "blocked",
              "not_applicable",
            ],
            fallback: "failed",
            status: String(json?.status ?? ""),
          }),
        }));
      });
    },
    [postReadinessRun, readinessPreflight, skills]
  );

  const retestAllReadiness = useCallback(async () => {
    if (readinessRetesting) return;
    setReadinessRetesting(true);
    try {
      const preflight = await loadReadinessPreflight().catch(() => null);
      await Promise.all([
        startLlmReadiness(),
        startWebSearchReadiness(),
        startSkillsReadiness(preflight),
        refreshInventory(),
        refreshSkills(),
      ]);
    } finally {
      setReadinessRetesting(false);
    }
  }, [
    loadReadinessPreflight,
    readinessRetesting,
    refreshInventory,
    refreshSkills,
    startLlmReadiness,
    startSkillsReadiness,
    startWebSearchReadiness,
  ]);

  useEffect(() => {
    if (llmAutoStartedRef.current) return;
    if (!providerSwitcher || providerSwitcher.providers.length === 0) return;
    llmAutoStartedRef.current = true;
    startLlmReadiness().catch(() => {});
  }, [providerSwitcher, startLlmReadiness]);

  useEffect(() => {
    if (webSearchAutoStartedRef.current) return;
    if (!webSearchConfig || webSearchConfig.providers.length === 0) return;
    webSearchAutoStartedRef.current = true;
    startWebSearchReadiness().catch(() => {});
  }, [startWebSearchReadiness, webSearchConfig]);

  useEffect(() => {
    if (skillsAutoStartedRef.current) return;
    if (!skills?.enabled) return;
    if (!readinessPreflight) return;
    const hasToolDependencies = (skills.skills ?? []).some(
      (skill) =>
        Array.isArray(skill.detectedTools) && skill.detectedTools.length > 0
    );
    if (!hasToolDependencies) return;

    skillsAutoStartedRef.current = true;
    startSkillsReadiness(readinessPreflight).catch(() => {});
  }, [readinessPreflight, skills, startSkillsReadiness]);

  return {
    llmReadinessByProviderId,
    readinessRetesting,
    resetLlmAutoStart: () => {
      llmAutoStartedRef.current = false;
    },
    retestAllReadiness,
    skillReadinessByName,
    webSearchReadinessByProviderId,
  };
}
