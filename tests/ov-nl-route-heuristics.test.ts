import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDirectnessToIntent,
  applyTripsTextHeuristicsToArgs,
  extractRouteFromText,
  inferDateTimeHintFromText,
  inferDirectnessFromText,
} from "../src/lib/ov-nl-route-heuristics";

test("extractRouteFromText parses Dutch route and trims trailing request words", () => {
  const route = extractRouteFromText(
    "ik wil vanmiddag van almere muziekwijk naar groningen. geef me directe treinopties."
  );
  assert.deepEqual(route, {
    from: "almere muziekwijk",
    to: "groningen",
  });
});

test("extractRouteFromText trims trailing date/time hints from station segments", () => {
  const route = extractRouteFromText(
    "ik wil van almere muziekwijk naar amsterdam centraal vandaag. geef me treinopties"
  );
  assert.deepEqual(route, {
    from: "almere muziekwijk",
    to: "amsterdam centraal",
  });

  const routeWithTime = extractRouteFromText(
    "ik wil van almere muziekwijk naar amsterdam centraal om 10:05"
  );
  assert.deepEqual(routeWithTime, {
    from: "almere muziekwijk",
    to: "amsterdam centraal",
  });
});

test("inferDirectnessFromText distinguishes strict vs preferred direct wording", () => {
  assert.equal(inferDirectnessFromText("ik wil directe treinopties"), "strict");
  assert.equal(inferDirectnessFromText("ik wil liefst direct reizen"), "preferred");
  assert.equal(inferDirectnessFromText("ik wil zonder overstap reizen"), "strict");
  assert.equal(inferDirectnessFromText("only direct trains, no transfers"), "strict");
  assert.equal(
    inferDirectnessFromText("ik wil van almere naar groningen met zo min mogelijk overstappen"),
    "preferred"
  );
  assert.equal(inferDirectnessFromText("wat is de snelste route?"), "none");
});

test("inferDateTimeHintFromText recognizes Dutch relative dayparts and explicit times", () => {
  assert.equal(inferDateTimeHintFromText("ik wil vanmiddag vertrekken"), "today@15:00");
  assert.equal(inferDateTimeHintFromText("ik reis vanavond"), "today@19:00");
  assert.equal(inferDateTimeHintFromText("ik wil morgen om 14:35 vertrekken"), "tomorrow@14:35");
  assert.equal(inferDateTimeHintFromText("ik wil morgen om 07 vertrekken"), "tomorrow@07:00");
  assert.equal(inferDateTimeHintFromText("ik wil morgen om 7 uur vertrekken"), "tomorrow@07:00");
  assert.equal(inferDateTimeHintFromText("ik wil vandaag vertrekken"), "today");
});

test("applyDirectnessToIntent strict enforces directOnly and maxTransfers=0", () => {
  const intent = applyDirectnessToIntent(undefined, "strict");
  assert.deepEqual(intent, {
    hard: {
      directOnly: true,
      maxTransfers: 0,
    },
  });
});

test("applyDirectnessToIntent preferred preserves existing strict hard direct filters", () => {
  const intent = applyDirectnessToIntent(
    {
      hard: {
        directOnly: true,
        maxTransfers: 0,
        maxDurationMinutes: 120,
      },
    },
    "preferred"
  );

  assert.deepEqual(intent, {
    hard: {
      directOnly: true,
      maxTransfers: 0,
      maxDurationMinutes: 120,
    },
  });
});

test("applyTripsTextHeuristicsToArgs maps direct options phrasing to strict direct-only constraints", () => {
  const args = applyTripsTextHeuristicsToArgs({
    text: "ik wil van almere centrum naar groningen, geef me directe treinopties",
    args: {},
  });

  assert.equal(args.from, "almere centrum");
  assert.equal(args.to, "groningen");
  assert.deepEqual(args.intent, {
    hard: {
      directOnly: true,
      maxTransfers: 0,
    },
  });
});

test("applyTripsTextHeuristicsToArgs strips trailing hints from existing from/to args", () => {
  const args = applyTripsTextHeuristicsToArgs({
    text: "ik wil van almere muziekwijk naar amsterdam centraal vandaag. geef me treinopties",
    args: {
      from: "Almere Muziekwijk",
      to: "Amsterdam Centraal vandaag",
    },
  });

  assert.equal(args.from, "Almere Muziekwijk");
  assert.equal(args.to, "Amsterdam Centraal");
  assert.equal(args.dateTime, "today");
});

test("applyTripsTextHeuristicsToArgs does not enforce strict direct-only without user wording", () => {
  const args = applyTripsTextHeuristicsToArgs({
    text: "ik wil vandaag van almere muziekwijk naar amsterdam centraal. geef me treinopties",
    args: {
      from: "Almere Muziekwijk",
      to: "Amsterdam Centraal",
      intent: {
        hard: {
          directOnly: true,
          maxTransfers: 0,
        },
      },
    },
  });

  const intent = args.intent as { hard?: Record<string, unknown> } | undefined;
  const hard = intent?.hard ?? {};
  assert.equal(hard.directOnly, undefined);
  assert.equal(hard.maxTransfers, undefined);
});

test("applyTripsTextHeuristicsToArgs keeps strict hard directness for no-transfer wording", () => {
  const args = applyTripsTextHeuristicsToArgs({
    text: "ik wil van almere centrum naar groningen, zonder overstap",
    args: {},
  });

  assert.equal(args.from, "almere centrum");
  assert.equal(args.to, "groningen");
  assert.deepEqual(args.intent, {
    hard: {
      directOnly: true,
      maxTransfers: 0,
    },
  });
});

test("applyTripsTextHeuristicsToArgs preserves existing intent and augments rankBy", () => {
  const args = applyTripsTextHeuristicsToArgs({
    text: "ik wil liefst directe opties",
    args: {
      from: "Almere Centrum",
      to: "Groningen",
      intent: {
        hard: {
          maxDurationMinutes: 130,
        },
        soft: {
          rankBy: ["fastest"],
        },
      },
    },
  });

  assert.deepEqual(args.intent, {
    hard: {
      maxDurationMinutes: 130,
    },
    soft: {
      rankBy: ["fewest_transfers", "fastest"],
    },
  });
});

test("applyTripsTextHeuristicsToArgs maps 'zo min mogelijk overstappen' to fewest_transfers", () => {
  const args = applyTripsTextHeuristicsToArgs({
    text: "ik wil van almere centrum naar groningen met zo min mogelijk overstappen",
    args: {},
  });

  assert.deepEqual(args.intent, {
    soft: {
      rankBy: ["fewest_transfers"],
    },
  });
});
