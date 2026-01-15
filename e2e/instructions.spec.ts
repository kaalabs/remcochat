import { expect, test } from "@playwright/test";
import packageJson from "../package.json";

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

async function getAvailableModelIds(page: import("@playwright/test").Page) {
  await page.getByTestId("model:picker-trigger").click();
  const options = page.locator('[data-testid^="model-option:"]');
  await expect(options.first()).toBeVisible();
  const testIds = await options.evaluateAll((els) =>
    els
      .map((el) => el.getAttribute("data-testid") || "")
      .filter(Boolean)
  );
  await page.keyboard.press("Escape");
  return testIds
    .map((id) => id.replace(/^model-option:/, ""))
    .filter((id) => id.length > 0);
}

async function selectPreferredModel(
  page: import("@playwright/test").Page,
  preferredIds: string[]
) {
  await page.getByTestId("model:picker-trigger").click();
  const options = page.locator('[data-testid^="model-option:"]');
  await expect(options.first()).toBeVisible();

  const testIds = await options.evaluateAll((els) =>
    els
      .map((el) => el.getAttribute("data-testid") || "")
      .filter(Boolean)
  );

  const available = testIds
    .map((id) => id.replace(/^model-option:/, ""))
    .filter((id) => id.length > 0);

  const scoreModelId = (id: string) => {
    const lower = id.toLowerCase();
    let score = 0;
    if (lower.includes("mini")) score += 30;
    if (lower.includes("small")) score += 20;
    if (lower.includes("fast")) score += 20;
    if (lower.includes("lite")) score += 15;
    if (lower.includes("nano")) score += 15;
    if (lower.includes("gpt-5")) score -= 10;
    if (lower.includes("sonnet")) score -= 5;
    if (lower.includes("opus")) score -= 10;
    if (lower.includes("thinking")) score -= 5;
    return score;
  };

  const preferred = preferredIds.find((id) => available.includes(id));
  const modelId =
    preferred ??
    [...available]
      .sort((a, b) => {
        const diff = scoreModelId(b) - scoreModelId(a);
        if (diff !== 0) return diff;
        return a.localeCompare(b);
      })[0];
  expect(modelId).toBeTruthy();

  await page.getByTestId(`model-option:${modelId}`).click();
  await expect(page.getByTestId(`model-option:${modelId}`)).toBeHidden();
  await expect(page.getByTestId("composer:textarea")).toBeFocused();

  return modelId;
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

test("Profile + chat instructions stay effective (WebKit)", async ({
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
  const modelId = await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
  ]);

  await setProfileInstructions(
    page,
    "For every assistant response, output exactly one line containing only: PROFILE-OK"
  );

  await sendAndExpectAssistant(page, {
    prompt: "Hi",
    expectedAssistantMustInclude: "PROFILE-OK",
    expectedAssistantMustNotInclude: ["CHAT-OK", "CHAT-NEW"],
    expectedModelId: modelId,
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
    expectedModelId: modelId,
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
    expectedModelId: modelId,
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
    expectedModelId: modelId,
    expectedProfileRev: 2,
    expectedChatRev: 3,
    expectedProfileInstructionsMinLen: 0,
    expectedChatInstructionsMinLen: 10,
    expectedProfileInstructionsStoredMinLen: 10,
  });

  expect(consoleErrors).toEqual([]);
});

