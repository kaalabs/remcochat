import { expect, test } from "@playwright/test";

test("UI language follows the active profile and persists", async ({ page, request }) => {
  const ts = Date.now();
  const enRes = await request.post("/api/profiles", {
    data: { name: `Lang EN ${ts}`, uiLanguage: "en" },
  });
  expect(enRes.ok()).toBeTruthy();
  const enJson = (await enRes.json()) as { profile?: { id?: string } };
  const profileEnId = enJson.profile?.id ?? "";
  expect(profileEnId).toBeTruthy();

  const nlRes = await request.post("/api/profiles", {
    data: { name: `Lang NL ${ts}`, uiLanguage: "nl" },
  });
  expect(nlRes.ok()).toBeTruthy();
  const nlJson = (await nlRes.json()) as { profile?: { id?: string } };
  const profileNlId = nlJson.profile?.id ?? "";
  expect(profileNlId).toBeTruthy();

  await page.context().addCookies([
    {
      name: "remcochat_profile_id",
      value: profileEnId,
      url: "http://127.0.0.1:3100",
    },
  ]);

  await page.goto("/");
  await expect(page.getByTestId("profile:select-trigger")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // Switch profile (EN -> NL) and ensure UI language switches with it.
  await page.getByTestId("profile:select-trigger").click();
  await page.getByTestId(`profile:option:${profileNlId}`).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");

  // Switch back (NL -> EN).
  await page.getByTestId("profile:select-trigger").click();
  await page.getByTestId(`profile:option:${profileEnId}`).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // Change the EN profile language to NL via profile settings.
  await page.getByTestId("profile:settings-open").click();
  await expect(page.getByTestId("profile:settings-dialog")).toBeVisible();
  await page.getByTestId("profile:ui-language-trigger").click();
  await page.getByTestId("profile:ui-language-option:nl").click();
  await page.getByTestId("profile:settings-save").click();

  await expect(page.locator("html")).toHaveAttribute("lang", "nl");

  // Verify visible UI copy updated (dialog title).
  await page.getByTestId("profile:settings-open").click();
  await expect(page.getByTestId("profile:settings-dialog")).toContainText("Profielinstellingen");
  await page.keyboard.press("Escape");

  // Refresh and ensure persisted.
  await page.reload();
  await expect(page.getByTestId("profile:select-trigger")).toBeVisible({ timeout: 120_000 });
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
});

