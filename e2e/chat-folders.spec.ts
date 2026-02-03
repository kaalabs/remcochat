import { expect, test } from "@playwright/test";

test("Folders: create, move chat, collapse persists, delete moves chat to root", async ({
  page,
  request,
}) => {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `Folders ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile?: { id: string } };
  const profileId = profileJson.profile?.id ?? "";
  expect(profileId).toBeTruthy();

  await page.context().addCookies([
    {
      name: "remcochat_profile_id",
      value: profileId,
      url: "http://127.0.0.1:3100",
    },
  ]);

  await page.goto("/");

  await page.getByTestId("sidebar:new-chat").click();
  await page.getByTestId("sidebar:new-chat").click();

  const activeChats = page.getByTestId("sidebar:chats-active");

  // Rename the chat to get a stable label.
  await activeChats.locator('[data-testid^="sidebar:chat-menu:"]').first().click();
  await page.locator('[data-testid^="chat-action:rename:"]').click();
  await page.getByTestId("chat:rename-input").fill("Chat A");
  await page.getByTestId("chat:rename-save").click();
  await expect(activeChats).toContainText("Chat A");

  // Create folder.
  await page.getByTestId("sidebar:new-folder").click();
  await page.getByTestId("folder:new-input").fill("Work");
  await page.getByTestId("folder:new-create").click();

  const foldersSection = page.getByTestId("sidebar:folders");
  await expect(foldersSection).toContainText("Work");

  // Move chat into folder.
  await activeChats.locator('[data-testid^="sidebar:chat-menu:"]').first().click();
  await page.locator('[data-testid^="chat-action:move-folder:"]').first().click();
  const moveRes = page.waitForResponse(
    (r) => r.url().includes("/api/chats/") && r.request().method() === "PATCH"
  );
  await page.getByRole("menuitemradio", { name: "Work" }).click();
  await moveRes;

  await expect(foldersSection).toContainText("Chat A");

  // Collapse folder and confirm chat is hidden.
  const collapseRes = page.waitForResponse(
    (r) => r.url().includes("/api/folders/") && r.request().method() === "PATCH"
  );
  await page.locator('[data-testid^="sidebar:folder-toggle:"]').first().click();
  await collapseRes;

  await expect(foldersSection).not.toContainText("Chat A");

  // Reload and confirm the collapsed state persists.
  await page.reload();
  await expect(page.getByTestId("sidebar:folders")).toContainText("Work");
  await expect(page.getByTestId("sidebar:folders")).not.toContainText("Chat A");

  // Expand again and confirm chat is visible.
  const expandRes = page.waitForResponse(
    (r) => r.url().includes("/api/folders/") && r.request().method() === "PATCH"
  );
  await page.locator('[data-testid^="sidebar:folder-toggle:"]').first().click();
  await expandRes;
  await expect(page.getByTestId("sidebar:folders")).toContainText("Chat A");

  // Delete folder and confirm the chat returns to the root list.
  await page.locator('[data-testid^="sidebar:folder-menu:"]').first().click();
  await page.locator('[data-testid^="folder-action:delete:"]').first().click();
  const deleteRes = page.waitForResponse(
    (r) => r.url().includes("/api/folders/") && r.request().method() === "DELETE"
  );
  await page.getByTestId("folder:delete-confirm").click();
  await deleteRes;

  await expect(page.getByTestId("sidebar:folders")).not.toContainText("Work");
  await expect(page.getByTestId("sidebar:chats-active")).toContainText("Chat A");
});

test("Folders: deleting a chat in a folder deletes it (does not unfile)", async ({
  page,
  request,
}) => {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `Folders delete chat ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile?: { id: string } };
  const profileId = profileJson.profile?.id ?? "";
  expect(profileId).toBeTruthy();

  await page.context().addCookies([
    {
      name: "remcochat_profile_id",
      value: profileId,
      url: "http://127.0.0.1:3100",
    },
  ]);

  await page.goto("/");

  const activeChats = page.getByTestId("sidebar:chats-active");
  const firstChatButton = activeChats.locator('[data-testid^="sidebar:chat:"]').first();
  await expect(firstChatButton).toBeVisible({ timeout: 120_000 });

  const chatIdRaw = (await firstChatButton.getAttribute("data-testid")) ?? "";
  const chatId = chatIdRaw.replace(/^sidebar:chat:/, "");
  expect(chatId).toBeTruthy();

  // Rename the chat to get a stable label.
  await page.getByTestId(`sidebar:chat-menu:${chatId}`).click();
  await page.getByTestId(`chat-action:rename:${chatId}`).click();
  await page.getByTestId("chat:rename-input").fill("Chat A");
  await page.getByTestId("chat:rename-save").click();
  await expect(activeChats).toContainText("Chat A");

  // Create folder.
  await page.getByTestId("sidebar:new-folder").click();
  await page.getByTestId("folder:new-input").fill("Work");
  await page.getByTestId("folder:new-create").click();
  await expect(page.getByTestId("sidebar:folders")).toContainText("Work");

  // Capture folder id.
  const foldersRes = await request.get(`/api/folders?profileId=${profileId}`);
  expect(foldersRes.ok()).toBeTruthy();
  const foldersJson = (await foldersRes.json()) as {
    folders?: Array<{ id: string; name: string }>;
  };
  const folderId = foldersJson.folders?.find((f) => f.name === "Work")?.id ?? "";
  expect(folderId).toBeTruthy();

  // Move chat into folder.
  await page.getByTestId(`sidebar:chat-menu:${chatId}`).click();
  await page.getByTestId(`chat-action:move-folder:${chatId}`).click();
  const moveRes = page.waitForResponse(
    (r) => r.url().includes("/api/chats/") && r.request().method() === "PATCH"
  );
  await page.getByRole("menuitemradio", { name: "Work" }).click();
  await moveRes;
  await expect(page.getByTestId("sidebar:folders")).toContainText("Chat A");

  // Delete chat.
  await page.getByTestId(`sidebar:chat-menu:${chatId}`).click();
  const deleteRes = page.waitForResponse(
    (r) => r.url().includes("/api/chats/") && r.request().method() === "DELETE"
  );
  const refreshRes = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/chats?profileId=${profileId}`) &&
      r.request().method() === "GET"
  );
  await page.getByTestId(`chat-action:delete:${chatId}`).click();
  await deleteRes;
  await refreshRes;

  await expect(page.getByTestId("sidebar:chats-active")).not.toContainText("Chat A");

  // If the app needs to auto-create a new chat, it should stay inside the same folder
  // (foldered chats should not be moved to root unless the folder is deleted).
  const chatsRes = await request.get(`/api/chats?profileId=${profileId}`);
  expect(chatsRes.ok()).toBeTruthy();
  const chatsJson = (await chatsRes.json()) as {
    chats?: Array<{ id: string; folderId: string | null; archivedAt?: string | null }>;
  };
  const unarchived = (chatsJson.chats ?? []).filter((c) => !c.archivedAt);
  expect(unarchived).toHaveLength(1);
  expect(unarchived[0]?.folderId).toBe(folderId);
});
