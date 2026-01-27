"use client";

import { ThemeToggle } from "@/components/theme-toggle";
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
import { ShieldIcon } from "lucide-react";
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

type ModelsCatalogResponse = {
  loadedAt: string;
  modelsdev: {
    version: string;
    timeoutMs: number;
    allowedModelTypes: string[];
  };
  providers: Record<
    string,
    {
      id: string;
      name: string;
      modelsdevProviderId: string;
      defaultModelId: string;
      allowedModelIds: string[];
      apiKeyEnv: string;
      baseUrl: string;
      models: Record<
        string,
        {
          id: string;
          label: string;
          description?: string;
          providerModelId: string;
          modelType: string;
          npm: string;
          capabilities: ModelCapabilities;
          raw: unknown;
        }
      >;
    }
  >;
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

export function AdminClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProvidersResponse | null>(null);
  const [activeDraft, setActiveDraft] = useState<string>("");

  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelsCatalogResponse | null>(null);

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

  const loadCatalog = async () => {
    const res = await fetch("/api/admin/models-catalog", { cache: "no-store" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error || "Failed to load models catalog.");
    }
    const data = (await res.json()) as ModelsCatalogResponse;
    setCatalog(data);
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
    setCatalogLoading(true);
    setCatalogError(null);
    loadCatalog()
      .catch((err) => {
        if (canceled) return;
        setCatalogError(
          err instanceof Error ? err.message : "Failed to load models catalog."
        );
      })
      .finally(() => {
        if (canceled) return;
        setCatalogLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, []);

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

            <Card>
              <CardHeader>
                <CardTitle>Models catalog</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Loaded via <code>modelsdev</code> and cached in-memory until server restart.
                </div>

                {catalogError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {catalogError}
                  </div>
                ) : null}

                {catalogLoading ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : catalog ? (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground">
                      Loaded: <span className="font-mono">{catalog.loadedAt}</span> ·{" "}
                      <span className="font-mono">{catalog.modelsdev.version}</span>
                    </div>

                    <div className="space-y-3">
                      {Object.values(catalog.providers)
                        .sort((a, b) => a.id.localeCompare(b.id))
                        .map((p) => (
                          <details
                            className="rounded-md border px-3 py-2"
                            key={p.id}
                          >
                            <summary className="cursor-pointer select-none text-sm font-medium">
                              {p.name}{" "}
                              <span className="font-mono text-muted-foreground">
                                {p.id}
                              </span>{" "}
                              · {p.allowedModelIds.length} models
                            </summary>
                            <div className="mt-3 space-y-3">
                              <div className="text-xs text-muted-foreground">
                                modelsdev provider:{" "}
                                <span className="font-mono">
                                  {p.modelsdevProviderId}
                                </span>{" "}
                                · api_key_env:{" "}
                                <span className="font-mono">{p.apiKeyEnv}</span>{" "}
                                · base_url:{" "}
                                <span className="font-mono">{p.baseUrl}</span>
                              </div>

                              <div className="space-y-2">
                                {p.allowedModelIds.map((modelId) => {
                                  const m = p.models[modelId];
                                  if (!m) return null;
                                  return (
                                    <div
                                      className="rounded-md border bg-background px-3 py-2"
                                      key={modelId}
                                    >
                                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-medium">
                                            {m.label}{" "}
                                            <span className="font-mono text-xs text-muted-foreground">
                                              {m.id}
                                            </span>
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            type{" "}
                                            <span className="font-mono">
                                              {m.modelType}
                                            </span>{" "}
                                            · npm{" "}
                                            <span className="font-mono">{m.npm}</span>
                                          </div>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                          {listModelCapabilityBadges(
                                            m.capabilities
                                          ).map(({ key, label, enabled }) => (
                                            <Badge
                                              className={enabled ? "" : "opacity-50"}
                                              data-enabled={enabled ? "true" : "false"}
                                              key={key}
                                              variant={enabled ? "secondary" : "outline"}
                                            >
                                              {label}
                                            </Badge>
                                          ))}
                                        </div>
                                      </div>

                                      <details className="mt-2">
                                        <summary className="cursor-pointer select-none text-xs text-muted-foreground">
                                          Raw modelsdev metadata
                                        </summary>
                                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[10px]">
                                          {JSON.stringify(m.raw, null, 2)}
                                        </pre>
                                      </details>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </details>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No catalog loaded.
                  </div>
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
