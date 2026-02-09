"use client";

import { useMemo } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  ListsOverviewToolOutput,
  TaskListOverview,
} from "@/lib/types";
import { ArrowRightCircle, ListChecks, ShoppingBasket, Users } from "lucide-react";

type ListsOverviewCardProps = ListsOverviewToolOutput & {
  onOpenList?: (list: TaskListOverview) => void;
};

const kindMeta = {
  todo: { icon: ListChecks },
  grocery: { icon: ShoppingBasket },
} as const;

function normalizeOutput(output: ListsOverviewToolOutput) {
  return {
    lists: Array.isArray(output.lists) ? output.lists : [],
    counts: {
      owned: Number(output.counts?.owned ?? 0),
      shared: Number(output.counts?.shared ?? 0),
      total: Number(output.counts?.total ?? 0),
    },
  };
}

function sortLists(lists: TaskListOverview[]) {
  return [...lists].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function ListsOverviewCard(props: ListsOverviewCardProps) {
  const { t } = useI18n();
  const { lists, counts } = useMemo(() => normalizeOutput(props), [props]);
  const canOpen = typeof props.onOpenList === "function";
  const owned = useMemo(
    () => sortLists(lists.filter((list) => list.scope === "owned")),
    [lists]
  );
  const shared = useMemo(
    () => sortLists(lists.filter((list) => list.scope === "shared")),
    [lists]
  );
  const headerLabel =
    counts.total === 1
      ? t("lists_overview.count.one")
      : t("lists_overview.count.other", { count: counts.total });

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-blue-200/70 bg-blue-50/70 shadow-xs dark:border-blue-500/40 dark:bg-blue-950/30"
      data-testid="tool:displayListsOverview"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-4">
        <div className="flex items-start gap-3">
          <div
            aria-label={t("lists_overview.title")}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-blue-200/70 bg-blue-100/70 shadow-xs dark:border-blue-600/40 dark:bg-blue-900/40"
          >
            <Users className="size-5 text-blue-800/80 dark:text-blue-100/80" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">{t("lists_overview.title")}</span>
              <Badge variant="secondary">{headerLabel}</Badge>
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              <span>{t("lists_overview.count.owned", { count: counts.owned })}</span>
              <span className="text-muted-foreground">•</span>
              <span>{t("lists_overview.count.shared", { count: counts.shared })}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4">
        {lists.length === 0 ? (
          <div className="rounded-md border border-dashed bg-background/60 px-3 py-3 text-sm text-muted-foreground">
            {t("lists_overview.empty")}
          </div>
        ) : (
          <>
            {owned.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  {t("lists_overview.section.owned")}
                </div>
                {owned.map((list) => {
                  const meta = kindMeta[list.kind] ?? kindMeta.todo;
                  const Icon = meta.icon;
                  const kindLabel =
                    list.kind === "grocery"
                      ? t("list.kind.grocery")
                      : t("list.kind.todo");
                  return (
                    <div
                      className="flex items-center gap-3 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm"
                      key={list.id}
                    >
                      {canOpen ? (
                        <Button
                          aria-label={t("lists_overview.open_aria", { name: list.name })}
                          className="h-9 w-9 px-0"
                          data-testid={`lists-overview:open:${list.id}`}
                          onClick={() => props.onOpenList?.(list)}
                          size="icon"
                          type="button"
                          variant="outline"
                        >
                          <ArrowRightCircle className="size-4" />
                        </Button>
                      ) : (
                        <Icon className="size-4 text-foreground/70" />
                      )}
                      <div className="min-w-0 flex-1 truncate font-medium">
                        {list.name}
                      </div>
                      <Badge className="text-[10px]" variant="outline">
                        {kindLabel}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {shared.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-muted-foreground">
                  {t("lists_overview.section.shared")}
                </div>
                {shared.map((list) => {
                  const meta = kindMeta[list.kind] ?? kindMeta.todo;
                  const Icon = meta.icon;
                  const kindLabel =
                    list.kind === "grocery"
                      ? t("list.kind.grocery")
                      : t("list.kind.todo");
                  const owner = list.ownerProfileName || t("common.unknown");
                  return (
                    <div
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm"
                      key={list.id}
                    >
                      {canOpen ? (
                        <Button
                          aria-label={t("lists_overview.open_aria", { name: list.name })}
                          className="h-9 w-9 px-0"
                          data-testid={`lists-overview:open:${list.id}`}
                          onClick={() => props.onOpenList?.(list)}
                          size="icon"
                          type="button"
                          variant="outline"
                        >
                          <ArrowRightCircle className="size-4" />
                        </Button>
                      ) : (
                        <Icon className="size-4 text-foreground/70" />
                      )}
                      <div className="min-w-0 flex-1 truncate font-medium">
                        {list.name}
                      </div>
                      <Badge className="text-[10px]" variant="outline">
                        {kindLabel}
                      </Badge>
                      <Badge className="text-[10px]" variant="secondary">
                        {owner}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
