import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeThemeSelection,
  toggleThemeFromResolved,
} from "../src/lib/theme";

test("normalizeThemeSelection defaults to system", () => {
  assert.equal(normalizeThemeSelection(undefined), "system");
  assert.equal(normalizeThemeSelection(null), "system");
  assert.equal(normalizeThemeSelection(""), "system");
  assert.equal(normalizeThemeSelection("banana"), "system");
});

test("normalizeThemeSelection accepts system/light/dark", () => {
  assert.equal(normalizeThemeSelection("system"), "system");
  assert.equal(normalizeThemeSelection("light"), "light");
  assert.equal(normalizeThemeSelection("dark"), "dark");
});

test("toggleThemeFromResolved toggles based on resolved theme", () => {
  assert.equal(toggleThemeFromResolved("dark"), "light");
  assert.equal(toggleThemeFromResolved("light"), "dark");
  assert.equal(toggleThemeFromResolved(undefined), "dark");
  assert.equal(toggleThemeFromResolved("banana"), "dark");
});

