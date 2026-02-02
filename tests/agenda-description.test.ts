import assert from "node:assert/strict";
import { test } from "node:test";
import { pickAgendaDescriptionFromRecord } from "../src/ai/agenda-description";

test("pickAgendaDescriptionFromRecord reads Dutch aliases", () => {
  assert.equal(
    pickAgendaDescriptionFromRecord({ beschrijving: "dauwtrappen" }),
    "dauwtrappen",
  );
  assert.equal(
    pickAgendaDescriptionFromRecord({ omschrijving: "Dauwtrappen" }),
    "Dauwtrappen",
  );
});

test("pickAgendaDescriptionFromRecord reads common alternates and case variants", () => {
  assert.equal(
    pickAgendaDescriptionFromRecord({ title: "Dauwtrappen" }),
    "Dauwtrappen",
  );
  assert.equal(
    pickAgendaDescriptionFromRecord({ Description: "Dauwtrappen" }),
    "Dauwtrappen",
  );
  assert.equal(
    pickAgendaDescriptionFromRecord({ eventName: "Dauwtrappen" }),
    "Dauwtrappen",
  );
});

test("pickAgendaDescriptionFromRecord returns empty string when missing", () => {
  assert.equal(pickAgendaDescriptionFromRecord({}), "");
  assert.equal(pickAgendaDescriptionFromRecord(null), "");
});

