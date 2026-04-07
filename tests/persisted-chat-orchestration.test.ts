import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  handlePersistedIntentPreflight,
  handlePersistedSkillResponses,
  preparePersistedToolingDecisions,
} from "../src/server/chat/persisted-chat-orchestration";
import { OV_NL_SKILL_NAME } from "../src/server/ov/ov-nl-constants";

const ORIGINAL_ADMIN_TOKEN = process.env.REMCOCHAT_ADMIN_TOKEN;

function createHeaders(extra?: Record<string, string | undefined>) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

function createRuntime(overrides: Record<string, unknown> = {}) {
  return {
    explicitSkillCandidate: null,
    skillsRegistry: null,
    skillsTools: { tools: {} },
    ovNlTools: { enabled: true },
    skillInvocation: {
      explicitSkillName: null,
      messages: [],
    },
    explicitSkillActivationOnly: false,
    availableSkills: [],
    ...overrides,
  } as any;
}

async function responseText(response: Response) {
  return await response.text();
}

afterEach(() => {
  if (typeof ORIGINAL_ADMIN_TOKEN === "string") {
    process.env.REMCOCHAT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  } else {
    delete process.env.REMCOCHAT_ADMIN_TOKEN;
  }
});

test("handlePersistedIntentPreflight returns the direct memory prompt before routing", async () => {
  let routeCalls = 0;
  const directMemoryResponse = new Response("memory-prompt");

  const result = await handlePersistedIntentPreflight({
    canRouteIntent: true,
    directMemoryCandidate: "remember the office Wi-Fi password",
    lastUserText: "remember the office Wi-Fi password",
    profileId: "profile-1",
    chatId: "chat-1",
    profile: {
      id: "profile-1",
      memoryEnabled: true,
    },
    routerContext: {},
    resolveModel: async () => ({ capabilities: { tools: true } }) as any,
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: createHeaders(),
    deps: {
      async routeIntentSafelyImpl() {
        routeCalls += 1;
        return { intent: "none", confidence: 0 } as const;
      },
      maybeCreatePersistedMemoryPromptResponseImpl(input) {
        return input.candidate ? directMemoryResponse : null;
      },
    },
  });

  assert.equal(routeCalls, 0);
  assert.equal(result.routedIntent, null);
  assert.equal(result.response, directMemoryResponse);
});

test("handlePersistedIntentPreflight preserves routed memory_add intent when it turns into a memory prompt", async () => {
  const routedIntent = {
    intent: "memory_add",
    confidence: 0.92,
    memoryCandidate: "the office Wi-Fi password is sesame",
  } as const;

  const result = await handlePersistedIntentPreflight({
    canRouteIntent: true,
    directMemoryCandidate: null,
    lastUserText: "remember the office Wi-Fi password",
    profileId: "profile-1",
    chatId: "chat-1",
    profile: {
      id: "profile-1",
      memoryEnabled: true,
    },
    routerContext: {},
    resolveModel: async () => ({ capabilities: { tools: true } }) as any,
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: createHeaders(),
    deps: {
      async routeIntentSafelyImpl() {
        return routedIntent;
      },
      maybeCreatePersistedMemoryPromptResponseImpl(input) {
        return input.candidate ? new Response("memory-prompt") : null;
      },
    },
  });

  assert.deepEqual(result.routedIntent, routedIntent);
  assert.ok(result.response);
});

test("handlePersistedIntentPreflight preserves routed intent and delegates shortcut handling after memory checks", async () => {
  const routedIntent = { intent: "agenda", confidence: 0.88 } as const;
  const shortcutResponse = new Response("shortcut");
  let shortcutLastUserText = "";

  const result = await handlePersistedIntentPreflight({
    canRouteIntent: true,
    directMemoryCandidate: null,
    lastUserText: "add lunch tomorrow",
    viewerTimeZone: "Europe/Amsterdam",
    profileId: "profile-1",
    chatId: "chat-1",
    profile: {
      id: "profile-1",
      memoryEnabled: true,
    },
    routerContext: { lastAssistantText: "Earlier answer" },
    resolveModel: async () => ({ capabilities: { tools: true } }) as any,
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: createHeaders({ "x-remcochat-test": "1" }),
    deps: {
      async routeIntentSafelyImpl() {
        return routedIntent;
      },
      maybeCreatePersistedMemoryPromptResponseImpl() {
        return null;
      },
      async handleToolIntentShortcutsImpl(input) {
        shortcutLastUserText = input.lastUserText;
        return shortcutResponse;
      },
    },
  });

  assert.deepEqual(result.routedIntent, routedIntent);
  assert.equal(result.response, shortcutResponse);
  assert.equal(shortcutLastUserText, "add lunch tomorrow");
});

