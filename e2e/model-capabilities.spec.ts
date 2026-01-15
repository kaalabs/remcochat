import { expect, test } from "@playwright/test";
import {
  getUIMessageStreamErrors,
  getUIMessageStreamText,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

async function switchProvider(
  request: import("@playwright/test").APIRequestContext,
  providerId: string
) {
  const res = await request.put("/api/providers/active", { data: { providerId } });
  expect(res.ok()).toBeTruthy();
}

async function createProfile(
  request: import("@playwright/test").APIRequestContext
) {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E capabilities ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile: { id: string } };
  return profileJson.profile.id;
}

test("Model with tools disabled returns text (no tool calls)", async ({
  request,
}) => {
  const base = await request.get("/api/providers");
  expect(base.ok()).toBeTruthy();
  const baseJson = (await base.json()) as { defaultProviderId: string };

  try {
    await switchProvider(request, "e2e_alt");
    const profileId = await createProfile(request);

    const chatRes = await request.post("/api/chat", {
      data: {
        profileId,
        modelId: "opencode/gpt-5-nano-no-tools-alt",
        temporary: true,
        messages: [
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [{ type: "text", text: "What's the weather in San Francisco?" }],
            metadata: { createdAt: new Date().toISOString() },
          },
        ],
      },
    });
    expect(chatRes.ok()).toBeTruthy();

    const headers = chatRes.headers();
    expect(headers["x-remcochat-model-type"]).toBe("openai_responses");

    const chunks = parseUIMessageStreamChunks(await chatRes.body());
    expect(getUIMessageStreamErrors(chunks)).toEqual([]);

    const hasToolChunks = chunks.some((c) => String(c.type).startsWith("tool-"));
    expect(hasToolChunks).toBeFalsy();

    expect(getUIMessageStreamText(chunks).trim().length).toBeGreaterThan(0);
  } finally {
    await switchProvider(request, baseJson.defaultProviderId);
  }
});

