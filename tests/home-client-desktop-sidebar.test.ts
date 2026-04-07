import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopSidebarLayout } from "@/app/home-client-desktop-sidebar";

test("buildDesktopSidebarLayout collapses the sidebar column when collapsed", () => {
  const result = buildDesktopSidebarLayout({
    collapsed: true,
    widthPx: 320,
  });

  assert.deepEqual(result, {
    desktopGridStyle: {
      "--rc-desktop-sidebar-cols": "0px minmax(0, 1fr)",
    },
  });
});

test("buildDesktopSidebarLayout clamps the expanded sidebar width", () => {
  const result = buildDesktopSidebarLayout({
    collapsed: false,
    widthPx: 999,
  });

  assert.deepEqual(result, {
    desktopGridStyle: {
      "--rc-desktop-sidebar-cols": "560px minmax(0, 1fr)",
    },
  });
});
