"use client";

import type { TimezonesToolOutput } from "@/ai/timezones";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Clock3 } from "lucide-react";

function dayDiffLabel(dayDiff: number) {
  if (dayDiff > 0) return "Tomorrow";
  if (dayDiff < 0) return "Yesterday";
  return "";
}

export function TimezonesCard(props: TimezonesToolOutput) {
  const entries = Array.isArray(props.entries) ? props.entries : [];
  const referenceEntry =
    entries.find((entry) => entry.isReference) ?? entries[0];
  const modeLabel = props.mode === "converted" ? "Converted" : "Now";

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-emerald-200/70 bg-emerald-50/80 shadow-xs dark:border-emerald-500/50 dark:bg-emerald-500/15"
      data-testid="tool:displayTimezones"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60 bg-transparent pb-4">
        <div className="min-w-0 flex-1 grid gap-1">
          <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
            Timezones <Badge variant="secondary">{modeLabel}</Badge>
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
            <span className="min-w-0 truncate">
              {referenceEntry?.label ?? props.reference.timeZone}
            </span>
            <span className="text-muted-foreground">•</span>
            <span className="tabular-nums">{props.reference.localTime}</span>
            <span className="text-muted-foreground">•</span>
            <span>
              {props.reference.dateLabel}{" "}
              <span className="tabular-nums">({props.reference.localDateISO})</span>
            </span>
          </CardDescription>
        </div>
        <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background/70 shadow-xs">
          <Clock3 className="size-5 shrink-0" />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {entries.map((entry) => {
          const diffLabel = dayDiffLabel(entry.dayDiff);
          return (
            <div
              className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-sm ${
                entry.isReference
                  ? "bg-emerald-100/60 dark:bg-emerald-500/20"
                  : "hover:bg-muted/30"
              }`}
              key={entry.timeZone}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{entry.label}</span>
                  {entry.isReference ? (
                    <Badge
                      className="border-emerald-300/70 bg-emerald-50/60 text-emerald-900 dark:border-emerald-200/50 dark:bg-emerald-500/10 dark:text-emerald-100"
                      variant="outline"
                    >
                      Base
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground">
                  {entry.dateLabel}{" "}
                  <span className="tabular-nums">({entry.localDateISO})</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums">
                  {entry.localTime}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {entry.offset}
                  {diffLabel ? ` · ${diffLabel}` : ""}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
