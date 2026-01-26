import assert from "node:assert/strict";
import { test } from "node:test";
import { __test__ } from "../src/server/agenda";

test("computeRange next_n_days uses UTC boundaries", () => {
  const range = __test__.computeRange({
    kind: "next_n_days",
    days: 3,
    timezone: "UTC",
  });

  assert.equal(range.rangeLabel, "Next 3 days");
  const diffMs = range.endUtc.getTime() - range.startUtc.getTime();
  assert.equal(Math.round(diffMs / 86_400_000), 3);
});

test("zonedDateTimeToUtc returns expected UTC timestamp", () => {
  const utcDate = __test__.zonedDateTimeToUtc(
    { year: 2024, month: 1, day: 2 },
    { hour: 10, minute: 30 },
    "UTC"
  );
  assert.equal(utcDate.toISOString(), "2024-01-02T10:30:00.000Z");
});

test("parseDateParts validates format", () => {
  const parts = __test__.parseDateParts("2024-11-09");
  assert.deepEqual(parts, { year: 2024, month: 11, day: 9 });
  assert.throws(() => __test__.parseDateParts("2024/11/09"));
});

test("parseTimeParts validates format", () => {
  const parts = __test__.parseTimeParts("09:05");
  assert.deepEqual(parts, { hour: 9, minute: 5, second: 0 });
  assert.throws(() => __test__.parseTimeParts("9:5"));
});
