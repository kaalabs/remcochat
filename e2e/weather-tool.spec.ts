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

test("Weather tool renders a card (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E weather ${Date.now()}`);
  await page.getByTestId("sidebar:new-chat").click();

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page.getByTestId("composer:textarea").fill(
    "What's the weather in San Francisco right now? Use the displayWeather tool."
  );
  await page.getByTestId("composer:submit").click();

  await expect(page.getByText(/Calling tool: "displayWeather"/)).toBeVisible({
    timeout: 120_000,
  });

  const card = page.getByTestId("tool:displayWeather");
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText("San Francisco");

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("Forecast tool renders a card (WebKit)", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  await createProfile(page, `E2E forecast ${Date.now()}`);
  await page.getByTestId("sidebar:new-chat").click();

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

  await page.getByTestId("composer:textarea").fill(
    "Show me the 7-day weather forecast for San Francisco. Use the displayWeatherForecast tool."
  );
  await page.getByTestId("composer:submit").click();

  await expect(
    page.getByText(/Calling tool: "displayWeatherForecast"/)
  ).toBeVisible({
    timeout: 120_000,
  });

  const card = page.getByTestId("tool:displayWeatherForecast");
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(card).toContainText("San Francisco");

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
