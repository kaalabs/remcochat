import { expect, test } from "@playwright/test";

type ModelsInventory = {
  providers: Array<{
    id: string;
    allowedModelIds: string[];
    requiredModelIds: string[];
    models: Array<{ id: string; supported: boolean }>;
  }>;
};

test("Admin allowed models editor persists to config.toml and updates /api/providers", async ({
  page,
  request,
}) => {
  const inventoryRes = await request.get("/api/admin/models-inventory");
  expect(inventoryRes.ok()).toBeTruthy();
  const inventory = (await inventoryRes.json()) as ModelsInventory;

  const pick = inventory.providers
    .map((p) => {
      const allowed = new Set(p.allowedModelIds);
      const required = new Set(p.requiredModelIds);
      const candidate =
        p.models.find((m) => m.supported && !allowed.has(m.id) && !required.has(m.id))
          ?.id ?? "";
      return { providerId: p.id, candidate, originalAllowed: p.allowedModelIds };
    })
    .find((p) => p.candidate);

  expect(pick, "Expected at least one provider with a selectable extra model").toBeTruthy();
  const providerId = pick!.providerId;
  const modelId = pick!.candidate;
  const originalAllowed = pick!.originalAllowed;

  try {
    await page.goto("/admin");

    const providerDetails = page.locator("details").filter({ hasText: providerId }).first();
    await expect(providerDetails).toBeVisible();
    await providerDetails.locator("summary").click();

    const showAllButton = page.getByTestId(`admin:models-showall:${providerId}`);
    await expect(showAllButton).toBeVisible();
    await showAllButton.click();

    const search = page.getByTestId(`admin:models-search:${providerId}`);
    await search.fill(modelId);

    const row = page.getByTestId(`admin:model-row:${providerId}:${modelId}`);
    await expect(row).toBeVisible();

    const checkbox = row.locator("input[type=checkbox]");
    await expect(checkbox).toBeEnabled();
    await checkbox.check();

    const save = page.getByTestId(`admin:allowed-models-save:${providerId}`);
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByText(/Allowed models updated/i)).toBeVisible();

    await expect
      .poll(async () => {
        const providersRes = await request.get("/api/providers");
        const json = (await providersRes.json()) as {
          providers: Array<{ id: string; models: Array<{ id: string }> }>;
        };
        const provider = json.providers.find((p) => p.id === providerId);
        return Boolean(provider?.models.some((m) => m.id === modelId));
      })
      .toBeTruthy();
  } finally {
    // Restore the original allowlist so this test does not affect other runs.
    await request.put("/api/admin/providers/allowed-models", {
      data: { providerId, allowedModelIds: originalAllowed },
    });
  }
});
