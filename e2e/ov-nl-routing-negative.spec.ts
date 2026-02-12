import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";
import { getUIMessageStreamText, parseUIMessageStreamChunks } from "./ui-message-stream";

skipUnlessOpencodeApiKey(test);

test("Non-rail prompts do not invoke ovNlGateway", async ({ request }) => {
  test.setTimeout(120_000);

  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E ov nl negative ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile?: { id?: string } };
  const profileId = String(profileJson.profile?.id ?? "");
  expect(profileId).toBeTruthy();

  const chatRes = await request.post("/api/chat", {
    data: {
      profileId,
      temporary: true,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text:
                "Ik ben in NL. Kun je me helpen met een wandelplan vanaf mijn huis voor dit weekend? (Geen treininfo, gewoon algemene tips.)",
            },
          ],
          metadata: { createdAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(chatRes.ok()).toBeTruthy();

  const chunks = parseUIMessageStreamChunks(await chatRes.body());
  const toolInputs = chunks
    .filter((chunk) => chunk.type === "tool-input-available")
    .map((chunk) => String(chunk.toolName ?? ""));

  expect(toolInputs).not.toContain("ovNlGateway");

  const assistantText = getUIMessageStreamText(chunks).trim();
  expect(assistantText.length).toBeGreaterThan(0);
});

