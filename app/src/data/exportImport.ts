import { z } from 'zod';
import { getDb } from './db';
import { migrateRecord, type RecordType } from './migrations';
import { Attempt, DailyRoutine, Preset, Settings, SkillState } from './schema';
import { listAttempts, saveAttempt } from './repositories/attempts';
import { listRoutines, saveRoutine } from './repositories/routines';
import { listPresets, savePreset } from './repositories/presets';
import { loadSettings, saveSettings } from './repositories/settings';
import { loadSkills, saveSkills } from './repositories/skills';
import { newId } from './ids';

export const ENVELOPE_FORMAT = 'piano-app-export';
export const ENVELOPE_VERSION = 1;

/** Units are explicit so the file stands on its own. */
export const UNITS = {
  'attempt.events[].t': 'milliseconds since the attempt started (monotonic clock)',
  'segments[].attacks[].t / targets[].onsetMs': 'milliseconds relative to the segment first beat',
  'bpm': 'quarter-note beats per minute',
  'beats': 'quarter-note beats',
  'midi': 'MIDI note number; middle C (C4) = 60',
  'startedAt / endedAt / exportedAt': 'ISO 8601 UTC',
  'localDate / routine.date': 'YYYY-MM-DD in the learner timezone',
} as const;

export const ExportEnvelope = z.object({
  format: z.literal(ENVELOPE_FORMAT),
  envelopeVersion: z.number().int().positive(),
  exportedAt: z.string(),
  units: z.record(z.string()).optional(),
  records: z.object({
    attempts: z.array(z.unknown()).default([]),
    routines: z.array(z.unknown()).default([]),
    presets: z.array(z.unknown()).default([]),
  }),
  settings: z.unknown().optional(),
  skills: z.unknown().optional(),
});
export type ExportEnvelope = z.infer<typeof ExportEnvelope>;

export async function exportAll(): Promise<ExportEnvelope> {
  const [attempts, routines, presets, settings, skills] = await Promise.all([
    listAttempts(),
    listRoutines(),
    listPresets(),
    loadSettings(),
    loadSkills(),
  ]);
  return {
    format: ENVELOPE_FORMAT,
    envelopeVersion: ENVELOPE_VERSION,
    exportedAt: new Date().toISOString(),
    units: { ...UNITS },
    records: { attempts, routines, presets },
    settings,
    skills,
  };
}

export interface ImportItem<T> {
  record: T;
  /** add: new; skip: identical record already present; copy: same id, different content -> new identity. */
  action: 'add' | 'skip' | 'copy';
  reason?: string;
}

export interface ImportPreview {
  attempts: ImportItem<Attempt>[];
  routines: ImportItem<DailyRoutine>[];
  presets: ImportItem<Preset>[];
  settings: Settings | null;
  skills: SkillState | null;
  errors: string[];
}

export class ImportFormatError extends Error {}

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );
}

