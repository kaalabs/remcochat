import YAML from "yaml";
import type { SkillFrontmatter } from "./types";

export type ParsedSkillMd = {
  frontmatter: SkillFrontmatter;
  body: string;
};

export function parseSkillMd(content: string): ParsedSkillMd {
  const text = String(content ?? "");
  if (!text.startsWith("---")) {
    throw new Error("Missing YAML frontmatter (expected leading ---)");
  }

  const lines = text.split("\n");
  if (lines.length < 3) throw new Error("Invalid frontmatter: too short");
  if (lines[0].trim() !== "---") throw new Error("Invalid frontmatter start marker");

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) throw new Error("Invalid frontmatter: missing closing ---");

  const yamlText = lines.slice(1, endIndex).join("\n");
  const parsed = YAML.parse(yamlText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid frontmatter: expected a YAML mapping/object");
  }

  const record = parsed as Record<string, unknown>;
  const name = String(record.name ?? "").trim();
  const description = String(record.description ?? "").trim();

  const license = record.license === undefined ? undefined : String(record.license ?? "").trim();
  const compatibility =
    record.compatibility === undefined ? undefined : String(record.compatibility ?? "").trim();

  let metadata: Record<string, string> | undefined;
  if (record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(record.metadata as Record<string, unknown>)) {
      const key = String(k ?? "").trim();
      if (!key) continue;
      out[key] = String(v ?? "");
    }
    metadata = out;
  }

  const allowedToolsRaw = record["allowed-tools"];
  const allowedTools =
    allowedToolsRaw === undefined ? undefined : String(allowedToolsRaw ?? "").trim();

  const frontmatter: SkillFrontmatter = {
    name,
    description,
    ...(license ? { license } : {}),
    ...(compatibility ? { compatibility } : {}),
    ...(metadata ? { metadata } : {}),
    ...(allowedTools ? { "allowed-tools": allowedTools } : {}),
  };

  const body = lines.slice(endIndex + 1).join("\n").replace(/^\n+/, "");

  return { frontmatter, body };
}

