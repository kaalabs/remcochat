import assert from "node:assert/strict";
import { test } from "node:test";
import { isListIntent, isListsOverviewIntent } from "../src/server/list-intent";

test("detects list intent for issue lists and todos", () => {
  assert.equal(
    isListIntent("Add issue to RemcoChat issues list"),
    true
  );
  assert.equal(isListIntent("Show my to-do list"), true);
  assert.equal(isListIntent("Voeg dit toe aan mijn boodschappenlijst"), true);
  assert.equal(isListIntent("Show my lists"), true);
});

test("does not treat generic listing as list intent", () => {
  assert.equal(isListIntent("List the steps to deploy"), false);
});

test("detects list overview intent", () => {
  assert.equal(isListsOverviewIntent("Show my lists"), true);
  assert.equal(isListsOverviewIntent("Welke lijsten heb ik?"), true);
  assert.equal(isListsOverviewIntent("Overview of my lists"), true);
});
