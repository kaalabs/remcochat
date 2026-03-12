import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const REPO_ROOT = process.cwd();

function walkFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      files.push(...walkFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function findIdentifierHits(rootDir: string, identifiers: string[]) {
  const hits: Array<{ file: string; identifier: string }> = [];
  for (const filePath of walkFiles(rootDir)) {
    const source = fs.readFileSync(filePath, "utf8");
    for (const identifier of identifiers) {
      const pattern = new RegExp(`\\b${identifier}\\b`);
      if (pattern.test(source)) {
        hits.push({
          file: path.relative(REPO_ROOT, filePath),
          identifier,
        });
      }
    }
  }
  return hits;
}

test("legacy heuristic identifiers are removed from production sources", () => {
  const hits = findIdentifierHits(path.join(REPO_ROOT, "src"), [
    "isLikelyWebSearchRequest",
    "isLikelyWorkspaceTask",
    "isLikelyHostAccessRequest",
    "isLikelyObsidianRequest",
    "workspaceTaskLikely",
    "hostAccessLikely",
    "obsidianLikely",
    "webSearchLikely",
  ]);

  assert.deepEqual(hits, []);
});

test("tool loop no longer derives initial tool visibility from raw-text regex helper names", () => {
  const toolLoopSource = fs.readFileSync(
    path.join(REPO_ROOT, "src", "ai", "tool-loop.ts"),
    "utf8",
  );

  for (const identifier of [
    "looksLikeDisplayAgendaRequest",
    "looksLikeListsRequest",
    "looksLikeNotesRequest",
    "looksLikeWeatherRequest",
    "looksLikeUrlSummaryRequest",
  ]) {
    assert.equal(toolLoopSource.includes(identifier), false, `${identifier} should be removed`);
  }
});
