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
      data: { providerId: "e2e_alt" },
    });

    await page.goto("/");
    await createProfile(page, `E2E models ${Date.now()}`);
    await page.getByTestId("sidebar:new-chat").click();

    await page.getByTestId("model:picker-trigger").click();

    await expect(
      page.getByTestId("model-option:gpt-5.2")
    ).toBeVisible();
    await expect(page.getByTestId("model-option:gpt-5.2-codex")).toBeVisible();
    await expect(
      page.locator('[data-testid="model-option:openai/gpt-5.2-chat"]')
    ).toHaveCount(0);

    await expect(page.getByTestId("model-feature:gpt-5.2:tools")).toHaveAttribute(
      "data-enabled",
      /^(true|false)$/
    );
  } finally {
    await request.put("/api/providers/active", {
      data: { providerId: baseJson.defaultProviderId },
    });
  }
});
