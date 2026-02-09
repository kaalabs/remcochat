import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampDesktopSidebarWidth,
  DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX,
  DESKTOP_SIDEBAR_MAX_WIDTH_PX,
  DESKTOP_SIDEBAR_MIN_WIDTH_PX,
  parseDesktopSidebarPrefs,
} from "../src/lib/sidebar-shell";

test("clampDesktopSidebarWidth enforces min and max bounds", () => {
  assert.equal(
    clampDesktopSidebarWidth(DESKTOP_SIDEBAR_MIN_WIDTH_PX - 100),
    DESKTOP_SIDEBAR_MIN_WIDTH_PX
  );
  assert.equal(
    clampDesktopSidebarWidth(DESKTOP_SIDEBAR_MAX_WIDTH_PX + 100),
    DESKTOP_SIDEBAR_MAX_WIDTH_PX
  );
});

test("clampDesktopSidebarWidth falls back to default for non-finite values", () => {
  assert.equal(
    clampDesktopSidebarWidth(Number.NaN),
    DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX
  );
  assert.equal(
    clampDesktopSidebarWidth(Number.POSITIVE_INFINITY),
    DESKTOP_SIDEBAR_DEFAULT_WIDTH_PX
  );
});

test("parseDesktopSidebarPrefs returns null for missing or invalid payload", () => {
  assert.equal(parseDesktopSidebarPrefs(null), null);
  assert.equal(parseDesktopSidebarPrefs(""), null);
  assert.equal(parseDesktopSidebarPrefs("{"), null);
  assert.equal(parseDesktopSidebarPrefs("[]"), null);
  assert.equal(parseDesktopSidebarPrefs('{"collapsed":"no","width":300}'), null);
  assert.equal(parseDesktopSidebarPrefs('{"collapsed":true}'), null);
  assert.equal(parseDesktopSidebarPrefs('{"width":300}'), null);
});

test("parseDesktopSidebarPrefs normalizes valid payload", () => {
  const parsed = parseDesktopSidebarPrefs('{"collapsed":true,"width":999}');
  assert.deepEqual(parsed, {
    collapsed: true,
    width: DESKTOP_SIDEBAR_MAX_WIDTH_PX,
  });
});