test("Profile settings stays within viewport with long memory items (WebKit)", async ({
  page,
}) => {
  await page.goto("/");

  const profileName = `E2E settings memory ${Date.now()}`;
  await createProfile(page, profileName);
  await page.getByTestId("sidebar:new-chat").click();

  const profilesRes = await page.request.get("/api/profiles");
  expect(profilesRes.ok()).toBeTruthy();
  const profilesJson = (await profilesRes.json()) as {
    profiles?: Array<{ id: string; name: string }>;
  };
  const profileId =
    profilesJson.profiles?.find((p) => p.name === profileName)?.id ?? "";
  expect(profileId).toBeTruthy();

  const patchRes = await page.request.patch(`/api/profiles/${profileId}`, {
    data: { memoryEnabled: true },
  });
  expect(patchRes.ok()).toBeTruthy();

  const longToken = "A".repeat(4000);
  await page
    .getByTestId("composer:textarea")
    .fill(`Memorize this, ${longToken}`);
  await page.getByTestId("composer:submit").click();

  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect
    .poll(async () => await assistantMessages.count(), {
      timeout: 120_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(0);

  await page.getByTestId("profile:settings-open").click();
  const dialog = page.getByTestId("profile:settings-dialog");
  await expect(dialog).toBeVisible({ timeout: 120_000 });

  const viewport = page.viewportSize();
  expect(viewport).toBeTruthy();
  const bbox = await dialog.boundingBox();
  expect(bbox).toBeTruthy();
  expect(bbox!.width).toBeLessThanOrEqual(viewport!.width - 4);
  expect(bbox!.height).toBeLessThanOrEqual(viewport!.height - 4);

  const memoryItems = page.getByTestId("profile:memory-item");
  await expect(memoryItems.first()).toBeVisible({ timeout: 120_000 });
  await expect(memoryItems.first()).toContainText(longToken.slice(0, 32));

  const wraps = await memoryItems.first().evaluate((el) => {
    return el.scrollWidth <= el.clientWidth + 1;
  });
  expect(wraps).toBeTruthy();
});

test("Regenerate creates a new variant (WebKit)", async ({ page }) => {
  await page.goto("/");

  await createProfile(page, `E2E Regen ${Date.now()}`);
  await page.getByTestId("sidebar:new-chat").click();
  await expect(page.getByTestId("chat:settings-open")).toBeVisible();
  await selectPreferredModel(page, ["openai/gpt-4.1-mini"]);

  await page.getByTestId("composer:textarea").fill("Write one short sentence about winter.");
  await page.getByTestId("composer:submit").click();

  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect(assistantMessages).toHaveCount(1, { timeout: 120_000 });

  await page.getByTestId("composer:regenerate").click();

  const pager = page.locator('[data-testid^="variants:pager:"]');
  await expect(pager).toHaveCount(1, { timeout: 120_000 });
  await expect(pager.first()).toContainText(/\d+\s*\/\s*2/, {
    timeout: 120_000,
  });
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
  await selectPreferredModel(page, ["openai/gpt-4.1-mini"]);

  // Turn 1 with variants.
  await page
    .getByTestId("composer:textarea")
    .fill("Write one short sentence about spring.");
  await page.getByTestId("composer:submit").click();

  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect(assistantMessages).toHaveCount(1, { timeout: 120_000 });
  await page.getByTestId("composer:regenerate").click();
  await expect(page.locator('[data-testid^="variants:pager:"]')).toHaveCount(1, {
    timeout: 120_000,
  });

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

test("New chat uses last selected model (WebKit)", async ({ page }) => {
  await page.goto("/");

  await createProfile(page, `E2E Model ${Date.now()}`);
  await expect(page.getByTestId("model:picker-trigger")).toBeVisible();

  await page.getByTestId("sidebar:new-chat").click();
  await expect(page.getByTestId("chat:settings-open")).toBeVisible();

  const available = await getAvailableModelIds(page);
  const target = available.length > 1 ? available[1] : available[0];
  expect(target).toBeTruthy();
  await selectPreferredModel(page, [target]);

  const createReq = page.waitForRequest((req) => {
    if (!req.url().includes("/api/chats")) return false;
    if (req.method() !== "POST") return false;
    return true;
  });
  await page.getByTestId("sidebar:new-chat").click();
  const req = await createReq;
  const body = req.postDataJSON() as unknown;
  expect(body).toMatchObject({ modelId: target });
});

test("App shows version (WebKit)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app:version")).toHaveText(
    `v${String(packageJson.version ?? "")} · (c) kaaLabs '26`
  );
});

test("App canvas stays within viewport (WebKit)", async ({ page }) => {
  await page.goto("/");

  const sizes = await page.evaluate(() => {
    const vh = window.innerHeight;
    const doc = document.documentElement;
    const body = document.body;
    return {
      vh,
      docScroll: doc.scrollHeight,
      docClient: doc.clientHeight,
      bodyScroll: body.scrollHeight,
      bodyClient: body.clientHeight,
    };
  });

  expect(sizes.docScroll).toBeLessThanOrEqual(sizes.vh + 4);
  expect(sizes.bodyScroll).toBeLessThanOrEqual(sizes.vh + 4);
  expect(sizes.docClient).toBeLessThanOrEqual(sizes.vh + 4);
  expect(sizes.bodyClient).toBeLessThanOrEqual(sizes.vh + 4);
});

test("Profile reselect restores composer focus (WebKit)", async ({ page }) => {
  await page.goto("/");

  const composer = page.getByTestId("composer:textarea");
  await expect(composer).toBeVisible();

  const trigger = page.getByTestId("profile:select-trigger");
  const current = (await trigger.innerText()).trim();
  expect(current).not.toBe("");

  await trigger.click();
  const option = page.getByRole("option", { name: current });
  await expect(option).toBeVisible();
  await option.click();

  await expect(composer).toBeFocused();
});

test("Theme toggle restores composer focus (WebKit)", async ({ page }) => {
  await page.goto("/");

  const themeToggle = page.getByLabel("Toggle theme");
  await expect(themeToggle).toBeVisible();
  await expect(themeToggle.locator("svg")).toHaveCount(1);

  const composer = page.getByTestId("composer:textarea");
  await expect(composer).toBeVisible();

  await themeToggle.click();
  await expect(composer).toBeFocused();

  await themeToggle.click();
  await expect(composer).toBeFocused();
});

test("Light theme uses gray canvas colors (WebKit)", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "light");
  });

  await page.goto("/");
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));

  const colors = await page.evaluate(() => {
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const aside = document.querySelector("aside");
    const sidebarBg = aside ? getComputedStyle(aside).backgroundColor : "";
    const style = getComputedStyle(document.documentElement);
    const primary = style.getPropertyValue("--primary").trim().toLowerCase();
    const accent = style.getPropertyValue("--accent").trim().toLowerCase();
    return { bodyBg, sidebarBg, primary, accent };
  });

  expect(colors.bodyBg).toBe("rgb(247, 247, 244)");
  expect(colors.sidebarBg).toBe("rgb(242, 241, 237)");
  expect(colors.primary).toBe("#a49f7b");
  expect(colors.accent).toBe("#e7e5dc");
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

