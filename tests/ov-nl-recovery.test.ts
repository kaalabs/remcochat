import assert from "node:assert/strict";
import test from "node:test";
import {
  isOvNlErrorLikeOutput,
  isOvNlNonRecoverableErrorCode,
  isOvNlRecoverableErrorCode,
  shouldContinueOvRecovery,
  shouldRetryOvAutoRecovery,
  shouldSuppressAssistantTextForOvOutput,
} from "../src/lib/ov-nl-recovery";

const OV_ERROR_OUTPUT = {
  kind: "error",
  action: "trips.search",
  error: {
    code: "station_not_found",
    message: "No stations found.",
  },
  fetchedAt: "2026-02-10T00:00:00.000Z",
  cached: false,
} as const;

const OV_DISAMBIGUATION_OUTPUT = {
  kind: "disambiguation",
  action: "trips.search",
  query: "amsterdam",
  message: "Multiple stations match.",
  candidates: [],
  fetchedAt: "2026-02-10T00:00:00.000Z",
  cached: false,
} as const;

const OV_SUCCESS_OUTPUT = {
  kind: "trips.search",
  trips: [],
} as const;

test("isOvNlErrorLikeOutput matches error and disambiguation kinds", () => {
  assert.equal(isOvNlErrorLikeOutput(OV_ERROR_OUTPUT), true);
  assert.equal(isOvNlErrorLikeOutput(OV_DISAMBIGUATION_OUTPUT), true);
  assert.equal(isOvNlErrorLikeOutput(OV_SUCCESS_OUTPUT), false);
});

test("error code classification distinguishes recoverable and non-recoverable codes", () => {
  assert.equal(isOvNlRecoverableErrorCode("station_not_found"), true);
  assert.equal(isOvNlRecoverableErrorCode("upstream_unreachable"), true);
  assert.equal(isOvNlRecoverableErrorCode("config_error"), false);
  assert.equal(isOvNlRecoverableErrorCode("access_denied"), false);

  assert.equal(isOvNlNonRecoverableErrorCode("config_error"), true);
  assert.equal(isOvNlNonRecoverableErrorCode("access_denied"), true);
  assert.equal(isOvNlNonRecoverableErrorCode("station_not_found"), false);
});

test("shouldSuppressAssistantTextForOvOutput suppresses success and allows error/disambiguation text", () => {
  assert.equal(shouldSuppressAssistantTextForOvOutput(OV_SUCCESS_OUTPUT), true);
  assert.equal(shouldSuppressAssistantTextForOvOutput(OV_ERROR_OUTPUT), false);
  assert.equal(shouldSuppressAssistantTextForOvOutput(OV_DISAMBIGUATION_OUTPUT), false);
});

test("shouldContinueOvRecovery only triggers for tool-calls + error-like output + no text", () => {
  assert.equal(
    shouldContinueOvRecovery({
      finishReason: "tool-calls",
      lastOvOutput: OV_ERROR_OUTPUT,
      hasTextDelta: false,
    }),
    true
  );

  assert.equal(
    shouldContinueOvRecovery({
      finishReason: "tool-calls",
      lastOvOutput: OV_SUCCESS_OUTPUT,
      hasTextDelta: false,
    }),
    false
  );

  assert.equal(
    shouldContinueOvRecovery({
      finishReason: "tool-calls",
      lastOvOutput: OV_ERROR_OUTPUT,
      hasTextDelta: true,
    }),
    false
  );
});

test("shouldRetryOvAutoRecovery retries recoverable errors only and stops when text already exists", () => {
  assert.equal(
    shouldRetryOvAutoRecovery({
      lastOvOutput: OV_ERROR_OUTPUT,
      retriesRemaining: 4,
      hasTextDelta: false,
    }),
    true
  );

  assert.equal(
    shouldRetryOvAutoRecovery({
      lastOvOutput: OV_ERROR_OUTPUT,
      retriesRemaining: 0,
      hasTextDelta: false,
    }),
    false
  );

  assert.equal(
    shouldRetryOvAutoRecovery({
      lastOvOutput: {
        ...OV_ERROR_OUTPUT,
        error: { ...OV_ERROR_OUTPUT.error, code: "config_error" },
      },
      retriesRemaining: 4,
      hasTextDelta: false,
    }),
    false
  );

  assert.equal(
    shouldRetryOvAutoRecovery({
      lastOvOutput: OV_DISAMBIGUATION_OUTPUT,
      retriesRemaining: 4,
      hasTextDelta: false,
    }),
    false
  );

  assert.equal(
    shouldRetryOvAutoRecovery({
      lastOvOutput: OV_ERROR_OUTPUT,
      retriesRemaining: 4,
      hasTextDelta: true,
    }),
    false
  );
});

test("retry budget is capped: recoverable OV retries stop after 4 attempts", () => {
  let retriesRemaining = 4;
  let attempts = 0;

  while (
    shouldRetryOvAutoRecovery({
      lastOvOutput: OV_ERROR_OUTPUT,
      retriesRemaining,
      hasTextDelta: false,
    })
  ) {
    attempts += 1;
    retriesRemaining -= 1;
  }

  assert.equal(attempts, 4);
  assert.equal(retriesRemaining, 0);
});

