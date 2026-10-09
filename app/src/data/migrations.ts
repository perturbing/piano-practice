// Per-record migration chain. Every record carries schemaVersion; older
// versions are upgraded step by step, newer-than-known versions are rejected
// with a clear message rather than silently mangled.

export type RecordType = 'settings' | 'skills' | 'attempt' | 'routine' | 'preset';

export const CURRENT_VERSIONS: Record<RecordType, number> = {
  settings: 1,
  skills: 1,
  attempt: 1,
  routine: 1,
  preset: 1,
};

type Migration = (r: Record<string, unknown>) => Record<string, unknown>;

// MIGRATIONS[type][n] upgrades version n to n + 1. None needed yet.
const MIGRATIONS: Record<RecordType, Record<number, Migration>> = {
  settings: {},
  skills: {},
  attempt: {},
  routine: {},
  preset: {},
};

export class UnsupportedVersionError extends Error {}

export function migrateRecord<T>(type: RecordType, raw: unknown): T {
  if (typeof raw !== 'object' || raw === null) throw new Error(`Invalid ${type} record.`);
  let rec = raw as Record<string, unknown>;
  let v = typeof rec.schemaVersion === 'number' ? rec.schemaVersion : 1;
  const target = CURRENT_VERSIONS[type];
  if (v > target) {
    throw new UnsupportedVersionError(
      `A ${type} record uses schema version ${v}, newer than this app supports (${target}). Update the app and try again.`,
    );
  }
  while (v < target) {
    const step = MIGRATIONS[type][v];
    if (!step) throw new UnsupportedVersionError(`No migration for ${type} v${v}.`);
    rec = step(rec);
    v++;
  }
  return { ...rec, schemaVersion: target } as T;
}
