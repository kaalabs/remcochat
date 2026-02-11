import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
});

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
  await expect
    .poll(async () => {
      return await drawer.evaluate((el) => el.scrollWidth - el.clientWidth);
    })
    .toBeLessThanOrEqual(2);
  await expect
    .poll(async () => {
      return await page.evaluate(() => {
        const el = document.querySelector('[data-testid="sidebar:drawer"]');
        if (!el) return 0;
        const rect = el.getBoundingClientRect();
        return rect.right - window.innerWidth;
      });
    })
    .toBeLessThanOrEqual(2);

  await drawer.getByTestId("sidebar:new-chat").click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId("composer:textarea")).toBeFocused();

  await page.getByTestId("admin:open").click();
  await expect(page).toHaveURL(/\/admin$/);
});

test.describe("Wide touch viewport", () => {
  // Approximate iOS Safari “Request Desktop Website”: large CSS viewport but touch-first input.
  // The CSS fix forces the mobile shell based on coarse pointer, not width breakpoints.
  test.use({
    viewport: { width: 980, height: 844 },
    hasTouch: true,
    isMobile: false,
  });

  test("Still uses a sidebar drawer", async ({ page }) => {
    await page.goto("/");

    const isCoarse = await page.evaluate(() =>
      window.matchMedia("(hover: none) and (pointer: coarse)").matches
    );
    test.skip(!isCoarse, "This browser context does not emulate a coarse pointer.");

    await expect(page.getByLabel("Open menu")).toBeVisible();

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
    await expect
      .poll(async () => {
        return await drawer.evaluate((el) => el.scrollWidth - el.clientWidth);
      })
      .toBeLessThanOrEqual(2);

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const el = document.querySelector('[data-testid="sidebar:drawer"]');
          if (!el) return 0;
          const rect = el.getBoundingClientRect();
          return rect.right - window.innerWidth;
        });
      })
      .toBeLessThanOrEqual(2);
  });
});
