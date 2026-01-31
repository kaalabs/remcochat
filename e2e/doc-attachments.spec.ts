import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";

skipUnlessOpencodeApiKey(test);

async function createProfile(page: import("@playwright/test").Page, name: string) {
  await page.getByTestId("profile:new").click();
  await page.getByTestId("profile:create-name").fill(name);
  await page.getByTestId("profile:create-submit").click();
  await expect(page.getByTestId("profile:create-name")).toBeHidden();
}

async function createChat(page: import("@playwright/test").Page) {
  const createRequest = page.waitForResponse((response) => {
    return (
      response.url().includes("/api/chats") &&
      response.request().method() === "POST"
    );
  });
  await page.getByTestId("sidebar:new-chat").click();
  await createRequest;
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

  const preferred = preferredIds.find((id) => available.includes(id));
  const modelId = preferred ?? available[0];
  expect(modelId).toBeTruthy();

  await page.getByTestId(`model-option:${modelId}`).click();
  await expect(page.getByTestId(`model-option:${modelId}`)).toBeHidden();
  await expect(page.getByTestId("composer:textarea")).toBeFocused();

  return modelId;
}

test("Document attachments upload/download and are available to the model (WebKit)", async ({
  page,
}) => {
  test.skip(
    process.env.REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX !== "1",
    "Set REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX=1 (and Vercel Sandbox creds) to run attachment extraction in Vercel Sandbox."
  );

  test.setTimeout(480_000);
  await page.goto("/");

  await createProfile(page, `E2E attachments ${Date.now()}`);
  await createChat(page);

  await selectPreferredModel(page, [
    "openai/gpt-4o-mini",
    "openai/gpt-4.1-mini",
    "gpt-5-nano",
  ]);

  const token = `REMCOCHAT_DOC_E2E_OK_${Date.now()}`;
  const fileContents = `TOKEN=${token}\n`;

  const fileInput = page.locator('input[type="file"][aria-label="Upload files"]');
  await fileInput.setInputFiles({
    name: "e2e-doc.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(fileContents, "utf8"),
  });

  await page
    .getByTestId("composer:textarea")
    .fill(
      "Read the attached document. Reply with the token value after TOKEN= exactly, and nothing else."
    );
  await page.getByTestId("composer:submit").click();

  const downloadLink = page.locator("[data-testid^='attachment:download:']").first();
  await expect(downloadLink).toBeVisible({ timeout: 120_000 });
  const href = await downloadLink.getAttribute("href");
  expect(href).toBeTruthy();

  const downloadRes = await page.request.get(String(href));
  expect(downloadRes.ok()).toBeTruthy();
  expect(await downloadRes.text()).toBe(fileContents);

  const assistantMessages = page.locator('[data-testid^="message:assistant:"]');
  await expect
    .poll(async () => await assistantMessages.count(), {
      timeout: 120_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeGreaterThan(0);

  const lastAssistant = assistantMessages.last();
  await expect
    .poll(async () => {
      const text = await lastAssistant.innerText().catch(() => "");
      return text.includes(token);
    }, {
      timeout: 240_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBeTruthy();

  await expect(lastAssistant).toContainText(token);
});
