import assert from "node:assert/strict";
import { test } from "node:test";
import type { I18nContextValue } from "../src/components/i18n-provider";
import {
  normalizeFolderNameDraft,
  validateFolderNameDraft,
} from "../src/app/home-client-folder-actions";

const t = ((key: string) => key) as I18nContextValue["t"];

test("normalizeFolderNameDraft trims and collapses whitespace", () => {
  assert.equal(normalizeFolderNameDraft("  Plans   for \n tonight  "), "Plans for tonight");
});

test("validateFolderNameDraft rejects empty values and overlong names", () => {
  assert.deepEqual(validateFolderNameDraft("   ", t), {
    ok: false,
    error: "validation.folder.name_required",
  });
  assert.deepEqual(validateFolderNameDraft("x".repeat(61), t), {
    ok: false,
    error: "validation.folder.name_too_long",
  });
});

test("validateFolderNameDraft returns normalized folder names", () => {
  assert.deepEqual(validateFolderNameDraft("  Weekend   tasks  ", t), {
    ok: true,
    name: "Weekend tasks",
  });
});
