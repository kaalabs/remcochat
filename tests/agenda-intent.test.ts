import assert from "node:assert/strict";
import { test } from "node:test";
import { __test__ } from "../src/server/agenda-intent";

test("agenda intent coercion rejects whitespace-only description for create", () => {
  const res = __test__.toAgendaCommand({
    action: "create",
    description: "   ",
    date: "2026-02-03",
    time: "09:30",
    duration_minutes: 15,
  } as any);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.match(res.error, /description/i);
});

test("agenda intent coercion accepts trimmed description for create", () => {
  const res = __test__.toAgendaCommand({
    action: "create",
    description: "  standup  ",
    date: "2026-02-03",
    time: "09:30",
    duration_minutes: 15,
  } as any);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.command.action, "create");
  assert.equal((res.command as any).description, "standup");
});

test("agenda intent coercion defaults list range when omitted", () => {
  const res = __test__.toAgendaCommand({ action: "list" } as any);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.command.action, "list");
  assert.equal((res.command as any).range.kind, "next_n_days");
  assert.equal((res.command as any).range.days, 30);
});

