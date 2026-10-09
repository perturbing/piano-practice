import { getDb } from '../db';
import { Preset } from '../schema';

export async function listPresets(): Promise<Preset[]> {
  const db = await getDb();
  return (await db.getAll('presets')).sort((a, b) => a.name.localeCompare(b.name));
}

export async function savePreset(p: Preset): Promise<void> {
  const db = await getDb();
  await db.put('presets', Preset.parse(p));
}

export async function deletePreset(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('presets', id);
}
