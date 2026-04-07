"use client";

import Link from "next/link";
import { RotateCwIcon, ShieldIcon, XIcon } from "lucide-react";

import type { I18nContextValue } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AdminClientHeaderProps = {
  inventoryLoading: boolean;
  onRetestAllReadiness: () => void;
  readinessRetesting: boolean;
  saveNotice: string | null;
  skillsLoading: boolean;
  t: I18nContextValue["t"];
};

export function shouldDisableAdminClientRetest(input: {
  inventoryLoading: boolean;
  readinessRetesting: boolean;
  skillsLoading: boolean;
}) {
  return (
    input.readinessRetesting || input.inventoryLoading || input.skillsLoading
  );
}

export function getAdminClientRefreshIconClassName(input: {
  inventoryLoading: boolean;
  readinessRetesting: boolean;
  skillsLoading: boolean;
}) {
  return cn(
    "size-4",
    shouldDisableAdminClientRetest(input) && "animate-spin"
  );
}

export function AdminClientHeader({
  inventoryLoading,
  onRetestAllReadiness,
  readinessRetesting,
  saveNotice,
  skillsLoading,
  t,
}: AdminClientHeaderProps) {
  const disableRetest = shouldDisableAdminClientRetest({
    inventoryLoading,
    readinessRetesting,
    skillsLoading,
  });

  return (
    <header className="relative flex items-center justify-between gap-3 border-b bg-sidebar pb-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))] text-sidebar-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <ShieldIcon className="size-4 shrink-0" />
        <div className="min-w-0">
          <div className="truncate font-semibold tracking-tight">
            {t("admin.dialog.title")}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {t("admin.page.subtitle")}
          </div>
        </div>
      </div>
      {saveNotice ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 px-4">
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-center text-sm text-emerald-700 dark:text-emerald-300">
            {saveNotice}
          </div>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          aria-label={t("common.refresh")}
          className="h-9 w-9"
          disabled={disableRetest}
          onClick={onRetestAllReadiness}
          size="icon"
          title={t("common.refresh")}
          type="button"
          variant="outline"
        >
          <RotateCwIcon
            className={getAdminClientRefreshIconClassName({
              inventoryLoading,
              readinessRetesting,
              skillsLoading,
            })}
          />
        </Button>
        <Button
          aria-label={t("common.back")}
          asChild
          className="h-9 w-9"
          size="icon"
          title={t("common.back")}
          type="button"
          variant="outline"
        >
          <Link href="/">
            <XIcon className="size-4" />
          </Link>
        </Button>
      </div>
    </header>
  );
}
