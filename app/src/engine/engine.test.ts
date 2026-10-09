import { describe, expect, it } from 'vitest';
import { GuidedEvaluator, singleNoteCue, summarizeGuided, type GuidedConfig } from './guided';
import { exactItem, itemsFromPhrase, timedTargetsFromPhrase, type GuidedItem } from './targets';
import { evaluateTimed, timedConfig, tolerancesFor, describeTimed } from './timed';
import {
  demonstratedUntimed,
  levelUpOffered,
  tempoIncreaseOffered,
  type SegmentEvidence,
} from './progression';
import { parseSpelled } from '../music/pitch';
import { C_MAJOR, parseKeyId } from '../music/keys';
import { arpeggioPattern } from '../music/patterns';

const sp = (t: string) => parseSpelled(t)!;
const cfg = (over: Partial<GuidedConfig> = {}): GuidedConfig => ({
  settleMs: 120,
  releaseBetweenItems: true,
  highlighted: false,
  key: C_MAJOR,
  ...over,
});

/** Drive an evaluator with a NoteTracker-like held set. */
function driver(ev: GuidedEvaluator) {
  const held = new Set<number>();
  return {
    press: (n: number, t: number) => {
      held.add(n);
      return ev.onAttack(n, t, [...held].sort((a, b) => a - b));
    },
    release: (n: number, t: number) => {
      held.delete(n);
      return ev.onRelease(t, [...held].sort((a, b) => a - b));
    },
    tick: (t: number) => ev.tick(t, [...held].sort((a, b) => a - b)),
  };
}

describe('guided single notes', () => {
  it('accepts a fresh correct note and waits for release before the next prompt', () => {
    const ev = new GuidedEvaluator([exactItem('a', [sp('C4')]), exactItem('b', [sp('C4')])], cfg());
    const d = driver(ev);
    expect(d.press(60, 0).kind).toBe('correct');
    expect(ev.phase).toBe('awaitingRelease');
    // Holding the key cannot complete the next prompt.
    expect(ev.index).toBe(0);
    d.release(60, 100);
    expect(ev.index).toBe(1);
    expect(d.press(60, 200).kind).toBe('done');
    expect(summarizeGuided(ev.results)).toMatchObject({ total: 2, firstTry: 2, corrected: 0 });
  });

  it('records a correction rather than a clean first try', () => {
    const ev = new GuidedEvaluator([exactItem('a', [sp('E4')])], cfg());
    const d = driver(ev);
    const fb = d.press(65, 0);
    expect(fb).toEqual({ kind: 'mistake', cue: 'You played F4. Try one step lower.' });
    expect(singleNoteCue(76, exactItem('x', [sp('D4')]), C_MAJOR)).toMatch(/more than an octave lower/);
    d.release(65, 50);
    d.press(64, 100);
    expect(ev.results[0]).toMatchObject({ outcome: 'correct', firstTry: false });
    expect(summarizeGuided(ev.results).corrected).toBe(1);
  });

  it('distinguishes the right note name in the wrong octave', () => {
    const item = exactItem('a', [sp('C4')]);
    expect(singleNoteCue(72, item, C_MAJOR)).toBe('That is C5; the written note is C4 — one octave too high.');
  });

  it('points at the key signature when the accidental comes from it', () => {
    const g = parseKeyId('G-major')!;
    expect(singleNoteCue(65, exactItem('a', [sp('F#4')]), g)).toBe(
      'You played F4. The note is F-sharp — check the key signature.',
    );
  });

  it('marks answer-revealing hints as assisted', () => {
    const ev = new GuidedEvaluator([exactItem('a', [sp('C4')]), exactItem('b', [sp('D4')])], cfg());
    const d = driver(ev);
    ev.hint();
    expect(ev.results[0].assisted).toBe(false); // landmark reminder only
    ev.hint();
    d.press(60, 0);
    expect(ev.results[0]).toMatchObject({ outcome: 'correct', firstTry: false, assisted: true, hintLevel: 2 });
  });

  it('records skip as skipped, never correct', () => {
    const ev = new GuidedEvaluator([exactItem('a', [sp('C4')])], cfg());
    ev.skip(0, []);
    expect(ev.results[0]).toMatchObject({ outcome: 'skipped', firstTry: false });
    expect(ev.phase).toBe('done');
  });

  it('treats highlighted support as assisted', () => {
    const ev = new GuidedEvaluator([exactItem('a', [sp('C4')])], cfg({ highlighted: true }));
    driver(ev).press(60, 0);
    expect(ev.results[0]).toMatchObject({ outcome: 'correct', firstTry: false, assisted: true });
  });

  it('sequences (scales) advance on fresh attacks without waiting for release', () => {
    const phrase = arpeggioPattern({ key: C_MAJOR, hand: 'right' });
    const ev = new GuidedEvaluator(itemsFromPhrase(phrase), cfg({ releaseBetweenItems: false }));
    const d = driver(ev);
    let t = 0;
    for (const n of [60, 64, 67, 72, 67, 64, 60]) {
      d.press(n, (t += 100)); // legato: press before release
      d.release(n, t + 150);
    }
    expect(ev.phase).toBe('done');
    expect(ev.results.every((r) => r.firstTry)).toBe(true);
  });

  it('a held top note is not counted twice in a repeated pattern', () => {
    const items = [exactItem('a', [sp('C5')]), exactItem('b', [sp('C5')])];
    const ev = new GuidedEvaluator(items, cfg({ releaseBetweenItems: false }));
    const d = driver(ev);
    d.press(72, 0);
    expect(ev.index).toBe(1);
    d.tick(500);
    expect(ev.index).toBe(1); // still needs a new attack
    d.release(72, 600);
    d.press(72, 700);
    expect(ev.phase).toBe('done');
  });
});

