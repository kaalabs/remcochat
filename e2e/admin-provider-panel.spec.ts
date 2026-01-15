import { expect, test } from "@playwright/test";

test("Admin panel switches provider", async ({ page, request }) => {
  const base = await request.get("/api/providers");
  expect(base.ok()).toBeTruthy();
  const baseJson = (await base.json()) as {
    defaultProviderId: string;
    activeProviderId: string;
  };

  try {
    await page.goto("/admin");

    const trigger = page.getByTestId("admin:provider-select");
    await expect(trigger).toBeVisible();

    await trigger.click();
    await page.getByTestId("admin:provider-option:e2e_alt").click();

    const save = page.getByTestId("admin:provider-save");
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByText("Active provider updated.")).toBeVisible();

    await expect
      .poll(async () => {
        const res = await request.get("/api/providers");
        const json = (await res.json()) as { activeProviderId?: string };
        return json.activeProviderId;
      })
      .toBe("e2e_alt");
  } finally {
    await request.put("/api/providers/active", {
      data: { providerId: baseJson.defaultProviderId },
    });
  }
});

