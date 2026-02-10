import { expect, test } from "@playwright/test";
import { skipUnlessOpencodeApiKey } from "./requirements";
import { getUIMessageStreamText, parseUIMessageStreamChunks } from "./ui-message-stream";

skipUnlessOpencodeApiKey(test);

const ovE2eEnabled = String(process.env.REMCOCHAT_E2E_ENABLE_OV_NL ?? "").trim() === "1";
const hasNsKey = Boolean(String(process.env.NS_APP_SUBSCRIPTION_KEY ?? "").trim());
test.skip(
  !ovE2eEnabled || !hasNsKey,
  "Set REMCOCHAT_E2E_ENABLE_OV_NL=1 and NS_APP_SUBSCRIPTION_KEY to run OV NL e2e smoke."
);

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

  const preferred = preferredIds.find((id) => available.includes(id)) ?? available[0];
  expect(preferred).toBeTruthy();

  await page.getByTestId(`model-option:${preferred}`).click();
  await expect(page.getByTestId(`model-option:${preferred}`)).toBeHidden();
}

test("OV NL tool renders NS-style card structure states (WebKit)", async ({ page }) => {
  test.setTimeout(300_000);

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");
  await createProfile(page, `E2E ov nl ${Date.now()}`);
  await createChat(page);

  await selectPreferredModel(page, [
    "gpt-5.2-codex",
    "gpt-5.2",
    "anthropic/claude-sonnet-4.5",
    "openai/gpt-4.1-mini",
  ]);

  const sendPrompt = async (text: string) => {
    await page.getByTestId("composer:textarea").fill(text);
    await page.getByTestId("composer:submit").click();
  };

  await sendPrompt(
    "Gebruik de ovNlGateway tool met action=trips.search en args={from:'utrecht',to:'groningen',limit:3}."
  );
  const tripCard = page.getByTestId("tool:ovNlGateway").last();
  await expect(tripCard).toBeVisible({ timeout: 120_000 });
  await expect(tripCard).toHaveClass(/ov-nl-card/);
  await expect(tripCard).toHaveClass(/ov-nl-card--trips/);
  await expect(tripCard.getByTestId("ov-nl-card:trips")).toBeVisible();

  await sendPrompt(
    "Gebruik de ovNlGateway tool met action=departures.list en args={station:'utrecht',maxJourneys:5}."
  );
  const boardCard = page.getByTestId("tool:ovNlGateway").last();
  await expect(boardCard).toBeVisible({ timeout: 120_000 });
  await expect(boardCard).toHaveClass(/ov-nl-card--board/);
  await expect(boardCard.getByTestId("ov-nl-card:board")).toBeVisible();

  await sendPrompt(
    "Gebruik de ovNlGateway tool met action=disruptions.list en args={isActive:true}."
  );
  const disruptionCard = page.getByTestId("tool:ovNlGateway").last();
  await expect(disruptionCard).toBeVisible({ timeout: 120_000 });
  await expect(disruptionCard).toHaveClass(/ov-nl-card--alerts/);
  await expect(disruptionCard.getByTestId("ov-nl-card:disruptions")).toBeVisible();

  expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
});

test("Natural Dutch rail query prefers ovNlGateway over web search", async ({ request }) => {
  test.setTimeout(120_000);

  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E ov nl routing ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile?: { id?: string } };
  const profileId = String(profileJson.profile?.id ?? "");
  expect(profileId).toBeTruthy();

  const chatRes = await request.post("/api/chat", {
    data: {
      profileId,
      temporary: true,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text: "Ik wil vandaag van Almere Centrum naar Groningen. Wat is de beste treinoptie?",
            },
          ],
          metadata: { createdAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(chatRes.ok()).toBeTruthy();

  const chunks = parseUIMessageStreamChunks(await chatRes.body());
  const toolInputs = chunks
    .filter((chunk) => chunk.type === "tool-input-available")
    .map((chunk) => String(chunk.toolName ?? ""));

  expect(toolInputs).toContain("ovNlGateway");

  const toolNameByCallId = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.type !== "tool-input-available") continue;
    const toolCallId = String(chunk.toolCallId ?? "");
    const toolName = String(chunk.toolName ?? "");
    if (!toolCallId || !toolName) continue;
    toolNameByCallId.set(toolCallId, toolName);
  }

  const ovOutputs = chunks.filter((chunk) => {
    if (chunk.type !== "tool-output-available") return false;
    const toolCallId = String(chunk.toolCallId ?? "");
    return toolNameByCallId.get(toolCallId) === "ovNlGateway";
  });

  const hasOvErrorLike = ovOutputs.some((chunk) => {
    const kind = String((chunk.output as { kind?: unknown } | undefined)?.kind ?? "");
    return kind === "error" || kind === "disambiguation";
  });
  if (!hasOvErrorLike) {
    const assistantText = getUIMessageStreamText(chunks).trim();
    expect(assistantText).toBe("");
  }

  const webToolNames = new Set([
    "perplexity_search",
    "web_search",
    "web_fetch",
    "google_search",
    "url_context",
    "exa_search",
    "brave_search",
  ]);
  const webCalls = toolInputs.filter((name) => webToolNames.has(name));
  expect(webCalls).toEqual([]);
});