test("handlePersistedSkillResponses returns the OV-unavailable response before recording skill activation", async () => {
  process.env.REMCOCHAT_ADMIN_TOKEN = "server-secret";
  let recordCalls = 0;

  const response = handlePersistedSkillResponses({
    request: new Request("http://remcochat.local"),
    chatId: "chat-1",
    runtime: createRuntime({
      explicitSkillCandidate: OV_NL_SKILL_NAME,
      skillsRegistry: {
        get(name: string) {
          return name === OV_NL_SKILL_NAME ? { name } : null;
        },
      },
      ovNlTools: { enabled: false },
      skillInvocation: {
        explicitSkillName: OV_NL_SKILL_NAME,
        messages: [],
      },
    }),
    lastUserText: `/${OV_NL_SKILL_NAME} test`,
    toolsEnabled: true,
    uiLanguage: "en",
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    createHeaders,
    deps: {
      recordActivatedSkillNameImpl() {
        recordCalls += 1;
        return [];
      },
    },
  });

  assert.ok(response);
  assert.equal(recordCalls, 0);
  assert.equal(response.headers.get("x-remcochat-ov-nl-tools-enabled"), "0");
  assert.equal(response.headers.get("x-remcochat-ov-nl-tools"), "");
  assert.match(await responseText(response), new RegExp(`/${OV_NL_SKILL_NAME}`));
});

test("handlePersistedSkillResponses records the explicit skill and returns activation before smoke-test fallback", () => {
  let recorded: { chatId: string; skillName: string } | null = null;
  let smokeCalls = 0;
  const activationResponse = new Response("activation");

  const response = handlePersistedSkillResponses({
    request: new Request("http://localhost"),
    chatId: "chat-1",
    runtime: createRuntime({
      skillInvocation: {
        explicitSkillName: "hue-instant-control",
        messages: [],
      },
    }),
    lastUserText: "/hue-instant-control make woonkamer cozy",
    toolsEnabled: true,
    uiLanguage: "nl",
    createHeaders,
    deps: {
      recordActivatedSkillNameImpl(input) {
        recorded = input;
        return [input.skillName];
      },
      maybeCreateExplicitSkillActivationResponseImpl() {
        return activationResponse;
      },
      maybeCreateSkillsToolsSmokeTestResponseImpl() {
        smokeCalls += 1;
        return new Response("smoke-test");
      },
    },
  });

  assert.equal(response, activationResponse);
  assert.deepEqual(recorded, {
    chatId: "chat-1",
    skillName: "hue-instant-control",
  });
  assert.equal(smokeCalls, 0);
});

test("handlePersistedSkillResponses falls through to the smoke-test response when activation does not intercept", () => {
  let smokeInput: any = null;

  const response = handlePersistedSkillResponses({
    request: new Request("http://localhost"),
    chatId: "chat-1",
    runtime: createRuntime({
      skillInvocation: {
        explicitSkillName: "skills-system-validation",
        messages: [],
      },
    }),
    lastUserText: "/skills-system-validation run skillsActivate then skillsReadResource",
    toolsEnabled: true,
    uiLanguage: "en",
    createHeaders,
    deps: {
      recordActivatedSkillNameImpl() {
        throw new Error("storage unavailable");
      },
      maybeCreateExplicitSkillActivationResponseImpl() {
        return null;
      },
      maybeCreateSkillsToolsSmokeTestResponseImpl(input) {
        smokeInput = input;
        return new Response("smoke-test");
      },
    },
  });

  assert.ok(response);
  assert.equal(smokeInput?.explicitSkillName, "skills-system-validation");
  assert.equal(smokeInput?.skillsEnabled, false);
});

test("preparePersistedToolingDecisions skips history lookup when regeneration is off", () => {
  let historyCalls = 0;

  const decisions = preparePersistedToolingDecisions({
    chatId: "chat-1",
    turnUserMessageId: "turn-1",
    isRegenerate: false,
    lastUserText: "hello there",
    memoryLines: ["- wifi password is sesame"],
    bashToolsEnabled: true,
    deps: {
      listTurnAssistantTextsImpl() {
        historyCalls += 1;
        return ["should not be used"];
      },
    },
  });

  assert.equal(historyCalls, 0);
  assert.equal(decisions.regenerateSection, "");
  assert.equal(decisions.explicitBashCommand, null);
  assert.equal(decisions.forcedToolName, null);
  assert.equal(decisions.ovFastPathBlocked, false);
});

test("preparePersistedToolingDecisions builds regenerate guidance and explicit bash routing", () => {
  const decisions = preparePersistedToolingDecisions({
    chatId: "chat-1",
    turnUserMessageId: "turn-1",
    isRegenerate: true,
    lastUserText: "bash: pwd",
    memoryLines: [],
    bashToolsEnabled: true,
    deps: {
      listTurnAssistantTextsImpl() {
        return ["First answer"];
      },
    },
  });

  assert.match(decisions.regenerateSection, /Regeneration: produce an alternative assistant response/);
  assert.match(decisions.regenerateSection, /First answer/);
  assert.equal(decisions.explicitBashCommand, "pwd");
  assert.equal(decisions.forcedToolName, null);
  assert.equal(decisions.ovFastPathBlocked, true);
});

test("preparePersistedToolingDecisions forces the memory answer tool for overlapping memory questions", () => {
  const decisions = preparePersistedToolingDecisions({
    chatId: "chat-1",
    turnUserMessageId: "turn-1",
    isRegenerate: false,
    lastUserText: "what's the wifi password?",
    memoryLines: ["- wifi password is sesame"],
    bashToolsEnabled: false,
  });

  assert.equal(decisions.explicitBashCommand, null);
  assert.equal(decisions.forcedToolName, "displayMemoryAnswer");
  assert.equal(decisions.ovFastPathBlocked, true);
});
