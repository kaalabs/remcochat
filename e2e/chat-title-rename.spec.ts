import { expect, test } from "@playwright/test";

test("Rename chat title from sidebar (active + archived)", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("sidebar:new-chat").click();

  const activeChats = page.getByTestId("sidebar:chats-active");
  await activeChats.locator('[data-testid^="sidebar:chat-menu:"]').first().click();
  await page.locator('[data-testid^="chat-action:rename:"]').click();

  await expect(page.getByTestId("chat:rename-dialog")).toBeVisible();
  await page.getByTestId("chat:rename-input").fill("Renamed chat");
  await page.getByTestId("chat:rename-save").click();

  await expect(activeChats).toContainText("Renamed chat");

  await page.reload();
  await expect(page.getByTestId("sidebar:chats-active")).toContainText(
    "Renamed chat"
  );

  const activeChatsAfterReload = page.getByTestId("sidebar:chats-active");
  await activeChatsAfterReload
    .locator('[data-testid^="sidebar:chat-menu:"]')
    .first()
    .click();
  await page.locator('[data-testid^="chat-action:archive:"]').click();

  const archivedToggle = page.getByTestId("sidebar:archived-toggle");
  await expect(archivedToggle).toBeVisible();

  const archivedChats = page.getByTestId("sidebar:chats-archived");
  if (!(await archivedChats.isVisible())) {
    await archivedToggle.click();
  }

  await archivedChats
    .locator('[data-testid^="sidebar:archived-chat-menu:"]')
    .first()
    .click();
  await page.locator('[data-testid^="chat-action:rename:"]').click();

  await page.getByTestId("chat:rename-input").fill("Renamed archived chat");
  await page.getByTestId("chat:rename-save").click();

  await expect(archivedChats).toContainText("Renamed archived chat");

  await page.reload();
  await expect(page.getByTestId("sidebar:archived-toggle")).toBeVisible();
  await page.getByTestId("sidebar:archived-toggle").click();
  await expect(page.getByTestId("sidebar:chats-archived")).toContainText(
    "Renamed archived chat"
  );
});

test("PATCH /api/chats/:id requires profileId", async ({ request }) => {
  const profilesRes = await request.get("/api/profiles");
  expect(profilesRes.ok()).toBeTruthy();
  const profilesJson = (await profilesRes.json()) as { profiles: Array<{ id: string }> };
  const profileId = profilesJson.profiles[0]?.id ?? "";
  expect(profileId).toBeTruthy();

  const chatRes = await request.post("/api/chats", {
    data: { profileId },
  });
  expect(chatRes.status()).toBe(201);
  const chatJson = (await chatRes.json()) as { chat: { id: string } };
  const chatId = chatJson.chat.id;

  const missingProfileId = await request.patch(`/api/chats/${chatId}`, {
    data: { title: "Nope" },
  });
  expect(missingProfileId.status()).toBe(400);

  const okRes = await request.patch(`/api/chats/${chatId}`, {
    data: { profileId, title: "Ok" },
  });
  expect(okRes.ok()).toBeTruthy();
  const okJson = (await okRes.json()) as { chat: { title: string } };
  expect(okJson.chat.title).toBe("Ok");
});

