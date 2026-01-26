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
import { CalendarDays, Users } from "lucide-react";

type AgendaCardProps = {
  output: AgendaToolOutput;
};

function formatDuration(minutes: number) {
  const total = Math.max(0, Math.floor(Number(minutes)));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function itemBadgeLabel(item: AgendaItem) {
  if (item.scope === "shared") return "Shared";
  if (item.sharedWithCount > 0) {
    return `Shared with ${item.sharedWithCount}`;
  }
  return "Owned";
}

function formatItemTimes(item: AgendaItem) {
  return {
    local: `${item.localDate} ${item.localTime} (${item.timezone})`,
    viewer: `${item.viewerLocalDate} ${item.viewerLocalTime}`,
  };
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
          items.map((item) => {
            const times = formatItemTimes(item);
            return (
              <div
                className="grid gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm"
                key={item.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge className="px-1.5 py-0 text-[10px]" variant="outline">
                        {itemBadgeLabel(item)}
                      </Badge>
                      <span className="truncate font-semibold">
                        {item.description}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Duration: {formatDuration(item.durationMinutes)}
                    </div>
                  </div>
                  {item.scope === "shared" && item.ownerProfileName ? (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="size-3.5" />
                      <span className="truncate">{item.ownerProfileName}</span>
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-1 text-xs text-muted-foreground">
                  <div>Local: {times.local}</div>
                  <div>Viewer: {times.viewer}</div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
      <CardFooter className="border-t border-border/60 pt-4 text-xs text-muted-foreground">
        Ask to add, update, share, or list agenda items.
      </CardFooter>
    </Card>
  );
}
