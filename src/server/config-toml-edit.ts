import fs from "node:fs";
import path from "node:path";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTableRange(content: string, header: string): { start: number; end: number } {
  const headerRe = new RegExp(`^\\s*\\[${escapeRegExp(header)}\\]\\s*$`, "m");
  const match = headerRe.exec(content);
  if (!match || match.index == null) {
    throw new Error(`config.toml: missing table [${header}]`);
  }

  const start = match.index;
  const afterHeaderIdx = start + match[0].length;
  const nextHeaderRe = /^\s*\[[^\]]+\]\s*$/gm;
  nextHeaderRe.lastIndex = afterHeaderIdx;
  const next = nextHeaderRe.exec(content);
  const end = next ? next.index : content.length;
  return { start, end };
}

function findKeyValueRangeInsideTable(
  content: string,
  tableRange: { start: number; end: number },
  key: string
): { start: number; end: number; indent: string } {
  const slice = content.slice(tableRange.start, tableRange.end);
  const re = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*=\\s*`, "m");
  const match = re.exec(slice);
  if (!match || match.index == null) {
    throw new Error(`config.toml: missing key "${key}" in table range`);
  }
  const indent = match[1] ?? "";
  const absStart = tableRange.start + match.index;
  const absAfterEq = tableRange.start + match.index + match[0].length;
  return { start: absStart, end: absAfterEq, indent };
}

function findBracketedArrayEnd(content: string, arrayStartIdx: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = arrayStartIdx; i < content.length; i++) {
    const ch = content[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "[") {
      depth += 1;
      continue;
    }
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  throw new Error("config.toml: unterminated array");
}

function renderTomlStringArray(
  indent: string,
  key: string,
  values: string[]
): string {
  const lines = [
    `${indent}${key} = [`,
    ...values.map((v) => `${indent}  "${v}",`),
    `${indent}]`,
  ];
  return lines.join("\n");
}

export function updateProviderAllowedModelIdsInToml(
  content: string,
  providerId: string,
  allowedModelIds: string[]
): string {
  const table = findTableRange(content, `providers.${providerId}`);
  const kv = findKeyValueRangeInsideTable(content, table, "allowed_model_ids");

  const arrayStart = content.indexOf("[", kv.end);
  if (arrayStart === -1 || arrayStart >= table.end) {
    throw new Error(
      `config.toml: providers.${providerId}.allowed_model_ids must be an array`
    );
  }
  const arrayEnd = findBracketedArrayEnd(content, arrayStart);

  const replacement = renderTomlStringArray(kv.indent, "allowed_model_ids", allowedModelIds);
  return content.slice(0, kv.start) + replacement + content.slice(arrayEnd + 1);
}

export function updateProviderDefaultModelIdInToml(
  content: string,
  providerId: string,
  modelId: string
): string {
  const table = findTableRange(content, `providers.${providerId}`);
  const kv = findKeyValueRangeInsideTable(content, table, "default_model_id");

  const lineEnd = content.indexOf("\n", kv.end);
  const end = lineEnd === -1 ? content.length : lineEnd;
  const replacement = `${kv.indent}default_model_id = "${modelId}"`;
  return content.slice(0, kv.start) + replacement + content.slice(end);
}

export function updateRouterModelIdInToml(content: string, modelId: string): string {
  const table = findTableRange(content, "app.router");
  const kv = findKeyValueRangeInsideTable(content, table, "model_id");

  // Replace until end-of-line, preserving indentation and key formatting.
  const lineEnd = content.indexOf("\n", kv.end);
  const end = lineEnd === -1 ? content.length : lineEnd;
  const replacement = `${kv.indent}model_id = "${modelId}"`;
  return content.slice(0, kv.start) + replacement + content.slice(end);
}

export function updateRouterProviderIdInToml(content: string, providerId: string): string {
  const table = findTableRange(content, "app.router");
  const kv = findKeyValueRangeInsideTable(content, table, "provider_id");

  // Replace until end-of-line, preserving indentation and key formatting.
  const lineEnd = content.indexOf("\n", kv.end);
  const end = lineEnd === -1 ? content.length : lineEnd;
  const replacement = `${kv.indent}provider_id = "${providerId}"`;
  return content.slice(0, kv.start) + replacement + content.slice(end);
}

export function updateWebToolsSearchProviderInToml(
  content: string,
  provider: "exa" | "brave"
): string {
  const table = findTableRange(content, "app.web_tools");
  const slice = content.slice(table.start, table.end);
  const hasKey = /^\s*search_provider\s*=/m.test(slice);

  if (hasKey) {
    const kv = findKeyValueRangeInsideTable(content, table, "search_provider");
    const lineEnd = content.indexOf("\n", kv.end);
    const end = lineEnd === -1 ? content.length : lineEnd;
    const replacement = `${kv.indent}search_provider = "${provider}"`;
    return content.slice(0, kv.start) + replacement + content.slice(end);
  }

  const headerIdx = content.indexOf("[app.web_tools]", table.start);
  if (headerIdx === -1) {
    throw new Error("config.toml: missing table [app.web_tools]");
  }
  const tableHeaderEnd = content.indexOf("\n", headerIdx);
  const insertAt = tableHeaderEnd === -1 ? table.end : tableHeaderEnd + 1;
  const insertion = `search_provider = "${provider}"\n`;
  return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

export function writeFileAtomic(filePath: string, content: string) {
  const dir = path.dirname(filePath);
  const tmp = path.join(
    dir,
    `.remcochat.${path.basename(filePath)}.${Date.now()}.${Math.random()
      .toString(16)
      .slice(2)}.tmp`
  );
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}
