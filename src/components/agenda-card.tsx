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
import type { AgendaItem, AgendaToolOutput } from "@/lib/types";
import { CalendarDays, Share2, Users } from "lucide-react";

type AgendaCardProps = {
  output: AgendaToolOutput;
};

function itemBadgeLabel(item: AgendaItem) {
  if (item.scope === "shared") return "Shared";
  return "Owned";
}

function formatDayLabel(date: Date) {
  // e.g. "Monday 12 September 2026" (uses viewer locale + timezone).
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatTimeLabel(date: Date) {
  // e.g. "12:15" (uses viewer locale + timezone).
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatRangeLine(startAt: string, endAt: string) {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  const startDay = formatDayLabel(start);
  const endDay = formatDayLabel(end);
  const startTime = formatTimeLabel(start);
  const endTime = formatTimeLabel(end);

  if (startDay === endDay) {
    return `${startDay} from ${startTime} to ${endTime}`;
  }

  return `${startDay} ${startTime} to ${endDay} ${endTime}`;
}

function groupItemsByDay(items: AgendaItem[]) {
  const groups = new Map<string, { key: string; label: string; items: AgendaItem[] }>();
  for (const item of items) {
    const start = new Date(item.startAt);
    const key = Number.isNaN(start.getTime()) ? item.startAt : start.toISOString().slice(0, 10);
    const label = Number.isNaN(start.getTime()) ? "Scheduled" : formatDayLabel(start);
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
  const items = normalizeItems(output);
  const dayGroups = groupItemsByDay(items);
  const isList = output.ok && output.action === "list";
  const headerNote = output.ok
    ? isList
      ? `${output.rangeLabel} (${output.timezone})`
      : output.message
    : output.error;
  const actionLabel = output.ok ? output.action : "needs-detail";

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-emerald-200/70 bg-emerald-50/80 shadow-xs dark:border-emerald-500/40 dark:bg-emerald-950/30"
      data-testid="tool:displayAgenda"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-4">
        <div className="flex items-start gap-3">
          <div
            aria-label="Agenda"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-emerald-200/70 bg-emerald-100/70 shadow-xs dark:border-emerald-600/40 dark:bg-emerald-900/40"
          >
            <CalendarDays className="size-5 text-emerald-800/80 dark:text-emerald-100/80" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">Agenda</span>
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
              ? "No agenda items for this range. Try 'this week' or 'next 30 days'."
              : output.ok
                ? "No agenda items to show."
                : "No matching agenda items found."}
          </div>
        ) : (
          dayGroups.map((group) => (
            <div className="grid gap-2" key={group.key}>
              <div className="px-1 text-xs font-semibold text-emerald-900/70 dark:text-emerald-100/70">
                {group.label}
              </div>
              <div className="grid gap-2">
                {group.items.map((item) => {
                  const line = formatRangeLine(item.startAt, item.endAt);
                  return (
                    <div
                      className="group grid gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm transition hover:bg-background/75"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              className="px-1.5 py-0 text-[10px]"
                              variant="outline"
                            >
                              {itemBadgeLabel(item)}
                            </Badge>
                            <span className="min-w-0 truncate font-semibold">
                              {item.description}
                            </span>
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
                              <Users className="size-3.5" />
                              <span className="max-w-[140px] truncate">
                                {item.ownerProfileName}
                              </span>
                            </div>
                          ) : null}
                          {item.sharedWithCount > 0 ? (
                            <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/50 px-2 py-0.5 text-[11px] text-muted-foreground">
                              <Share2 className="size-3.5" />
                              <span>{item.sharedWithCount}</span>
                            </div>
                          ) : null}
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
        Tip: ask “show my agenda”, “this week”, or “next 30 days”.
      </CardFooter>
    </Card>
  );
}
