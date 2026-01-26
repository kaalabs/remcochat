import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMemoryAddCommand, parseMemorizeDecision } from "../src/server/memory-commands";

test("parseMemorizeDecision recognizes confirm/cancel variants", () => {
  assert.equal(parseMemorizeDecision("Confirm memory"), "confirm");
  assert.equal(parseMemorizeDecision("Cancel memory"), "cancel");
  assert.equal(parseMemorizeDecision("yes"), "confirm");
  assert.equal(parseMemorizeDecision("no"), "cancel");
  assert.equal(parseMemorizeDecision(""), null);
});

test("parseMemoryAddCommand extracts candidate from common command forms", () => {
  assert.equal(
    parseMemoryAddCommand("Remember this: my timezone is Europe/Amsterdam"),
    "my timezone is Europe/Amsterdam"
  );
  assert.equal(
    parseMemoryAddCommand("Please remember that my cat is named Miso."),
    "my cat is named Miso."
  );
  assert.equal(
    parseMemoryAddCommand("Save this to memory: wifi password is 1234"),
    "wifi password is 1234"
  );
});

test("parseMemoryAddCommand avoids non-command 'remember when/how' phrasing", () => {
  assert.equal(parseMemoryAddCommand("Remember when we met?"), null);
  assert.equal(parseMemoryAddCommand("remember how that worked"), null);
});

