import { expect, test } from "@playwright/test";
import {
  getUIMessageStreamErrors,
  getUIMessageStreamText,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

async function switchProvider(request: import("@playwright/test").APIRequestContext, providerId: string) {
  const res = await request.put("/api/providers/active", { data: { providerId } });
  expect(res.ok()).toBeTruthy();
}

async function createProfile(request: import("@playwright/test").APIRequestContext) {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E model types ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile: { id: string } };
  return profileJson.profile.id;
}

async function chatOnce(input: {
  request: import("@playwright/test").APIRequestContext;
  profileId: string;
  modelId: string;
}) {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const chatRes = await input.request.post("/api/chat", {
      data: {
        profileId: input.profileId,
        modelId: input.modelId,
        temporary: true,
        messages: [
          {
            id: `user-${Date.now()}`,
            role: "user",
            parts: [{ type: "text", text: "Respond with exactly: ok" }],
            metadata: { createdAt: new Date().toISOString() },
          },
        ],
      },
    });
    expect(chatRes.ok()).toBeTruthy();

    const chunks = parseUIMessageStreamChunks(await chatRes.body());
    const errors = getUIMessageStreamErrors(chunks);
    const text = getUIMessageStreamText(chunks);

    if (errors.length === 0 && text.toLowerCase().includes("ok")) {
      return chatRes.headers();
    }

    const retryable = errors.some((e) =>
      e.toLowerCase().includes("high concurrency usage")
    );
    if (retryable && attempt < maxAttempts) {
      await sleep(750 * attempt);
      continue;
    }

    expect(errors, `UI stream errors: ${errors.join("; ")}`).toEqual([]);
    expect(text.toLowerCase()).toContain("ok");
    return chatRes.headers();
  }

  throw new Error("Unreachable: chatOnce() exhausted retries.");
}

test("Chat works for OpenAI-compatible (chat/completions) model type", async ({ request }) => {
  const base = await request.get("/api/providers");
  expect(base.ok()).toBeTruthy();
  const baseJson = (await base.json()) as { defaultProviderId: string };

  try {
    await switchProvider(request, "e2e_alt");
    const profileId = await createProfile(request);

    const headers = await chatOnce({
      request,
      profileId,
      modelId: "glm-4.7-free",
    });

    expect(headers["x-remcochat-model-type"]).toBe("openai_compatible");
  } finally {
    await switchProvider(request, baseJson.defaultProviderId);
  }
});

test("Chat works for Google Generative AI model type", async ({ request }) => {
  test.skip(
    process.env.REMCOCHAT_E2E_ENABLE_GOOGLE_GEMINI !== "1",
    "Gemini models appear disabled for OPENCODE in this environment. Set REMCOCHAT_E2E_ENABLE_GOOGLE_GEMINI=1 after enabling Gemini access to run this test."
  );

  const base = await request.get("/api/providers");
  expect(base.ok()).toBeTruthy();
  const baseJson = (await base.json()) as { defaultProviderId: string };

  try {
    await switchProvider(request, "e2e_alt");
    const profileId = await createProfile(request);

    const headers = await chatOnce({
      request,
      profileId,
      modelId: "gemini-3-pro",
    });

    expect(headers["x-remcochat-model-type"]).toBe("google_generative_ai");
  } finally {
    await switchProvider(request, baseJson.defaultProviderId);
  }
});
