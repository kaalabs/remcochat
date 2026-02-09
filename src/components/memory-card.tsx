"use client";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { useI18n } from "@/components/i18n-provider";
import { Brain } from "lucide-react";
import { Streamdown } from "streamdown";

export type MemoryCardData = {
  answer: string;
};

export function MemoryCard(props: MemoryCardData) {
  const { t } = useI18n();
  const answer = (props.answer ?? "").trim();

    return (
    <Card
      className="w-full max-w-md overflow-hidden border-amber-200/70 bg-amber-100 py-0 shadow-xs dark:border-amber-800/40 dark:bg-amber-950/30"
      data-testid="memory:card"
    >
      <CardContent className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            aria-label={t("memory.title")}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-amber-200/70 bg-amber-50/60 shadow-xs dark:border-amber-800/40 dark:bg-amber-950/20"
          >
            <Brain className="size-5 text-amber-900/70 dark:text-amber-100/70" />
          </div>
          <Streamdown className="min-w-0 flex-1 text-sm text-amber-950/85 dark:text-amber-100/85 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            {answer || " "}
          </Streamdown>
        </div>
      </CardContent>
    </Card>
  );
}
