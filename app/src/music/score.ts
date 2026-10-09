import type { Spelled } from './pitch';
import { midiOf } from './pitch';
import type { Key } from './keys';

/** Instructional only: MIDI cannot verify which hand or finger played a note. */
export type Hand = 'right' | 'left' | 'both' | 'alternate';
export type Staff = 'treble' | 'bass';

/** One written event: a note, a chord, or a rest (no notes). Durations are in beats. */
export interface ScoreEvent {
  notes: Spelled[];
  beats: number;
  /** Suggested finger per note (1-5) or null; never scored. */
  fingers?: (number | null)[];
  /** Explicit staff for each note on a grand staff; otherwise chosen by pitch. */
  staves?: Staff[];
}

export interface Phrase {
  /** Stable pattern id used as part of tempo-history keys. */
  patternId: string;
  title: string;
  key: Key;
  events: ScoreEvent[];
  beatsPerBar: number;
  hand: Hand;
  /** Notes about the fingering provenance, shown with the annotations. */
  fingeringNote?: string;
}

export function noteEvent(notes: Spelled[], beats = 1, fingers?: (number | null)[], staves?: Staff[]): ScoreEvent {
  return { notes, beats, fingers, staves };
}

export function rest(beats = 1): ScoreEvent {
  return { notes: [], beats };
}

export function totalBeats(p: Phrase): number {
  return p.events.reduce((a, e) => a + e.beats, 0);
}

/** Onset beat (from phrase start) for each event. */
export function onsetBeats(p: Phrase): number[] {
  const out: number[] = [];
  let t = 0;
  for (const e of p.events) {
    out.push(t);
    t += e.beats;
  }
  return out;
}

export function phraseMidiRange(p: Phrase): { low: number; high: number } | null {
  const all = p.events.flatMap((e) => e.notes.map(midiOf));
  if (all.length === 0) return null;
  return { low: Math.min(...all), high: Math.max(...all) };
}

/** Choose the staff for a note on a grand staff when not authored explicitly. */
export function staffFor(note: Spelled, explicit?: Staff): Staff {
  if (explicit) return explicit;
  return midiOf(note) >= 60 ? 'treble' : 'bass';
}
