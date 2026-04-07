"use client";

import { CheckCircleIcon, MessageCircleIcon, Sparkles, XCircleIcon } from "lucide-react";

import type { SkillsAdminResponse } from "@/app/admin/admin-client-api";
import type { AdminSkillsSummary } from "@/app/admin/admin-client-skills";
import { ReadinessDot, type ReadinessDotState } from "@/components/readiness-dot";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function shouldShowAdminSkillReadinessDot(input: {
  detectedTools: string[];
  readinessState: ReadinessDotState;
}) {
  return input.detectedTools.length > 0 && input.readinessState !== "not_applicable";
}

export function getAdminSkillActivatedCount(input: {
  skillName: string;
  skillsSummary: AdminSkillsSummary | null;
}) {
  return input.skillsSummary?.activatedCounts[input.skillName] ?? 0;
}

export function AdminSkillsCard(props: {
  locale: string;
  skillReadinessByName: Record<string, ReadinessDotState>;
  skills: SkillsAdminResponse | null;
  skillsError: string | null;
  skillsLoading: boolean;
  skillsSummary: AdminSkillsSummary | null;
}) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.skills.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.skillsError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.skillsError}
          </div>
        ) : null}

        {props.skillsSummary ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={
                  props.skillsSummary.enabled
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "border-red-500/30 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                }
                variant="outline"
              >
                {props.skillsSummary.enabled ? "Actief" : t("common.disabled")}
              </Badge>
              <Badge variant="outline">
                {t("admin.skills.summary.discovered")}:{" "}
                {props.skillsSummary.discovered}
              </Badge>
              <Badge variant="outline">
                {t("admin.skills.summary.invalid")}:{" "}
                {props.skillsSummary.invalid}
              </Badge>
              <Badge variant="outline">
                {t("admin.skills.summary.collisions")}:{" "}
                {props.skillsSummary.collisions}
              </Badge>
            </div>

            <div className="text-sm text-muted-foreground">
              <span>
                {t("admin.skills.last_scan.label")}:{" "}
                {props.skillsSummary.scannedAt ? (
                  <span className="font-medium text-foreground">
                    {props.skillsSummary.scannedAt.toLocaleString(props.locale)}
                  </span>
                ) : (
                  <span>{t("admin.skills.last_scan.unknown")}</span>
                )}
              </span>
            </div>

            {props.skillsSummary.scanRootsMeta.length > 0 ? (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <div className="mb-1 font-medium text-muted-foreground">
                  {t("admin.skills.scan_roots.title")}
                </div>
                <div className="space-y-2">
                  {props.skillsSummary.scanRootsMeta.map((root) => (
                    <div
                      className="grid gap-1 sm:grid-cols-[1fr_auto] sm:items-start"
                      key={root.root}
                    >
                      <div
                        className="min-w-0 font-mono break-all"
                        title={root.root}
                      >
                        {root.exists ? (
                          <CheckCircleIcon
                            aria-label={t("admin.skills.scan_root.exists_aria")}
                            className="mr-1 inline-block size-3 align-[-2px] text-emerald-600 dark:text-emerald-400"
                          />
                        ) : (
                          <XCircleIcon
                            aria-label={t("admin.skills.scan_root.missing_aria")}
                            className="mr-1 inline-block size-3 align-[-2px] text-red-600 dark:text-red-400"
                          />
                        )}
                        <Sparkles
                          aria-label={t(
                            "admin.skills.scan_root.skills_available_aria"
                          )}
                          className="mr-1 inline-block size-3 align-[-2px] text-muted-foreground"
                        />
                        <span className="mr-2 text-muted-foreground">
                          {root.skillsCount}
                        </span>
                        {root.root}
                      </div>
                      <div />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(props.skills?.invalid?.length ?? 0) > 0 ? (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <div className="mb-1 font-medium text-muted-foreground">
                  {t("admin.skills.invalid.title")}
                </div>
                <div className="space-y-2">
                  {(props.skills?.invalid ?? []).map((invalid, index) => (
                    <div
                      className="space-y-1"
                      key={`${index}-${invalid.skillMdPath}`}
                    >
                      <div className="font-mono">{invalid.skillMdPath}</div>
                      <div className="text-muted-foreground">{invalid.error}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(props.skills?.collisions?.length ?? 0) > 0 ? (
              <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                <div className="mb-1 font-medium text-muted-foreground">
                  {t("admin.skills.collisions.title")}
                </div>
                <div className="space-y-2">
                  {(props.skills?.collisions ?? []).map((collision) => (
                    <div className="space-y-1" key={collision.name}>
                      <div className="font-mono">{collision.name}</div>
                      <div className="text-muted-foreground">
                        {t("admin.skills.collisions.winner")}:{" "}
                        <span className="font-mono">
                          {collision.winner.sourceDir}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        {t("admin.skills.collisions.losers")}:{" "}
                        <span className="font-mono">
                          {collision.losers.map((loser) => loser.sourceDir).join(", ")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-md border bg-muted/20">
              <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                {t("admin.skills.available.title")}
              </div>
              <div className="divide-y">
                {(props.skills?.skills ?? []).map((skill) => {
                  const detectedTools = Array.isArray(skill.detectedTools)
                    ? skill.detectedTools
                    : [];
                  const readinessState =
                    props.skillReadinessByName[skill.name] ?? "untested";
                  const activatedCount = getAdminSkillActivatedCount({
                    skillName: skill.name,
                    skillsSummary: props.skillsSummary,
                  });

                  return (
                    <div className="px-3 py-2" key={skill.name}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {shouldShowAdminSkillReadinessDot({
                              detectedTools,
                              readinessState,
                            }) ? (
                              <ReadinessDot state={readinessState} />
                            ) : null}
                            <div className="truncate font-mono text-sm">
                              {skill.name}
                            </div>
                          </div>
                          {skill.sourceDir ? (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {t("admin.skills.skill.root")}:{" "}
                              <span className="font-mono break-all">
                                {skill.sourceDir}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {props.skills?.usage ? (
                            <Badge
                              title={t(
                                "admin.skills.activation.activated_other",
                                {
                                  count: activatedCount,
                                }
                              )}
                              variant="secondary"
                            >
                              <MessageCircleIcon className="size-3.5" />
                              <span className="font-mono tabular-nums">
                                {activatedCount}
                              </span>
                            </Badge>
                          ) : (
                            <Badge
                              className="border-red-500/30 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-300"
                              variant="outline"
                            >
                              {t("admin.skills.activation.admin_only")}
                            </Badge>
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
            {props.skillsLoading ? t("admin.skills.loading") : t("admin.skills.none")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
