import { type Accidental, type Letter, type Spelled, diatonicIndex } from './pitch';
import { type Key, keySignature, signatureAccidental } from './keys';
import type { Staff } from './score';

// Staff position = diatonic steps above the bottom line (0 = bottom line,
// 1 = first space, 8 = top line). Treble bottom line is E4, bass is G2.
const BOTTOM_LINE: Record<Staff, number> = {
  treble: diatonicIndex({ letter: 'E', acc: 0, octave: 4 }),
  bass: diatonicIndex({ letter: 'G', acc: 0, octave: 2 }),
};

export function staffPosition(note: Spelled, staff: Staff): number {
  return diatonicIndex(note) - BOTTOM_LINE[staff];
}

/** Ledger-line positions (even positions outside 0..8) needed for a note. */
export function ledgerLines(position: number): number[] {
  const out: number[] = [];
  for (let p = -2; p >= position; p -= 2) out.push(p);
  for (let p = 10; p <= position; p += 2) out.push(p);
  return out;
}

// Conventional key-signature placements.
const SHARP_POS: Record<Staff, Record<Letter, number>> = {
  treble: { F: 8, C: 5, G: 9, D: 6, A: 3, E: 7, B: 4 },
  bass: { F: 6, C: 3, G: 7, D: 4, A: 1, E: 5, B: 2 },
};
const FLAT_POS: Record<Staff, Record<Letter, number>> = {
  treble: { B: 4, E: 7, A: 3, D: 6, G: 2, C: 5, F: 1 },
  bass: { B: 2, E: 5, A: 1, D: 4, G: 0, C: 3, F: -1 },
};

export function keySignaturePositions(key: Key, staff: Staff): { acc: Accidental; position: number }[] {
  return keySignature(key).map((p) => ({
    acc: p.acc,
    position: p.acc > 0 ? SHARP_POS[staff][p.letter] : FLAT_POS[staff][p.letter],
  }));
}

/**
 * The accidental glyph to print for each note in reading order (null = none).
 * The key signature applies to every octave; a printed accidental lasts to the
 * end of its bar for that staff line (letter + octave), as in standard notation.
 * `barStarts` are the event indices where a new bar begins.
 */
export function displayedAccidentals(
  events: { notes: Spelled[]; staves?: Staff[] }[],
  key: Key,
  barStarts: Set<number>,
): (Accidental | null)[][] {
  let active = new Map<string, Accidental>();
  return events.map((e, i) => {
    if (barStarts.has(i)) active = new Map();
    return e.notes.map((n) => {
      const slot = `${n.letter}${n.octave}`;
      const current = active.get(slot) ?? signatureAccidental(key, n.letter);
      if (current === n.acc) return null;
      active.set(slot, n.acc);
      return n.acc;
    });
  });
}

/** Event indices at which each bar starts, given durations in beats. */
export function barStartIndices(beats: number[], beatsPerBar: number): Set<number> {
  const out = new Set<number>([0]);
  let t = 0;
  beats.forEach((b, i) => {
    if (i > 0 && Math.abs(t % beatsPerBar) < 1e-9) out.add(i);
    t += b;
  });
  return out;
}
