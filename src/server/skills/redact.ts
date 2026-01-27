import os from "node:os";
import path from "node:path";
import type { SkillRecord, SkillsRegistrySnapshot } from "./types";

const REDACTED = "<redacted>";

function normalizeAbsolute(p: string): string {
  return path.resolve(String(p ?? "")).replace(/\/+$/, "");
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function redactPath(p: string, cwdAbs: string, homeAbs: string): string {
  const abs = normalizeAbsolute(p);
  if (!abs) return REDACTED;

  if (abs === cwdAbs) return ".";
  const cwdPrefix = cwdAbs.endsWith(path.sep) ? cwdAbs : `${cwdAbs}${path.sep}`;
  if (abs.startsWith(cwdPrefix)) {
    return `./${toPosix(path.relative(cwdAbs, abs))}`;
  }

  if (homeAbs && abs === homeAbs) return "~";
  const homePrefix = homeAbs && homeAbs.endsWith(path.sep) ? homeAbs : `${homeAbs}${path.sep}`;
  if (homeAbs && abs.startsWith(homePrefix)) {
    return `~/${toPosix(path.relative(homeAbs, abs))}`;
  }

  return REDACTED;
}

function redactSkillRecord(
  rec: SkillRecord,
  cwdAbs: string,
  homeAbs: string
): SkillRecord {
  return {
    ...rec,
    skillDir: redactPath(rec.skillDir, cwdAbs, homeAbs),
    skillMdPath: redactPath(rec.skillMdPath, cwdAbs, homeAbs),
    sourceDir: redactPath(rec.sourceDir, cwdAbs, homeAbs),
  };
}

function sanitizeWarningText(input: string, cwdAbs: string, homeAbs: string): string {
  let text = String(input ?? "");
  if (!text) return "";

  text = text.replaceAll(cwdAbs, ".");
  if (homeAbs) text = text.replaceAll(homeAbs, "~");

  // Last resort: redact any remaining absolute-looking paths.
  text = text.replace(/(^|[\s(])\/[^\s)]+/g, `$1${REDACTED}`);
  text = text.replace(/(^|[\s(])[A-Za-z]:\\\\[^\s)]+/g, `$1${REDACTED}`);

  return text;
}

export function redactSkillsRegistrySnapshotForPublic(
  snapshot: SkillsRegistrySnapshot
): SkillsRegistrySnapshot {
  const cwdAbs = normalizeAbsolute(process.cwd());
  const homeAbs = normalizeAbsolute(os.homedir());

  return {
    ...snapshot,
    scanRoots: snapshot.scanRoots.map((r) => redactPath(r, cwdAbs, homeAbs)),
    skills: snapshot.skills.map((s) => redactSkillRecord(s, cwdAbs, homeAbs)),
    invalid: snapshot.invalid.map((inv) => ({
      skillDir: redactPath(inv.skillDir, cwdAbs, homeAbs),
      skillMdPath: redactPath(inv.skillMdPath, cwdAbs, homeAbs),
      error: String(inv.error ?? ""),
    })),
    collisions: snapshot.collisions.map((c) => ({
      name: c.name,
      winner: redactSkillRecord(c.winner, cwdAbs, homeAbs),
      losers: c.losers.map((l) => redactSkillRecord(l, cwdAbs, homeAbs)),
    })),
    warnings: snapshot.warnings.map((w) => sanitizeWarningText(w, cwdAbs, homeAbs)).filter(Boolean),
  };
}

