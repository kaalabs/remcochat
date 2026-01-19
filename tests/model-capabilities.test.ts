import assert from "node:assert/strict";
import { test } from "node:test";
import { listModelCapabilityBadges } from "../src/lib/models";

test("listModelCapabilityBadges maps capabilities to display metadata", () => {
  const badges = listModelCapabilityBadges({
    tools: true,
    reasoning: false,
    temperature: false,
    attachments: true,
    structuredOutput: false,
  });

  assert.deepEqual(badges, [
    { key: "tools", label: "Tools", enabled: true },
    { key: "reasoning", label: "Reasoning", enabled: false },
    { key: "temperature", label: "Temp", enabled: false },
    { key: "attachments", label: "Files", enabled: true },
    { key: "structuredOutput", label: "JSON", enabled: false },
  ]);
});
