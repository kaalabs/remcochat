import assert from "node:assert/strict";
import { test } from "node:test";
import { t } from "../src/lib/i18n";

test("t() resolves known keys for en and nl", () => {
  assert.equal(t("en", "common.save"), "Save");
  assert.equal(t("nl", "common.save"), "Opslaan");
});

test("t() interpolates {vars}", () => {
  assert.equal(
    t("en", "tool.calling", { toolName: "displayNotes" }),
    'Calling tool: "displayNotes"'
  );
});

test("t() falls back to key when key is unknown", () => {
  assert.equal(t("en", "missing.key" as any), "missing.key");
  assert.equal(t("nl", "missing.key" as any), "missing.key");
});

