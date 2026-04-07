import {
  createToolBundle,
  listToolNamesByExecutionOwner,
  type ToolBundle,
} from "@/ai/tool-bundle";
import {
  routeToolSurface,
  type ToolSurfaceRoute,
} from "@/server/tool-surface-router";

export function createDisabledToolBundle(): ToolBundle {
  return createToolBundle({ enabled: false, entries: [] });
}

export function assertServerOwnedToolLoopBundle(bundle: ToolBundle) {
  const clientOwnedTools = listToolNamesByExecutionOwner(bundle, "client");
  if (clientOwnedTools.length === 0) return;

  throw new Error(
    `Client-owned tools are not supported in RemcoChat's server-owned tool loop: ${clientOwnedTools.join(", ")}`,
  );
}

export async function routeToolSurfaceSafely(input: {
  text: string;
  context?: {
    lastAssistantText?: string;
    lastToolName?: string;
  };
}): Promise<ToolSurfaceRoute | null> {
  try {
    return await routeToolSurface(input);
  } catch (err) {
    console.error("Tool-surface router failed", err);
    return { surface: "none", confidence: 0 };
  }
}
