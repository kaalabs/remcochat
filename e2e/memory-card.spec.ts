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

test("Memory retrieval shows a memory card (WebKit)", async ({ page }) => {
  test.setTimeout(480_000);
  await page.goto("/");

  const profileName = `E2E memory ${Date.now()}`;
  await createProfile(page, profileName);
  await page.getByTestId("sidebar:new-chat").click();

  await selectPreferredModel(page, [
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
    "openai/gpt-5",
  ]);

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

  await page
    .getByTestId("composer:textarea")
    .fill("Remember this: Favorite color: purple.");
  await page.getByTestId("composer:submit").click();

  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect
    .poll(async () => await assistantMessages.count(), {
      timeout: 120_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(0);

  const firstAssistant = assistantMessages.first();
  const promptCard = firstAssistant.getByTestId("memory:prompt-card");
  await expect(promptCard).toBeVisible({ timeout: 120_000 });
  await expect(promptCard).toContainText(/favorite color/i);

  const confirmButton = promptCard.getByTestId("memory:prompt-confirm");
  await expect(confirmButton).toBeEnabled({ timeout: 120_000 });
  await confirmButton.click();

  await expect
    .poll(async () => await assistantMessages.count(), {
      timeout: 120_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(1);

  const savedAssistant = assistantMessages.last();
  await expect(savedAssistant.getByTestId("memory:card")).toBeVisible({
    timeout: 120_000,
  });
  await expect(savedAssistant.getByTestId("memory:card")).toContainText(
    /saved to memory/i
  );

  await expect(page.getByTestId("chat:settings-open")).toBeEnabled({
    timeout: 120_000,
  });

  const assistantCountBeforeAnswer = await assistantMessages.count();

  await page
    .getByTestId("composer:textarea")
    .fill("What's my favorite color? Reply with a single word.");
  await page.getByTestId("composer:submit").click();

  await expect
    .poll(async () => await assistantMessages.count(), {
      timeout: 120_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(assistantCountBeforeAnswer);

  const lastAssistant = assistantMessages.last();

  await expect
    .poll(async () => {
      const text = await lastAssistant.innerText().catch(() => "");
      return /\bpurple\b/i.test(text);
    }, {
      timeout: 240_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeTruthy();

  await expect(lastAssistant).toContainText(/\bpurple\b/i);

  const memoryCard = lastAssistant.getByTestId("memory:card");
  await expect(memoryCard).toBeVisible();
  await expect(memoryCard).toContainText(/\bpurple\b/i);
  await expect(lastAssistant.locator(".prose-neutral")).toHaveCount(0);
});
