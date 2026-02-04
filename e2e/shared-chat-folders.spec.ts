import { expect, test } from "@playwright/test";

test("Shared folders: share folder, recipient sees chats, move-out stops sharing, unshare removes folder", async ({
  page,
  request,
}) => {
  const ownerName = `Shared folders owner ${Date.now()}`;
  const memberName = `Shared folders member ${Date.now()}`;

  const ownerRes = await request.post("/api/profiles", { data: { name: ownerName } });
  expect(ownerRes.ok()).toBeTruthy();
  const ownerJson = (await ownerRes.json()) as { profile?: { id: string } };
  const ownerId = ownerJson.profile?.id ?? "";
  expect(ownerId).toBeTruthy();

  const memberRes = await request.post("/api/profiles", { data: { name: memberName } });
  expect(memberRes.ok()).toBeTruthy();
  const memberJson = (await memberRes.json()) as { profile?: { id: string } };
  const memberId = memberJson.profile?.id ?? "";
  expect(memberId).toBeTruthy();

  // Owner session.
  await page.context().addCookies([
    { name: "remcochat_profile_id", value: ownerId, url: "http://127.0.0.1:3100" },
  ]);
  await page.goto("/");

  // Create a chat and rename for a stable label.
  await page.getByTestId("sidebar:new-chat").click();
  const activeChats = page.getByTestId("sidebar:chats-active");
  await activeChats.locator('[data-testid^="sidebar:chat-menu:"]').first().click();
  await page.locator('[data-testid^="chat-action:rename:"]').click();
  await page.getByTestId("chat:rename-input").fill("Chat A");
  await page.getByTestId("chat:rename-save").click();
  await expect(activeChats).toContainText("Chat A");

  // Capture chat id.
  const chatIdRaw = (await activeChats
    .locator('[data-testid^="sidebar:chat:"]')
    .first()
    .getAttribute("data-testid")) as string;
  const chatId = chatIdRaw.replace(/^sidebar:chat:/, "");
  expect(chatId).toBeTruthy();

  // Create folder.
  await page.getByTestId("sidebar:new-folder").click();
  await page.getByTestId("folder:new-input").fill("Work");
  await page.getByTestId("folder:new-create").click();
  await expect(page.getByTestId("sidebar:folders")).toContainText("Work");

  // Capture folder id.
  const foldersRes = await request.get(`/api/folders?profileId=${ownerId}`);
  expect(foldersRes.ok()).toBeTruthy();
  const foldersJson = (await foldersRes.json()) as {
    folders?: Array<{ id: string; name: string; scope?: string }>;
  };
  const folderId =
    foldersJson.folders?.find((f) => f.name === "Work" && f.scope !== "shared")?.id ??
    "";
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

  // Share folder with member via UI.
  await page.getByTestId(`sidebar:folder-menu:${folderId}`).click();
  await page.getByTestId(`folder-action:share:${folderId}`).click();
  await page.getByTestId("folder:share-target").fill(memberName);
  const shareRes = page.waitForResponse(
    (r) => r.url().includes(`/api/folders/${folderId}/share`) && r.request().method() === "POST"
  );
  await page.getByTestId("folder:share-submit").click();
  await shareRes;

  // Member session: switch cookie and reload.
  await page.context().addCookies([
    { name: "remcochat_profile_id", value: memberId, url: "http://127.0.0.1:3100" },
  ]);
  await page.evaluate((profileId) => {
    window.localStorage.setItem("remcochat:profileId", profileId);
  }, memberId);
  await page.reload();

  const personalToggle = page.getByTestId("sidebar:folders-personal-toggle");
  await expect(personalToggle).toHaveAttribute("aria-expanded", "true");

  const sharedSection = page.getByTestId("sidebar:folders-shared");
  const sharedToggle = page.getByTestId("sidebar:folders-shared-toggle");
  await expect(sharedToggle).toHaveAttribute("aria-expanded", "true");

  await expect(sharedSection).toContainText(`by ${ownerName}`);
  await expect(sharedSection).toContainText("Work");
  await expect(sharedSection).toContainText("Chat A");

  // Groupings should be collapsible.
  await personalToggle.click();
  await expect(personalToggle).toHaveAttribute("aria-expanded", "false");
  await personalToggle.click();
  await expect(personalToggle).toHaveAttribute("aria-expanded", "true");

  await sharedToggle.click();
  await expect(sharedToggle).toHaveAttribute("aria-expanded", "false");
  await expect(sharedSection).not.toContainText("Work");

  await sharedToggle.click();
  await expect(sharedToggle).toHaveAttribute("aria-expanded", "true");
  await expect(sharedSection).toContainText("Work");

  const ownerGroupToggle = page.getByRole("button", { name: `by ${ownerName}` });
  await expect(ownerGroupToggle).toHaveAttribute("aria-expanded", "true");
  await ownerGroupToggle.click();
  await expect(ownerGroupToggle).toHaveAttribute("aria-expanded", "false");
  await expect(sharedSection).not.toContainText("Work");
  await ownerGroupToggle.click();
  await expect(ownerGroupToggle).toHaveAttribute("aria-expanded", "true");
  await expect(sharedSection).toContainText("Work");

  // Shared chat menu should be disabled for the member.
  await expect(page.getByTestId(`sidebar:chat-menu:${chatId}`)).toBeDisabled();

  // Member can open the chat; settings + model should be locked.
  await page.getByTestId(`sidebar:chat:${chatId}`).click();
  await expect(page.getByTestId("chat:settings-open")).toBeDisabled();
  await expect(page.getByTestId("model:picker-trigger")).toBeDisabled();

  // Owner moves the chat out of the shared folder; member loses access to the chat.
  await page.context().addCookies([
    { name: "remcochat_profile_id", value: ownerId, url: "http://127.0.0.1:3100" },
  ]);
  await page.evaluate((profileId) => {
    window.localStorage.setItem("remcochat:profileId", profileId);
  }, ownerId);
  await page.reload();

  const moveOutRes = await request.patch(`/api/chats/${chatId}`, {
    data: { profileId: ownerId, folderId: null },
  });
  expect(moveOutRes.ok()).toBeTruthy();

  await page.context().addCookies([
    { name: "remcochat_profile_id", value: memberId, url: "http://127.0.0.1:3100" },
  ]);
  await page.evaluate((profileId) => {
    window.localStorage.setItem("remcochat:profileId", profileId);
  }, memberId);
  await page.reload();
  await expect(page.getByTestId("sidebar:folders-shared")).toContainText("Work");
  await expect(page.getByTestId("sidebar:folders-shared")).not.toContainText("Chat A");

  // Owner stops sharing; folder disappears for the member.
  const unshareRes = await request.post(`/api/folders/${folderId}/unshare`, {
    data: { profileId: ownerId, targetProfile: memberId },
  });
  expect(unshareRes.ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("sidebar:folders-shared")).toHaveCount(0);
});
