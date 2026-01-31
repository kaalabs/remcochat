"use client";

import { ThemeToggle } from "@/components/theme-toggle";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listModelCapabilityBadges, type ModelCapabilities } from "@/lib/models";
import { cn } from "@/lib/utils";
import { CheckIcon, ChevronDownIcon, ShieldIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ProvidersResponse = {
  defaultProviderId: string;
  activeProviderId: string;
  providers: Array<{
    id: string;
    name: string;
    defaultModelId: string;
    models: Array<{
      id: string;
      type: string;
      label: string;
      description?: string;
      capabilities?: ModelCapabilities;
    }>;
  }>;
};

type ModelsInventoryResponse = {
  loadedAt: string;
  configPath: string;
  modelsdevVersion: string;
  router: { enabled: boolean; providerId: string; modelId: string } | null;
  providers: Array<{
    id: string;
    name: string;
    modelsdevProviderId: string;
    defaultModelId: string;
    allowedModelIds: string[];
    requiredModelIds: string[];
    apiKeyEnv: string;
    baseUrl: string;
    models: Array<{
      id: string;
      label: string;
      description?: string;
      npm: string | null;
      modelType: string | null;
      supported: boolean;
      capabilities: ModelCapabilities;
    }>;
  }>;
};

type SkillsAdminResponse = {
  enabled: boolean;
  scannedAt?: number;
  scanRoots?: string[];
  skills?: Array<{
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string;
    sourceDir?: string;
    skillDir?: string;
    skillMdPath?: string;
  }>;
  invalid?: Array<{ skillDir: string; skillMdPath: string; error: string }>;
  collisions?: Array<{
    name: string;
    winner: { sourceDir: string; skillDir: string; skillMdPath: string };
    losers: Array<{ sourceDir: string; skillDir: string; skillMdPath: string }>;
  }>;
  warnings?: string[];
  status?: { enabled: boolean; registryLoaded: boolean };
  usage?: {
    chatsWithAnyActivatedSkills: number;
    activatedSkillCounts: Record<string, number>;
  };
};

function AdminModelPicker(props: {
  value: string;
  onChange: (modelId: string) => void;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    modelType?: string | null;
    capabilities?: ModelCapabilities;
  }>;
  disabled?: boolean;
  placeholder?: string;
  triggerTestId?: string;
}) {
  const selected = props.options.find((m) => m.id === props.value);
  const [open, setOpen] = useState(false);
  const displayValue = (selected?.label ?? props.value).trim();

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-9 w-full justify-between gap-2 px-3"
          data-testid={props.triggerTestId}
          disabled={props.disabled}
          variant="outline"
        >
          <span className="truncate">
            {displayValue || props.placeholder || "Select..."}
            {selected?.description ? (
              <span className="ml-2 text-muted-foreground">{selected.description}</span>
            ) : null}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" />
        </Button>
      </ModelSelectorTrigger>

      <ModelSelectorContent title="Select model">
        <ModelSelectorInput placeholder="Search models…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          <ModelSelectorGroup heading="Models">
            {props.options.map((option) => (
              <ModelSelectorItem
                data-testid={`model-option:${option.id}`}
                key={option.id}
                onSelect={() => {
                  props.onChange(option.id);
                  setOpen(false);
                }}
                value={option.id}
              >
                <CheckIcon
                  className={cn(
                    "mr-2 size-4",
                    option.id === props.value ? "opacity-100" : "opacity-0"
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <ModelSelectorName>{option.label}</ModelSelectorName>
                    {option.description ? (
                      <span className="truncate text-muted-foreground text-xs">
                        {option.description}
                      </span>
                    ) : null}
                    {option.modelType ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {option.modelType}
                      </span>
                    ) : null}
                  </div>
                  {option.capabilities ? (
                    <div className="flex flex-wrap gap-1">
                      {listModelCapabilityBadges(option.capabilities).map(
                        ({ key, label, enabled }) => (
                          <Badge
                            className={cn(
                              "pointer-events-none px-1.5 py-0 text-[10px]",
                              enabled ? "" : "opacity-50"
                            )}
                            data-enabled={enabled ? "true" : "false"}
                            key={key}
                            variant={enabled ? "secondary" : "outline"}
                          >
                            {label}
                          </Badge>
                        )
                      )}
                    </div>
                  ) : null}
                </div>
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

export function AdminClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [activeDraft, setActiveDraft] = useState<string>("");

  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventory, setInventory] = useState<ModelsInventoryResponse | null>(null);

  const [modelsSavingByProvider, setModelsSavingByProvider] = useState<
    Record<string, boolean>
  >({});
  const [defaultModelSavingByProvider, setDefaultModelSavingByProvider] = useState<
    Record<string, boolean>
  >({});
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsNotice, setModelsNotice] = useState<string | null>(null);

  const [routerDraftModelId, setRouterDraftModelId] = useState<string>("");
  const [routerSaving, setRouterSaving] = useState(false);

  const [allowedDraftByProviderId, setAllowedDraftByProviderId] = useState<
    Record<string, Set<string>>
  >({});
  const [defaultDraftByProviderId, setDefaultDraftByProviderId] = useState<
    Record<string, string>
  >({});
  const [filtersByProviderId, setFiltersByProviderId] = useState<
    Record<string, { query: string; showAll: boolean }>
  >({});

  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillsAdminResponse | null>(null);

  const load = async () => {
    const res = await fetch("/api/providers", { cache: "no-store" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error || "Failed to load providers.");
    }
    const data = (await res.json()) as ProvidersResponse;
    setProviders(data);
    setActiveDraft(data.activeProviderId);
  };

  const loadInventory = async () => {
    const res = await fetch("/api/admin/models-inventory", { cache: "no-store" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error || "Failed to load models inventory.");
    }
    const data = (await res.json()) as ModelsInventoryResponse;
    setInventory(data);
    setRouterDraftModelId(data.router?.modelId ?? "");
  };

  const loadSkills = async () => {
    const res = await fetch("/api/skills", { cache: "no-store" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error || "Failed to load skills.");
    }
    const data = (await res.json()) as SkillsAdminResponse;
    setSkills(data);
  };

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    load()
      .catch((err) => {
        if (canceled) return;
        setError(err instanceof Error ? err.message : "Failed to load providers.");
      })
      .finally(() => {
        if (canceled) return;
        setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    setInventoryLoading(true);
    setInventoryError(null);
    loadInventory()
      .catch((err) => {
        if (canceled) return;
        setInventoryError(
          err instanceof Error ? err.message : "Failed to load models inventory."
        );
      })
      .finally(() => {
        if (canceled) return;
        setInventoryLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!inventory) return;
    const nextDraft: Record<string, Set<string>> = {};
    const nextDefaultDraft: Record<string, string> = {};
    const nextFilters: Record<string, { query: string; showAll: boolean }> = {};
    for (const p of inventory.providers) {
      nextDraft[p.id] = new Set(p.allowedModelIds);
      nextDefaultDraft[p.id] = p.defaultModelId;
      nextFilters[p.id] = { query: "", showAll: false };
    }
    setAllowedDraftByProviderId(nextDraft);
    setDefaultDraftByProviderId(nextDefaultDraft);
    setFiltersByProviderId(nextFilters);
  }, [inventory]);

  useEffect(() => {
    let canceled = false;
    setSkillsLoading(true);
    setSkillsError(null);
    loadSkills()
      .catch((err) => {
        if (canceled) return;
        setSkillsError(err instanceof Error ? err.message : "Failed to load skills.");
      })
      .finally(() => {
        if (canceled) return;
        setSkillsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const providerOptions = useMemo(() => {
    return providers?.providers ?? [];
  }, [providers]);

  const activeProvider = useMemo(() => {
    if (!providers) return null;
    return (
      providers.providers.find((p) => p.id === providers.activeProviderId) ?? null
    );
  }, [providers]);

  const [resetConfirm, setResetConfirm] = useState("");
  const [resetSaving, setResetSaving] = useState(false);

  const canSave =
    !loading &&
    !saving &&
    providers != null &&
    activeDraft.trim().length > 0 &&
    activeDraft !== providers.activeProviderId;

  const exportAllData = () => {
    const a = document.createElement("a");
    a.href = "/api/admin/export";
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const resetAllData = async () => {
    if (resetSaving) return;
    if (resetConfirm !== "RESET") return;

    setResetSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET" }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to reset.");
      }
      setResetConfirm("");
      setNotice("Reset completed. RemcoChat has been restored to the default profile.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset.");
    } finally {
      setResetSaving(false);
    }
  };

  const save = async () => {
    if (!providers) return;
    if (!activeDraft) return;
    if (saving) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/providers/active", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: activeDraft }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to switch provider.");
      }
      await load();
      setNotice("Active provider updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch provider.");
    } finally {
      setSaving(false);
    }
  };

  const refreshInventory = async () => {
    if (inventoryLoading) return;
    setInventoryLoading(true);
    setInventoryError(null);
    try {
      await loadInventory();
    } catch (err) {
      setInventoryError(
        err instanceof Error ? err.message : "Failed to load models inventory."
      );
    } finally {
      setInventoryLoading(false);
    }
  };

  const setProviderQuery = (providerId: string, query: string) => {
    setFiltersByProviderId((prev) => ({
      ...prev,
      [providerId]: { query, showAll: prev[providerId]?.showAll ?? false },
    }));
  };

  const toggleProviderShowAll = (providerId: string) => {
    setFiltersByProviderId((prev) => ({
      ...prev,
      [providerId]: {
        query: prev[providerId]?.query ?? "",
        showAll: !(prev[providerId]?.showAll ?? false),
      },
    }));
  };

  const toggleAllowedModel = (providerId: string, modelId: string) => {
    setAllowedDraftByProviderId((prev) => {
      const existing = prev[providerId] ?? new Set<string>();
      const next = new Set(existing);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return { ...prev, [providerId]: next };
    });
  };

  const setProviderDefaultDraft = (providerId: string, modelId: string) => {
    setDefaultDraftByProviderId((prev) => ({ ...prev, [providerId]: modelId }));
  };

  const resetProviderDraft = (providerId: string) => {
    if (!inventory) return;
    const provider = inventory.providers.find((p) => p.id === providerId);
    if (!provider) return;
    setAllowedDraftByProviderId((prev) => ({
      ...prev,
      [providerId]: new Set(provider.allowedModelIds),
    }));
  };

  const resetProviderDefaultDraft = (providerId: string) => {
    if (!inventory) return;
    const provider = inventory.providers.find((p) => p.id === providerId);
    if (!provider) return;
    setDefaultDraftByProviderId((prev) => ({ ...prev, [providerId]: provider.defaultModelId }));
  };

  const saveProviderDraft = async (providerId: string) => {
    if (!inventory) return;
    const draft = allowedDraftByProviderId[providerId];
    if (!draft) return;
    if (modelsSavingByProvider[providerId]) return;

    setModelsSavingByProvider((prev) => ({ ...prev, [providerId]: true }));
    setModelsError(null);
    setModelsNotice(null);
    try {
      const res = await fetch("/api/admin/providers/allowed-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          allowedModelIds: Array.from(draft),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to update allowed models.");
      }
      await refreshInventory();
      setModelsNotice(`Allowed models updated for "${providerId}".`);
    } catch (err) {
      setModelsError(
        err instanceof Error ? err.message : "Failed to update allowed models."
      );
    } finally {
      setModelsSavingByProvider((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const saveProviderDefaultDraft = async (providerId: string) => {
    if (!inventory) return;
    const provider = inventory.providers.find((p) => p.id === providerId);
    if (!provider) return;
    const draftDefault = String(defaultDraftByProviderId[providerId] ?? "").trim();
    if (!draftDefault) return;
    if (defaultModelSavingByProvider[providerId]) return;

    // Changing default may also update the provider allowlist on disk; require allowlist draft to be clean.
    const allowedDraft = allowedDraftByProviderId[providerId] ?? new Set(provider.allowedModelIds);
    const hasAllowedChanges = !setsEqual(allowedDraft, new Set(provider.allowedModelIds));
    if (hasAllowedChanges) {
      setModelsError(
        `Provider "${providerId}" has unsaved allowed-model changes. Save or reset allowed models first.`
      );
      return;
    }

    setDefaultModelSavingByProvider((prev) => ({ ...prev, [providerId]: true }));
    setModelsError(null);
    setModelsNotice(null);
    try {
      const res = await fetch("/api/admin/providers/default-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, defaultModelId: draftDefault }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to update default model.");
      }
      await refreshInventory();
      setModelsNotice(`Default model updated for "${providerId}".`);
    } catch (err) {
      setModelsError(
        err instanceof Error ? err.message : "Failed to update default model."
      );
    } finally {
      setDefaultModelSavingByProvider((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const saveRouterModel = async () => {
    if (!inventory?.router) return;
    if (!routerDraftModelId) return;
    if (routerSaving) return;

    setRouterSaving(true);
    setModelsError(null);
    setModelsNotice(null);
    try {
      const res = await fetch("/api/admin/router/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: routerDraftModelId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok) {
        throw new Error(json?.error || "Failed to update router model.");
      }
      await refreshInventory();
      setModelsNotice("Router model updated.");
    } catch (err) {
      setModelsError(
        err instanceof Error ? err.message : "Failed to update router model."
      );
    } finally {
      setRouterSaving(false);
    }
  };

  const refreshSkills = async () => {
    if (skillsLoading) return;
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      await loadSkills();
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : "Failed to load skills.");
    } finally {
      setSkillsLoading(false);
    }
  };

  const skillsSummary = useMemo(() => {
    const data = skills;
    if (!data) return null;
    const enabled = Boolean(data.enabled);
    const discovered = data.skills?.length ?? 0;
    const invalid = data.invalid?.length ?? 0;
    const collisions = data.collisions?.length ?? 0;
    const warnings = data.warnings?.length ?? 0;
    const activatedChats = data.usage?.chatsWithAnyActivatedSkills ?? 0;
    const scannedAt =
      typeof data.scannedAt === "number" ? new Date(data.scannedAt) : null;
    return {
      enabled,
      discovered,
      invalid,
      collisions,
      warnings,
      activatedChats,
      scannedAt,
      scanRoots: data.scanRoots ?? [],
      activatedCounts: data.usage?.activatedSkillCounts ?? {},
    };
  }, [skills]);

  return (
    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b bg-sidebar pb-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))] text-sidebar-foreground">
          <div className="flex min-w-0 items-center gap-3">
            <ShieldIcon className="size-4 shrink-0" />
            <div className="min-w-0">
              <div className="truncate font-semibold tracking-tight">Admin</div>
              <div className="truncate text-xs text-muted-foreground">
                Global settings for this RemcoChat instance
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/">Back</Link>
            </Button>
            <ThemeToggle />
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Backup</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Download a full JSON backup (profiles, chats, messages, variants, memory).
                </div>
                <div className="flex justify-end">
                  <Button
                    data-testid="admin:export"
                    onClick={() => exportAllData()}
                    type="button"
                    variant="secondary"
                  >
                    Export all data
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Provider switching</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {error ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
                {notice ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                    {notice}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="admin:provider">
                      Active provider
                    </label>
                    <Select
                      disabled={loading || saving}
                      onValueChange={(value) => setActiveDraft(value)}
                      value={activeDraft}
                    >
                      <SelectTrigger
                        data-testid="admin:provider-select"
                        id="admin:provider"
                      >
                        <SelectValue placeholder={loading ? "Loading..." : "Select a provider"} />
                      </SelectTrigger>
                      <SelectContent>
                        {providerOptions.map((p) => (
                          <SelectItem
                            data-testid={`admin:provider-option:${p.id}`}
                            key={p.id}
                            value={p.id}
                          >
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {activeProvider ? (
                      <div className="text-xs text-muted-foreground">
                        Current: <span className="font-medium">{activeProvider.name}</span> ·{" "}
                        <span className="font-mono">
                          {Array.from(
                            new Set(activeProvider.models.map((m) => m.type))
                          ).join(", ")}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <Button
                    data-testid="admin:provider-save"
                    disabled={!canSave}
                    onClick={() => save()}
                    type="button"
                  >
                    {saving ? "Saving…" : "Save"}
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground">
                  Switching is global and persistent for this server instance. Existing chats keep
                  their stored model ids; RemcoChat clamps them to the active provider’s allowed
                  models.
                </div>
              </CardContent>
            </Card>

            {inventory?.router ? (
              <Card>
                <CardHeader>
                  <CardTitle>Router model</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    This controls <code>app.router.model_id</code> in <code>config.toml</code>.
                    Changing it also ensures the model is included in the router provider’s
                    <code>allowed_model_ids</code>.
                  </div>

                  {inventory ? (
                    <div className="text-xs text-muted-foreground">
                      Provider:{" "}
                      <span className="font-mono">{inventory.router.providerId}</span>
                    </div>
                  ) : null}

                  {(() => {
                    const provider = inventory?.providers.find(
                      (p) => p.id === inventory.router?.providerId
                    );
                    const options =
                      provider?.models
                        .filter((m) => m.supported)
                        .map((m) => ({
                          id: m.id,
                          label: m.label,
                          description: m.description,
                          modelType: m.modelType,
                          capabilities: m.capabilities,
                        })) ?? [];

                    const canSaveRouter =
                      !routerSaving &&
                      routerDraftModelId.trim().length > 0 &&
                      routerDraftModelId !== inventory?.router?.modelId;

                    return (
                      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="space-y-2">
                          <label className="text-sm font-medium" htmlFor="admin:router-model">
                            Model
                          </label>
                          <div id="admin:router-model">
                            <AdminModelPicker
                              disabled={inventoryLoading || routerSaving || options.length === 0}
                              onChange={(modelId) => setRouterDraftModelId(modelId)}
                              options={options}
                              placeholder={inventoryLoading ? "Loading…" : "Select a model"}
                              triggerTestId="admin:router-model-select"
                              value={routerDraftModelId}
                            />
                          </div>
                        </div>

                        <Button
                          data-testid="admin:router-model-save"
                          disabled={!canSaveRouter}
                          onClick={() => saveRouterModel()}
                          type="button"
                        >
                          {routerSaving ? "Saving…" : "Save"}
                        </Button>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Allowed models</CardTitle>
                  <Button
                    disabled={inventoryLoading}
                    onClick={() => refreshInventory()}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {inventoryLoading ? "Refreshing…" : "Refresh"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  These models appear in the user chat UI Model picker (per provider). Changes are
                  written to <code>config.toml</code> and apply immediately.
                </div>

                {modelsError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {modelsError}
                  </div>
                ) : null}

                {modelsNotice ? (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                    {modelsNotice}
                  </div>
                ) : null}

                {inventoryError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {inventoryError}
                  </div>
                ) : null}

                {inventoryLoading ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : inventory ? (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Config: <span className="font-mono">{inventory.configPath}</span> · Loaded:{" "}
                      <span className="font-mono">{inventory.loadedAt}</span> · modelsdev:{" "}
                      <span className="font-mono">{inventory.modelsdevVersion}</span>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Users may need to refresh their page to fetch updated model options.
                    </div>

                    <div className="space-y-3">
                      {inventory.providers.map((p) => {
                        const draft = allowedDraftByProviderId[p.id] ?? new Set(p.allowedModelIds);
                        const required = new Set(p.requiredModelIds);
                        const baseline = new Set(p.allowedModelIds);
                        const filter = filtersByProviderId[p.id] ?? {
                          query: "",
                          showAll: false,
                        };
                        const savingProvider = Boolean(modelsSavingByProvider[p.id]);
                        const hasChanges = !setsEqual(draft, baseline);
                        const defaultDraft = String(
                          defaultDraftByProviderId[p.id] ?? p.defaultModelId
                        ).trim();
                        const savingDefault = Boolean(defaultModelSavingByProvider[p.id]);
                        const hasDefaultChange =
                          defaultDraft.length > 0 && defaultDraft !== p.defaultModelId;

                        const query = filter.query.trim().toLowerCase();
                        const filtered = (filter.showAll
                          ? p.models
                          : p.models.filter((m) => draft.has(m.id))
                        ).filter((m) => {
                          if (!query) return true;
                          const hay = `${m.id} ${m.label} ${m.description ?? ""}`.toLowerCase();
                          return hay.includes(query);
                        });

                        const isActive = providers?.activeProviderId === p.id;

                        return (
                          <details className="rounded-md border px-3 py-2" key={p.id}>
                            <summary className="cursor-pointer select-none text-sm font-medium">
                              <span className="mr-2">{p.name}</span>
                              <span className="font-mono text-muted-foreground">{p.id}</span>{" "}
                              {isActive ? (
                                <Badge className="ml-2" variant="secondary">
                                  Active
                                </Badge>
                              ) : null}{" "}
                              <span className="text-muted-foreground">
                                · {draft.size} allowed / {p.models.length} total
                              </span>
                            </summary>

                            <div className="mt-3 space-y-3">
                              <div className="text-xs text-muted-foreground">
                                default_model_id:{" "}
                                <span className="font-mono">{p.defaultModelId}</span> · modelsdev
                                provider:{" "}
                                <span className="font-mono">{p.modelsdevProviderId}</span>
                              </div>

                              <div className="grid gap-3 rounded-md border bg-muted/20 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-end">
                                <div className="space-y-2">
                                  <label
                                    className="text-sm font-medium"
                                    htmlFor={`admin:default-model:${p.id}`}
                                  >
                                    Default model
                                  </label>
                                  <div id={`admin:default-model:${p.id}`}>
                                    <AdminModelPicker
                                      disabled={inventoryLoading || savingDefault}
                                      onChange={(modelId) => setProviderDefaultDraft(p.id, modelId)}
                                      options={p.models
                                        .filter((m) => m.supported)
                                        .map((m) => ({
                                          id: m.id,
                                          label: m.label,
                                          description: m.description,
                                          modelType: m.modelType,
                                          capabilities: m.capabilities,
                                        }))}
                                      placeholder="Select a default model"
                                      triggerTestId={`admin:default-model-select:${p.id}`}
                                      value={defaultDraft}
                                    />
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Saved to <code>providers.{p.id}.default_model_id</code> (and
                                    RemcoChat will auto-include it in <code>allowed_model_ids</code>
                                    if needed).
                                  </div>
                                </div>

                                <div className="flex justify-end gap-2">
                                  <Button
                                    data-testid={`admin:default-model-reset:${p.id}`}
                                    disabled={!hasDefaultChange || savingDefault}
                                    onClick={() => resetProviderDefaultDraft(p.id)}
                                    size="sm"
                                    type="button"
                                    variant="secondary"
                                  >
                                    Reset
                                  </Button>
                                  <Button
                                    data-testid={`admin:default-model-save:${p.id}`}
                                    disabled={!hasDefaultChange || savingDefault || hasChanges}
                                    onClick={() => saveProviderDefaultDraft(p.id)}
                                    size="sm"
                                    type="button"
                                  >
                                    {savingDefault ? "Saving…" : "Save"}
                                  </Button>
                                </div>

                                {hasChanges ? (
                                  <div className="text-xs text-muted-foreground sm:col-span-2">
                                    Save/reset allowed models first (default-model save rewrites
                                    <code>allowed_model_ids</code> to ensure consistency).
                                  </div>
                                ) : null}
                              </div>

                              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                                <div className="space-y-2">
                                  <label
                                    className="text-sm font-medium"
                                    htmlFor={`admin:models-search:${p.id}`}
                                  >
                                    Search
                                  </label>
                                  <Input
                                    autoComplete="off"
                                    data-testid={`admin:models-search:${p.id}`}
                                    id={`admin:models-search:${p.id}`}
                                    onChange={(e) => setProviderQuery(p.id, e.target.value)}
                                    placeholder={
                                      filter.showAll
                                        ? "Filter models…"
                                        : "Filter allowed models…"
                                    }
                                    value={filter.query}
                                  />
                                </div>

                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button
                                    data-testid={`admin:models-showall:${p.id}`}
                                    onClick={() => toggleProviderShowAll(p.id)}
                                    size="sm"
                                    type="button"
                                    variant="secondary"
                                  >
                                    {filter.showAll ? "Show allowed" : "Show all"}
                                  </Button>
                                  <Button
                                    data-testid={`admin:allowed-models-reset:${p.id}`}
                                    disabled={!hasChanges || savingProvider}
                                    onClick={() => resetProviderDraft(p.id)}
                                    size="sm"
                                    type="button"
                                    variant="secondary"
                                  >
                                    Reset
                                  </Button>
                                  <Button
                                    data-testid={`admin:allowed-models-save:${p.id}`}
                                    disabled={!hasChanges || savingProvider}
                                    onClick={() => saveProviderDraft(p.id)}
                                    size="sm"
                                    type="button"
                                  >
                                    {savingProvider ? "Saving…" : "Save"}
                                  </Button>
                                </div>
                              </div>

                              <div className="rounded-md border">
                                {filtered.length === 0 ? (
                                  <div className="px-3 py-2 text-sm text-muted-foreground">
                                    No models found.
                                  </div>
                                ) : (
                                  <div className="divide-y">
                                    {filtered.map((m) => {
                                      const checked = draft.has(m.id);
                                      const isRequired = required.has(m.id);
                                      const isDefault = m.id === p.defaultModelId;
                                      const isRouter =
                                        inventory.router?.providerId === p.id &&
                                        inventory.router?.modelId === m.id;
                                      const disabled = isRequired || !m.supported;

                                      return (
                                        <div
                                          className="flex items-start gap-3 px-3 py-2"
                                          data-testid={`admin:model-row:${p.id}:${m.id}`}
                                          key={m.id}
                                        >
                                          <input
                                            checked={checked}
                                            className="mt-1 size-4 accent-foreground disabled:opacity-50"
                                            disabled={disabled}
                                            onChange={() => toggleAllowedModel(p.id, m.id)}
                                            type="checkbox"
                                          />

                                          <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                              <div className="min-w-0">
                                                <div className="truncate text-sm font-medium">
                                                  {m.label}{" "}
                                                  <span className="font-mono text-xs text-muted-foreground">
                                                    {m.id}
                                                  </span>
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                  {m.modelType ? (
                                                    <>
                                                      type{" "}
                                                      <span className="font-mono">
                                                        {m.modelType}
                                                      </span>
                                                    </>
                                                  ) : (
                                                    <>type (unknown)</>
                                                  )}
                                                  {m.npm ? (
                                                    <>
                                                      {" "}
                                                      · npm{" "}
                                                      <span className="font-mono">{m.npm}</span>
                                                    </>
                                                  ) : null}
                                                </div>
                                              </div>

                                              <div className="flex flex-wrap gap-1">
                                                {!m.supported ? (
                                                  <Badge variant="outline">Unsupported</Badge>
                                                ) : null}
                                                {isDefault ? (
                                                  <Badge variant="secondary">Default</Badge>
                                                ) : null}
                                                {isRouter ? (
                                                  <Badge variant="secondary">Router</Badge>
                                                ) : null}
                                              </div>
                                            </div>

                                            <div className="flex flex-wrap gap-1">
                                              {listModelCapabilityBadges(m.capabilities).map(
                                                ({ key, label, enabled }) => (
                                                  <Badge
                                                    className={enabled ? "" : "opacity-50"}
                                                    data-enabled={enabled ? "true" : "false"}
                                                    key={key}
                                                    variant={enabled ? "secondary" : "outline"}
                                                  >
                                                    {label}
                                                  </Badge>
                                                )
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No inventory loaded.</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Skills</CardTitle>
                  <Button
                    disabled={skillsLoading}
                    onClick={() => refreshSkills()}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    {skillsLoading ? "Refreshing…" : "Refresh"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {skillsError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {skillsError}
                  </div>
                ) : null}

                {skillsSummary ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={skillsSummary.enabled ? "secondary" : "outline"}>
                        {skillsSummary.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Badge variant="outline">
                        Discovered: {skillsSummary.discovered}
                      </Badge>
                      <Badge variant="outline">Invalid: {skillsSummary.invalid}</Badge>
                      <Badge variant="outline">
                        Collisions: {skillsSummary.collisions}
                      </Badge>
                      <Badge variant="outline">
                        Warnings: {skillsSummary.warnings}
                      </Badge>
                      {skills?.usage ? (
                        <Badge variant="outline">
                          Chats with activated skills: {skillsSummary.activatedChats}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Usage: (admin only)</Badge>
                      )}
                    </div>

                    <div className="text-sm text-muted-foreground">
                      {skillsSummary.scannedAt ? (
                        <span>
                          Last scan:{" "}
                          <span className="font-medium text-foreground">
                            {skillsSummary.scannedAt.toLocaleString()}
                          </span>
                        </span>
                      ) : (
                        <span>Last scan: (unknown)</span>
                      )}
                    </div>

                    {skillsSummary.scanRoots.length > 0 ? (
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                        <div className="mb-1 font-medium text-muted-foreground">
                          Scan roots
                        </div>
                        <div className="space-y-1 font-mono">
                          {skillsSummary.scanRoots.map((r) => (
                            <div key={r} className="truncate">
                              {r}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {(skills?.warnings?.length ?? 0) > 0 ? (
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                        <div className="mb-1 font-medium text-muted-foreground">
                          Warnings
                        </div>
                        <div className="space-y-1">
                          {(skills?.warnings ?? []).map((w, idx) => (
                            <div key={`${idx}-${w}`} className="break-words font-mono">
                              {w}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {(skills?.invalid?.length ?? 0) > 0 ? (
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                        <div className="mb-1 font-medium text-muted-foreground">
                          Invalid skills
                        </div>
                        <div className="space-y-2">
                          {(skills?.invalid ?? []).map((inv, idx) => (
                            <div key={`${idx}-${inv.skillMdPath}`} className="space-y-1">
                              <div className="font-mono">{inv.skillMdPath}</div>
                              <div className="text-muted-foreground">{inv.error}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {(skills?.collisions?.length ?? 0) > 0 ? (
                      <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                        <div className="mb-1 font-medium text-muted-foreground">
                          Name collisions
                        </div>
                        <div className="space-y-2">
                          {(skills?.collisions ?? []).map((c) => (
                            <div key={c.name} className="space-y-1">
                              <div className="font-mono">{c.name}</div>
                              <div className="text-muted-foreground">
                                Winner: <span className="font-mono">{c.winner.sourceDir}</span>
                              </div>
                              <div className="text-muted-foreground">
                                Losers:{" "}
                                <span className="font-mono">
                                  {c.losers.map((l) => l.sourceDir).join(", ")}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-md border bg-muted/20">
                      <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                        Available skills
                      </div>
                      <div className="divide-y">
                        {(skills?.skills ?? []).map((s) => {
                          const activatedCount = skillsSummary.activatedCounts[s.name] ?? 0;
                          return (
                            <div key={s.name} className="px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate font-mono text-sm">{s.name}</div>
                                  <div className="mt-0.5 text-xs text-muted-foreground">
                                    {s.description}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  {skills?.usage ? (
                                    <Badge variant={activatedCount > 0 ? "secondary" : "outline"}>
                                      {activatedCount > 0
                                        ? `Activated in ${activatedCount} chat${activatedCount === 1 ? "" : "s"}`
                                        : "Not activated"}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline">Activation: (admin only)</Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    {skillsLoading ? "Loading skills…" : "No skills data."}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  This wipes the local database. Type <code>RESET</code> to enable the button.
                </div>
                <Input
                  autoComplete="off"
                  data-testid="admin:reset-confirm"
                  onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="Type RESET"
                  value={resetConfirm}
                />
                <div className="flex justify-end">
                  <Button
                    data-testid="admin:reset"
                    disabled={resetConfirm !== "RESET" || resetSaving}
                    onClick={() => resetAllData()}
                    type="button"
                    variant="destructive"
                  >
                    {resetSaving ? "Resetting…" : "Reset all data"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
