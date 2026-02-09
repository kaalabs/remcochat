"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/components/i18n-provider";
import type { AgendaItem, AgendaToolOutput } from "@/lib/types";
import { CalendarDays, Share2, User, Users } from "lucide-react";

type AgendaCardProps = {
  output: AgendaToolOutput;
};

function formatDayLabel(locale: string, date: Date) {
  // e.g. "Monday 12 September 2026" (uses viewer locale + timezone).
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTimeLabel(locale: string, date: Date) {
  // e.g. "12:15" (uses viewer locale + timezone).
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatTimeRangeLine(locale: string, startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  const startTime = formatTimeLabel(locale, start);
  const endTime = formatTimeLabel(locale, end);

  // Date is already shown in the day header. Keep this line time-only.
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (sameDay) return `${startTime}–${endTime}`;

  // Cross-day items are rare; include just weekday labels to reduce ambiguity.
  const startWeekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(start);
  const endWeekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(end);
  return `${startWeekday} ${startTime}–${endWeekday} ${endTime}`;
}

function groupItemsByDay(locale: string, scheduledLabel: string, items: AgendaItem[]) {
  const groups = new Map<string, { key: string; label: string; items: AgendaItem[] }>();
  for (const item of items) {
    const start = new Date(item.startAt);
    // Group by viewer-local date to avoid splitting one local day into multiple groups due to UTC offsets.
    const key =
      item.viewerLocalDate ||
      (Number.isNaN(start.getTime()) ? item.startAt : start.toISOString().slice(0, 10));
    const label = Number.isNaN(start.getTime()) ? scheduledLabel : formatDayLabel(locale, start);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, { key, label, items: [item] });
    }
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeItems(output: AgendaToolOutput) {
  if (!output.ok) return output.candidates ?? [];
  if (output.action === "list") return output.items ?? [];
  if (Array.isArray(output.items) && output.items.length > 0) return output.items;
  if (output.item) return [output.item];
  return [];
}

export function AgendaCard({ output }: AgendaCardProps) {
  const { locale, t } = useI18n();
  const items = normalizeItems(output);
  const dayGroups = groupItemsByDay(locale, t("agenda.scheduled"), items);
  const isList = output.ok && output.action === "list";
  const headerNote = output.ok
    ? isList
      ? `${output.rangeLabel} (${output.timezone})`
      : output.message
    : output.error;
  const actionLabel = (() => {
    if (!output.ok) return t("agenda.action.needs_detail");
    const action = output.action;
    switch (action) {
      case "create":
        return t("agenda.action.create");
      case "update":
        return t("agenda.action.update");
      case "delete":
        return t("agenda.action.delete");
      case "share":
        return t("agenda.action.share");
      case "unshare":
        return t("agenda.action.unshare");
      case "list":
        return t("agenda.action.list");
      default:
        return String(action);
    }
  })();

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-emerald-200/70 bg-emerald-50/80 shadow-xs dark:border-emerald-500/40 dark:bg-emerald-950/30"
      data-testid="tool:displayAgenda"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-4">
        <div className="flex items-start gap-3">
          <div
            aria-label={t("agenda.title")}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-emerald-200/70 bg-emerald-100/70 shadow-xs dark:border-emerald-600/40 dark:bg-emerald-900/40"
          >
            <CalendarDays className="size-5 text-emerald-800/80 dark:text-emerald-100/80" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">{t("agenda.title")}</span>
              <Badge variant="secondary">{actionLabel}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">{headerNote}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 pt-4">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed bg-background/60 px-3 py-3 text-sm text-muted-foreground">
            {isList
              ? t("agenda.empty.range")
              : output.ok
                ? t("agenda.empty.ok")
                : t("agenda.empty.not_found")}
          </div>
        ) : (
          dayGroups.map((group) => (
            <div className="grid gap-2" key={group.key}>
              <div className="px-1 text-xs font-semibold text-emerald-900/70 dark:text-emerald-100/70">
                {group.label}
              </div>
              <div className="grid gap-2">
                {group.items.map((item) => {
                  const line = formatTimeRangeLine(locale, item.startAt, item.endAt);
                  const scopeLabel =
                    item.scope === "shared" ? t("common.shared") : t("common.owned");
                  const ScopeIcon = item.scope === "shared" ? Users : User;
                  return (
                    <div
                      className="group grid gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm transition hover:bg-background/75"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="min-w-0 whitespace-normal break-words font-semibold">
                            {item.description}
                          </div>
                          {line ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {line}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {item.scope === "shared" && item.ownerProfileName ? (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="size-3.5" />
                              <span className="max-w-[140px] truncate">
                                {item.ownerProfileName}
                              </span>
                            </div>
                          ) : null}
                          <div className="inline-flex items-center gap-1.5">
                            <div
                              className="inline-flex size-6 items-center justify-center rounded-full border border-border/60 bg-background/50 text-muted-foreground"
                              title={scopeLabel}
                            >
                              <ScopeIcon className="size-3.5" />
                              <span className="sr-only">{scopeLabel}</span>
                            </div>
                            {item.sharedWithCount > 0 ? (
                              <div
                                className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground"
                                title={t("agenda.shared_with", { count: item.sharedWithCount })}
                              >
                                <Share2 className="size-3.5" />
                                <span>{item.sharedWithCount}</span>
                                <span className="sr-only">
                                  {t("agenda.shared_with", { count: item.sharedWithCount })}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </CardContent>
      <CardFooter className="border-t border-border/60 pt-4 text-xs text-muted-foreground">
        {t("agenda.tip")}
      </CardFooter>
    </Card>
  );
}