function parseAll<T>(type: RecordType, schema: z.ZodType<T>, raws: unknown[], errors: string[]): T[] {
  const out: T[] = [];
  raws.forEach((raw, i) => {
    try {
      const r = schema.safeParse(migrateRecord(type, raw));
      if (r.success) out.push(r.data);
      else errors.push(`${type} #${i + 1}: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
    } catch (e) {
      errors.push(`${type} #${i + 1}: ${(e as Error).message}`);
    }
  });
  return out;
}

/** Validate, migrate and diff against the local database. Nothing is written. */
export async function previewImport(json: string): Promise<ImportPreview> {
  if (json.length > MAX_IMPORT_BYTES) throw new ImportFormatError('The file is larger than 50 MB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ImportFormatError('The file is not valid JSON.');
  }
  const env = ExportEnvelope.safeParse(parsed);
  if (!env.success) throw new ImportFormatError(`The file is not a ${ENVELOPE_FORMAT} file.`);
  if (env.data.envelopeVersion > ENVELOPE_VERSION) {
    throw new ImportFormatError(
      `The file was made by a newer version of the app (format ${env.data.envelopeVersion}). Update the app and try again.`,
    );
  }
  const errors: string[] = [];
  const attempts = parseAll('attempt', Attempt, env.data.records.attempts, errors);
  const routines = parseAll('routine', DailyRoutine, env.data.records.routines, errors);
  const presets = parseAll('preset', Preset, env.data.records.presets, errors);
  const settings = env.data.settings ? parseAll('settings', Settings, [env.data.settings], errors)[0] ?? null : null;
  const skills = env.data.skills ? parseAll('skills', SkillState, [env.data.skills], errors)[0] ?? null : null;

  const db = await getDb();
  const diff = async <T extends object>(
    items: T[],
    get: (r: T) => Promise<T | undefined>,
  ): Promise<ImportItem<T>[]> => {
    const out: ImportItem<T>[] = [];
    for (const record of items) {
      const existing = await get(record);
      if (!existing) out.push({ record, action: 'add' });
      else if (stable(existing) === stable(record)) out.push({ record, action: 'skip', reason: 'already present' });
      else out.push({ record, action: 'copy', reason: 'same id with different content' });
    }
    return out;
  };
  return {
    attempts: await diff(attempts, (r) => db.get('attempts', r.id)),
    routines: await diff(routines, (r) => db.get('routines', r.date)),
    presets: await diff(presets, (r) => db.get('presets', r.id)),
    settings,
    skills,
    errors,
  };
}

export interface ImportChoices {
  /** For conflicting records: import as a copy with a new identity, or skip. Never overwrite. */
  conflicts: 'copy' | 'skip';
  /** Replace local settings with the file's (device setup is kept). */
  applySettings: boolean;
  /** Replace local levels and working tempos with the file's. */
  applySkills: boolean;
}

export async function applyImport(preview: ImportPreview, choices: ImportChoices): Promise<{ added: number; copied: number; skipped: number }> {
  let added = 0;
  let copied = 0;
  let skipped = 0;
  for (const it of preview.attempts) {
    if (it.action === 'add') {
      await saveAttempt(it.record);
      added++;
    } else if (it.action === 'copy' && choices.conflicts === 'copy') {
      await saveAttempt({ ...it.record, id: newId('att') });
      copied++;
    } else skipped++;
  }
  for (const it of preview.presets) {
    if (it.action === 'add') {
      await savePreset(it.record);
      added++;
    } else if (it.action === 'copy' && choices.conflicts === 'copy') {
      await savePreset({ ...it.record, id: newId('preset'), name: `${it.record.name} (imported)` });
      copied++;
    } else skipped++;
  }
  // Routines are keyed by date; a conflicting day keeps the local routine.
  for (const it of preview.routines) {
    if (it.action === 'add') {
      await saveRoutine(it.record);
      added++;
    } else skipped++;
  }
  if (choices.applySettings && preview.settings) {
    const local = await loadSettings();
    await saveSettings({ ...preview.settings, input: local.input, range: local.range });
  }
  if (choices.applySkills && preview.skills) await saveSkills(preview.skills);
  return { added, copied, skipped };
}

export async function deleteAllData(): Promise<void> {
  const db = await getDb();
  await Promise.all(['attempts', 'routines', 'presets', 'skills', 'settings'].map((s) => db.clear(s as 'attempts')));
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per guided item or timed segment, for analysis in a spreadsheet. */
export function resultsCsv(attempts: Attempt[]): string {
  const rows: unknown[][] = [
    [
      'attempt_id', 'started_at', 'kind', 'title', 'mode', 'status', 'key', 'unit', 'unit_id',
      'outcome', 'first_try', 'assisted', 'hint_level', 'mistakes', 'bpm', 'expected', 'matched',
      'timing_misses', 'wrong_pitches', 'missed', 'extras', 'median_abs_error_ms',
    ],
  ];
  for (const a of attempts) {
    for (const r of a.itemResults ?? []) {
      rows.push([a.id, a.startedAt, a.kind, a.title, a.mode, a.status, a.keyOrder[0], 'item', r.itemId, r.outcome,
        r.firstTry, r.assisted, r.hintLevel, r.mistakes.length, '', '', '', '', '', '', '', '']);
    }
    for (const s of a.segments ?? []) {
      const m = s.summary;
      rows.push([a.id, a.startedAt, a.kind, a.title, a.mode, a.status, s.keyId, 'segment', s.index, s.status, '', s.assisted, '', '',
        s.bpm, m?.expected, m?.matched, m?.timingMisses, m?.wrongPitches, m?.missed, m?.extras, m?.medianAbsErrorMs]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