describe('guided chords', () => {
  const written: GuidedItem = exactItem('c', [sp('C4'), sp('E4'), sp('G4')]);

  it('accepts the exact held set after the settle time, without penalty for slow assembly', () => {
    const ev = new GuidedEvaluator([written], cfg());
    const d = driver(ev);
    d.press(60, 0);
    d.press(64, 400);
    d.press(67, 900);
    expect(d.tick(1000).kind).toBe('none');
    expect(d.tick(1030).kind).toBe('done');
    expect(ev.results[0].firstTry).toBe(true);
  });

  it('an extra note blocks acceptance until released and is stored as a correction', () => {
    const ev = new GuidedEvaluator([written], cfg());
    const d = driver(ev);
    d.press(60, 0);
    d.press(64, 0);
    d.press(67, 0);
    expect(d.press(65, 10).kind).toBe('mistake');
    expect(d.tick(500).kind).toBe('none');
    d.release(65, 600);
    d.tick(650);
    expect(d.tick(800).kind).toBe('done');
    expect(ev.results[0]).toMatchObject({ outcome: 'correct', firstTry: false });
  });

  it('a written chord keeps its voicing; the right notes an octave away are not accepted', () => {
    const ev = new GuidedEvaluator([written], cfg());
    const d = driver(ev);
    d.press(60, 0);
    d.press(64, 0);
    const fb = d.press(79, 0);
    expect(fb.kind).toBe('mistake');
    expect(fb.cue).toContain('the written note is G4');
  });

  it('chord-name items accept any inversion unless a bass is required', () => {
    const pcs = [0, 3, 7]; // C minor
    const any: GuidedItem = {
      id: 'cm',
      notes: [sp('C4'), sp('Eb4'), sp('G4')],
      midis: [60, 63, 67],
      policy: { kind: 'chordName', pcs, allowDoubling: false, low: 48, high: 84 },
    };
    const ev = new GuidedEvaluator([any], cfg());
    const d = driver(ev);
    d.press(55, 0);
    d.press(60, 0);
    d.press(63, 0);
    d.tick(0);
    expect(d.tick(200).kind).toBe('done');

    const firstInv: GuidedItem = { ...any, id: 'cm1', policy: { ...any.policy, bassPc: 3 } as GuidedItem['policy'] };
    const ev2 = new GuidedEvaluator([firstInv], cfg());
    const d2 = driver(ev2);
    d2.press(60, 0);
    d2.press(63, 0);
    const fb = d2.press(67, 0);
    expect(fb.kind).toBe('mistake');
    expect(fb.cue).toContain('E-flat as the lowest note');
  });

  it('a still-held chord cannot complete the next identical chord prompt', () => {
    const ev = new GuidedEvaluator([written, { ...written, id: 'c2' }], cfg({ releaseBetweenItems: false }));
    const d = driver(ev);
    d.press(60, 0);
    d.press(64, 0);
    d.press(67, 0);
    d.tick(0);
    d.tick(200);
    expect(ev.index).toBe(1);
    d.tick(400);
    d.tick(800);
    expect(ev.index).toBe(1);
    d.release(64, 900);
    d.press(64, 1000);
    d.tick(1000);
    expect(d.tick(1200).kind).toBe('done');
  });

  it('chord-name items name the needed third for a quality error', () => {
    const ev = new GuidedEvaluator(
      [
        {
          id: 'cm',
          notes: [sp('C4'), sp('Eb4'), sp('G4')],
          midis: [60, 63, 67],
          policy: { kind: 'chordName', pcs: [0, 3, 7], allowDoubling: false, low: 48, high: 84 },
        },
      ],
      cfg({ key: parseKeyId('C-minor')! }),
    );
    expect(driver(ev).press(64, 0).cue).toBe('E4 is not in this chord; E-flat is needed.');
  });
});

