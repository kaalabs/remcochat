"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain } from "lucide-react";
import { Streamdown } from "streamdown";

export type MemoryPromptCardData = {
  content: string;
  disabled?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
};

export function MemoryPromptCard(props: MemoryPromptCardData) {
  const content = (props.content ?? "").trim();

  return (
    <Card
      className="w-full max-w-md overflow-hidden border-amber-200/70 bg-amber-100 py-0 shadow-xs dark:border-amber-800/40 dark:bg-amber-950/30"
      data-testid="memory:prompt-card"
    >
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div
            aria-label="Memory"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-200/70 bg-amber-50/60 shadow-xs dark:border-amber-800/40 dark:bg-amber-950/20"
          >
            <Brain className="size-5 text-amber-900/70 dark:text-amber-100/70" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-amber-950/90 dark:text-amber-100/90">
              Save this memory?
            </div>
            <Streamdown className="mt-1 text-sm text-amber-950/85 dark:text-amber-100/85 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              {content || " "}
            </Streamdown>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                className="bg-amber-900/90 text-amber-50 hover:bg-amber-900 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
                data-testid="memory:prompt-confirm"
                disabled={props.disabled}
                onClick={() => props.onConfirm?.()}
                size="sm"
                type="button"
              >
                Yes
              </Button>
              <Button
                className="border-amber-200/70 bg-transparent text-amber-950/80 hover:bg-amber-200/60 dark:border-amber-800/40 dark:text-amber-100/80 dark:hover:bg-amber-900/40"
                data-testid="memory:prompt-cancel"
                disabled={props.disabled}
                onClick={() => props.onCancel?.()}
                size="sm"
                type="button"
                variant="outline"
              >
                No
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
