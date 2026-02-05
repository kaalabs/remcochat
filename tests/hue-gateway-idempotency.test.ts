import assert from "node:assert/strict";
import { test } from "node:test";
import { createHueGatewayDeterministicIds } from "../src/server/integrations/hue-gateway/v2/keys";

test("deterministic ids are stable for same payload (key order independent)", () => {
  const a = createHueGatewayDeterministicIds({
    turnKey: "chat-1:user-1",
    action: "room.set",
    args: { roomName: "Woonkamer", state: { on: true, brightness: 35 } },
  });

  const b = createHueGatewayDeterministicIds({
    turnKey: "chat-1:user-1",
    action: "room.set",
    args: { state: { brightness: 35, on: true }, roomName: "Woonkamer" },
  });

  assert.equal(a.requestId, b.requestId);
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.equal(a.hashHex, b.hashHex);
});

test("deterministic ids differ for different payloads", () => {
  const a = createHueGatewayDeterministicIds({
    turnKey: "chat-1:user-1",
    action: "light.set",
    args: { name: "Vibiemme", state: { on: true } },
  });

  const b = createHueGatewayDeterministicIds({
    turnKey: "chat-1:user-1",
    action: "light.set",
    args: { name: "Vibiemme", state: { on: false } },
  });

  assert.notEqual(a.hashHex, b.hashHex);
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
});

test("deterministic ids do not embed raw arg values", () => {
  const secret = "supersecret!not-in-keys";
  const ids = createHueGatewayDeterministicIds({
    turnKey: "chat-1:user-1",
    action: "clipv2.request",
    args: { method: "GET", path: "/clip/v2/resource/room", secret },
  });

  assert.ok(!ids.requestId.includes(secret));
  assert.ok(!ids.idempotencyKey.includes(secret));
});

test("undefined values do not affect hashing", () => {
  const a = createHueGatewayDeterministicIds({
    turnKey: "chat-1:user-1",
    action: "inventory.snapshot",
    args: { ifRevision: 123 },
  });

  const b = createHueGatewayDeterministicIds({
    turnKey: "chat-1:user-1",
    action: "inventory.snapshot",
    args: { ifRevision: 123, ignored: undefined },
  });

  assert.equal(a.hashHex, b.hashHex);
  assert.equal(a.requestId, b.requestId);
});
