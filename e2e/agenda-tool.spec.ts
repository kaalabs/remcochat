import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";

skipUnlessOpencodeApiKey(test);

async function createProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:new").click();
  await page.getByTestId("profile:create-name").fill(name);
  await expect(page.getByTestId("profile:create-submit")).toBeEnabled();
  // The dialog animates; WebKit can treat the button as "unstable" during the transition.
  await page.getByTestId("profile:create-submit").evaluate((el) => {
    (el as HTMLButtonElement).click();
  });
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

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(date: Date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

test("Agenda tool renders a card and lists items (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E agenda ${Date.now()}`);
  await createChat(page);

  await selectPreferredModel(page, [
    "gpt-5.2-codex",
    "gpt-5.2",
  ]);

  const scheduled = new Date(Date.now() + 60 * 60 * 1000);
  const date = formatDate(scheduled);
  const time = formatTime(scheduled);

  await page.getByTestId("composer:textarea").fill(
    `Gebruik de displayAgenda tool met action=create, description=Team sync, date=${date}, time=${time}, duration_minutes=30.`
  );
  await page.getByTestId("composer:submit").click();

  const createdCard = page.getByTestId("tool:displayAgenda").last();
  await expect(createdCard).toBeVisible({ timeout: 120_000 });
  await expect(createdCard).toContainText(/team sync/i);

  await page.getByTestId("composer:textarea").fill(
    "Gebruik de displayAgenda tool met action=list en range={kind:today}."
  );
  await page.getByTestId("composer:submit").click();

  const listCard = page.getByTestId("tool:displayAgenda").last();
  await expect(listCard).toBeVisible({ timeout: 120_000 });
  await expect(listCard).toContainText(/team sync/i);

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
