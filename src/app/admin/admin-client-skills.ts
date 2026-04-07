"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "@/components/i18n-provider";
import {
  fetchAdminSkills,
  type SkillsAdminResponse,
} from "@/app/admin/admin-client-api";

type UseAdminClientSkillsInput = {
  buildAdminHeaders: () => Record<string, string>;
};

export type AdminSkillsSummary = {
  activatedCounts: Record<string, number>;
  collisions: number;
  discovered: number;
  enabled: boolean;
  invalid: number;
  scanRoots: string[];
  scanRootsMeta: Array<{ root: string; exists: boolean; skillsCount: number }>;
  scannedAt: Date | null;
};

export function summarizeAdminSkills(
  skills: SkillsAdminResponse | null
): AdminSkillsSummary | null {
  if (!skills) return null;

  return {
    activatedCounts: skills.usage?.activatedSkillCounts ?? {},
    collisions: skills.collisions?.length ?? 0,
    discovered: skills.skills?.length ?? 0,
    enabled: Boolean(skills.enabled),
    invalid: skills.invalid?.length ?? 0,
    scanRoots: skills.scanRoots ?? [],
    scanRootsMeta: skills.scanRootsMeta ?? [],
    scannedAt:
      typeof skills.scannedAt === "number" ? new Date(skills.scannedAt) : null,
  };
}

export function useAdminClientSkills({
  buildAdminHeaders,
}: UseAdminClientSkillsInput) {
  const { t } = useI18n();
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillsAdminResponse | null>(null);
  const skillsLoadRunIdRef = useRef(0);

  const loadSkills = useCallback(
    async (options?: { rescan?: boolean }) => {
      const data = await fetchAdminSkills({
        fallbackErrorMessage: t("error.admin.skills_load_failed"),
        headers: buildAdminHeaders(),
        rescan: options?.rescan,
      });
      setSkills(data);
    },
    [buildAdminHeaders, t]
  );

  useEffect(() => {
    let canceled = false;
    setSkillsLoading(true);
    setSkillsError(null);
    loadSkills()
      .catch((err) => {
        if (canceled) return;
        setSkillsError(
          err instanceof Error
            ? err.message
            : t("error.admin.skills_load_failed")
        );
      })
      .finally(() => {
        if (canceled) return;
        setSkillsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [loadSkills, t]);

  const refreshSkills = useCallback(async () => {
    const runId = (skillsLoadRunIdRef.current += 1);
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      await loadSkills({ rescan: true });
    } catch (err) {
      if (skillsLoadRunIdRef.current !== runId) return;
      setSkillsError(
        err instanceof Error
          ? err.message
          : t("error.admin.skills_load_failed")
      );
    } finally {
      if (skillsLoadRunIdRef.current !== runId) return;
      setSkillsLoading(false);
    }
  }, [loadSkills, t]);

  const skillsSummary = useMemo(() => {
    return summarizeAdminSkills(skills);
  }, [skills]);

  return {
    refreshSkills,
    skills,
    skillsError,
    skillsLoading,
    skillsSummary,
  };
}
