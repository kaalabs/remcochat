import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";

skipUnlessOpencodeApiKey(test);

async function createProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:new").click({ force: true });
  await page.getByTestId("profile:create-name").fill(name);
  await page.getByTestId("profile:create-submit").click();
  await expect(page.getByTestId("profile:create-name")).toBeHidden();
}

async function getToolsEnabledModelId(request: import("@playwright/test").APIRequestContext) {
  const providersRes = await request.get("/api/providers");
  expect(providersRes.ok()).toBeTruthy();
  const providersJson = (await providersRes.json()) as {
    activeProviderId: string;
    providers: Array<{
      id: string;
      models: Array<{ id: string; capabilities?: { tools?: boolean } }>;
    }>;
  };

  const active =
    providersJson.providers.find((p) => p.id === providersJson.activeProviderId) ??
    providersJson.providers[0];
  const modelId = active?.models.find((m) => m.capabilities?.tools === true)?.id ?? "";
  return modelId;
}

async function selectModel(page: import("@playwright/test").Page, modelId: string) {
  await page.getByTestId("model:picker-trigger").click();
  await expect(page.getByTestId(`model-option:${modelId}`)).toBeVisible();
  await page.getByTestId(`model-option:${modelId}`).click();
  await expect(page.getByTestId(`model-option:${modelId}`)).toBeHidden();
  await expect(page.getByTestId("composer:textarea")).toBeFocused();
}

test("Skills tools render cards (WebKit)", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const modelId = await getToolsEnabledModelId(request);
  test.skip(!modelId, "No tools-enabled model found for active provider.");

  await page.goto("/");

  await createProfile(page, `E2E skills ${Date.now()}`);
  await page.getByTestId("sidebar:new-chat").click();

  await selectModel(page, modelId);

  await page
    .getByTestId("composer:textarea")
    .fill("/skills-system-validation validate that skillsActivate and skillsReadResource work");
  await page.getByTestId("composer:submit").click();

  await expect(page.getByText(/Calling tool: \"skillsActivate\"/)).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId("tool:skillsActivate")).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByTestId("tool:skillsActivate")).toContainText(
    "skills-system-validation"
  );

  await expect(page.getByText(/Calling tool: \"skillsReadResource\"/)).toBeVisible({
    timeout: 120_000,
  });
  const referenceCard = page
    .getByTestId("tool:skillsReadResource")
    .filter({ hasText: "references/REFERENCE.md" })
    .first();
  await expect(referenceCard).toBeVisible({ timeout: 120_000 });

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});
