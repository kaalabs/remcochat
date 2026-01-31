import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";

skipUnlessOpencodeApiKey(test);

async function createProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:new").click();
  const nameInput = page.getByTestId("profile:create-name");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  await page.getByTestId("profile:create-submit").click();
  await expect(nameInput).toBeHidden();
  await expect(page.locator("[data-slot='dialog-overlay']")).toBeHidden();
}

async function createProfileViaApi(
  page: import("@playwright/test").Page,
  name: string
): Promise<string> {
  const res = await page.request.post("/api/profiles", { data: { name } });
  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as { profile?: { id?: string } };
  const id = String(json?.profile?.id ?? "");
  expect(id).toBeTruthy();
  return id;
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
  const selectContent = page.locator('[data-slot="select-content"]');
  await expect(selectContent).toBeVisible();
  await selectContent.locator('[data-slot="select-item"]', { hasText: name }).click();
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

test("Lists overview shows owned lists (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E lists overview ${Date.now()}`);
  await createChat(page);

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=create, list_name=Projecten."
  );
  await page.getByTestId("composer:submit").click();
  await expect(page.getByTestId("tool:displayList").last()).toBeVisible({
    timeout: 120_000,
  });

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayList tool met action=create, list_name=Boodschappen."
  );
  await page.getByTestId("composer:submit").click();
  await expect(page.getByTestId("tool:displayList").last()).toBeVisible({
    timeout: 120_000,
  });

  await page.getByTestId("composer:textarea").fill("Show my lists.");
  await page.getByTestId("composer:submit").click();

  const card = page.getByTestId("tool:displayListsOverview");
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText(/Projecten/i);
  await expect(card).toContainText(/Boodschappen/i);

  await card.getByRole("button", { name: /Open Projecten/i }).click();
  const opened = page.getByTestId("tool:displayList").last();
  await expect(opened).toBeVisible({ timeout: 120_000 });
  await expect(opened).toContainText(/Projecten/i);

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("Lists overview includes shared lists (WebKit)", async ({ page }) => {
  test.setTimeout(480_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  const ownerName = `E2E overview owner ${Date.now()}`;
  const memberName = `E2E overview member ${Date.now()}`;
  const ownerId = await createProfileViaApi(page, ownerName);
  await createProfileViaApi(page, memberName);
  await page.reload();

  await selectProfile(page, ownerName);
  await createChat(page);

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  const createListRes = await page.request.post(`/api/profiles/${ownerId}/lists`, {
    data: { action: "create", listName: "Weekend" },
  });
  expect(createListRes.ok()).toBeTruthy();
  const shareRes = await page.request.post(`/api/profiles/${ownerId}/lists`, {
    data: { action: "share_list", listName: "Weekend", targetProfile: memberName },
  });
  expect(shareRes.ok()).toBeTruthy();

  await selectProfile(page, memberName);
  await createChat(page);

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page
    .getByTestId("composer:textarea")
    .fill("Welke lijsten heb ik? Gebruik de displayListsOverview tool.");
  await page.getByTestId("composer:submit").click();

  const card = page.getByTestId("tool:displayListsOverview");
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText(/Weekend/i);
  await expect(card).toContainText(ownerName);

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
