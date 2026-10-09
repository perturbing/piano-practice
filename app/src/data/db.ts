import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Attempt, DailyRoutine, Preset, Settings, SkillState } from './schema';

export interface PianoDB extends DBSchema {
  settings: { key: string; value: Settings };
  skills: { key: string; value: SkillState };
  attempts: {
    key: string;
    value: Attempt;
    indexes: { byStartedAt: string; byLocalDate: string };
  };
  routines: { key: string; value: DailyRoutine };
  presets: { key: string; value: Preset };
}

const DB_NAME = 'piano-app';
const DB_VERSION = 1;
const EXPECTED_STORES = ['settings', 'skills', 'attempts', 'routines', 'presets'] as const;

let dbPromise: Promise<IDBPDatabase<PianoDB>> | null = null;

// Store creation is existence-based (not version arithmetic) and getDb
// self-heals a database missing a store, as in the bike app.
function openOptions() {
  return {
    upgrade(db: IDBPDatabase<PianoDB>) {
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('skills')) db.createObjectStore('skills');
      if (!db.objectStoreNames.contains('attempts')) {
        const attempts = db.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('byStartedAt', 'startedAt');
        attempts.createIndex('byLocalDate', 'localDate');
      }
      if (!db.objectStoreNames.contains('routines')) db.createObjectStore('routines', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('presets')) db.createObjectStore('presets', { keyPath: 'id' });
    },
    blocking(_cur: number, _blocked: number | null, event: IDBVersionChangeEvent) {
      (event.target as IDBDatabase | null)?.close();
      dbPromise = null;
    },
    blocked() {
      console.warn('piano-app: database upgrade is blocked by another open tab of this app. Close other tabs and reload.');
    },
    terminated() {
      dbPromise = null;
    },
  };
}

async function openHealed(): Promise<IDBPDatabase<PianoDB>> {
  let db: IDBPDatabase<PianoDB>;
  try {
    db = await openDB<PianoDB>(DB_NAME, DB_VERSION, openOptions());
  } catch (e) {
    if (e instanceof DOMException && e.name === 'VersionError') {
      db = await openDB<PianoDB>(DB_NAME, undefined, openOptions());
    } else {
      throw e;
    }
  }
  for (let guard = 0; guard < 3; guard++) {
    const missing = EXPECTED_STORES.filter((s) => !db.objectStoreNames.contains(s));
    if (missing.length === 0) return db;
    console.warn(`piano-app: database is missing stores [${missing.join(', ')}]; repairing.`);
    const nextVersion = db.version + 1;
    db.close();
    db = await openDB<PianoDB>(DB_NAME, nextVersion, openOptions());
  }
  return db;
}

export function getDb(): Promise<IDBPDatabase<PianoDB>> {
  if (!dbPromise) dbPromise = openHealed();
  return dbPromise;
}

/** Test hook: reset the cached connection. */
export function resetDbForTests(): void {
  dbPromise = null;
}