describe('timed evaluation', () => {
  it('derives tolerances from the inter-onset interval (spec examples)', () => {
    const q = timedConfig(1000);
    const at60 = [0, 1000, 2000].map((o, i) => ({ id: `${i}`, midi: 60, onsetMs: o, group: i, eventIndex: i }));
    expect(tolerancesFor(at60, q)).toEqual([200, 200, 200]);
    const e = timedConfig(500);
    const eighths120 = [0, 250, 500].map((o, i) => ({ id: `${i}`, midi: 60, onsetMs: o, group: i, eventIndex: i }));
    expect(tolerancesFor(eighths120, e)).toEqual([62.5, 62.5, 62.5]);
    expect(tolerancesFor([at60[0]], q)).toEqual([200]); // isolated target: declared beat
  });

  const arp = timedTargetsFromPhrase(arpeggioPattern({ key: C_MAJOR, hand: 'right' }), 1000);
  const perfect = arp.map((t) => ({ note: t.midi, t: t.onsetMs + 20 }));

  it('matches a clean performance', () => {
    const r = evaluateTimed(arp, perfect, timedConfig(1000));
    expect(r.summary).toMatchObject({ expected: 7, matched: 7, extras: 0, missed: 0, medianAbsErrorMs: 20 });
  });

  it('a wrong note does not shift later targets', () => {
    const played = perfect.map((a, i) => (i === 1 ? { ...a, note: 65 } : a));
    const r = evaluateTimed(arp, played, timedConfig(1000));
    expect(r.targets[1]).toMatchObject({ kind: 'wrongPitch', played: 65 });
    expect(r.summary).toMatchObject({ matched: 6, wrongPitches: 1, extras: 0 });
  });

  it('keeps missed notes, extras and timing misses distinct', () => {
    const played = [
      { note: 60, t: 0 },
      // E4 skipped entirely
      { note: 67, t: 2350 }, // late beyond 200 ms window
      { note: 72, t: 3000 },
      { note: 61, t: 3500 }, // between onsets: extra
      { note: 67, t: 4000 },
      { note: 64, t: 5000 },
      { note: 60, t: 6000 },
    ];
    const r = evaluateTimed(arp, played, timedConfig(1000));
    expect(r.targets[1]).toEqual({ kind: 'missed' });
    expect(r.targets[2]).toMatchObject({ kind: 'timing', errorMs: 350 });
    expect(r.summary).toMatchObject({ matched: 5, missed: 1, timingMisses: 1, extras: 1 });
  });

  it('one attack cannot satisfy two targets; ties resolve by closest onset then score order', () => {
    const two = [
      { id: 'a', midi: 60, onsetMs: 0, group: 0, eventIndex: 0 },
      { id: 'b', midi: 60, onsetMs: 300, group: 1, eventIndex: 1 },
    ];
    // Windows are 75 ms (a quarter of the 300 ms gap); 250 is 50 ms from b.
    const r = evaluateTimed(two, [{ note: 60, t: 250 }], timedConfig(300));
    expect(r.targets.map((t) => t.kind)).toEqual(['missed', 'matched']);
  });

  it('flags chords whose attacks spread too far', () => {
    const chord = [60, 64, 67].map((m, i) => ({ id: `${i}`, midi: m, onsetMs: 0, group: 0, eventIndex: 0 }));
    const r = evaluateTimed(
      chord,
      [
        { note: 60, t: -100 },
        { note: 64, t: 0 },
        { note: 67, t: 150 },
      ],
      timedConfig(1000),
    );
    expect(r.summary.matched).toBe(3);
    expect(r.spreadGroups).toEqual([0]);
  });

  it('leaves open windows pending during live evaluation', () => {
    const r = evaluateTimed(arp, perfect.slice(0, 2), timedConfig(1000), 1500);
    expect(r.targets[2].kind).toBe('pending');
    expect(r.targets[0].kind).toBe('matched');
  });

  it('early and late errors do not cancel in the summary', () => {
    const played = arp.map((t, i) => ({ note: t.midi, t: t.onsetMs + (i % 2 ? 100 : -100) }));
    const r = evaluateTimed(arp, played, timedConfig(1000));
    expect(r.summary.medianAbsErrorMs).toBe(100);
    expect(describeTimed(r.summary)).toContain('7 of 7 notes on time');
  });
});

