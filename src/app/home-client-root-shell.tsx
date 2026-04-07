"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";

import type { I18nContextValue } from "@/components/i18n-provider";
import { HomeClientMainColumn } from "@/app/home-client-main-column";
import { HomeClientOverlays } from "@/app/home-client-overlays";

type HomeClientRootShellProps = {
  desktopGridStyle: CSSProperties;
  desktopSidebarCollapsed: boolean;
  desktopSidebarContent: ReactNode;
  desktopSidebarResizing: boolean;
  mainColumn: ComponentProps<typeof HomeClientMainColumn>;
  onEndDesktopSidebarResize: ComponentProps<"div">["onPointerUp"];
  onMoveDesktopSidebarResize: ComponentProps<"div">["onPointerMove"];
  onResetDesktopSidebarWidth: ComponentProps<"div">["onDoubleClick"];
  onStartDesktopSidebarResize: ComponentProps<"div">["onPointerDown"];
  overlays: ComponentProps<typeof HomeClientOverlays>;
  t: I18nContextValue["t"];
};

export function HomeClientRootShell({
  desktopGridStyle,
  desktopSidebarCollapsed,
  desktopSidebarContent,
  desktopSidebarResizing,
  mainColumn,
  onEndDesktopSidebarResize,
  onMoveDesktopSidebarResize,
  onResetDesktopSidebarWidth,
  onStartDesktopSidebarResize,
  overlays,
  t,
}: HomeClientRootShellProps) {
  return (
    <div className="h-dvh w-full overflow-hidden bg-background text-foreground">
      <div
        className="rc-shell-grid grid h-full min-h-0 grid-cols-1 md:[grid-template-columns:var(--rc-desktop-sidebar-cols)]"
        style={desktopGridStyle}
      >
        <aside
          aria-hidden={desktopSidebarCollapsed}
          className={
            "rc-desktop-sidebar relative hidden min-h-0 flex-col bg-sidebar text-sidebar-foreground md:flex " +
            (desktopSidebarCollapsed
              ? "overflow-hidden border-r-0"
              : "overflow-visible border-r")
          }
          data-testid="sidebar:desktop"
        >
          {!desktopSidebarCollapsed ? desktopSidebarContent : null}
          {!desktopSidebarCollapsed ? (
            <div
              aria-label={t("sidebar.resize_handle.aria")}
              className={
                "absolute right-0 top-0 hidden h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none md:block " +
                (desktopSidebarResizing
                  ? "bg-sidebar-primary/40"
                  : "bg-transparent")
              }
              data-testid="sidebar:desktop-resize-handle"
              onDoubleClick={onResetDesktopSidebarWidth}
              onPointerCancel={onEndDesktopSidebarResize}
              onPointerDown={onStartDesktopSidebarResize}
              onPointerMove={onMoveDesktopSidebarResize}
              onPointerUp={onEndDesktopSidebarResize}
              role="separator"
            />
          ) : null}
        </aside>

        <HomeClientMainColumn {...mainColumn} />
      </div>

      <HomeClientOverlays {...overlays} />
    </div>
  );
}