test("Archiving/deleting last active chat never opens archived chat (WebKit)", async ({
  page,
}) => {
  await page.goto("/");

  await createProfile(page, `E2E Empty chats ${Date.now()}`);
  await expect(page.getByTestId("sidebar:new-chat")).toBeVisible();

  await page.getByTestId("sidebar:new-chat").click();

  const activeList = page.getByTestId("sidebar:chats-active");
  const chatButtons = activeList.locator('[data-testid^="sidebar:chat:"]');
  await expect(chatButtons).toHaveCount(2, { timeout: 120_000 });

  const [newerChatId, olderChatId] = await chatButtons.evaluateAll((els) =>
    els
      .map((el) => el.getAttribute("data-testid") || "")
      .filter(Boolean)
      .map((id) => id.replace(/^sidebar:chat:/, ""))
  );
  expect(newerChatId).toBeTruthy();
  expect(olderChatId).toBeTruthy();
  expect(newerChatId).not.toBe(olderChatId);

  await page.getByTestId(`sidebar:chat-menu:${olderChatId}`).click();
  await page.getByTestId(`chat-action:archive:${olderChatId}`).click();
  await expect(page.getByTestId(`sidebar:archived-chat:${olderChatId}`)).toBeVisible({
    timeout: 120_000,
  });

  await page.getByTestId(`sidebar:chat-menu:${newerChatId}`).click();
  await page.getByTestId(`chat-action:archive:${newerChatId}`).click();
  await expect(page.getByTestId(`sidebar:archived-chat:${newerChatId}`)).toBeVisible({
    timeout: 120_000,
  });

  await expect(chatButtons).toHaveCount(1, { timeout: 120_000 });
  const createdChatId =
    ((await chatButtons.first().getAttribute("data-testid")) ?? "").replace(
      /^sidebar:chat:/,
      ""
    );
  expect(createdChatId).toBeTruthy();
  expect([newerChatId, olderChatId]).not.toContain(createdChatId);

  await page.getByTestId(`sidebar:chat-menu:${createdChatId}`).click();
  await page.getByTestId(`chat-action:delete:${createdChatId}`).click();
  await page.getByTestId("chat:delete-confirm").click();

  await expect(page.getByTestId(`sidebar:chat:${createdChatId}`)).toHaveCount(0);
  await expect(chatButtons).toHaveCount(1, { timeout: 120_000 });
  const afterDeleteChatId =
    ((await chatButtons.first().getAttribute("data-testid")) ?? "").replace(
      /^sidebar:chat:/,
      ""
    );
  expect(afterDeleteChatId).toBeTruthy();
  expect([newerChatId, olderChatId, createdChatId]).not.toContain(afterDeleteChatId);

  await expect(page.getByTestId(`sidebar:archived-chat:${olderChatId}`)).toBeVisible();
  await expect(page.getByTestId(`sidebar:archived-chat:${newerChatId}`)).toBeVisible();
});

test("Admin export/reset works (WebKit)", async ({ request }) => {
  const exportRes = await request.get("/api/admin/export");
  expect(exportRes.ok()).toBeTruthy();
  const exported = (await exportRes.json()) as {
    schemaVersion?: number;
    profiles?: unknown[];
  };
  expect(exported.schemaVersion).toBe(1);
  expect(Array.isArray(exported.profiles)).toBeTruthy();

  const badReset = await request.post("/api/admin/reset", {
    data: { confirm: "NO" },
  });
  expect(badReset.status()).toBe(400);

  const okReset = await request.post("/api/admin/reset", {
    data: { confirm: "RESET" },
  });
  expect(okReset.ok()).toBeTruthy();

  const profilesRes = await request.get("/api/profiles");
  expect(profilesRes.ok()).toBeTruthy();
  const profiles = (await profilesRes.json()) as {
    profiles?: Array<{ name?: string }>;
  };
  expect(profiles.profiles?.[0]?.name).toBe("Default");
});

