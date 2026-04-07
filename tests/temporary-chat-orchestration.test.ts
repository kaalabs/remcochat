import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleTemporaryIntentPreflight,
  handleTemporarySkillResponses,
  prepareTemporaryExecutionDecisions,
  TEMPORARY_AGENDA_MUTATION_BLOCKED_TEXT,
  TEMPORARY_MEMORY_BLOCKED_TEXT,
} from "../src/server/chat/temporary-chat-orchestration";
import { OV_NL_SKILL_NAME } from "../src/server/ov/ov-nl-constants";

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

test("handleTemporaryIntentPreflight blocks direct memory candidates in temporary chats", async () => {
  let routeCalls = 0;

  const result = await handleTemporaryIntentPreflight({
    canRouteIntent: true,
    directMemoryCandidate: "remember the office Wi-Fi password",
    lastUserText: "remember the office Wi-Fi password",
    profileId: "profile-1",
    routerContext: {},
    resolveModel: async () => ({ capabilities: { tools: true } }) as any,
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: createHeaders(),
    deps: {
      async routeIntentSafelyImpl() {
        routeCalls += 1;
        return { intent: "none", confidence: 0 } as const;
      },
    },
  });

  assert.equal(routeCalls, 0);
  assert.equal(result.routedIntent, null);
  assert.ok(result.response);
  assert.match(await responseText(result.response), /Temporary chats do not save memory/);
});

test("handleTemporaryIntentPreflight blocks routed memory_add intents after routing", async () => {
  const routedIntent = {
    intent: "memory_add",
    confidence: 0.92,
    memoryCandidate: "the office Wi-Fi password is sesame",
  } as const;

  const result = await handleTemporaryIntentPreflight({
    canRouteIntent: true,
    directMemoryCandidate: null,
    lastUserText: "remember the office Wi-Fi password",
    profileId: "profile-1",
    routerContext: {},
    resolveModel: async () => ({ capabilities: { tools: true } }) as any,
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: createHeaders(),
    deps: {
      async routeIntentSafelyImpl() {
        return routedIntent;
      },
    },
  });

  assert.deepEqual(result.routedIntent, routedIntent);
  assert.ok(result.response);
  assert.match(await responseText(result.response), new RegExp(TEMPORARY_MEMORY_BLOCKED_TEXT));
});

test("handleTemporaryIntentPreflight preserves routed intent and forwards the temporary agenda block message to shortcuts", async () => {
  let receivedAgendaBlockedText = "";
  const routedIntent = { intent: "agenda", confidence: 0.88 } as const;
  const shortcutResponse = new Response("shortcut");

  const result = await handleTemporaryIntentPreflight({
    canRouteIntent: true,
    directMemoryCandidate: null,
    lastUserText: "add lunch tomorrow",
    viewerTimeZone: "Europe/Amsterdam",
    profileId: "profile-1",
    routerContext: { lastAssistantText: "Earlier answer" },
    resolveModel: async () => ({ capabilities: { tools: true } }) as any,
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    headers: createHeaders({ "x-remcochat-test": "1" }),
    deps: {
      async routeIntentSafelyImpl() {
        return routedIntent;
      },
      async handleToolIntentShortcutsImpl(input) {
        receivedAgendaBlockedText = input.agendaMutationBlockedText ?? "";
        return shortcutResponse;
      },
    },
  });

  assert.deepEqual(result.routedIntent, routedIntent);
  assert.equal(result.response, shortcutResponse);
  assert.equal(receivedAgendaBlockedText, TEMPORARY_AGENDA_MUTATION_BLOCKED_TEXT);
});

test("handleTemporarySkillResponses returns the OV-unavailable response with disabled OV headers", async () => {
  const response = handleTemporarySkillResponses({
    request: new Request("http://localhost"),
    ovNlConfig: null,
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
    uiLanguage: "en",
    messageMetadata: { createdAt: "2026-03-25T00:00:00Z" },
    createHeaders,
  });

  assert.ok(response);
  assert.equal(response.headers.get("x-remcochat-ov-nl-tools-enabled"), "0");
  assert.equal(response.headers.get("x-remcochat-ov-nl-tools"), "");
  assert.match(await responseText(response), /staat niet aan in je server config/);
});

test("prepareTemporaryExecutionDecisions shapes temporary metadata and gates explicit bash by tool availability", () => {
  const disabled = prepareTemporaryExecutionDecisions({
    createdAt: "2026-03-25T00:00:00Z",
    turnUserMessageId: "u1",
    profileInstructionsRevision: 3,
    explicitBashCommandFromUser: "/bash pwd",
    bashToolsEnabled: false,
  });

  assert.equal(disabled.explicitBashCommand, null);
  assert.equal(disabled.ovFastPathBlocked, false);
  assert.deepEqual(disabled.baseMessageMetadata, {
    createdAt: "2026-03-25T00:00:00Z",
    turnUserMessageId: "u1",
    profileInstructionsRevision: 3,
    chatInstructionsRevision: 0,
  });

  const enabled = prepareTemporaryExecutionDecisions({
    createdAt: "2026-03-25T00:00:00Z",
    turnUserMessageId: "u1",
    profileInstructionsRevision: 3,
    explicitBashCommandFromUser: "/bash pwd",
    bashToolsEnabled: true,
  });

  assert.equal(enabled.explicitBashCommand, "/bash pwd");
  assert.equal(enabled.ovFastPathBlocked, true);
});
