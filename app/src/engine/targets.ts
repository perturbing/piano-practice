import type { Spelled } from '../music/pitch';
import { midiOf } from '../music/pitch';
import type { Phrase } from '../music/score';

/**
 * How a guided item is judged. Authored definitions resolve ambiguity; there is
 * no universal chord checker.
 *  - exact: the written pitches including octave; no other held keys
 *  - pitchClass: a named note in any octave ("find any C")
 *  - chordName: chord pitch classes in an allowed range; optional bass for an
 *    inversion; doubling only when enabled
 */
export type MatchPolicy =
  | { kind: 'exact' }
  | { kind: 'pitchClass' }
  | {
      kind: 'chordName';
      pcs: number[];
      bassPc?: number;
      allowDoubling: boolean;
      low: number;
      high: number;
    };

export interface GuidedItem {
  id: string;
  /** Written target notes (spelling kept separate from MIDI). */
  notes: Spelled[];
  midis: number[];
  policy: MatchPolicy;
  /** Text prompt for items not read from the staff ("Build C minor"). */
  prompt?: string;
  /** Index of the phrase event this item comes from, for sequence display. */
  eventIndex?: number;
  /** Which phrase (key segment) of the exercise the item belongs to. */
  phraseIndex?: number;
  /** Notes drawn for an item shown on its own: staff events plus the item's position. */
  display?: { events: Spelled[][]; cursor: number };
  clef?: 'treble' | 'bass';
  /** Audible prompt (listening tasks): MIDI notes played when the item starts. */
  audio?: number[];
  /** Conceptual answers given with buttons instead of MIDI. */
  choices?: { label: string; correct: boolean }[];
}

export function exactItem(id: string, notes: Spelled[], eventIndex?: number): GuidedItem {
  return { id, notes, midis: notes.map(midiOf), policy: { kind: 'exact' }, eventIndex };
}

/** Guided items for every sounding event of a phrase (rests are skipped). */
export function itemsFromPhrase(phrase: Phrase, idPrefix = 'n'): GuidedItem[] {
  const out: GuidedItem[] = [];
  phrase.events.forEach((e, i) => {
    if (e.notes.length > 0) out.push(exactItem(`${idPrefix}${i}`, e.notes, i));
  });
  return out;
}

export interface TimedTarget {
  id: string;
  midi: number;
  /** Onset relative to the segment's first beat, in ms. */
  onsetMs: number;
  /** Targets sharing an onset form one chord group. */
  group: number;
  eventIndex: number;
}

/** Expand a phrase into timed targets at a tempo. */
export function timedTargetsFromPhrase(phrase: Phrase, beatMs: number): TimedTarget[] {
  const out: TimedTarget[] = [];
  let beat = 0;
  phrase.events.forEach((e, i) => {
    e.notes.forEach((n, j) => out.push({ id: `t${i}.${j}`, midi: midiOf(n), onsetMs: beat * beatMs, group: i, eventIndex: i }));
    beat += e.beats;
  });
  return out;
}