test("Delete profile works (WebKit)", async ({ request }) => {
  const name = `E2E Delete ${Date.now()}`;

  const createRes = await request.post("/api/profiles", {
    data: { name },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = (await createRes.json()) as { profile?: { id?: string } };
  const profileId = created.profile?.id ?? "";
  expect(profileId).not.toBe("");

  const badDelete = await request.delete(`/api/profiles/${profileId}`, {
    data: { confirm: "NO" },
  });
  expect(badDelete.status()).toBe(400);

  const okDelete = await request.delete(`/api/profiles/${profileId}`, {
    data: { confirm: name },
  });
  expect(okDelete.ok()).toBeTruthy();

  const profilesRes = await request.get("/api/profiles");
  expect(profilesRes.ok()).toBeTruthy();
  const profiles = (await profilesRes.json()) as {
    profiles?: Array<{ id?: string; name?: string }>;
  };
  const stillThere = (profiles.profiles ?? []).some((p) => p.id === profileId);
  expect(stillThere).toBe(false);
});

test("Temporary chat turns composer red (WebKit)", async ({ page }) => {
  await page.goto("/");

  const toggle = page.getByTestId("chat:temporary-toggle");
  await expect(toggle).toBeVisible();
  const title = (await toggle.getAttribute("title")) ?? "";
  if (title.includes("(on)")) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("title", "Temporary chat (off)");
  }

  const submit = page.getByTestId("composer:submit");
  const textarea = page.getByTestId("composer:textarea");
  const composerGroup = textarea.locator(
    'xpath=ancestor::*[@data-slot="input-group"][1]'
  );

  const getBorderRgb = async () =>
    composerGroup.evaluate((el) => {
      const raw = getComputedStyle(el).borderTopColor;
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return { ok: false, raw, r: 0, g: 0, b: 0 };
      }

      ctx.fillStyle = "rgb(0, 0, 0)";
      ctx.fillStyle = raw;
      const used = String(ctx.fillStyle);

      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;

      return {
        ok:
          used !== "rgb(0, 0, 0)" ||
          raw.includes("0, 0, 0") ||
          raw.includes("0 0 0"),
        raw,
        r: data[0] ?? 0,
        g: data[1] ?? 0,
        b: data[2] ?? 0,
      };
    });

  const isReddish = (rgb: { r: number; g: number; b: number }) =>
    rgb.r > rgb.g + 10 && rgb.r > rgb.b + 10;

  const normal = await getBorderRgb();
  expect(normal.ok, `normalBorder="${normal.raw}"`).toBe(true);

  await expect(submit).toHaveAttribute("data-variant", "default");

  await toggle.click();
  await expect(submit).toHaveAttribute("data-variant", "destructive");

  const temp = await getBorderRgb();
  expect(temp.ok, `tempBorder="${temp.raw}"`).toBe(true);
  expect(temp.r).toBeGreaterThanOrEqual(normal.r + 10);
  expect(isReddish(temp)).toBe(true);
  expect(temp.raw).not.toBe(normal.raw);

  await toggle.click();
  await expect(submit).toHaveAttribute("data-variant", "default");

  const back = await getBorderRgb();
  expect(back.ok, `backBorder="${back.raw}"`).toBe(true);
  expect(isReddish(back)).toBe(false);
});

test("Temporary toggle uses consistent colored elements (WebKit)", async ({
  page,
}) => {
  await page.goto("/");

  const toggle = page.getByTestId("chat:temporary-toggle");
  await expect(toggle).toBeVisible();
  const title = (await toggle.getAttribute("title")) ?? "";
  if (title.includes("(on)")) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("title", "Temporary chat (off)");
  }

  await expect(toggle).toHaveClass(/border-ring/);
  await expect(toggle).toHaveClass(/text-ring/);
  await expect(toggle).toHaveClass(/bg-transparent/);

  await toggle.click();
  await expect(toggle).toHaveAttribute("title", "Temporary chat (on)");

  await expect(toggle).toHaveClass(/border-destructive/);
  await expect(toggle).toHaveClass(/text-destructive/);
  await expect(toggle).toHaveClass(/bg-destructive/);

  await toggle.click();
  await expect(toggle).toHaveAttribute("title", "Temporary chat (off)");

  await expect(toggle).toHaveClass(/border-ring/);
  await expect(toggle).toHaveClass(/text-ring/);
  await expect(toggle).toHaveClass(/bg-transparent/);
});
