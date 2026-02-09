"use client";

import type { UrlSummaryToolOutput } from "@/ai/url-summary";
import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExternalLink, FileText } from "lucide-react";

function formatFetchedAt(locale: string, value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDomain(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function formatLengthLabel(
  t: ReturnType<typeof useI18n>["t"],
  length: UrlSummaryToolOutput["length"]
) {
  switch (length) {
    case "short":
      return t("url_summary.length.short");
    case "long":
      return t("url_summary.length.long");
    default:
      return t("url_summary.length.medium");
  }
}

export function UrlSummaryCard(props: UrlSummaryToolOutput) {
  const { locale, t } = useI18n();
  const paragraphs = props.summary.split(/\n{2,}/).filter(Boolean);
  const bullets = Array.isArray(props.bullets) ? props.bullets : [];
  const domain = formatDomain(props.resolvedUrl || props.url);
  const fetchedAt = formatFetchedAt(locale, props.fetchedAt);

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-slate-200/70 bg-slate-50/80 shadow-xs dark:border-slate-700/50 dark:bg-slate-950/40"
      data-testid="tool:displayUrlSummary"
    >
      <CardHeader className="border-b border-border/60 bg-transparent pb-4">
        <div className="flex items-start gap-3">
          <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200/70 bg-slate-100/70 shadow-xs dark:border-slate-700/60 dark:bg-slate-900/60">
            <FileText className="size-5 text-slate-700/80 dark:text-slate-200/80" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 truncate">{props.title}</span>
              <Badge variant="secondary">
                {formatLengthLabel(t, props.length)}
              </Badge>
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
              {props.siteName ? (
                <>
                  <span className="min-w-0 truncate">{props.siteName}</span>
                  <span className="text-muted-foreground">-</span>
                </>
              ) : null}
              <span className="min-w-0 truncate">{domain}</span>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-4 text-sm">
        <div className="grid gap-2 text-foreground/90">
          {paragraphs.map((paragraph, index) => (
            <p key={`${props.url}-summary-${index}`}>{paragraph}</p>
          ))}
        </div>
        {bullets.length > 0 ? (
          <ul className="grid list-disc gap-1 pl-5 text-sm text-foreground/85">
            {bullets.map((bullet, index) => (
              <li className="min-w-0" key={`${props.url}-bullet-${index}`}>
                {bullet}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          {props.readingTimeMinutes ? (
            <span>
              {t("url_summary.reading_time", { minutes: props.readingTimeMinutes })}
            </span>
          ) : null}
          {fetchedAt ? (
            <>
              <span className="text-muted-foreground">-</span>
              <span>{t("url_summary.fetched_at", { fetchedAt })}</span>
            </>
          ) : null}
        </div>
        <Button asChild size="sm" variant="secondary">
          <a href={props.resolvedUrl} rel="noreferrer" target="_blank">
            {t("url_summary.open_link")}
            <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}
