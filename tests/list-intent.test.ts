import assert from "node:assert/strict";
import { test } from "node:test";
import { isListIntent } from "../src/server/list-intent";

test("detects list intent for issue lists and todos", () => {
  assert.equal(
    isListIntent("Add issue to RemcoChat issues list"),
    true
  );
  assert.equal(isListIntent("Show my to-do list"), true);
  assert.equal(isListIntent("Voeg dit toe aan mijn boodschappenlijst"), true);
});

test("does not treat generic listing as list intent", () => {
  assert.equal(isListIntent("List the steps to deploy"), false);
});

