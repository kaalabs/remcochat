import { expect, test } from "@playwright/test";
import {
  getUIMessageStreamErrors,
  getUIMessageStreamText,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

test("Providers include anthropic model type", async ({ request }) => {
  const base = await request.get("/api/providers");
  expect(base.ok()).toBeTruthy();
  const baseJson = (await base.json()) as {
    defaultProviderId: string;
    providers: Array<{
      id: string;
      models: Array<{ id: string; type: string }>;
    }>;
  };

  const alt = baseJson.providers.find((p) => p.id === "e2e_alt");
  expect(alt).toBeTruthy();
  expect(
    alt?.models.some(
      (m) =>
        m.id === "claude-opus-4-5" &&
        m.type === "anthropic_messages"
    )
  ).toBeTruthy();

  try {
    await request.put("/api/providers/active", {
      data: { providerId: "e2e_alt" },
    });

    const profileRes = await request.post("/api/profiles", {
      data: { name: `E2E anthropic provider chat ${Date.now()}` },
    });
    expect(profileRes.ok()).toBeTruthy();
    const profileJson = (await profileRes.json()) as { profile: { id: string } };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const chatRes = await request.post("/api/chat", {
        data: {
          profileId: profileJson.profile.id,
          modelId: "claude-opus-4-5",
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

      const headers = chatRes.headers();
      expect(headers["x-remcochat-provider-id"]).toBe("e2e_alt");
      expect(headers["x-remcochat-model-type"]).toBe("anthropic_messages");

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
