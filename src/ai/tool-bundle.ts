export type ToolGroup =
  | "display"
  | "web"
  | "sandbox"
  | "host-read"
  | "host-exec"
  | "skills"
  | "hue"
  | "ov";

export type ToolRisk = "safe" | "approval";
export type ToolExecutionOwner = "server" | "client";

export type ToolRepairStrategy = "displayAgenda";

export type ToolStepVisibility =
  | "always"
  | "step0-only"
  | "followup-only"
  | "explicit-only";

export type ToolMetadata = {
  name: string;
  group: ToolGroup;
  risk: ToolRisk;
  executionOwner: ToolExecutionOwner;
  needsApproval?: boolean;
  strict?: boolean;
  inputExamples?: Array<{ input: Record<string, unknown> }>;
  repairStrategy?: ToolRepairStrategy;
  stepVisibility?: ToolStepVisibility;
  providerDefined?: boolean;
};

export type ToolEntry = {
  name: string;
  tool: unknown;
  metadata: ToolMetadata;
};

export type ToolBundle = {
  enabled: boolean;
  tools: Record<string, unknown>;
  metadataByName: Record<string, ToolMetadata>;
  entries: ToolEntry[];
};

export function defineToolEntry(input: {
  name: string;
  tool: unknown;
  metadata: Omit<ToolMetadata, "name" | "executionOwner"> & {
    executionOwner?: ToolExecutionOwner;
  };
}): ToolEntry {
  return {
    name: input.name,
    tool: input.tool,
    metadata: {
      name: input.name,
      executionOwner: input.metadata.executionOwner ?? "server",
      ...input.metadata,
    },
  };
}

export function createToolBundle(input: {
  enabled: boolean;
  entries: ToolEntry[];
}): ToolBundle {
  const tools: Record<string, unknown> = {};
  const metadataByName: Record<string, ToolMetadata> = {};

  for (const entry of input.entries) {
    tools[entry.name] = entry.tool;
    metadataByName[entry.name] = entry.metadata;
  }

  return {
    enabled: input.enabled,
    tools,
    metadataByName,
    entries: input.entries.slice(),
  };
}

export function mergeToolBundles(...bundles: ToolBundle[]): ToolBundle {
  const entries: ToolEntry[] = [];
  for (const bundle of bundles) {
    if (!bundle.enabled) continue;
    entries.push(...bundle.entries);
  }

  return createToolBundle({
    enabled: entries.length > 0,
    entries,
  });
}

export function listToolNamesByGroup(bundle: ToolBundle, group: ToolGroup): string[] {
  return bundle.entries
    .filter((entry) => entry.metadata.group === group)
    .map((entry) => entry.name);
}

export function listToolNamesByExecutionOwner(
  bundle: ToolBundle,
  executionOwner: ToolExecutionOwner,
): string[] {
  return bundle.entries
    .filter((entry) => entry.metadata.executionOwner === executionOwner)
    .map((entry) => entry.name);
}
