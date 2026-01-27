import { getDb } from "@/server/db";

export type SkillsUsageSummary = {
  chatsWithAnyActivatedSkills: number;
  activatedSkillCounts: Record<string, number>;
};

function parseStringArrayJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v ?? "").trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function getSkillsUsageSummary(): SkillsUsageSummary {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT activated_skill_names_json
       FROM chats
       WHERE deleted_at IS NULL`
    )
    .all() as Array<{ activated_skill_names_json: string }>;

  const activatedSkillCounts: Record<string, number> = {};
  let chatsWithAnyActivatedSkills = 0;

  for (const row of rows) {
    const names = parseStringArrayJson(row.activated_skill_names_json);
    if (names.length > 0) chatsWithAnyActivatedSkills += 1;
    for (const name of names) {
      activatedSkillCounts[name] = (activatedSkillCounts[name] ?? 0) + 1;
    }
  }

  return { chatsWithAnyActivatedSkills, activatedSkillCounts };
}

