import { expect, test } from "@playwright/test";

type ModelsInventory = {
  providers: Array<{
    id: string;
    defaultModelId: string;
    models: Array<{ id: string; supported: boolean }>;
  }>;
};

test("Admin default model editor persists to config.toml and updates /api/providers", async ({
  page,
  request,
}) => {
  const inventoryRes = await request.get("/api/admin/models-inventory");
  expect(inventoryRes.ok()).toBeTruthy();
  const inventory = (await inventoryRes.json()) as ModelsInventory;

  const pick = inventory.providers
    .map((p) => {
      const candidate =
        p.models.find((m) => m.supported && m.id !== p.defaultModelId)?.id ?? "";
      return { providerId: p.id, candidate, originalDefault: p.defaultModelId };
    })
    .find((p) => p.candidate);

  expect(pick, "Expected at least one provider with a different supported model").toBeTruthy();
  const providerId = pick!.providerId;
  const nextDefault = pick!.candidate;
  const originalDefault = pick!.originalDefault;

  try {
    await page.goto("/admin");

    const providerDetails = page.locator("details").filter({ hasText: providerId }).first();
    await expect(providerDetails).toBeVisible();
    await providerDetails.locator("summary").click();

    // Select a different default model and save.
    await page.getByTestId(`admin:default-model-select:${providerId}`).click();
    await page.getByTestId(`model-option:${nextDefault}`).click();

    const save = page.getByTestId(`admin:default-model-save:${providerId}`);
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText(/Default model updated/i)).toBeVisible();

    await expect
      .poll(async () => {
        const providersRes = await request.get("/api/providers");
        const json = (await providersRes.json()) as {
          providers: Array<{ id: string; defaultModelId: string }>;
        };
        const provider = json.providers.find((p) => p.id === providerId);
        return provider?.defaultModelId ?? "";
      })
      .toBe(nextDefault);
  } finally {
    await request.put("/api/admin/providers/default-model", {
      data: { providerId, defaultModelId: originalDefault },
    });
  }
});

