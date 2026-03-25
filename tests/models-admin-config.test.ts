import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileProviderModelReferences } from "../src/server/models-admin-config";

test("reconcileProviderModelReferences keeps valid required models", () => {
  const reconciled = reconcileProviderModelReferences({
    allowedModelIds: ["model-b", "model-a"],
    currentDefaultModelId: "model-a",
    currentRouterModelId: "model-b",
    supportedModelIds: ["model-a", "model-b", "model-c"],
  });

  assert.deepEqual(reconciled, {
    allowedModelIds: ["model-a", "model-b"],
    defaultModelId: "model-a",
    routerModelId: "model-b",
  });
});

test("reconcileProviderModelReferences replaces missing default and router with a valid fallback", () => {
  const reconciled = reconcileProviderModelReferences({
    allowedModelIds: ["model-c", "model-b"],
    currentDefaultModelId: "missing-default",
    currentRouterModelId: "missing-router",
    supportedModelIds: ["model-b", "model-c"],
  });

  assert.deepEqual(reconciled, {
    allowedModelIds: ["model-b", "model-c"],
    defaultModelId: "model-b",
    routerModelId: "model-b",
  });
});
