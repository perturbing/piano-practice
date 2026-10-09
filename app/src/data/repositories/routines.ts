import { getDb } from '../db';
import { DailyRoutine } from '../schema';

export async function getRoutine(date: string): Promise<DailyRoutine | undefined> {
  const db = await getDb();
  return db.get('routines', date);
}

export async function saveRoutine(r: DailyRoutine): Promise<void> {
  const db = await getDb();
  await db.put('routines', DailyRoutine.parse(r));
}

export async function listRoutines(): Promise<DailyRoutine[]> {
  const db = await getDb();
  return (await db.getAll('routines')).sort((a, b) => (a.date < b.date ? 1 : -1));
}
