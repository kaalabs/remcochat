import assert from "node:assert/strict";
import { test } from "node:test";
import { detectUiLanguageFromAcceptLanguage } from "../src/lib/i18n";

test("detectUiLanguageFromAcceptLanguage returns nl when the first language is nl", () => {
  assert.equal(
    detectUiLanguageFromAcceptLanguage("nl-NL,nl;q=0.9,en-US;q=0.8"),
    "nl"
  );
  assert.equal(detectUiLanguageFromAcceptLanguage("NL"), "nl");
  assert.equal(detectUiLanguageFromAcceptLanguage("nl;q=0.9,en;q=0.8"), "nl");
});

test("detectUiLanguageFromAcceptLanguage returns en for non-nl headers and empty values", () => {
  assert.equal(detectUiLanguageFromAcceptLanguage("en-US,en;q=0.9"), "en");
  assert.equal(detectUiLanguageFromAcceptLanguage("fr-FR,fr;q=0.9"), "en");
  assert.equal(detectUiLanguageFromAcceptLanguage(""), "en");
  assert.equal(detectUiLanguageFromAcceptLanguage(null), "en");
  assert.equal(detectUiLanguageFromAcceptLanguage(undefined), "en");
});

