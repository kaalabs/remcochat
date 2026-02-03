import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";
import {
  getUIMessageStreamErrors,
  getUIMessageStreamText,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

skipUnlessOpencodeApiKey(test);

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

  const opencode = baseJson.providers.find((p) => p.id === "opencode");
  expect(opencode).toBeTruthy();

  const anthropicModels = (opencode?.models ?? [])
    .filter((m) => m.type === "anthropic_messages")
    .map((m) => m.id);
  expect(anthropicModels.length).toBeGreaterThan(0);

  const preferredAnthropicModels = [...anthropicModels].sort((a, b) => {
    const score = (id: string) => {
      const lower = id.toLowerCase();
      if (lower.includes("haiku")) return 3;
      if (lower.includes("sonnet")) return 2;
      if (lower.includes("opus")) return 1;
      return 0;
    };
    const diff = score(b) - score(a);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });

  try {
    await request.put("/api/providers/active", {
      data: { providerId: "opencode" },
    });

    const profileRes = await request.post("/api/profiles", {
      data: { name: `E2E anthropic provider chat ${Date.now()}` },
    });
    expect(profileRes.ok()).toBeTruthy();
    const profileJson = (await profileRes.json()) as { profile: { id: string } };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const maxAttempts = 3;

    let lastErrors: string[] = [];
    for (const modelId of preferredAnthropicModels) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const chatRes = await request.post("/api/chat", {
          data: {
            profileId: profileJson.profile.id,
            modelId,
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

        if (!chatRes.ok()) {
          lastErrors = [`HTTP ${chatRes.status()}`];
          break;
        }

        const headers = chatRes.headers();
        expect(headers["x-remcochat-provider-id"]).toBe("opencode");
        expect(headers["x-remcochat-model-type"]).toBe("anthropic_messages");

        const chunks = parseUIMessageStreamChunks(await chatRes.body());
        const errors = getUIMessageStreamErrors(chunks);
        const text = getUIMessageStreamText(chunks);
        lastErrors = errors;

        if (errors.length === 0 && text.toLowerCase().includes("ok")) return;

        const retryable = errors.some((e) =>
          e.toLowerCase().includes("high concurrency usage")
        );
        if (retryable && attempt < maxAttempts) {
          await sleep(750 * attempt);
          continue;
        }

        const disabled = errors.some((e) => e.toLowerCase().includes("disabled"));
        if (disabled) break;

        expect(errors, `UI stream errors: ${errors.join("; ")}`).toEqual([]);
        expect(text.toLowerCase()).toContain("ok");
        return;
      }
    }

    throw new Error(
      `No anthropic_messages model worked via OpenCode. Last errors: ${lastErrors.join("; ")}`
    );
  } finally {
    await request.put("/api/providers/active", {
      data: { providerId: baseJson.defaultProviderId },
    });
  }
});
