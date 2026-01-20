import { expect, test } from "@playwright/test";

test("Providers config endpoint", async ({ request }) => {
  const res = await request.get("/api/providers");
  expect(res.ok()).toBeTruthy();

  const json = (await res.json()) as {
    defaultProviderId: string;
    activeProviderId: string;
    providers: Array<{
      id: string;
      name: string;
      defaultModelId: string;
      models: Array<{
        id: string;
        type: string;
        label: string;
        description?: string;
        capabilities: {
          tools: boolean;
          reasoning: boolean;
          temperature: boolean;
          attachments: boolean;
          structuredOutput: boolean;
        };
      }>;
    }>;
  };

  expect(json.defaultProviderId).toBeTruthy();
  expect(json.activeProviderId).toBeTruthy();

  expect(Array.isArray(json.providers)).toBeTruthy();
  expect(json.providers.length).toBeGreaterThan(0);

  const providerIds = new Set(json.providers.map((p) => p.id));
  expect(providerIds.has(json.activeProviderId)).toBeTruthy();

  for (const provider of json.providers) {
    expect(provider.name).toBeTruthy();
    expect(provider.defaultModelId).toBeTruthy();
    expect(Array.isArray(provider.models)).toBeTruthy();
    expect(provider.models.length).toBeGreaterThan(0);
    expect(provider.models.some((m) => m.id === provider.defaultModelId)).toBeTruthy();
    expect(provider.models.every((m) => Boolean(m.type))).toBeTruthy();
    expect(
      provider.models.every(
        (m) =>
          m.capabilities &&
          typeof m.capabilities.tools === "boolean" &&
          typeof m.capabilities.reasoning === "boolean" &&
          typeof m.capabilities.temperature === "boolean" &&
          typeof m.capabilities.attachments === "boolean" &&
          typeof m.capabilities.structuredOutput === "boolean"
      )
    ).toBeTruthy();
  }
});
