// @vitest-environment node
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { resetDbForTests } from './db';
import { getAttempt, listAttempts, saveAttempt } from './repositories/attempts';
import { loadSettings, saveSettings } from './repositories/settings';
import { loadSkills, saveSkills } from './repositories/skills';
import { listRoutines, saveRoutine } from './repositories/routines';
import { applyImport, deleteAllData, exportAll, ImportFormatError, previewImport, resultsCsv } from './exportImport';
import { defaultSettings, defaultSkillState, type Attempt, type DailyRoutine } from './schema';
import { localDateIn } from './ids';
import { UnsupportedVersionError, migrateRecord } from './migrations';

function freshDb() {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
}

const attempt: Attempt = {
  schemaVersion: 1,
  id: 'att_1',
  kind: 'practice',
  sourceId: 'arpeggio',
  title: 'C major tonic arpeggio',
  startedAt: '2026-10-09T10:00:00.000Z',
  endedAt: '2026-10-09T10:02:00.000Z',
  localDate: '2026-10-09',
  status: 'completed',
  mode: 'timed',
  contentRevision: 1,
  evaluatorVersion: 'timed-v1',
  settings: { keyId: 'C-major', hand: 'right', bpm: 60 },
  keyOrder: ['C-major'],
  skills: ['pattern:arp-1-updown:C-major'],
  confirmedRange: { low: 36, high: 96, method: 'checked' },
  input: { source: 'webmidi', route: 'bluetooth-os', name: 'BLE adapter' },
  timing: { timestampSource: 'webmidi-event', clock: 'performance.now', offsetMs: 0, reliable: true },
  events: [
    { t: 0, type: 'countIn' },
    { t: 4000, type: 'noteon', note: 60, velocity: 80 },
    { t: 4200, type: 'noteoff', note: 60, velocity: 0 },
  ],
  segments: [
    {
      index: 0,
      keyId: 'C-major',
      bpm: 60,
      subdivision: 1,
      startT: 4000,
      status: 'complete',
      toleranceConfig: { maxToleranceMs: 200, ioiFraction: 0.25, chordSpreadMs: 180, beatMs: 1000, profile: 'standard' },
      attacks: [{ note: 60, t: 0 }],
      targets: [{ id: 't0.0', midi: 60, onsetMs: 0, group: 0, eventIndex: 0 }],
      outcomes: [{ kind: 'matched', attack: 0, errorMs: 0 }],
      summary: {
        expected: 1, matched: 1, timingMisses: 0, wrongPitches: 0, missed: 0, extras: 0,
        medianAbsErrorMs: 0, meanSignedErrorMs: 0,
      },
      qualifies: true,
      assisted: false,
    },
  ],
  interruptions: 0,
};

const routine: DailyRoutine = {
  schemaVersion: 1,
  date: '2026-10-09',
  timezone: 'Europe/Amsterdam',
  revision: 1,
  generatedAt: '2026-10-09T09:00:00.000Z',
  rulesVersion: 'routine-v1',
  lengthMin: 10,
  tasks: [
    {
      id: 'task-1', slot: 'settle', title: 'Settle in', purpose: 'p', reason: 'r', track: 'fingerPatterns', level: 1,
      pattern: { kind: 'track', example: 0 }, keyId: 'C-major', hand: 'right', mode: 'guided', bpm: null,
      repetitions: 2, estMin: 2,
    },
  ],
  position: 0,
  status: 'in-progress',
  taskStates: [{ taskId: 'task-1', status: 'done', attemptIds: ['att_1'] }],
  swaps: [],
};

describe('persistence', () => {
  beforeEach(freshDb);

  it('defaults settings and skills on a clean install', async () => {
    expect(await loadSettings()).toMatchObject({ sessionLengthMin: 10, keyPool: ['C-major'] });
    expect((await loadSkills()).levels.fingerPatterns).toBe(1);
  });

  it('round-trips a complete attempt through export into a clean installation', async () => {
    await saveAttempt(attempt);
    await saveRoutine(routine);
    await saveSettings({ ...defaultSettings(), sessionLengthMin: 15 });
    await saveSkills({ ...defaultSkillState(), workingTempos: { 'arp|C-major': 64 } });
    const json = JSON.stringify(await exportAll());

    freshDb();
    const preview = await previewImport(json);
    expect(preview.errors).toEqual([]);
    expect(preview.attempts.map((i) => i.action)).toEqual(['add']);
    await applyImport(preview, { conflicts: 'copy', applySettings: true, applySkills: true });

    expect(await getAttempt('att_1')).toEqual(attempt);
    expect(await listRoutines()).toEqual([routine]);
    expect((await loadSettings()).sessionLengthMin).toBe(15);
    expect((await loadSkills()).workingTempos).toEqual({ 'arp|C-major': 64 });
  });

  it('skips identical records and copies conflicting ones without overwriting', async () => {
    await saveAttempt(attempt);
    const json = JSON.stringify(await exportAll());
    await saveAttempt({ ...attempt, title: 'changed locally' });
    const preview = await previewImport(json);
    expect(preview.attempts[0].action).toBe('copy');
    await applyImport(preview, { conflicts: 'copy', applySettings: false, applySkills: false });
    const all = await listAttempts();
    expect(all).toHaveLength(2);
    expect(all.find((a) => a.id === 'att_1')?.title).toBe('changed locally');

    const again = await previewImport(JSON.stringify(await exportAll()));
    expect(again.attempts.every((i) => i.action === 'skip')).toBe(true);
  });

  it('rejects files that are not exports or come from a newer version', async () => {
    await expect(previewImport('nope')).rejects.toBeInstanceOf(ImportFormatError);
    await expect(previewImport('{"format":"other"}')).rejects.toBeInstanceOf(ImportFormatError);
    const env = { ...(await exportAll()), envelopeVersion: 99 };
    await expect(previewImport(JSON.stringify(env))).rejects.toThrow(/newer version/);
  });

  it('reports invalid records instead of importing them', async () => {
    const env = await exportAll();
    env.records.attempts = [{ ...attempt, mode: 'sideways' }];
    const p = await previewImport(JSON.stringify(env));
    expect(p.attempts).toHaveLength(0);
    expect(p.errors[0]).toMatch(/attempt #1/);
  });

  it('delete all clears every store', async () => {
    await saveAttempt(attempt);
    await deleteAllData();
    expect(await listAttempts()).toEqual([]);
  });

  it('exports results as CSV', () => {
    const csv = resultsCsv([attempt]);
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('segment');
  });
});

describe('helpers', () => {
  it('rejects newer record versions', () => {
    expect(() => migrateRecord('attempt', { schemaVersion: 5 })).toThrow(UnsupportedVersionError);
  });
  it('computes routine dates in the learner timezone', () => {
    const at = new Date('2026-10-09T23:30:00Z');
    expect(localDateIn('UTC', at)).toBe('2026-10-09');
    expect(localDateIn('Europe/Amsterdam', at)).toBe('2026-10-10');
  });
});
