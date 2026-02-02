import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inferAgendaDescriptionFromUserText,
  pickAgendaDescriptionFromRecord,
} from "../src/ai/agenda-description";

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

test("inferAgendaDescriptionFromUserText extracts description from Dutch command", () => {
  assert.equal(
    inferAgendaDescriptionFromUserText(
      "Zet dauwtrappen in mijn agenda, morgen tussen 17:00 en 18:00",
    ),
    "dauwtrappen",
  );
  assert.equal(
    inferAgendaDescriptionFromUserText(
      'Zet \"Dauwtrappen\" in mijn agenda morgen tussen 17:00 en 18:00',
    ),
    "Dauwtrappen",
  );
});
