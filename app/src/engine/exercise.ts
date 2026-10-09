import type { Key } from '../music/keys';
import { keyId } from '../music/keys';
import type { Phrase } from '../music/score';
import { midiOf } from '../music/pitch';
import type { AttemptKind, ResolvedPhrase } from '../data/schema';
import type { GuidedItem } from './targets';
import { itemsFromPhrase } from './targets';

export const CONTENT_REVISION = 1;

type Scalar = string | number | boolean | null;

/**
 * A fully resolved exercise: the runner executes it and the attempt stores a
 * snapshot of it (targets, seed, settings, revisions) at start.
 */
export interface ExerciseSpec {
  kind: AttemptKind;
  sourceId: string;
  title: string;
  /** One-line instruction shown above the prompt. */
  instruction: string;
  mode: 'guided' | 'timed';
  /** Primary key (first of a key rotation). */
  key: Key;
  /** Phrases shown with a cursor (sequences) or played in time; one per key segment. */
  phrases: Phrase[];
  /** Guided prompts; for phrase-display exercises they point into `phrases`. */
  items: GuidedItem[];
  display: 'phrase' | 'item';
  /** Target keys highlighted from the start (Try with help) — items count as assisted. */
  highlighted: boolean;
  hints: boolean;
  releaseBetweenItems: boolean;
  showKeyboard: boolean;
  showFingering: boolean;
  /** Timed only. */
  bpm?: number;
  repetitions?: number;
  profile?: 'standard' | 'forgiving';
  settings: Record<string, Scalar>;
  skills: string[];
  seed?: number;
  presetId?: string;
  presetRevision?: number;
  routineDate?: string;
  taskId?: string;
  /** The task can be demonstrated (phrase playback). */
  demo: boolean;
}

export function guidedPhraseSpec(
  base: Omit<ExerciseSpec, 'items' | 'display' | 'mode' | 'releaseBetweenItems' | 'demo'>,
  passes = 1,
): ExerciseSpec {
  const items: GuidedItem[] = [];
  base.phrases.forEach((p, pi) => {
    for (let pass = 0; pass < passes; pass++) {
      for (const it of itemsFromPhrase(p, `k${pi}p${pass}n`)) items.push({ ...it, phraseIndex: pi });
    }
  });
  return { ...base, items, display: 'phrase', mode: 'guided', releaseBetweenItems: false, demo: true };
}

export function timedPhraseSpec(
  base: Omit<ExerciseSpec, 'items' | 'display' | 'mode' | 'releaseBetweenItems' | 'demo'>,
): ExerciseSpec {
  return { ...base, items: [], display: 'phrase', mode: 'timed', releaseBetweenItems: true, demo: true };
}

export function resolvePhrase(p: Phrase): ResolvedPhrase {
  return {
    patternId: p.patternId,
    title: p.title,
    keyId: keyId(p.key),
    hand: p.hand,
    beatsPerBar: p.beatsPerBar,
    events: p.events.map((e) => ({
      notes: e.notes,
      midis: e.notes.map(midiOf),
      beats: e.beats,
      ...(e.fingers ? { fingers: e.fingers } : {}),
      ...(e.staves ? { staves: e.staves } : {}),
    })),
    ...(p.fingeringNote ? { fingeringNote: p.fingeringNote } : {}),
  };
}

/**
 * Lowest and highest written target notes across the whole exercise (chord-name
 * prompts use the example voicing they display).
 */
export function exerciseRange(spec: ExerciseSpec): { low: number; high: number } | null {
  const all = [
    ...spec.phrases.flatMap((p) => p.events.flatMap((e) => e.notes.map(midiOf))),
    ...spec.items.flatMap((i) => i.midis),
  ];
  if (all.length === 0) return null;
  return { low: Math.min(...all), high: Math.max(...all) };
}

/** The exercise must fit the confirmed keyboard range — it is never silently transposed. */
export function fitsRange(spec: ExerciseSpec, range: { low: number; high: number }): boolean {
  const r = exerciseRange(spec);
  return !r || (r.low >= range.low && r.high <= range.high);
}
