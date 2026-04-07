"use client";

import type { ComponentProps } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import type { I18nContextValue } from "@/components/i18n-provider";
import { HomeClientComposer } from "@/app/home-client-composer";
import { HomeClientHeader } from "@/app/home-client-header";
import { HomeClientTranscript } from "@/app/home-client-transcript";

type HomeClientMainColumnProps = {
  composer: ComponentProps<typeof HomeClientComposer>;
  contentMaxWidthClass: string;
  header: ComponentProps<typeof HomeClientHeader>;
  providersLoadError: string | null;
  t: I18nContextValue["t"];
  transcript: ComponentProps<typeof HomeClientTranscript>;
};

export function HomeClientMainColumn({
  composer,
  contentMaxWidthClass,
  header,
  providersLoadError,
  t,
  transcript,
}: HomeClientMainColumnProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <HomeClientHeader {...header} />

      {providersLoadError ? (
        <div className="px-[max(1rem,env(safe-area-inset-left,0px))] pt-3 pr-[max(1rem,env(safe-area-inset-right,0px))] sm:px-[max(1.375rem,env(safe-area-inset-left,0px))] md:px-[max(1.75rem,env(safe-area-inset-left,0px))]">
          <div className={contentMaxWidthClass}>
            <Alert
              className="border-destructive/50"
              data-testid="providers:load-error"
              variant="destructive"
            >
              <AlertTitle>{t("error.admin.providers_load_failed")}</AlertTitle>
              <AlertDescription>{providersLoadError}</AlertDescription>
            </Alert>
          </div>
        </div>
      ) : null}

      <HomeClientTranscript {...transcript} />
      <HomeClientComposer {...composer} />
    </main>
  );
}
