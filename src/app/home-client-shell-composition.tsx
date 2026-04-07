"use client";

import {
  createHomeClientMainColumnProps,
} from "@/app/home-client-shell-main-column-props";
import {
  createHomeClientOverlaysProps,
} from "@/app/home-client-shell-overlays-props";
import {
  createHomeClientSidebarControllerSharedProps,
  renderHomeClientSidebarController,
} from "@/app/home-client-shell-sidebar-props";
import type {
  CreateHomeClientRootShellPropsInput,
  HomeClientRootShellProps,
} from "@/app/home-client-shell-types";

export function createHomeClientRootShellProps(
  input: CreateHomeClientRootShellPropsInput
): HomeClientRootShellProps {
  const sidebarControllerSharedProps =
    createHomeClientSidebarControllerSharedProps(input);

  return {
    desktopGridStyle: input.desktopGridStyle,
    desktopSidebarCollapsed: input.desktopSidebarCollapsed,
    desktopSidebarContent: input.desktopSidebarCollapsed
      ? null
      : renderHomeClientSidebarController(sidebarControllerSharedProps, "desktop"),
    desktopSidebarResizing: input.desktopSidebarResizing,
    mainColumn: createHomeClientMainColumnProps(input),
    onEndDesktopSidebarResize: input.endDesktopSidebarResize,
    onMoveDesktopSidebarResize: input.onMoveDesktopSidebarResize,
    onResetDesktopSidebarWidth: input.onResetDesktopSidebarWidth,
    onStartDesktopSidebarResize: input.startDesktopSidebarResize,
    overlays: createHomeClientOverlaysProps(input, sidebarControllerSharedProps),
    t: input.t,
  };
}
