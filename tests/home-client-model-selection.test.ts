import assert from "node:assert/strict";
import test from "node:test";

import type { ProvidersResponse } from "../src/lib/providers-response";
import {
  buildLastUsedModelKey,
  resolveActiveProvider,
  resolveEffectiveModelId,
  resolvePreferredNewChatModelId,
  resolveProfileDefaultModelId,
} from "../src/app/home-client-model-selection";

const allowedModels = new Set(["model-a", "model-b", "model-c"]);
const isAllowedModel = (modelId: unknown): modelId is string =>
  typeof modelId === "string" && allowedModels.has(modelId);

function makeProvidersResponse(
  overrides: Partial<ProvidersResponse> = {}
): ProvidersResponse {
  return {
    activeProviderId: overrides.activeProviderId ?? "provider-b",
    defaultProviderId: overrides.defaultProviderId ?? "provider-a",
    webToolsEnabled: overrides.webToolsEnabled ?? true,
    providers:
      overrides.providers ?? [
        {
          id: "provider-a",
          name: "Provider A",
          defaultModelId: "model-a",
          models: [{ id: "model-a", label: "Model A" }],
        },
        {
          id: "provider-b",
          name: "Provider B",
          defaultModelId: "model-b",
          models: [{ id: "model-b", label: "Model B" }],
        },
      ],
  };
}

test("resolveActiveProvider prefers active, then default, then first provider", () => {
  assert.equal(
    resolveActiveProvider(makeProvidersResponse())?.id,
    "provider-b"
  );

  assert.equal(
    resolveActiveProvider(
      makeProvidersResponse({
        activeProviderId: "missing",
      })
    )?.id,
    "provider-a"
  );

  assert.equal(
    resolveActiveProvider(
      makeProvidersResponse({
        activeProviderId: "missing",
        defaultProviderId: "also-missing",
      })
    )?.id,
    "provider-a"
  );
});

test("resolveProfileDefaultModelId keeps valid profile defaults and falls back otherwise", () => {
  assert.equal(
    resolveProfileDefaultModelId({
      activeProfileDefaultModelId: "model-b",
      isAllowedModel,
      providerDefaultModelId: "model-a",
    }),
    "model-b"
  );

  assert.equal(
    resolveProfileDefaultModelId({
      activeProfileDefaultModelId: "missing",
      isAllowedModel,
      providerDefaultModelId: "model-a",
    }),
    "model-a"
  );
});

test("resolveEffectiveModelId preserves the temporary/persisted model precedence", () => {
  assert.equal(
    resolveEffectiveModelId({
      activeChatModelId: "model-b",
      isAllowedModel,
      isTemporaryChat: false,
      profileDefaultModelId: "model-a",
      temporaryModelId: "model-c",
    }),
    "model-b"
  );

  assert.equal(
    resolveEffectiveModelId({
      activeChatModelId: "missing",
      isAllowedModel,
      isTemporaryChat: false,
      profileDefaultModelId: "model-a",
      temporaryModelId: "model-c",
    }),
    "model-a"
  );

  assert.equal(
    resolveEffectiveModelId({
      activeChatModelId: "model-b",
      isAllowedModel,
      isTemporaryChat: true,
      profileDefaultModelId: "model-a",
      temporaryModelId: "model-c",
    }),
    "model-c"
  );
});

test("resolvePreferredNewChatModelId matches the stored then active then profile-default fallback", () => {
  assert.equal(buildLastUsedModelKey("profile-1"), "remcochat:lastModelId:profile-1");

  assert.equal(
    resolvePreferredNewChatModelId({
      activeProfileId: "profile-1",
      effectiveModelId: "model-b",
      isAllowedModel,
      profileDefaultModelId: "model-a",
      profileId: "profile-1",
      storedModelId: "model-c",
    }),
    "model-c"
  );

  assert.equal(
    resolvePreferredNewChatModelId({
      activeProfileId: "profile-1",
      effectiveModelId: "model-b",
      isAllowedModel,
      profileDefaultModelId: "model-a",
      profileId: "profile-1",
      storedModelId: "missing",
    }),
    "model-b"
  );

  assert.equal(
    resolvePreferredNewChatModelId({
      activeProfileId: "profile-2",
      effectiveModelId: "model-b",
      isAllowedModel,
      profileDefaultModelId: "model-a",
      profileId: "profile-1",
      storedModelId: "missing",
    }),
    "model-a"
  );
});
