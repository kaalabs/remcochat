"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ChevronDown, CopyIcon, Maximize2, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type BashCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type BashToolCardProps =
  | {
      kind: "bash";
      command: string;
      result?: BashCommandResult;
      errorText?: string;
      state: "running" | "ok" | "error";
    }
  | {
      kind: "readFile";
      path: string;
      content?: string;
      errorText?: string;
      state: "running" | "ok" | "error";
    }
  | {
      kind: "writeFile";
      path: string;
      contentLength?: number;
      success?: boolean;
      errorText?: string;
      state: "running" | "ok" | "error";
    };

function clip(value: string, maxChars: number) {
  const text = String(value ?? "");
  if (text.length <= maxChars) return { text, clipped: false };
  return { text: `${text.slice(0, maxChars)}…`, clipped: true };
}

function CopyTextButton(props: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      className={cn("h-7 px-2 text-xs", props.className)}
      disabled={!props.text}
      onClick={async () => {
        if (typeof window === "undefined") return;
        if (!navigator?.clipboard?.writeText) return;
        try {
          await navigator.clipboard.writeText(props.text);
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
      {copied ? "Copied" : props.label}
    </Button>
  );
}

function OutputBlock(props: {
  label: string;
  value: string;
  defaultOpen?: boolean;
  maxHeightClass?: string;
  autoScroll?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const hasValue = Boolean(String(props.value ?? ""));
  const maxHeightClass = props.maxHeightClass ?? "max-h-96";
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!props.autoScroll) return;
    if (!open) return;
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [props.value, open, props.autoScroll]);

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
            {!hasValue ? <span className="text-muted-foreground/70">(empty)</span> : null}
          </button>
        </CollapsibleTrigger>
        {hasValue ? <CopyTextButton label="Copy" text={props.value} /> : null}
      </div>
      <CollapsibleContent className="mt-2">
        <pre
          ref={preRef}
          className={cn(
            maxHeightClass,
            "overflow-auto rounded-md border bg-background/60 p-3 text-xs leading-relaxed whitespace-pre font-mono"
          )}
        >
          {props.value || ""}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function BashToolCard(props: BashToolCardProps) {
  const [openFull, setOpenFull] = useState(false);
  const header = useMemo(() => {
    if (props.kind === "bash") {
      return {
        title: "Terminal",
        subtitle: "bash",
      };
    }
    if (props.kind === "readFile") {
      return { title: "Filesystem", subtitle: "readFile" };
    }
    return { title: "Filesystem", subtitle: "writeFile" };
  }, [props.kind]);

  const commandSummary =
    props.kind === "bash" ? clip(props.command, 140).text : "";

  return (
    <Card
      className="w-full max-w-full overflow-hidden border-border/60 bg-muted/20 shadow-xs"
      data-testid={`tool:${props.kind}`}
    >
      <CardHeader className="border-b border-border/60 bg-transparent py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/70">
              <TerminalSquare className="size-4.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <span>{header.title}</span>
                <Badge variant="secondary">{header.subtitle}</Badge>
                {props.kind === "bash" && props.state === "ok" && props.result ? (
                  <Badge variant={props.result.exitCode === 0 ? "secondary" : "outline"}>
                    exit {props.result.exitCode}
                  </Badge>
                ) : null}
                {props.state === "running" ? (
                  <Badge variant="outline">Running…</Badge>
                ) : props.state === "error" ? (
                  <Badge className="border-destructive/50 text-destructive" variant="outline">
                    Error
                  </Badge>
                ) : null}
              </CardTitle>
              {props.kind === "bash" ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{commandSummary}</span>
                </div>
              ) : props.kind === "readFile" ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  <span className="font-mono">{props.path}</span>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{props.path}</span>
                  {typeof props.contentLength === "number" ? (
                    <span>({props.contentLength.toString()} chars)</span>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          {props.kind === "bash" ? (
            <div className="flex items-center gap-2">
              <Button
                className="h-7 px-2 text-xs"
                onClick={() => setOpenFull(true)}
                size="sm"
                type="button"
                variant="secondary"
              >
                <Maximize2 className="mr-1 size-3.5" />
                Full
              </Button>
              <CopyTextButton label="Copy command" text={props.command} />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 py-3">
        {props.state === "error" && props.errorText ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {props.errorText}
          </div>
        ) : null}

        {props.kind === "bash" && props.result && (props.state === "ok" || props.state === "running") ? (
          <div className="grid gap-2">
            <OutputBlock
              autoScroll={props.state === "running"}
              defaultOpen={props.state === "running" || Boolean(props.result.stdout)}
              label="stdout"
              value={props.result.stdout || ""}
            />
            <OutputBlock
              autoScroll={props.state === "running"}
              defaultOpen={props.state === "running" || Boolean(props.result.stderr)}
              label="stderr"
              value={props.result.stderr || ""}
            />
          </div>
        ) : null}

        {props.kind === "readFile" && props.state === "ok" ? (
          <OutputBlock
            defaultOpen={true}
            label="content"
            value={props.content || ""}
          />
        ) : null}

        {props.kind === "writeFile" && props.state === "ok" ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{props.success ? "Wrote file" : "Done"}</Badge>
          </div>
        ) : null}
      </CardContent>

      {props.kind === "bash" ? (
        <Dialog onOpenChange={setOpenFull} open={openFull}>
          <DialogContent className="sm:max-w-6xl">
            <DialogHeader>
              <DialogTitle>Terminal output</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <Badge variant="secondary">bash</Badge>
                    {props.state === "ok" && props.result ? (
                      <Badge
                        variant={props.result.exitCode === 0 ? "secondary" : "outline"}
                      >
                        exit {props.result.exitCode}
                      </Badge>
                    ) : props.state === "running" ? (
                      <Badge variant="outline">Running…</Badge>
                    ) : props.state === "error" ? (
                      <Badge className="border-destructive/50 text-destructive" variant="outline">
                        Error
                      </Badge>
                    ) : null}
                  </div>
                  <CopyTextButton label="Copy command" text={props.command} />
                </div>
                <pre className="max-h-40 overflow-auto rounded-md border bg-background/60 p-3 text-xs leading-relaxed whitespace-pre font-mono">
                  {props.command}
                </pre>
              </div>

              {props.state === "error" && props.errorText ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {props.errorText}
                </div>
              ) : null}

              {props.result && (props.state === "ok" || props.state === "running") ? (
                <div className="grid gap-2">
                  <OutputBlock
                    autoScroll={props.state === "running"}
                    defaultOpen={true}
                    label="stdout"
                    maxHeightClass="max-h-[60vh]"
                    value={props.result.stdout || ""}
                  />
                  <OutputBlock
                    autoScroll={props.state === "running"}
                    defaultOpen={Boolean(props.result.stderr)}
                    label="stderr"
                    maxHeightClass="max-h-[60vh]"
                    value={props.result.stderr || ""}
                  />
                </div>
              ) : null}

              {props.state === "running" ? (
                <div className="text-sm text-muted-foreground">Command still running…</div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
