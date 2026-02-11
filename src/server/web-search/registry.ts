import { createBraveSearchTool } from "@/ai/brave-search";
import { createExaSearchTool } from "@/ai/exa-search";

export type WebSearchProviderRegistryItem = {
  id: string;
  label: string;
  smokeTest: () => Promise<void>;
};

export function listWebSearchProviders(): WebSearchProviderRegistryItem[] {
  return [
    {
      id: "exa",
      label: "Exa",
      smokeTest: async () => {
        const tool = createExaSearchTool() as unknown as {
          execute: (args: { query: string; num_results?: number }) => Promise<unknown>;
        };
        await tool.execute({ query: "OpenAI", num_results: 1 });
      },
    },
    {
      id: "brave",
      label: "Brave Search",
      smokeTest: async () => {
        const tool = createBraveSearchTool() as unknown as {
          execute: (args: { query: string; num_results?: number }) => Promise<unknown>;
        };
        await tool.execute({ query: "OpenAI", num_results: 1 });
      },
    },
  ];
}

export function getWebSearchProviderById(
  id: string
): WebSearchProviderRegistryItem | null {
  const key = String(id ?? "").trim();
  if (!key) return null;
  return listWebSearchProviders().find((p) => p.id === key) ?? null;
}

