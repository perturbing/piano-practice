import { describe, expect, it } from 'vitest';
import type { Attempt, TimedSegment } from '../data/schema';
import { attemptQualified, commonMistakes, lessonStatus, qualifiedTempos, skillRows, tempoOfferFor, trackEvidence } from './evidence';

function attempt(over: Partial<Attempt>): Attempt {
  return {
    schemaVersion: 1,
    id: Math.random().toString(36),
    kind: 'practice',
    sourceId: 'x',
    title: 't',
    startedAt: '2026-10-09T10:00:00Z',
    localDate: '2026-10-09',
    status: 'completed',
    mode: 'guided',
    contentRevision: 1,
    evaluatorVersion: 'guided-v1',
    settings: {},
    keyOrder: ['C-major'],
    skills: [],
    confirmedRange: null,
    input: { source: 'virtual', route: 'virtual', name: 'v' },
    timing: { timestampSource: 'virtual-input', clock: 'performance.now', offsetMs: 0, reliable: false },
    events: [],
    interruptions: 0,
    ...over,
  };
}

const items = (firstTry: number, total: number) =>
  Array.from({ length: total }, (_, i) => ({
    itemId: `i${i}`,
    outcome: 'correct' as const,
    firstTry: i < firstTry,
    assisted: false,
    hintLevel: 0,
    highlighted: false,
    mistakes: i < firstTry ? [] : [{ played: [61], t: 0, cue: 'You played C♯4. Try a half step lower.' }],
    activatedAt: 0,
    completedAt: 1,
  }));

const seg = (over: Partial<TimedSegment>): TimedSegment => ({
  index: 0,
  keyId: 'C-major',
  bpm: 60,
  subdivision: 1,
  startT: 0,
  status: 'complete',
  toleranceConfig: { maxToleranceMs: 200, ioiFraction: 0.25, chordSpreadMs: 180, beatMs: 1000, profile: 'standard' },
  attacks: [],
  targets: [],
  outcomes: [],
  summary: { expected: 8, matched: 8, timingMisses: 0, wrongPitches: 0, missed: 0, extras: 0, medianAbsErrorMs: 20, meanSignedErrorMs: 0 },
  qualifies: true,
  assisted: false,
  ...over,
});

describe('evidence views', () => {
  it('lesson status needs passing recall/apply checks on two different days', () => {
    const try1 = attempt({ kind: 'lesson', sourceId: 'l1:try', itemResults: items(4, 4) });
    expect(lessonStatus([try1], 'l1').status).toBe('practising');
    const day1 = attempt({ kind: 'lesson', sourceId: 'l1:recall', itemResults: items(10, 10) });
    expect(lessonStatus([try1, day1], 'l1').status).toBe('practising');
    const day2 = attempt({ kind: 'lesson', sourceId: 'l1:apply', localDate: '2026-10-10', itemResults: items(9, 10) });
    expect(lessonStatus([try1, day1, day2], 'l1').status).toBe('demonstrated');
    expect(lessonStatus([], 'l1').status).toBe('not-started');
  });

  it('hinted or corrected items keep a check from qualifying', () => {
    expect(attemptQualified(attempt({ itemResults: items(8, 10) }))).toBe(false);
    expect(attemptQualified(attempt({ itemResults: items(9, 10) }))).toBe(true);
    expect(attemptQualified(attempt({ itemResults: items(10, 10), status: 'ended-early' }))).toBe(false);
  });

  it('collects per-track evidence for daily attempts', () => {
    const a = attempt({ kind: 'daily', settings: { track: 'pulse' }, itemResults: items(10, 10) });
    const b = attempt({ kind: 'daily', settings: { track: 'pulse' }, itemResults: items(3, 10) });
    expect(trackEvidence([a, b], '2026-10-01')).toEqual({ pulse: { attempts: 2, qualified: 1 } });
    expect(trackEvidence([a, b], '2026-10-10')).toEqual({});
  });

  it('offers +2 BPM only after two qualifying segments, never after an interruption', () => {
    expect(tempoOfferFor(attempt({ mode: 'timed', segments: [seg({}), seg({ index: 1 })] }))).toBe(true);
    expect(
      tempoOfferFor(attempt({ mode: 'timed', segments: [seg({}), seg({ index: 1, status: 'interrupted', summary: null, qualifies: false })] })),
    ).toBe(false);
    expect(tempoOfferFor(attempt({ mode: 'timed', segments: [seg({}), seg({ index: 1, bpm: 62 })] }))).toBe(false);
  });

  it('keeps conditions with every qualifying tempo', () => {
    const q = qualifiedTempos([attempt({ mode: 'timed', settings: { tempoKey: 'k' }, segments: [seg({ bpm: 66 }), seg({ qualifies: false })] })]);
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ tempoKey: 'k', bpm: 66, keyId: 'C-major', subdivision: 1, profile: 'standard' });
  });

  it('groups skills and specific difficulties', () => {
    const a = attempt({ skills: ['reading:treble'], itemResults: items(7, 10) });
    const rows = skillRows([a]);
    expect(rows[0]).toMatchObject({ label: 'Note reading — treble clef', items: 10, firstTry: 7 });
    expect(commonMistakes([a])[0]).toEqual({ cue: 'Try a half step lower.', count: 3 });
  });
});