describe('progression heuristics', () => {
  const seg = (matched: number, over: Partial<SegmentEvidence> = {}): SegmentEvidence => ({
    settingsKey: 'k',
    complete: true,
    assisted: false,
    interrupted: false,
    summary: {
      expected: 20,
      matched,
      timingMisses: 0,
      wrongPitches: 0,
      missed: 20 - matched,
      extras: 0,
      medianAbsErrorMs: 30,
      meanSignedErrorMs: 0,
    },
    ...over,
  });
  it('offers +2 BPM after two qualifying attempts at the same settings', () => {
    expect(tempoIncreaseOffered([seg(19), seg(20)])).toBe(true);
    expect(tempoIncreaseOffered([seg(18), seg(20)])).toBe(false);
    expect(tempoIncreaseOffered([seg(20), seg(20, { interrupted: true })])).toBe(false);
    expect(tempoIncreaseOffered([seg(20, { settingsKey: 'other' }), seg(20)])).toBe(false);
    expect(tempoIncreaseOffered([seg(20), seg(20, { summary: { ...seg(20).summary, extras: 1 } })])).toBe(false);
  });
  it('requires two passing checks on different days', () => {
    expect(demonstratedUntimed([{ date: '2026-10-01', total: 10, independent: 9 }])).toBe(false);
    expect(
      demonstratedUntimed([
        { date: '2026-10-01', total: 10, independent: 9 },
        { date: '2026-10-01', total: 10, independent: 10 },
      ]),
    ).toBe(false);
    expect(
      demonstratedUntimed([
        { date: '2026-10-01', total: 10, independent: 9 },
        { date: '2026-10-02', total: 10, independent: 9 },
      ]),
    ).toBe(true);
  });
  it('levels up only across fresh examples and days', () => {
    expect(
      levelUpOffered([
        { patternId: 'a', date: '1', qualified: true },
        { patternId: 'a', date: '2', qualified: true },
      ]),
    ).toBe(false);
    expect(
      levelUpOffered([
        { patternId: 'a', date: '1', qualified: true },
        { patternId: 'b', date: '2', qualified: true },
      ]),
    ).toBe(true);
  });
});
