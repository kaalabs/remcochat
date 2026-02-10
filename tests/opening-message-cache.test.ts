import assert from "node:assert/strict";
import { test } from "node:test";
import type { UiLanguage } from "../src/lib/types";
import {
  mergeOpeningMessageNext,
  parseOpeningMessageCache,
  selectOpeningMessageFromCache,
} from "../src/lib/opening-message-cache";

test("parseOpeningMessageCache rejects malformed payloads", () => {
  assert.equal(parseOpeningMessageCache(""), null);
  assert.equal(parseOpeningMessageCache("not-json"), null);
  assert.equal(parseOpeningMessageCache('{"current":"a"}'), null);
  assert.equal(
    parseOpeningMessageCache(
      JSON.stringify({ current: "a", next: "b", updatedAt: "not-a-date" })
    ),
    null
  );
});

test("selectOpeningMessageFromCache rotates next -> current", () => {
  const now = new Date("2026-02-10T12:00:00.000Z");
  const selected = selectOpeningMessageFromCache({
    cache: {
      current: "Current opener.",
      next: "Next opener.",
      updatedAt: "2026-02-10T11:00:00.000Z",
    },
    fallback: "Fallback opener.",
    now,
  });

  assert.equal(selected.displayed, "Next opener.");
  assert.equal(selected.nextCache.current, "Next opener.");
  assert.equal(selected.nextCache.next, "Current opener.");
  assert.equal(selected.nextCache.updatedAt, now.toISOString());
});

test("selectOpeningMessageFromCache falls back to current and fallback", () => {
  const now = new Date("2026-02-10T12:01:00.000Z");
  const selectedFromCurrent = selectOpeningMessageFromCache({
    cache: {
      current: "Only current.",
      next: "",
      updatedAt: "2026-02-10T11:00:00.000Z",
    },
    fallback: "Fallback opener.",
    now,
  });
  assert.equal(selectedFromCurrent.displayed, "Only current.");
  assert.equal(selectedFromCurrent.nextCache.next, "Fallback opener.");

  const selectedFromFallback = selectOpeningMessageFromCache({
    cache: null,
    fallback: "Fallback opener.",
    now,
  });
  assert.equal(selectedFromFallback.displayed, "Fallback opener.");
  assert.equal(selectedFromFallback.nextCache.next, "Fallback opener.");
});

test("mergeOpeningMessageNext keeps a non-empty next value", () => {
  const now = new Date("2026-02-10T12:02:00.000Z");

  const merged = mergeOpeningMessageNext({
    displayed: "Displayed opener.",
    next: "",
    fallback: "Fallback opener.",
    now,
  });

  assert.equal(merged.current, "Displayed opener.");
  assert.equal(merged.next, "Fallback opener.");
  assert.equal(merged.updatedAt, now.toISOString());
});

test("opening message language maps are exhaustive at compile-time", () => {
  const coverage: Record<UiLanguage, true> = {
    en: true,
    nl: true,
  };
  assert.equal(coverage.en, true);
  assert.equal(coverage.nl, true);
});
