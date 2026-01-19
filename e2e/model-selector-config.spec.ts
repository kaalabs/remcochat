import { expect, test } from "@playwright/test";

async function createProfile(
  page: import("@playwright/test").Page,
  name: string
) {
  await page.getByTestId("profile:new").click();
  await page.getByTestId("profile:create-name").fill(name);
  await page.getByTestId("profile:create-submit").click();
  await expect(page.getByTestId("profile:create-name")).toBeHidden();
}

test("Model selector uses config models", async ({ page, request }) => {
  const base = await request.get("/api/providers");
  expect(base.ok()).toBeTruthy();
  const baseJson = (await base.json()) as {
    defaultProviderId: string;
    activeProviderId: string;
  };

  try {
    await request.put("/api/providers/active", {
      data: { providerId: "e2e_vercel" },
    });

    await page.goto("/");
    await createProfile(page, `E2E models ${Date.now()}`);
    await page.getByTestId("sidebar:new-chat").click();

    await page.getByTestId("model:picker-trigger").click();

    await expect(
      page.getByTestId("model-option:anthropic/claude-opus-4.5")
    ).toBeVisible();
    await expect(
      page.getByTestId("model-option:openai/gpt-3.5-turbo")
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="model-option:openai/gpt-5.2-chat"]')
    ).toHaveCount(0);

    await expect(
      page.getByTestId("model-feature:anthropic/claude-opus-4.5:tools")
    ).toHaveAttribute("data-enabled", "true");
    await expect(
      page.getByTestId("model-feature:anthropic/claude-opus-4.5:reasoning")
    ).toHaveAttribute("data-enabled", "true");
    await expect(
      page.getByTestId("model-feature:anthropic/claude-opus-4.5:structuredOutput")
    ).toHaveAttribute("data-enabled", "false");

    await expect(
      page.getByTestId("model-feature:openai/gpt-3.5-turbo:tools")
    ).toHaveAttribute("data-enabled", "false");
  } finally {
    await request.put("/api/providers/active", {
      data: { providerId: baseJson.defaultProviderId },
    });
  }
});
