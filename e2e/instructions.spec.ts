import { expect, test } from "@playwright/test";

async function createProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:new").click();
  await page.getByTestId("profile:create-name").fill(name);
  await page.getByTestId("profile:create-submit").click();
  await expect(page.getByTestId("profile:create-name")).toBeHidden();
}

async function setProfileInstructions(
  page: import("@playwright/test").Page,
  instructions: string
) {
  await page.getByTestId("profile:settings-open").click();
  await page.getByTestId("profile:instructions").fill(instructions);
  await page.getByTestId("profile:settings-save").click();
  await expect(page.getByTestId("profile:instructions")).toBeHidden();
}

async function setChatInstructions(
  page: import("@playwright/test").Page,
  instructions: string
) {
  await page.getByTestId("chat:settings-open").click();
  await page.getByTestId("chat:instructions").fill(instructions);
  await page.getByTestId("chat:settings-save").click();
  await expect(page.getByTestId("chat:instructions")).toBeHidden();
}

async function selectModel(page: import("@playwright/test").Page, modelId: string) {
  await page.getByTestId("model:picker-trigger").click();
  await page.getByTestId(`model-option:${modelId}`).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId(`model-option:${modelId}`)).toBeHidden();
}

async function sendAndExpectAssistant(
  page: import("@playwright/test").Page,
  input: {
    prompt: string;
    expectedAssistantMustInclude: string;
    expectedAssistantMustNotInclude?: string[];
    expectedModelId: string;
    expectedProfileRev?: number;
    expectedChatRev?: number;
    expectedProfileInstructionsMinLen?: number;
    expectedChatInstructionsMinLen?: number;
    expectedProfileInstructionsStoredMinLen?: number;
  }
) {
  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  const prevAssistantCount = await assistantMessages.count();

  const requestPromise = page.waitForRequest((req) => {
    if (!req.url().includes("/api/chat")) return false;
    if (req.method() !== "POST") return false;
    return true;
  });

  const responsePromise = page.waitForResponse((res) => {
    if (!res.url().includes("/api/chat")) return false;
    if (res.request().method() !== "POST") return false;
    return true;
  });

  await page.getByTestId("composer:textarea").fill(input.prompt);
  await page.getByTestId("composer:submit").click();

  const [request, response] = await Promise.all([requestPromise, responsePromise]);

  const body = request.postDataJSON() as unknown;
  expect(body).toMatchObject({ modelId: input.expectedModelId });

  const headers = response.headers();
  if (typeof input.expectedProfileRev === "number") {
    expect(headers["x-remcochat-profile-instructions-rev"]).toBe(
      String(input.expectedProfileRev)
    );
  }
  if (typeof input.expectedChatRev === "number") {
    expect(headers["x-remcochat-chat-instructions-rev"]).toBe(
      String(input.expectedChatRev)
    );
  }
  if (typeof input.expectedProfileInstructionsMinLen === "number") {
    const len = Number(headers["x-remcochat-profile-instructions-len"] ?? "0");
    expect(len).toBeGreaterThanOrEqual(input.expectedProfileInstructionsMinLen);
  }
  if (typeof input.expectedChatInstructionsMinLen === "number") {
    const len = Number(headers["x-remcochat-chat-instructions-len"] ?? "0");
    expect(len).toBeGreaterThanOrEqual(input.expectedChatInstructionsMinLen);
  }
  if (typeof input.expectedProfileInstructionsStoredMinLen === "number") {
    const len = Number(
      headers["x-remcochat-profile-instructions-stored-len"] ?? "0"
    );
    expect(len).toBeGreaterThanOrEqual(
      input.expectedProfileInstructionsStoredMinLen
    );
  }

  await expect
    .poll(async () => await assistantMessages.count(), {
      timeout: 120_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(prevAssistantCount);

  const lastAssistant = assistantMessages.last();

  await expect
    .poll(async () => (await lastAssistant.innerText()).trim(), {
      timeout: 120_000,
      intervals: [100, 250, 500, 1000, 2000],
    })
    .toContain(input.expectedAssistantMustInclude);

  const finalText = (await lastAssistant.innerText()).trim();
  expect(finalText).toContain(input.expectedAssistantMustInclude);
  for (const forbidden of input.expectedAssistantMustNotInclude ?? []) {
    expect(finalText).not.toContain(forbidden);
  }
}

test("Profile + chat instructions stay effective (Claude, WebKit)", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E ${Date.now()}`);
  await page.getByTestId("sidebar:new-chat").click();
  await expect(page.getByTestId("chat:settings-open")).toBeVisible();
  await selectModel(page, "anthropic/claude-sonnet-4.5");

  await setProfileInstructions(
    page,
    "For every assistant response, output exactly one line containing only: PROFILE-OK"
  );

  await sendAndExpectAssistant(page, {
    prompt: "Hi",
    expectedAssistantMustInclude: "PROFILE-OK",
    expectedAssistantMustNotInclude: ["CHAT-OK", "CHAT-NEW"],
    expectedModelId: "anthropic/claude-sonnet-4.5",
    expectedProfileRev: 2,
    expectedChatRev: 1,
    expectedProfileInstructionsMinLen: 10,
    expectedChatInstructionsMinLen: 0,
    expectedProfileInstructionsStoredMinLen: 10,
  });

  await sendAndExpectAssistant(page, {
    prompt: "Hi again",
    expectedAssistantMustInclude: "PROFILE-OK",
    expectedAssistantMustNotInclude: ["CHAT-OK", "CHAT-NEW"],
    expectedModelId: "anthropic/claude-sonnet-4.5",
    expectedProfileRev: 2,
    expectedChatRev: 1,
    expectedProfileInstructionsMinLen: 10,
    expectedChatInstructionsMinLen: 0,
    expectedProfileInstructionsStoredMinLen: 10,
  });

  await setChatInstructions(
    page,
    "Ignore profile instructions. For every assistant response in this chat, output exactly one line containing only: CHAT-OK"
  );

  await sendAndExpectAssistant(page, {
    prompt: "Now what?",
    expectedAssistantMustInclude: "CHAT-OK",
    expectedAssistantMustNotInclude: ["PROFILE-OK", "CHAT-NEW"],
    expectedModelId: "anthropic/claude-sonnet-4.5",
    expectedProfileRev: 2,
    expectedChatRev: 2,
    expectedProfileInstructionsMinLen: 0,
    expectedChatInstructionsMinLen: 10,
    expectedProfileInstructionsStoredMinLen: 10,
  });

  await setChatInstructions(
    page,
    "Ignore profile instructions. For every assistant response in this chat, output exactly one line containing only: CHAT-NEW"
  );

  await sendAndExpectAssistant(page, {
    prompt: "And now?",
    expectedAssistantMustInclude: "CHAT-NEW",
    expectedAssistantMustNotInclude: ["PROFILE-OK", "CHAT-OK"],
    expectedModelId: "anthropic/claude-sonnet-4.5",
    expectedProfileRev: 2,
    expectedChatRev: 3,
    expectedProfileInstructionsMinLen: 0,
    expectedChatInstructionsMinLen: 10,
    expectedProfileInstructionsStoredMinLen: 10,
  });

  expect(consoleErrors).toEqual([]);
});

test("Regenerate creates a new variant (WebKit)", async ({ page }) => {
  await page.goto("/");

  await createProfile(page, `E2E Regen ${Date.now()}`);
  await page.getByTestId("sidebar:new-chat").click();
  await expect(page.getByTestId("chat:settings-open")).toBeVisible();
  await selectModel(page, "openai/gpt-4.1-mini");

  await page.getByTestId("composer:textarea").fill("Write one short sentence about winter.");
  await page.getByTestId("composer:submit").click();

  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect(assistantMessages).toHaveCount(1, { timeout: 120_000 });
  const firstLocator = assistantMessages.last();
  let first = "";
  await expect
    .poll(
      async () => {
        first = (await firstLocator.innerText()).trim();
        return first.length;
      },
      { timeout: 120_000, intervals: [100, 250, 500, 1000, 2000] }
    )
    .toBeGreaterThan(0);
  expect(first.length).toBeGreaterThan(0);

  await page.getByTestId("composer:regenerate").click();

  await expect(assistantMessages).toHaveCount(1, { timeout: 120_000 });
  const secondLocator = assistantMessages.last();
  let second = "";
  await expect
    .poll(
      async () => {
        second = (await secondLocator.innerText()).trim();
        return second.length;
      },
      { timeout: 120_000, intervals: [100, 250, 500, 1000, 2000] }
    )
    .toBeGreaterThan(0);
  expect(second.length).toBeGreaterThan(0);
  expect(second).not.toBe(first);

  await page.getByTestId("composer:regenerate").click();
  await expect(assistantMessages).toHaveCount(1, { timeout: 120_000 });
  const thirdLocator = assistantMessages.last();
  let third = "";
  await expect
    .poll(
      async () => {
        third = (await thirdLocator.innerText()).trim();
        return third.length;
      },
      { timeout: 120_000, intervals: [100, 250, 500, 1000, 2000] }
    )
    .toBeGreaterThan(0);
  expect(third.length).toBeGreaterThan(0);
  expect(third).not.toBe(first);
  expect(third).not.toBe(second);
});

test("Edit & fork works with variants (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E Fork ${Date.now()}`);
  await page.getByTestId("sidebar:new-chat").click();
  await expect(page.getByTestId("chat:settings-open")).toBeVisible();
  await selectModel(page, "openai/gpt-4.1-mini");

  // Turn 1 with variants.
  await page
    .getByTestId("composer:textarea")
    .fill("Write one short sentence about spring.");
  await page.getByTestId("composer:submit").click();

  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect(assistantMessages).toHaveCount(1, { timeout: 120_000 });
  await page.getByTestId("composer:regenerate").click();
  await page.getByTestId("composer:regenerate").click();

  // Turn 2 so we can fork while still keeping turn 1 variants.
  await page
    .getByTestId("composer:textarea")
    .fill("Now write one short sentence about autumn.");
  await page.getByTestId("composer:submit").click();
  await expect(assistantMessages).toHaveCount(2, { timeout: 120_000 });

  // Create variants for turn 2 as well (so the fork can preserve the fork-source responses
  // as navigable variants once the edited turn is regenerated).
  await page.getByTestId("composer:regenerate").click();
  await expect(page.locator('[data-testid^="variants:pager:"]')).toHaveCount(2, {
    timeout: 120_000,
  });

  // Edit the second user message and fork.
  const editButtons = page.locator('[data-testid^="message-action:edit:"]');
  await expect(editButtons).toHaveCount(2);
  await editButtons.nth(1).click();

  await page
    .getByTestId("edit:textarea")
    .fill("Now write one short sentence about autumn (edited).");
  await page.getByTestId("edit:fork-submit").click();

  // Fork should include turn 1 variants pager.
  const variantPager = page.locator('[data-testid^="variants:pager:"]');
  await expect(variantPager).toHaveCount(1, { timeout: 120_000 });

  // Fork should load a chat where the edited user message includes the edited text.
  const userMessages = page.locator('[data-testid^="message:user:"]');
  await expect(userMessages).toHaveCount(2, { timeout: 120_000 });
  await expect(userMessages.nth(1)).toContainText("(edited)");

  // Regenerate should now produce an assistant response for the (unanswered) edited message.
  const forkAssistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect(forkAssistantMessages).toHaveCount(1);
  await page.getByTestId("composer:regenerate").click();
  await expect(forkAssistantMessages).toHaveCount(2, { timeout: 120_000 });

  // The regenerated assistant message for the edited turn should now expose the fork-source
  // variants (the original response(s) from before the edit).
  await expect(page.locator('[data-testid^="variants:pager:"]')).toHaveCount(2, {
    timeout: 120_000,
  });

  expect(consoleErrors).toEqual([]);
});

