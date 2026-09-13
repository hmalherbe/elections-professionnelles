import { db } from "../db/index.js";

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export interface TestContactSettings {
  testEmail: string | null;
  testMobile: string | null;
}

export function getTestContactSettings(): TestContactSettings {
  return {
    testEmail: getSetting("test_email"),
    testMobile: getSetting("test_mobile"),
  };
}
