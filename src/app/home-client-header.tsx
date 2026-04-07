"use client";

import type { I18nContextValue } from "@/components/i18n-provider";
import { ModelPicker } from "@/components/model-picker";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  HomeClientLanAdminTriggerButton,
} from "@/app/home-client-lan-admin-ui";
import type { ModelOption } from "@/lib/models";
import {
  GhostIcon,
  MenuIcon,
  PanelLeftOpenIcon,
  ShieldIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

type HomeClientHeaderProps = {
  adminEnabled: boolean;
  canManageActiveChat: boolean;
  desktopSidebarCollapsed: boolean;
  effectiveModelId: string;
  isTemporaryChat: boolean;
  lanAdminAccessAllowed: boolean | null;
  lanAdminAccessEnabled: boolean;
  lanAdminAccessHasToken: boolean;
  modelOptions: ModelOption[];
  onChangeModel: (modelId: string) => void;
  onExpandDesktopSidebar: () => void;
  onOpenLanAdmin: () => void;
  onOpenSidebar: () => void;
  onToggleTemporaryChat: () => void;
  t: I18nContextValue["t"];
};

export function HomeClientHeader({
  adminEnabled,
  canManageActiveChat,
  desktopSidebarCollapsed,
  effectiveModelId,
  isTemporaryChat,
  lanAdminAccessAllowed,
  lanAdminAccessEnabled,
  lanAdminAccessHasToken,
  modelOptions,
  onChangeModel,
  onExpandDesktopSidebar,
  onOpenLanAdmin,
  onOpenSidebar,
  onToggleTemporaryChat,
  t,
}: HomeClientHeaderProps) {
  return (
    <header className="border-b">
      <div className="flex flex-wrap items-center gap-3 pb-3 pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
        <div className="rc-mobile-header flex min-w-0 items-center gap-2 md:hidden">
          <Button
            aria-label={t("sidebar.open_menu.aria")}
            onClick={onOpenSidebar}
            size="icon"
            type="button"
            variant="outline"
          >
            <MenuIcon className="size-4" />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <Image
              alt=""
              aria-hidden="true"
              className="h-5 w-5 shrink-0"
              src="/icons/remcochat-sidebar-mark-20.png"
              height={20}
              width={20}
            />
            <div className="min-w-0 truncate font-semibold tracking-tight">
              RemcoChat
            </div>
          </div>
        </div>

        {desktopSidebarCollapsed ? (
          <div className="hidden items-center md:flex">
            <Button
              aria-label={t("sidebar.expand.aria")}
              className="h-9 w-9"
              data-testid="sidebar:desktop-toggle"
              onClick={onExpandDesktopSidebar}
              title={t("sidebar.expand.aria")}
              type="button"
              variant="outline"
            >
              <PanelLeftOpenIcon className="size-4" />
            </Button>
          </div>
        ) : null}

        <div className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto">
          <div className="hidden shrink-0 text-sm text-muted-foreground md:block">
            {t("model.label")}
          </div>
          <ModelPicker
            className="min-w-0 w-full md:w-auto"
            disabled={!isTemporaryChat && !canManageActiveChat}
            onChange={onChangeModel}
            options={modelOptions}
            triggerTestId="model:picker-trigger"
            value={effectiveModelId}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <HomeClientLanAdminTriggerButton
            allowed={lanAdminAccessAllowed}
            enabled={lanAdminAccessEnabled}
            hasToken={lanAdminAccessHasToken}
            onOpen={onOpenLanAdmin}
            t={t}
          />
          <Button
            aria-label={
              isTemporaryChat
                ? t("chat.temporary.exit_aria")
                : t("chat.temporary.enter_aria")
            }
            className={
              "h-9 w-9 px-0 " +
              (isTemporaryChat
                ? "border-destructive text-destructive bg-destructive/10 hover:bg-destructive/15 hover:text-destructive focus-visible:border-destructive focus-visible:ring-destructive/20"
                : "border-ring text-ring bg-transparent hover:bg-ring/10 hover:text-ring focus-visible:border-ring focus-visible:ring-ring/30")
            }
            data-testid="chat:temporary-toggle"
            onClick={onToggleTemporaryChat}
            title={
              isTemporaryChat
                ? t("chat.temporary.title_on")
                : t("chat.temporary.title_off")
            }
            type="button"
            variant="outline"
          >
            <GhostIcon className="size-4" />
          </Button>
          <ThemeToggle />
          {adminEnabled ? (
            <Button
              asChild
              className="h-9 w-9 px-0"
              data-testid="admin:open"
              title={t("admin.dialog.title")}
              variant="outline"
            >
              <Link aria-label={t("admin.open.aria")} href="/admin">
                <ShieldIcon className="size-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
