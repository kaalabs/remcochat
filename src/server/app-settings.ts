import { getDb } from "@/server/db";

const KEY_ACTIVE_PROVIDER_ID = "active_provider_id";

export function getActiveProviderIdFromDb(): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(KEY_ACTIVE_PROVIDER_ID) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setActiveProviderIdInDb(providerId: string) {
  const db = getDb();
  db.prepare(
    `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `
  ).run(KEY_ACTIVE_PROVIDER_ID, providerId, new Date().toISOString());
}

