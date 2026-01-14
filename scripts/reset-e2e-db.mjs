import fs from "node:fs";
import path from "node:path";

const dbPath = process.env.REMCOCHAT_DB_PATH
  ? path.resolve(process.env.REMCOCHAT_DB_PATH)
  : path.join(process.cwd(), "data", "remcochat-e2e.sqlite");

try {
  fs.rmSync(dbPath, { force: true });
} catch {
  // ignore
}

