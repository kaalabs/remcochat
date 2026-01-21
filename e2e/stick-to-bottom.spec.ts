import { expect, test } from "@playwright/test";

async function getDefaultProfileId(request: import("@playwright/test").APIRequestContext) {
  const profilesRes = await request.get("/api/profiles");
  expect(profilesRes.ok()).toBeTruthy();
  const profilesJson = (await profilesRes.json()) as { profiles: Array<{ id: string }> };
  const profileId = profilesJson.profiles[0]?.id ?? "";
  expect(profileId).toBeTruthy();
  return profileId;
}

async function createChatWithMessages(input: {
  request: import("@playwright/test").APIRequestContext;
  profileId: string;
  title: string;
  messagePairs: number;
}) {
  const { request, profileId, title, messagePairs } = input;

  const chatRes = await request.post("/api/chats", { data: { profileId } });
  expect(chatRes.status()).toBe(201);
  const chatJson = (await chatRes.json()) as { chat: { id: string } };
  const chatId = chatJson.chat.id;

  const renameRes = await request.patch(`/api/chats/${chatId}`, {
    data: { profileId, title },
  });
  expect(renameRes.ok()).toBeTruthy();

  const now = Date.now();
  const messages: Array<{
    id: string;
    role: "user" | "assistant";
    parts: Array<{ type: "text"; text: string }>;
    metadata: { createdAt: string };
  }> = [];

  for (let i = 0; i < messagePairs; i++) {
    const createdAt = new Date(now + i * 1000).toISOString();
    messages.push({
      id: `u-${chatId}-${i}`,
      role: "user",
      parts: [{ type: "text", text: `User message ${i}: ${"x".repeat(80)}` }],
      metadata: { createdAt },
    });
    messages.push({
      id: `a-${chatId}-${i}`,
      role: "assistant",
      parts: [{ type: "text", text: `Assistant message ${i}: ${"y".repeat(160)}` }],
      metadata: { createdAt },
    });
  }

  const putRes = await request.put(`/api/chats/${chatId}/messages`, {
    data: { profileId, messages, variantsByUserMessageId: {} },
  });
  expect(putRes.ok()).toBeTruthy();

  return { chatId, lastAssistantMessageId: `a-${chatId}-${messagePairs - 1}` };
}

test("Chat transcript starts at bottom and re-sticks on chat switch", async ({
  page,
  request,
}) => {
  const profileId = await getDefaultProfileId(request);

  const chat1 = await createChatWithMessages({
    request,
    profileId,
    title: "Scroll Chat 1",
    messagePairs: 35,
  });
  const chat2 = await createChatWithMessages({
    request,
    profileId,
    title: "Scroll Chat 2",
    messagePairs: 35,
  });

  await page.goto("/");

  await page.getByTestId(`sidebar:chat:${chat1.chatId}`).click();
  await expect(page.getByTestId(`message:assistant:${chat1.lastAssistantMessageId}`)).toBeVisible();

  const scrollEl = page.locator('[data-testid="chat:transcript"] > div').first();
  await expect
    .poll(async () => {
      return await scrollEl.evaluate((el) => {
        return el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
      });
    })
    .toBe(true);

  await scrollEl.evaluate((el) => {
    el.scrollTop = 0;
  });

  await page.getByTestId(`sidebar:chat:${chat2.chatId}`).click();
  await expect(page.getByTestId(`message:assistant:${chat2.lastAssistantMessageId}`)).toBeVisible();

  await expect
    .poll(async () => {
      return await scrollEl.evaluate((el) => {
        return el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
      });
    })
    .toBe(true);
});

