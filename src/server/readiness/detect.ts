export const TOOL_DEP_TOKENS = ["hueGateway", "ovNlGateway"] as const;
export type ToolDependencyToken = (typeof TOOL_DEP_TOKENS)[number];

const TOKEN_REGEX: Record<ToolDependencyToken, RegExp> = {
  hueGateway: /\bhueGateway\b/i,
  ovNlGateway: /\bovNlGateway\b/i,
};

export function detectToolDependenciesFromText(text: string): ToolDependencyToken[] {
  const raw = String(text ?? "");
  const found: ToolDependencyToken[] = [];
  for (const token of TOOL_DEP_TOKENS) {
    if (TOKEN_REGEX[token].test(raw)) found.push(token);
  }
  return found;
}

