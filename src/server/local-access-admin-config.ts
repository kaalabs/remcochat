import fs from "node:fs";
import { getConfigFilePath, parseConfigToml, resetConfigCache } from "@/server/config";
import { updateLocalAccessInToml, writeFileAtomic } from "@/server/config-toml-edit";

function normalizeAllowlist(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const trimmed = String(v ?? "").trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export async function updateLocalAccessInConfigToml(input: {
  enabled: boolean;
  allowedCommands: string[];
  allowedDirectories: string[];
}) {
  const enabled = Boolean(input.enabled);
  const allowedCommands = normalizeAllowlist(input.allowedCommands);
  const allowedDirectories = normalizeAllowlist(input.allowedDirectories);

  if (enabled && allowedCommands.length === 0) {
    throw new Error("allowedCommands must not be empty when enabling local_access.");
  }
  if (enabled && allowedDirectories.length === 0) {
    throw new Error("allowedDirectories must not be empty when enabling local_access.");
  }

  const filePath = getConfigFilePath();
  const original = fs.readFileSync(filePath, "utf8");

  const updatedToml = updateLocalAccessInToml(original, {
    enabled,
    allowedCommands,
    allowedDirectories,
  });

  // Fail-fast: ensure we are not about to write an invalid config.
  parseConfigToml(updatedToml);

  writeFileAtomic(filePath, updatedToml);
  resetConfigCache();
}

