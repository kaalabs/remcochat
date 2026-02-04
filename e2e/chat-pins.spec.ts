import { expect, test } from "@playwright/test";

test("Chat pins: pin/unpin keeps pinned chats at the top", async ({ page, request }) => {
  const profileRes = await request.post("/api/profiles", {
    data: { name: `Pins ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile?: { id: string } };
  const profileId = profileJson.profile?.id ?? "";
  expect(profileId).toBeTruthy();

  const chatARes = await request.post("/api/chats", {
    data: { profileId, title: "Chat A" },
  });
  expect(chatARes.ok()).toBeTruthy();
  const chatAJson = (await chatARes.json()) as { chat?: { id: string } };
  const chatAId = chatAJson.chat?.id ?? "";
  expect(chatAId).toBeTruthy();

  const chatBRes = await request.post("/api/chats", {
    data: { profileId, title: "Chat B" },
  });
  expect(chatBRes.ok()).toBeTruthy();
  const chatBJson = (await chatBRes.json()) as { chat?: { id: string } };
  const chatBId = chatBJson.chat?.id ?? "";
  expect(chatBId).toBeTruthy();

  await page.context().addCookies([
    {
      name: "remcochat_profile_id",
      value: profileId,
      url: "http://127.0.0.1:3100",
    },
  ]);

  await page.goto("/");

  await expect(page.getByTestId(`sidebar:chat:${chatAId}`)).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId(`sidebar:chat:${chatBId}`)).toBeVisible();

  // Pin Chat A.
  const pinResA = page.waitForResponse(
    (r) => r.url().includes(`/api/chats/${chatAId}/pin`) && r.request().method() === "POST"
  );
  await page.getByTestId(`sidebar:chat-pin:${chatAId}`).click();
  await pinResA;

  await expect(page.getByTestId("sidebar:chats-pinned")).toHaveCount(0);

  const activeList = page.getByTestId("sidebar:chats-active");
  const firstAfterPinA =
    (await activeList
      .locator('[data-testid^="sidebar:chat:"]')
      .first()
      .getAttribute("data-testid")) ?? "";
  expect(firstAfterPinA.replace(/^sidebar:chat:/, "")).toBe(chatAId);

  // Now pin Chat B and ensure it becomes the first pinned chat.
  const pinResB = page.waitForResponse(
    (r) => r.url().includes(`/api/chats/${chatBId}/pin`) && r.request().method() === "POST"
  );
  await page.getByTestId(`sidebar:chat-pin:${chatBId}`).click();
  await pinResB;

  const firstAfterPinB =
    (await activeList
      .locator('[data-testid^="sidebar:chat:"]')
      .first()
      .getAttribute("data-testid")) ?? "";
  expect(firstAfterPinB.replace(/^sidebar:chat:/, "")).toBe(chatBId);

  // Unpin Chat B; Chat A should remain pinned and visible.
  const unpinResB = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/chats/${chatBId}/pin`) && r.request().method() === "DELETE"
  );
  await page.getByTestId(`sidebar:chat-pin:${chatBId}`).click();
  await unpinResB;

  const firstAfterUnpinB =
    (await activeList
      .locator('[data-testid^="sidebar:chat:"]')
      .first()
      .getAttribute("data-testid")) ?? "";
  expect(firstAfterUnpinB.replace(/^sidebar:chat:/, "")).toBe(chatAId);

  // Unpin Chat A; pinned section should disappear.
  const unpinResA = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/chats/${chatAId}/pin`) && r.request().method() === "DELETE"
  );
  await page.getByTestId(`sidebar:chat-pin:${chatAId}`).click();
  await unpinResA;

  const firstAfterUnpinA =
    (await activeList
      .locator('[data-testid^="sidebar:chat:"]')
      .first()
      .getAttribute("data-testid")) ?? "";
  expect(firstAfterUnpinA.replace(/^sidebar:chat:/, "")).toBe(chatBId);
});
