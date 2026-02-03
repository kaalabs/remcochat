import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";
import {
  getUIMessageStreamErrors,
  getUIMessageStreamText,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

skipUnlessOpencodeApiKey(test);

test("Chat uses active provider", async ({ request }) => {
  const base = await request.get("/api/providers");
  expect(base.ok()).toBeTruthy();
  const baseJson = (await base.json()) as {
    defaultProviderId: string;
    activeProviderId: string;
  };

  try {
    await request.put("/api/providers/active", {
      data: { providerId: "e2e_alt" },
    });

    const profileRes = await request.post("/api/profiles", {
      data: { name: `E2E provider chat ${Date.now()}` },
    });
    expect(profileRes.ok()).toBeTruthy();
    const profileJson = (await profileRes.json()) as { profile: { id: string } };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const chatRes = await request.post("/api/chat", {
        data: {
          profileId: profileJson.profile.id,
          modelId: "gpt-5.2",
          temporary: true,
          messages: [
            {
              id: `user-${Date.now()}`,
              role: "user",
              parts: [{ type: "text", text: "Say: ok" }],
              metadata: { createdAt: new Date().toISOString() },
            },
          ],
        },
      });
      expect(chatRes.ok()).toBeTruthy();

      const headers = chatRes.headers();
      expect(headers["x-remcochat-provider-id"]).toBe("e2e_alt");
      expect(headers["x-remcochat-model-type"]).toBe("openai_responses");

      const chunks = parseUIMessageStreamChunks(await chatRes.body());
      const errors = getUIMessageStreamErrors(chunks);
      const text = getUIMessageStreamText(chunks);

      if (errors.length === 0 && text.toLowerCase().includes("ok")) break;

      const retryable = errors.some((e) =>
        e.toLowerCase().includes("high concurrency usage")
      );
      if (retryable && attempt < maxAttempts) {
        await sleep(750 * attempt);
        continue;
      }

      expect(errors, `UI stream errors: ${errors.join("; ")}`).toEqual([]);
      expect(text.toLowerCase()).toContain("ok");
      break;
    }
  } finally {
    await request.put("/api/providers/active", {
      data: { providerId: baseJson.defaultProviderId },
    });
  }
});
