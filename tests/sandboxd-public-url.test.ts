import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPublishedPortUrl } from "../sandboxd/src/public-url";

test("sandboxd port url prefers publishedPortHostIp over request Host header", () => {
  const url = buildPublishedPortUrl({
    hostHeader: "sandboxd:8080",
    bindHost: "0.0.0.0",
    publishedPortHostIp: "100.71.169.51",
    hostPort: 32768,
  });
  assert.equal(url, "http://100.71.169.51:32768");
});

test("sandboxd port url falls back to request Host when publishedPortHostIp is 0.0.0.0", () => {
  const url = buildPublishedPortUrl({
    hostHeader: "100.71.169.51:8080",
    bindHost: "0.0.0.0",
    publishedPortHostIp: "0.0.0.0",
    hostPort: 32768,
  });
  assert.equal(url, "http://100.71.169.51:32768");
});

test("sandboxd port url respects SANDBOXD_PUBLIC_HOST override", () => {
  const url = buildPublishedPortUrl({
    hostHeader: "sandboxd:8080",
    bindHost: "0.0.0.0",
    publishedPortHostIp: "100.71.169.51",
    hostPort: 32768,
    publicHost: "klubnt01",
  });
  assert.equal(url, "http://klubnt01:32768");
});

test("sandboxd port url supports https proto override", () => {
  const url = buildPublishedPortUrl({
    hostHeader: "sandboxd:8080",
    bindHost: "0.0.0.0",
    publishedPortHostIp: "100.71.169.51",
    hostPort: 32768,
    publicHost: "example.test",
    publicProto: "https",
  });
  assert.equal(url, "https://example.test:32768");
});

