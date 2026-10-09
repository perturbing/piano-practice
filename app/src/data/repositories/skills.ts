import { getDb } from '../db';
import { migrateRecord } from '../migrations';
import { SkillState, defaultSkillState } from '../schema';

const KEY = 'skills';

export async function loadSkills(): Promise<SkillState> {
  const db = await getDb();
  const raw = await db.get('skills', KEY);
  if (!raw) return defaultSkillState();
  return SkillState.parse(migrateRecord<SkillState>('skills', raw));
}

export async function saveSkills(s: SkillState): Promise<void> {
  const db = await getDb();
  await db.put('skills', SkillState.parse(s), KEY);
}
