import { expect, test } from "@playwright/test";

test("Switch active provider", async ({ request }) => {
  const res1 = await request.get("/api/providers");
  expect(res1.ok()).toBeTruthy();
  const json1 = (await res1.json()) as {
    defaultProviderId: string;
    activeProviderId: string;
    providers: Array<{ id: string }>;
  };

  const originalActive = json1.activeProviderId;
  const alt = json1.providers.find((p) => p.id !== originalActive)?.id;
  expect(alt).toBeTruthy();

  const put = await request.put("/api/providers/active", {
    data: { providerId: alt },
  });
  expect(put.ok()).toBeTruthy();

  const res2 = await request.get("/api/providers");
  expect(res2.ok()).toBeTruthy();
  const json2 = (await res2.json()) as { activeProviderId: string };
  expect(json2.activeProviderId).toBe(alt);

  const reset = await request.put("/api/providers/active", {
    data: { providerId: originalActive },
  });
  expect(reset.ok()).toBeTruthy();
});

