import { expect, test } from "@playwright/test";
import {
  getUIMessageStreamErrors,
  parseUIMessageStreamChunks,
} from "./ui-message-stream";

async function createProfile(request: import("@playwright/test").APIRequestContext) {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E bash ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile: { id: string } };
  return profileJson.profile.id;
}

test("Bash tools run a command in Vercel Sandbox", async ({ request }) => {
  test.skip(
    process.env.REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX !== "1",
    "Set REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX=1 (and Vercel Sandbox creds + REMCOCHAT_ENABLE_BASH_TOOL=1) to run this test."
  );

  const profileId = await createProfile(request);
  const temporarySessionId = `e2e-bash-${Date.now()}`;

  const chatRes = await request.post("/api/chat", {
    data: {
      profileId,
      modelId: "openai/gpt-5.2-codex",
      temporary: true,
      temporarySessionId,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: "Run: `echo REMCOCHAT_BASH_E2E_OK`",
            },
          ],
          metadata: { createdAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(chatRes.ok()).toBeTruthy();

  const headers = chatRes.headers();
  expect(headers["x-remcochat-bash-tools-enabled"]).toBe("1");

  const chunks = parseUIMessageStreamChunks(await chatRes.body());
  expect(getUIMessageStreamErrors(chunks)).toEqual([]);

  const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value && typeof value === "object");
  };

  const stdout = chunks
    .filter((c) => String(c.toolName ?? "") === "bash")
    .map((c) => {
      const type = String(c.type ?? "");
      if (type !== "tool-output-available" && type !== "tool-result") return "";

      const payload =
        c.output ?? c.result ?? c.toolOutput ?? c.toolResult;
      if (!isRecord(payload)) return "";

      return typeof payload.stdout === "string" ? payload.stdout : "";
    })
    .filter(Boolean)
    .join("\n");

  expect(stdout).toContain("REMCOCHAT_BASH_E2E_OK");
});
