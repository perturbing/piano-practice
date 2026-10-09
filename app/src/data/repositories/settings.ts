import { getDb } from '../db';
import { migrateRecord } from '../migrations';
import { Settings, defaultSettings } from '../schema';

const KEY = 'app';

export async function loadSettings(): Promise<Settings> {
  const db = await getDb();
  const raw = await db.get('settings', KEY);
  if (!raw) return defaultSettings();
  // Unknown or invalid fields fall back to defaults instead of blocking startup.
  const parsed = Settings.safeParse({ ...defaultSettings(), ...migrateRecord<Settings>('settings', raw) });
  return parsed.success ? parsed.data : defaultSettings();
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getDb();
  await db.put('settings', Settings.parse(settings), KEY);
}