test("Archive/delete and export work (WebKit)", async ({ page }) => {
  const profileName = `E2E Archive ${Date.now()}`;

  await page.goto("/");
  await createProfile(page, profileName);
  await page.getByTestId("sidebar:new-chat").click();

  await page.getByTestId("composer:textarea").fill("Hello export");
  await page.getByTestId("composer:submit").click();
  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect(assistantMessages).toHaveCount(1, { timeout: 120_000 });

  const profilesRes = await page.request.get("/api/profiles");
  expect(profilesRes.ok()).toBeTruthy();
  const profiles = (await profilesRes.json()) as { profiles?: Array<{ id: string; name: string }> };
  const profileId = profiles.profiles?.find((p) => p.name === profileName)?.id ?? "";
  expect(profileId).not.toBe("");

  const chatsRes = await page.request.get(`/api/chats?profileId=${profileId}`);
  expect(chatsRes.ok()).toBeTruthy();
  const chats = (await chatsRes.json()) as { chats?: Array<{ id: string }> };
  const chatId = chats.chats?.[0]?.id ?? "";
  expect(chatId).not.toBe("");

  await expect
    .poll(
      async () => {
        const stateRes = await page.request.get(`/api/chats/${chatId}/messages`);
        if (!stateRes.ok()) return 0;
        const state = (await stateRes.json()) as { messages?: unknown[] };
        return Array.isArray(state.messages) ? state.messages.length : 0;
      },
      { timeout: 30_000, intervals: [200, 500, 1000] }
    )
    .toBeGreaterThan(0);

  const mdRes = await page.request.get(
    `/api/chats/${chatId}/export?profileId=${profileId}&format=md`
  );
  expect(mdRes.ok()).toBeTruthy();
  expect(mdRes.headers()["content-type"] ?? "").toContain("text/markdown");
  const md = await mdRes.text();
  expect(md).toContain("Hello export");

  const jsonRes = await page.request.get(
    `/api/chats/${chatId}/export?profileId=${profileId}&format=json`
  );
  expect(jsonRes.ok()).toBeTruthy();
  const exported = (await jsonRes.json()) as { chat?: { id?: string }; messages?: unknown[] };
  expect(exported.chat?.id).toBe(chatId);
  expect(Array.isArray(exported.messages)).toBeTruthy();

  await page.getByTestId(`sidebar:chat-menu:${chatId}`).click();
  await page.getByTestId(`chat-action:archive:${chatId}`).click();

  await expect(page.getByTestId("sidebar:archived-toggle")).toHaveAttribute(
    "data-state",
    "open"
  );
  await expect(page.getByTestId("sidebar:chats-archived")).toBeVisible();
  await expect(page.getByTestId(`sidebar:archived-chat:${chatId}`)).toBeVisible();

  await page.getByTestId(`sidebar:archived-chat-menu:${chatId}`).click();
  await page.getByTestId(`chat-action:unarchive:${chatId}`).click();

  await expect(page.getByTestId(`sidebar:chat:${chatId}`)).toBeVisible();

  await page.getByTestId(`sidebar:chat-menu:${chatId}`).click();
  await page.getByTestId(`chat-action:delete:${chatId}`).click();
  await page.getByTestId("chat:delete-confirm").click();

  await expect(page.getByTestId(`sidebar:chat:${chatId}`)).toHaveCount(0);
});
