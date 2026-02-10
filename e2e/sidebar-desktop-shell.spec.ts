import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("Desktop sidebar can resize, collapse, and persist across reloads", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const key = "remcochat:desktopSidebar:v1";
    const sentinel = "remcochat:e2e:desktopSidebarClearedOnce";
    if (window.sessionStorage.getItem(sentinel) === "1") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.setItem(sentinel, "1");
  });

  const sidebarWidth = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar:desktop"]');
      if (!(el instanceof HTMLElement)) return -1;
      return Math.round(el.getBoundingClientRect().width);
    });

  await page.goto("/");
  await expect(page.getByTestId("sidebar:desktop")).toBeVisible();

  const initialWidth = await sidebarWidth();
  expect(initialWidth).toBeGreaterThanOrEqual(280);
  expect(initialWidth).toBeLessThanOrEqual(296);

  const handle = page.getByTestId("sidebar:desktop-resize-handle");
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  if (!box) throw new Error("Missing desktop resize handle");

  const dragY = box.y + box.height / 2;
  const dragStartX = box.x + box.width / 2;
  await page.mouse.move(dragStartX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + 120, dragY, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(async () => await sidebarWidth())
    .toBeGreaterThanOrEqual(initialWidth + 100);

  const resizedWidth = await sidebarWidth();

  await page.reload();
  await expect(page.getByTestId("sidebar:desktop")).toBeVisible();
  await expect
    .poll(async () => await sidebarWidth())
    .toBeGreaterThanOrEqual(resizedWidth - 2);

  await page.getByTestId("sidebar:desktop-toggle").click();
  await expect
    .poll(async () => await sidebarWidth())
    .toBeLessThanOrEqual(2);

  await page.reload();
  await expect
    .poll(async () => await sidebarWidth())
    .toBeLessThanOrEqual(2);

  await page.getByTestId("sidebar:desktop-toggle").click();
  await expect
    .poll(async () => await sidebarWidth())
    .toBeGreaterThanOrEqual(resizedWidth - 2);
});
