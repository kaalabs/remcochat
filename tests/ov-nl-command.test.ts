import assert from "node:assert/strict";
import { test } from "node:test";
import { __test__, routeOvNlCommand } from "../src/server/ov-nl-command";

test("mergeFollowUpWithContext fills trips.search from/to from previous trips output", () => {
  const merged = __test__.mergeFollowUpWithContext({
    command: {
      action: "trips.search",
      args: {
        intent: {
          hard: {
            directOnly: true,
          },
        },
      },
      confidence: 0.94,
      missing: [],
      clarification: "",
      isFollowUp: true,
    },
    context: {
      lastOvOutput: {
        kind: "trips.search",
        from: {
          code: "ALMC",
          uicCode: "8400058",
          nameShort: "Almere C.",
          nameMedium: "Almere Centrum",
          nameLong: "Almere Centrum",
          countryCode: "NL",
          lat: null,
          lng: null,
          distanceMeters: null,
        },
        to: {
          code: "GN",
          uicCode: "8400261",
          nameShort: "Groningen",
          nameMedium: "Groningen",
          nameLong: "Groningen",
          countryCode: "NL",
          lat: null,
          lng: null,
          distanceMeters: null,
        },
        via: null,
        trips: [],
        cacheTtlSeconds: 5,
        fetchedAt: "2030-02-07T12:00:00.000Z",
        cached: false,
      },
    },
  });

  assert.equal(merged.args.from, "Almere Centrum");
  assert.equal(merged.args.to, "Groningen");
});

test("mergeFollowUpWithContext fills board station from previous board output", () => {
  const merged = __test__.mergeFollowUpWithContext({
    command: {
      action: "departures.list",
      args: {
        intent: {
          soft: {
            rankBy: ["earliest_departure"],
          },
        },
      },
      confidence: 0.91,
      missing: [],
      clarification: "",
      isFollowUp: true,
    },
    context: {
      lastOvOutput: {
        kind: "departures.list",
        station: {
          code: "UT",
          uicCode: "8400621",
          nameShort: "Utrecht C.",
          nameMedium: "Utrecht Centraal",
          nameLong: "Utrecht Centraal",
          countryCode: "NL",
          lat: null,
          lng: null,
          distanceMeters: null,
        },
        departures: [],
        cacheTtlSeconds: 5,
        fetchedAt: "2030-02-07T12:00:00.000Z",
        cached: false,
      },
    },
  });

  assert.equal(merged.args.station, "Utrecht Centraal");
});

test("requiredMissingForAction detects missing trips.search fields", () => {
  const missing = __test__.requiredMissingForAction({
    action: "trips.search",
    args: {},
    confidence: 0.9,
    missing: [],
    clarification: "",
    isFollowUp: false,
  });

  assert.deepEqual(missing.sort(), ["from", "to"]);
});

test("clarificationForMissing returns concise station question", () => {
  const text = __test__.clarificationForMissing(
    {
      action: "departures.list",
      args: {},
      confidence: 0.9,
      missing: ["station"],
      clarification: "",
      isFollowUp: false,
    },
    ["station"]
  );

  assert.match(text, /station/i);
});

test("routeOvNlCommand deterministically routes simple Dutch trips.search when router is disabled", async () => {
  const result = await routeOvNlCommand({
    text: "ik wil vandaag van Almere Centrum naar groningen. geef me treinopties met een directe verbinding.",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.command.action, "trips.search");
  assert.equal(String(result.command.args.from ?? ""), "Almere Centrum");
  assert.equal(String(result.command.args.to ?? "").toLowerCase(), "groningen");
  assert.equal(String(result.command.args.dateTime ?? ""), "today");

  const intent = result.command.args.intent as
    | { hard?: { directOnly?: unknown; maxTransfers?: unknown }; soft?: { rankBy?: string[] } }
    | undefined;
  assert.equal(intent?.hard?.directOnly, true);
  assert.equal(intent?.hard?.maxTransfers, 0);
  assert.deepEqual(intent?.soft?.rankBy ?? [], []);
});

test("routeOvNlCommand keeps strict direct intent for explicit no-transfer wording", async () => {
  const result = await routeOvNlCommand({
    text: "ik wil van Almere Centrum naar Groningen, zonder overstap.",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const intent = result.command.args.intent as
    | { hard?: { directOnly?: unknown; maxTransfers?: unknown } }
    | undefined;
  assert.equal(intent?.hard?.directOnly, true);
  assert.equal(intent?.hard?.maxTransfers, 0);
});

test("routeOvNlCommand infers vanmiddag as afternoon datetime hint", async () => {
  const result = await routeOvNlCommand({
    text: "ik wil vanmiddag van almere muziekwijk naar groningen. geef me directe treinopties.",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(String(result.command.args.dateTime ?? ""), "today@15:00");

  const intent = result.command.args.intent as
    | { hard?: { directOnly?: unknown; maxTransfers?: unknown }; soft?: { rankBy?: string[] } }
    | undefined;
  assert.equal(intent?.hard?.directOnly, true);
  assert.equal(intent?.hard?.maxTransfers, 0);
  assert.deepEqual(intent?.soft?.rankBy ?? [], []);
});

test("routeOvNlCommand parses 'zo min mogelijk overstappen' as transfer-minimizing preference", async () => {
  const result = await routeOvNlCommand({
    text: "ik wil vanmiddag van almere muziekwijk naar groningen, met zo min mogelijk overstappen.",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  const intent = result.command.args.intent as
    | { hard?: { directOnly?: unknown; maxTransfers?: unknown }; soft?: { rankBy?: string[] } }
    | undefined;
  assert.equal(intent?.hard?.directOnly, undefined);
  assert.equal(intent?.hard?.maxTransfers, undefined);
  assert.deepEqual(intent?.soft?.rankBy, ["fewest_transfers"]);
});

test("routeOvNlCommand routes board prompt to departures.list with station", async () => {
  const result = await routeOvNlCommand({
    text: "laat het vertrekbord van station almere muziekwijk zien",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.command.action, "departures.list");
  assert.equal(String(result.command.args.station ?? ""), "almere muziekwijk");
});

test("routeOvNlCommand routes board prompt with explicit window to departures.window", async () => {
  const result = await routeOvNlCommand({
    text: "laat het vertrekbord van station almere muziekwijk zien tussen 18:00 en 19:00",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.command.action, "departures.window");
  assert.equal(String(result.command.args.station ?? ""), "almere muziekwijk");
  assert.equal(String(result.command.args.fromTime ?? ""), "18:00");
  assert.equal(String(result.command.args.toTime ?? ""), "19:00");
});

test("routeOvNlCommand asks clarification when board prompt is missing station", async () => {
  const result = await routeOvNlCommand({
    text: "laat het vertrekbord zien",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.equal(result.reason, "missing_required");
  assert.equal(result.missing.includes("station"), true);
  assert.match(result.clarification, /station/i);
});
