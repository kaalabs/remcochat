import { expect, test } from "@playwright/test";

async function createProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:new").click();
  await page.getByTestId("profile:create-name").fill(name);
  await page.getByTestId("profile:create-submit").click();
  await expect(page.getByTestId("profile:create-name")).toBeHidden();
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

async function selectProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:select-trigger").click();
  await page.getByRole("option", { name }).click();
  await expect(page.getByTestId("profile:select-trigger")).toContainText(name);
}

async function createChat(page: import("@playwright/test").Page) {
  const createRequest = page.waitForResponse((response) => {
    return (
      response.url().includes("/api/chats") &&
      response.request().method() === "POST"
    );
  });
  await page.getByTestId("sidebar:new-chat").click();
  await createRequest;
}

test("List tool renders a card (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E lists ${Date.now()}`);
  await createChat(page);

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=add_items, list_name=Boodschappen en items=[melk, brood, eieren]."
  );
  await page.getByTestId("composer:submit").click();

  const card = page.getByTestId("tool:displayList");
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText(/boodschappen/i);
  await expect(card).toContainText(/melk/i);
  await expect(card).toContainText(/brood/i);

  const unchecked = card.locator('[role="checkbox"][aria-checked="false"]');
  const checked = card.locator('[role="checkbox"][aria-checked="true"]');
  const beforeChecked = await checked.count();
  await unchecked.first().click();
  await expect(checked).toHaveCount(beforeChecked + 1, { timeout: 120_000 });

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("List tool deletes a list (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E list delete ${Date.now()}`);
  await createChat(page);

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=add_items, list_name=Boodschappen en items=[melk]."
  );
  await page.getByTestId("composer:submit").click();

  const card = page.getByTestId("tool:displayList").last();
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText(/melk/i);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=delete_list, list_name=Boodschappen."
  );
  await page.getByTestId("composer:submit").click();

  const deletedCard = page.getByTestId("tool:displayList").last();
  await expect(deletedCard).toBeVisible({ timeout: 120_000 });
  await expect(deletedCard).toContainText(/deleted/i);
  await expect(deletedCard.locator('[role="checkbox"]')).toHaveCount(0);

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("Shared lists sync across profiles (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  const ownerName = `E2E owner ${Date.now()}`;
  await createProfile(page, ownerName);

  const memberName = `E2E member ${Date.now()}`;
  await createProfile(page, memberName);

  await selectProfile(page, ownerName);
  await createChat(page);

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=add_items, list_name=Boodschappen en items=[melk]."
  );
  await page.getByTestId("composer:submit").click();

  const ownerCard = page.getByTestId("tool:displayList").last();
  await expect(ownerCard).toBeVisible({ timeout: 120_000 });
  await expect(ownerCard).toContainText(/boodschappen/i);
  await expect(ownerCard).toContainText(/melk/i);

  const listCardCount = page.getByTestId("tool:displayList");
  const beforeShareCount = await listCardCount.count();
  await page.getByTestId("composer:textarea").fill(
    `Gebruik de displayList tool met action=share_list, list_name=Boodschappen, target_profile=${memberName}`
  );
  await page.getByTestId("composer:submit").click();
  await expect(listCardCount).toHaveCount(beforeShareCount + 1, {
    timeout: 120_000,
  });
  const shareResultCard = page.getByTestId("tool:displayList").last();
  await expect(shareResultCard).toContainText(/shared/i);

  await selectProfile(page, memberName);
  await createChat(page);

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=show, list_name=Boodschappen."
  );
  await page.getByTestId("composer:submit").click();

  const memberCard = page.getByTestId("tool:displayList").last();
  await expect(memberCard).toBeVisible({ timeout: 120_000 });
  await expect(memberCard).toContainText(/melk/i);

  const unchecked = memberCard.locator('[role="checkbox"][aria-checked="false"]');
  await unchecked.first().click();
  await expect(
    memberCard.locator('[role="checkbox"][aria-checked="true"]')
  ).toHaveCount(1, { timeout: 120_000 });

  await selectProfile(page, ownerName);
  await createChat(page);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=show, list_name=Boodschappen."
  );
  await page.getByTestId("composer:submit").click();

  const ownerCheck = page.getByTestId("tool:displayList").last();
  await expect(
    ownerCheck.locator('[role="checkbox"][aria-checked="true"]')
  ).toHaveCount(1, { timeout: 120_000 });

  await ownerCheck.getByRole("button", { name: "Delete list" }).click();
  await expect(ownerCheck.getByText("Deleted", { exact: true }).first()).toBeVisible({
    timeout: 120_000,
  });

  await selectProfile(page, memberName);
  await createChat(page);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=show, list_name=Boodschappen."
  );
  await page.getByTestId("composer:submit").click();
  await expect(page.getByText(/List error:.*not found/i)).toBeVisible({
    timeout: 120_000,
  });

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
