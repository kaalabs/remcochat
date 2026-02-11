import assert from "node:assert/strict";
import { test } from "node:test";
import { detectToolDependenciesFromText } from "../src/server/readiness/detect";

test("detectToolDependenciesFromText finds tool tokens case-insensitively", () => {
  const deps = detectToolDependenciesFromText(`
Use the hueGateway tool.
Use the ovNlGateway tool too.
`);
  assert.deepEqual(deps.sort(), ["hueGateway", "ovNlGateway"].sort());
});

test("detectToolDependenciesFromText returns empty when no tokens", () => {
  const deps = detectToolDependenciesFromText(`No tools mentioned here.`);
  assert.deepEqual(deps, []);
});

