import { describe, expect, it } from 'vitest';
import { FAMILIES, familyById, resolveKeys } from './practiceFamilies';
import { exerciseRange, fitsRange } from '../engine/exercise';
import { MAJOR_TONICS, MINOR_TONICS, keyId } from '../music/keys';
import { spelledText } from '../music/pitch';
import { Attempt } from '../data/schema';
import { LESSONS, lessonById } from './lessons';

const ctx = { seed: 1234, range: { low: 36, high: 96 } };

describe('practice families', () => {
  it('every family builds runnable content from its defaults', () => {
    for (const f of FAMILIES) {
      const spec = f.build(f.defaults, ctx);
      const units = spec.mode === 'timed' ? spec.phrases.length : spec.items.length;
      expect(units, f.id).toBeGreaterThan(0);
      expect(fitsRange(spec, ctx.range), f.id).toBe(true);
      if (spec.mode === 'timed') expect(spec.bpm, f.id).toBeGreaterThan(0);
    }
  });

  it('pattern families support all 12 roots in both tonalities', () => {
    const keys = [...MAJOR_TONICS.map((t) => `${t}-major`), ...MINOR_TONICS.map((t) => `${t}-minor`)];
    for (const id of ['scales', 'arpeggios', 'progressions'] as const) {
      const f = familyById(id)!;
      for (const k of keys) {
        const spec = f.build({ ...f.defaults, keys: [k] }, ctx);
        expect(spec.phrases[0].events.some((e) => e.notes.length > 0), `${id} ${k}`).toBe(true);
      }
    }
  });

  it('switching key updates the written notes: D major has F-sharp, C minor has E-flat', () => {
    const f = familyById('arpeggios')!;
    const d = f.build({ ...f.defaults, keys: ['D-major'] }, ctx);
    expect(d.phrases[0].events.flatMap((e) => e.notes.map(spelledText))).toContain('F♯4');
    const c = f.build({ ...f.defaults, keys: ['C-minor'] }, ctx);
    expect(c.phrases[0].events.flatMap((e) => e.notes.map(spelledText))).toContain('E♭4');
  });

  it('key rotation keeps one phrase per key in the chosen order', () => {
    const f = familyById('scales')!;
    const p = { ...f.defaults, keys: ['F-major', 'C-major', 'G-major'], keyOrder: 'circle' };
    expect(resolveKeys(p, 1).map(keyId)).toEqual(['C-major', 'G-major', 'F-major']);
    const spec = f.build(p, ctx);
    expect(spec.phrases.map((ph) => keyId(ph.key))).toEqual(['C-major', 'G-major', 'F-major']);
    expect(spec.settings.resolvedKeyOrder).toBe('C-major,G-major,F-major');
  });

  it('generated content is reproducible from the seed', () => {
    const f = familyById('noteReading')!;
    expect(f.build(f.defaults, ctx)).toEqual(f.build(f.defaults, ctx));
  });

  it('chord building uses chord-name matching with an optional required bass', () => {
    const f = familyById('chordBuilding')!;
    const spec = f.build({ ...f.defaults, inversion: 'mixed' }, ctx);
    for (const it of spec.items) {
      expect(it.policy.kind).toBe('chordName');
      expect(it.prompt).toMatch(/^Build /);
    }
  });

  it('detects exercises that do not fit a small keyboard', () => {
    const f = familyById('scales')!;
    const spec = f.build({ ...f.defaults, octaves: '2', keys: ['B-major'] }, ctx);
    expect(exerciseRange(spec)!.high).toBeGreaterThan(84);
    expect(fitsRange(spec, { low: 48, high: 84 })).toBe(false);
  });

  it('resolved items fit the attempt schema', () => {
    for (const f of FAMILIES) {
      const spec = f.build(f.defaults, ctx);
      const items = Attempt.shape.items.parse(spec.items);
      expect(items?.length).toBe(spec.items.length);
    }
  });
});

describe('lessons', () => {
  it('every lesson follows the five-step sequence and its checks build', () => {
    for (const l of LESSONS) {
      expect(l.steps.map((s) => s.kind), l.id).toEqual(['understand', 'observe', 'try', 'recall', 'apply']);
      for (const p of l.prereqs) expect(lessonById(p), `${l.id} prereq ${p}`).toBeTruthy();
      for (const step of l.steps) {
        if (!step.exercise) continue;
        const spec = step.exercise(ctx);
        expect(spec.kind).toBe('lesson');
        expect(spec.sourceId).toBe(`${l.id}:${step.kind}`);
        expect(fitsRange(spec, ctx.range), `${l.id}:${step.kind}`).toBe(true);
        // Only Try with help reveals keys; recall/apply checks never highlight.
        expect(spec.highlighted, `${l.id}:${step.kind}`).toBe(step.kind === 'try' && spec.mode === 'guided');
        if (step.kind !== 'try') expect(spec.demo).toBe(false);
      }
    }
  });
});
