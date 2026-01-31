import process from "node:process";

export function hasOpencodeApiKey(): boolean {
  return Boolean(String(process.env.OPENCODE_API_KEY ?? "").trim());
}

export function skipUnlessOpencodeApiKey(
  test: typeof import("@playwright/test").test
) {
  const enabled = String(process.env.REMCOCHAT_E2E_ENABLE_LLM ?? "").trim() === "1";
  test.skip(
    !enabled || !hasOpencodeApiKey(),
    "Set REMCOCHAT_E2E_ENABLE_LLM=1 and OPENCODE_API_KEY to run e2e tests that require real LLM calls."
  );
}
