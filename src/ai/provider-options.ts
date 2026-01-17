import type { ModelType } from "@/server/config";
import type { SharedV3ProviderOptions } from "@ai-sdk/provider";

export function createProviderOptionsForWebTools(input: {
  modelType: ModelType;
  providerModelId: string;
  webToolsEnabled: boolean;
}): SharedV3ProviderOptions | undefined {
  if (!input.webToolsEnabled) return undefined;
  return undefined;
}
