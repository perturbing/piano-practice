// Written pitch spelling vs sounding MIDI pitch. The two are stored separately
// everywhere: C-sharp and D-flat share a key, but they are different answers to a
// spelling question. Scientific pitch notation: middle C = C4 = MIDI 60.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
export type Letter = (typeof LETTERS)[number];

// Semitones above C for each natural letter.
const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** -2 = double flat, -1 = flat, 0 = natural, 1 = sharp, 2 = double sharp. */
export type Accidental = -2 | -1 | 0 | 1 | 2;

/** A pitch name without octave, e.g. F-sharp or B-flat. */
export interface PitchName {
  letter: Letter;
  acc: Accidental;
}

/** A written note: pitch name plus octave. */
export interface Spelled extends PitchName {
  octave: number;
}

export function letterIndex(letter: Letter): number {
  return LETTERS.indexOf(letter);
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function pitchClassOf(p: PitchName): number {
  return mod(LETTER_PC[p.letter] + p.acc, 12);
}

/**
 * Sounding MIDI number. The octave belongs to the letter, so B-sharp-3 sounds as
 * C4 (60) and C-flat-4 sounds as B3 (59).
 */
export function midiOf(s: Spelled): number {
  return (s.octave + 1) * 12 + LETTER_PC[s.letter] + s.acc;
}

export function pitchClass(midi: number): number {
  return mod(midi, 12);
}

/** Diatonic step index (C4 = 28): used for staff positions and interval numbers. */
export function diatonicIndex(s: Spelled): number {
  return s.octave * 7 + letterIndex(s.letter);
}

export function fromDiatonicIndex(index: number, acc: Accidental = 0): Spelled {
  return { letter: LETTERS[mod(index, 7)], acc, octave: Math.floor(index / 7) };
}

const ACC_TEXT: Record<Accidental, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' };
const ACC_WORD: Record<Accidental, string> = {
  [-2]: '-double-flat',
  [-1]: '-flat',
  0: '',
  1: '-sharp',
  2: '-double-sharp',
};

export function accidentalSymbol(acc: Accidental): string {
  return ACC_TEXT[acc];
}

/** "F♯" */
export function pitchNameText(p: PitchName): string {
  return p.letter + ACC_TEXT[p.acc];
}

/** "F♯4" */
export function spelledText(s: Spelled): string {
  return pitchNameText(s) + s.octave;
}

/** "F-sharp" — used in sentences, where symbols are easy to misread. */
export function pitchNameWords(p: PitchName): string {
  return p.letter + ACC_WORD[p.acc];
}

const SHARP_NAMES: PitchName[] = [
  { letter: 'C', acc: 0 },
  { letter: 'C', acc: 1 },
  { letter: 'D', acc: 0 },
  { letter: 'D', acc: 1 },
  { letter: 'E', acc: 0 },
  { letter: 'F', acc: 0 },
  { letter: 'F', acc: 1 },
  { letter: 'G', acc: 0 },
  { letter: 'G', acc: 1 },
  { letter: 'A', acc: 0 },
  { letter: 'A', acc: 1 },
  { letter: 'B', acc: 0 },
];
const FLAT_NAMES: PitchName[] = [
  { letter: 'C', acc: 0 },
  { letter: 'D', acc: -1 },
  { letter: 'D', acc: 0 },
  { letter: 'E', acc: -1 },
  { letter: 'E', acc: 0 },
  { letter: 'F', acc: 0 },
  { letter: 'G', acc: -1 },
  { letter: 'G', acc: 0 },
  { letter: 'A', acc: -1 },
  { letter: 'A', acc: 0 },
  { letter: 'B', acc: -1 },
  { letter: 'B', acc: 0 },
];

/**
 * A default spelling for a played MIDI note when no musical context exists
 * (e.g. free play). MIDI alone cannot reveal which name the player intended.
 */
export function defaultSpelling(midi: number, preferFlats = false): Spelled {
  const name = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass(midi)];
  return { ...name, octave: Math.floor(midi / 12) - 1 };
}

/** Spell a MIDI note with a chosen letter (used to keep key-appropriate names). */
export function spellWithLetter(midi: number, letter: Letter): Spelled | null {
  for (const octave of [Math.floor(midi / 12) - 2, Math.floor(midi / 12) - 1, Math.floor(midi / 12)]) {
    const acc = midi - ((octave + 1) * 12 + LETTER_PC[letter]);
    if (acc >= -2 && acc <= 2) return { letter, acc: acc as Accidental, octave };
  }
  return null;
}

export function midiText(midi: number, preferFlats = false): string {
  return spelledText(defaultSpelling(midi, preferFlats));
}

/** Parse "C4", "F#3", "Bb2", "E♭5". Returns null if invalid. */
export function parseSpelled(text: string): Spelled | null {
  const m = /^([A-Ga-g])(##|bb|#|b|♯|♭|𝄪|𝄫)?(-?\d+)$/.exec(text.trim());
  if (!m) return null;
  const accMap: Record<string, Accidental> = { '#': 1, '♯': 1, '##': 2, '𝄪': 2, b: -1, '♭': -1, bb: -2, '𝄫': -2 };
  return {
    letter: m[1].toUpperCase() as Letter,
    acc: m[2] ? accMap[m[2]] : 0,
    octave: Number(m[3]),
  };
}

/** Parse "C", "F#", "Bb" (no octave). */
export function parsePitchName(text: string): PitchName | null {
  const s = parseSpelled(text + '4');
  return s ? { letter: s.letter, acc: s.acc } : null;
}

export function samePitchName(a: PitchName, b: PitchName): boolean {
  return a.letter === b.letter && a.acc === b.acc;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(midi));
}

/** Transpose a spelled note diatonically by `steps` letters and `semis` semitones. */
export function transposeSpelled(s: Spelled, steps: number, semis: number): Spelled {
  const target = fromDiatonicIndex(diatonicIndex(s) + steps);
  const acc = midiOf(s) + semis - midiOf(target);
  if (acc < -2 || acc > 2) throw new Error(`Cannot spell ${spelledText(s)} + (${steps}, ${semis})`);
  return { ...target, acc: acc as Accidental };
}
