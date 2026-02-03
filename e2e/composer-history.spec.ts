import { expect, test } from "@playwright/test";

async function createProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:new").click();
  await page.getByTestId("profile:create-name").fill(name);
  await page.getByTestId("profile:create-submit").click();
  await expect(page.getByTestId("profile:create-name")).toBeHidden();
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

async function selectPreferredModel(
  page: import("@playwright/test").Page,
  preferredIds: string[]
) {
  await page.getByTestId("model:picker-trigger").click();
  const options = page.locator('[data-testid^="model-option:"]');
  await expect(options.first()).toBeVisible();

  const testIds = await options.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-testid") || "").filter(Boolean)
  );

  const available = testIds
    .map((id) => id.replace(/^model-option:/, ""))
    .filter((id) => id.length > 0);

  const preferred = preferredIds.find((id) => available.includes(id));
  const modelId = preferred ?? available[0];
  expect(modelId).toBeTruthy();

  await page.getByTestId(`model-option:${modelId}`).click();
  await expect(page.getByTestId(`model-option:${modelId}`)).toBeHidden();
  await expect(page.getByTestId("composer:textarea")).toBeFocused();
}

async function sendPromptAndStop(
  page: import("@playwright/test").Page,
  text: string
) {
  const composer = page.getByTestId("composer:textarea");
  const submit = page.getByTestId("composer:submit");

  const chatResponse = page.waitForResponse((response) => {
    return (
      response.url().includes("/api/chat") &&
      response.request().method() === "POST"
    );
  });

  await composer.fill(text);
  await submit.click();
  await expect(composer).toHaveValue("");
  await chatResponse;

  const stop = page.getByRole("button", { name: "Stop" });
  try {
    await stop.waitFor({ state: "visible", timeout: 15_000 });
    await stop.click();
  } catch {
    // If the request completed quickly, Stop may never appear.
  }

  await expect(stop).toHaveCount(0, { timeout: 120_000 });
}

test("Composer ArrowUp/ArrowDown cycles through prompt history", async ({
  page,
}) => {
  await page.goto("/");

  await createProfile(page, `E2E composer history ${Date.now()}`);
  await createChat(page);
  await selectPreferredModel(page, ["openai/gpt-4o-mini", "gpt-5.2-codex", "gpt-5.2"]);

  await sendPromptAndStop(page, "First prompt");
  await sendPromptAndStop(page, "Second prompt");

  const composer = page.getByTestId("composer:textarea");
  await composer.fill("my draft");

  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("Second prompt");

  await composer.press("ArrowUp");
  await expect(composer).toHaveValue("First prompt");

  await composer.press("ArrowDown");
  await expect(composer).toHaveValue("Second prompt");

  await composer.press("ArrowDown");
  await expect(composer).toHaveValue("my draft");
});