test("Direct-only rail query returns direct trips or clear no-match without web fallback", async ({
  request,
}) => {
  test.setTimeout(120_000);

  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E ov nl direct ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile?: { id?: string } };
  const profileId = String(profileJson.profile?.id ?? "");
  expect(profileId).toBeTruthy();

  const chatRes = await request.post("/api/chat", {
    data: {
      profileId,
      temporary: true,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text:
                "Ik wil alleen directe treinopties van Almere Centrum naar Groningen, geen overstappen.",
            },
          ],
          metadata: { createdAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(chatRes.ok()).toBeTruthy();

  const chunks = parseUIMessageStreamChunks(await chatRes.body());
  const toolNameByCallId = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.type !== "tool-input-available") continue;
    const toolCallId = String(chunk.toolCallId ?? "");
    const toolName = String(chunk.toolName ?? "");
    if (!toolCallId || !toolName) continue;
    toolNameByCallId.set(toolCallId, toolName);
  }

  const ovOutputs = chunks.filter((chunk) => {
    if (chunk.type !== "tool-output-available") return false;
    const toolCallId = String(chunk.toolCallId ?? "");
    return toolNameByCallId.get(toolCallId) === "ovNlGateway";
  });
  expect(ovOutputs.length).toBeGreaterThan(0);

  const lastOvOutput = ovOutputs[ovOutputs.length - 1] as {
    output?: { kind?: unknown; trips?: Array<{ transfers?: unknown }>; error?: { code?: unknown } };
  };
  const kind = String(lastOvOutput.output?.kind ?? "");
  if (kind === "trips.search") {
    const trips = Array.isArray(lastOvOutput.output?.trips) ? lastOvOutput.output?.trips ?? [] : [];
    for (const trip of trips) {
      expect(Number(trip.transfers ?? NaN)).toBe(0);
    }
  } else if (kind === "error") {
    const code = String(lastOvOutput.output?.error?.code ?? "");
    expect(code.length).toBeGreaterThan(0);
  }

  const webToolNames = new Set([
    "perplexity_search",
    "web_search",
    "web_fetch",
    "google_search",
    "url_context",
    "exa_search",
    "brave_search",
  ]);
  const toolInputs = chunks
    .filter((chunk) => chunk.type === "tool-input-available")
    .map((chunk) => String(chunk.toolName ?? ""));
  const webCalls = toolInputs.filter((name) => webToolNames.has(name));
  expect(webCalls).toEqual([]);
});

test("OV error/disambiguation allows follow-up clarification text without web fallback", async ({
  request,
}) => {
  test.setTimeout(120_000);

  const profileRes = await request.post("/api/profiles", {
    data: { name: `E2E ov nl recovery ${Date.now()}` },
  });
  expect(profileRes.ok()).toBeTruthy();
  const profileJson = (await profileRes.json()) as { profile?: { id?: string } };
  const profileId = String(profileJson.profile?.id ?? "");
  expect(profileId).toBeTruthy();

  const chatRes = await request.post("/api/chat", {
    data: {
      profileId,
      temporary: true,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: "user",
          parts: [
            {
              type: "text",
              text:
                "Gebruik de ovNlGateway tool met action=trips.search en args={from:'zzzzzz',to:'groningen',limit:2}.",
            },
          ],
          metadata: { createdAt: new Date().toISOString() },
        },
      ],
    },
  });
  expect(chatRes.ok()).toBeTruthy();

  const chunks = parseUIMessageStreamChunks(await chatRes.body());
  const toolNameByCallId = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.type !== "tool-input-available") continue;
    const toolCallId = String(chunk.toolCallId ?? "");
    const toolName = String(chunk.toolName ?? "");
    if (!toolCallId || !toolName) continue;
    toolNameByCallId.set(toolCallId, toolName);
  }

  const ovOutputs = chunks.filter((chunk) => {
    if (chunk.type !== "tool-output-available") return false;
    const toolCallId = String(chunk.toolCallId ?? "");
    return toolNameByCallId.get(toolCallId) === "ovNlGateway";
  });
  const hasOvErrorLike = ovOutputs.some((chunk) => {
    const kind = String((chunk.output as { kind?: unknown } | undefined)?.kind ?? "");
    return kind === "error" || kind === "disambiguation";
  });
  expect(hasOvErrorLike).toBeTruthy();

  const assistantText = getUIMessageStreamText(chunks).trim();
  expect(assistantText.length).toBeGreaterThan(0);

  const webToolNames = new Set([
    "perplexity_search",
    "web_search",
    "web_fetch",
    "google_search",
    "url_context",
    "exa_search",
    "brave_search",
  ]);
  const toolInputs = chunks
    .filter((chunk) => chunk.type === "tool-input-available")
    .map((chunk) => String(chunk.toolName ?? ""));
  const webCalls = toolInputs.filter((name) => webToolNames.has(name));
  expect(webCalls).toEqual([]);
});
