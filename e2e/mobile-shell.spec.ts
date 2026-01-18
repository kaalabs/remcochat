import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("Mobile shell uses a sidebar drawer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("Open menu")).toBeVisible();
  await expect(
    page.locator('button[aria-label="Toggle theme"]:visible')
  ).toBeVisible();
  await expect(page.getByTestId("model:picker-trigger")).toBeVisible();

  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
    })
    .toBeLessThanOrEqual(2);

  await page.getByLabel("Open menu").click();
  const drawer = page.getByTestId("sidebar:drawer");
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("sidebar:new-chat").click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("composer:textarea")).toBeFocused();

  await page.getByLabel("Open menu").click();
  await expect(drawer).toBeVisible();

  await drawer.getByTestId("admin:open").click();
  await expect(page).toHaveURL(/\/admin$/);
});
