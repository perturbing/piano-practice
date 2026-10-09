import { getDb } from '../db';
import { Attempt } from '../schema';

/** Save incrementally (item boundaries, event batches); validated on every write. */
export async function saveAttempt(a: Attempt): Promise<void> {
  const db = await getDb();
  await db.put('attempts', Attempt.parse(a));
}

export async function getAttempt(id: string): Promise<Attempt | undefined> {
  const db = await getDb();
  return db.get('attempts', id);
}

/** Newest first. */
export async function listAttempts(): Promise<Attempt[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('attempts', 'byStartedAt');
  return all.reverse();
}

export async function deleteAttempts(ids: string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('attempts', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function findInProgressAttempts(): Promise<Attempt[]> {
  return (await listAttempts()).filter((a) => a.status === 'in-progress');
}
