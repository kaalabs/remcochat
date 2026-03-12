import assert from "node:assert/strict";
import { test } from "node:test";
import { createTools, repairDisplayAgendaInput } from "../src/ai/tools";

test("repairDisplayAgendaInput canonicalizes legacy agenda aliases", () => {
  const repaired = repairDisplayAgendaInput({
    action: "create",
    titel: "Dentist appointment",
    date: "2026-03-16",
    time: "09:30",
    duration_minutes: "30",
    unknown_field: "ignored",
  });

  assert.deepEqual(repaired, {
    action: "create",
    description: "Dentist appointment",
    date: "2026-03-16",
    time: "09:30",
    duration_minutes: 30,
  });
});

test("repairDisplayAgendaInput strips unknown keys from list actions", () => {
  const repaired = repairDisplayAgendaInput({
    action: "list",
    range: {
      kind: "next_n_days",
      days: "7",
      timezone: "Europe/Amsterdam",
      ignored: "value",
    },
    include_overlaps: true,
    ignored: "value",
  });

  assert.deepEqual(repaired, {
    action: "list",
    range: {
      kind: "next_n_days",
      days: 7,
      timezone: "Europe/Amsterdam",
    },
    include_overlaps: true,
  });
});

test("repairDisplayAgendaInput refuses incomplete create calls", () => {
  const repaired = repairDisplayAgendaInput({
    action: "create",
    description: "Missing time",
    date: "2026-03-16",
  });

  assert.equal(repaired, null);
});

test("displayAgenda advertises a top-level object JSON schema for provider compatibility", () => {
  const bundle = createTools({
    profileId: "profile_test",
    viewerTimeZone: "Europe/Amsterdam",
    isTemporary: false,
  });
  const displayAgendaEntry = bundle.entries.find((entry) => entry.name === "displayAgenda");
  const displayAgendaTool = displayAgendaEntry?.tool as
    | {
        inputSchema?: {
          jsonSchema?: Record<string, unknown>;
        };
      }
    | undefined;
  const jsonSchema = displayAgendaTool?.inputSchema?.jsonSchema;

  assert.ok(displayAgendaEntry);
  assert.ok(jsonSchema);
  assert.equal(jsonSchema.type, "object");
  assert.equal(jsonSchema.additionalProperties, false);
  assert.ok(!("oneOf" in jsonSchema));
});
