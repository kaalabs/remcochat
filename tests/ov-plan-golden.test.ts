import assert from "node:assert/strict";
import { test } from "node:test";
import { compileOvPlan } from "../src/server/ov/planner";

test("compileOvPlan produces minimal trips.search args and requestMeta", () => {
  const planned = compileOvPlan({
    version: 1,
    intentKind: "trips.search",
    confidence: 0.92,
    isFollowUp: false,
    slots: {
      fromText: "Almere Muziekwijk",
      toText: "Amsterdam Centraal",
      dateTimeHint: "today",
    },
    requested: {
      hard: {
        directOnly: true,
        maxTransfers: 0,
        includeModes: ["PUBLIC_TRANSIT"],
      },
      soft: {
        rankBy: ["fastest"],
      },
    },
    missing: [],
    clarification: "",
  });

  assert.equal(planned.ok, true);
  if (!planned.ok) return;

  assert.equal(planned.plan.action, "trips.search");
  assert.equal(planned.plan.args.from, "Almere Muziekwijk");
  assert.equal(planned.plan.args.to, "Amsterdam Centraal");
  assert.equal(planned.plan.args.dateTime, "today");
  assert.equal(planned.plan.requestMeta.requestedDirectOnly, true);
  assert.equal(planned.plan.requestMeta.requestedHardKeys.includes("directOnly"), true);
});

test("compileOvPlan returns missing_required for departures.window missing station", () => {
  const planned = compileOvPlan({
    version: 1,
    intentKind: "departures.window",
    confidence: 0.9,
    isFollowUp: false,
    slots: {
      fromTime: "18:00",
      toTime: "19:00",
    },
    requested: {},
    missing: [],
    clarification: "",
  });

  assert.equal(planned.ok, false);
  if (planned.ok) return;
  assert.equal(planned.missing.includes("station"), true);
});

