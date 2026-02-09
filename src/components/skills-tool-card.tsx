"use client";

import { useI18n } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BookOpen, ChevronDown, CopyIcon, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

type SkillsToolCardProps =
  | {
      kind: "activate";
      skillName: string;
      frontmatter?: unknown;
      body?: string;
      errorText?: string;
      state: "running" | "ok" | "error";
    }
  | {
      kind: "readResource";
      skillName: string;
      resourcePath: string;
      content?: string;
      errorText?: string;
      state: "running" | "ok" | "error";
    };

function hasTruncationNotice(value: string) {
  return /\[REMCOCHAT_SKILLS_TRUNCATED:/.test(String(value ?? ""));
}

function CopyTextButton(props: { text: string; label: string; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const text = String(props.text ?? "");

  return (
    <Button
      className={cn("h-7 px-2 text-xs", props.className)}
      disabled={!text}
      onClick={async () => {
        if (typeof window === "undefined") return;
        if (!navigator?.clipboard?.writeText) return;
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // ignore
        }
      }}
      size="sm"
      type="button"
      variant="secondary"
    >
      <CopyIcon className="mr-1 size-3.5" />
      {copied ? t("common.copied") : props.label}
    </Button>
  );
}

function OutputBlock(props: {
  label: string;
  value: string;
  defaultOpen?: boolean;
  maxHeightClass?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const value = String(props.value ?? "");
  const hasValue = Boolean(value);
  const maxHeightClass = props.maxHeightClass ?? "max-h-96";

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <button
            className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40"
            type="button"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", open ? "rotate-180" : "")} />
            <span>{props.label}</span>
            {!hasValue ? (
              <span className="text-muted-foreground/70">
                ({t("common.empty")})
              </span>
            ) : null}
          </button>
        </CollapsibleTrigger>
        {hasValue ? <CopyTextButton label={t("common.copy")} text={value} /> : null}
      </div>
      <CollapsibleContent className="mt-2">
        <pre className={cn(maxHeightClass, "overflow-auto rounded-md border bg-background/60 p-3 text-xs leading-relaxed whitespace-pre font-mono")}>
          {value}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function SkillsToolCard(props: SkillsToolCardProps) {
  const { t } = useI18n();
  const header = useMemo(() => {
    if (props.kind === "activate") {
      return { title: t("skills_tool.title"), subtitle: "activate" };
    }
    return { title: t("skills_tool.title"), subtitle: "readResource" };
  }, [props.kind, t]);

  const details = useMemo(() => {
    if (props.kind === "activate") {
      const body = String(props.body ?? "");
      return {
        primary: props.skillName,
        truncated: hasTruncationNotice(body),
        content: body,
        frontmatter: props.frontmatter,
        defaultOpen: false,
      };
    }
    const content = String(props.content ?? "");
    return {
      primary: props.resourcePath,
      truncated: hasTruncationNotice(content),
      content,
      frontmatter: undefined,
      defaultOpen: content.length > 0 && content.length <= 800,
    };
  }, [props]);

  const icon = props.kind === "activate" ? Sparkles : BookOpen;
  const Icon = icon;

  return (
    <Card
      className="w-full max-w-full overflow-hidden border-border/60 bg-muted/20 shadow-xs"
      data-testid={`tool:${props.kind === "activate" ? "skillsActivate" : "skillsReadResource"}`}
    >
      <CardHeader className="border-b border-border/60 bg-transparent py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/70">
              <Icon className="size-4.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <span>{header.title}</span>
                <Badge variant="secondary">{header.subtitle}</Badge>
                {details.truncated ? (
                  <Badge variant="outline">{t("skills_tool.truncated")}</Badge>
                ) : null}
                {props.state === "running" ? (
                  <Badge variant="outline">{t("common.running_ellipsis")}</Badge>
                ) : props.state === "error" ? (
                  <Badge className="border-destructive/50 text-destructive" variant="outline">
                    {t("common.error")}
                  </Badge>
                ) : null}
              </CardTitle>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{details.primary}</span>
              </div>
            </div>
          </div>
          {props.state === "ok" ? (
            <CopyTextButton
              label={
                props.kind === "activate"
                  ? t("skills_tool.copy_skill_md")
                  : t("skills_tool.copy_content")
              }
              text={details.content}
            />
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 py-3">
        {props.state === "error" && props.errorText ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.errorText}
          </div>
        ) : null}

        {props.state === "ok" ? (
          <div className="grid gap-2">
            {props.kind === "activate" ? (
              <OutputBlock
                defaultOpen={details.defaultOpen}
                label={t("skills_tool.output.skill_md_body")}
                value={details.content}
              />
            ) : (
              <OutputBlock
                defaultOpen={details.defaultOpen}
                label={t("skills_tool.output.content")}
                value={details.content}
              />
            )}
            {props.kind === "activate" ? (
              <OutputBlock
                defaultOpen={false}
                label={t("skills_tool.output.frontmatter_json")}
                maxHeightClass="max-h-72"
                value={JSON.stringify(details.frontmatter ?? {}, null, 2)}
              />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
