import {
  type Accidental,
  type Letter,
  type PitchName,
  type Spelled,
  LETTERS,
  diatonicIndex,
  fromDiatonicIndex,
  letterIndex,
  midiOf,
  mod,
  parsePitchName,
  pitchClassOf,
  pitchNameText,
} from './pitch';

export type Tonality = 'major' | 'minor';

export interface Key {
  tonic: PitchName;
  tonality: Tonality;
}

/** Natural minor is the default minor scale; harmonic minor raises the 7th. */
export type ScaleVariant = 'major' | 'natural-minor' | 'harmonic-minor';

const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR_STEPS = [0, 2, 3, 5, 7, 8, 11];

// Position on the circle of fifths for a natural letter (C = 0).
const LETTER_FIFTHS: Record<Letter, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

export function fifthsOf(p: PitchName): number {
  return LETTER_FIFTHS[p.letter] + 7 * p.acc;
}

/** Number of sharps (positive) or flats (negative) in the key signature. */
export function keySignatureCount(key: Key): number {
  return fifthsOf(key.tonic) - (key.tonality === 'minor' ? 3 : 0);
}

const SHARP_ORDER: Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Key-signature accidentals in written order, e.g. D major -> F#, C#. */
export function keySignature(key: Key): PitchName[] {
  const n = keySignatureCount(key);
  if (n >= 0) return SHARP_ORDER.slice(0, n).map((letter) => ({ letter, acc: 1 as Accidental }));
  return FLAT_ORDER.slice(0, -n).map((letter) => ({ letter, acc: -1 as Accidental }));
}

/** The accidental the key signature applies to a letter. */
export function signatureAccidental(key: Key, letter: Letter): Accidental {
  return keySignature(key).find((p) => p.letter === letter)?.acc ?? 0;
}

/**
 * The 12 tonic roots in musically conventional spellings, with the common
 * enharmonic alternatives at six sharps/flats. Every root is selectable from
 * the first release; the lesson path introduces them gradually.
 */
export const MAJOR_TONICS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
export const MINOR_TONICS = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Eb', 'Bb', 'F', 'C', 'G', 'D'];

export function allKeys(): Key[] {
  return [
    ...MAJOR_TONICS.map((t) => ({ tonic: parsePitchName(t)!, tonality: 'major' as const })),
    ...MINOR_TONICS.map((t) => ({ tonic: parsePitchName(t)!, tonality: 'minor' as const })),
  ];
}

/** Stable id like "C-major", "F#-minor", "Bb-major". */
export function keyId(key: Key): string {
  const acc = key.tonic.acc === 1 ? '#' : key.tonic.acc === -1 ? 'b' : '';
  return `${key.tonic.letter}${acc}-${key.tonality}`;
}

export function parseKeyId(id: string): Key | null {
  const [tonic, tonality] = id.split('-');
  const p = parsePitchName(tonic ?? '');
  if (!p || (tonality !== 'major' && tonality !== 'minor')) return null;
  return { tonic: p, tonality };
}

export function keyName(key: Key): string {
  return `${pitchNameText(key.tonic)} ${key.tonality}`;
}

export const C_MAJOR: Key = { tonic: { letter: 'C', acc: 0 }, tonality: 'major' };

export function scaleVariantFor(key: Key, harmonic = false): ScaleVariant {
  if (key.tonality === 'major') return 'major';
  return harmonic ? 'harmonic-minor' : 'natural-minor';
}

function stepsFor(variant: ScaleVariant): number[] {
  return variant === 'major' ? MAJOR_STEPS : variant === 'natural-minor' ? NATURAL_MINOR_STEPS : HARMONIC_MINOR_STEPS;
}

/**
 * The seven scale-degree pitch names, spelled with one letter per degree so
 * D major contains F-sharp (never G-flat) and C minor contains E-flat.
 */
export function scalePitchNames(key: Key, variant: ScaleVariant = scaleVariantFor(key)): PitchName[] {
  const steps = stepsFor(variant);
  const tonicPc = pitchClassOf(key.tonic);
  const start = letterIndex(key.tonic.letter);
  return steps.map((semis, degree) => {
    const letter = LETTERS[(start + degree) % 7];
    const natural = pitchClassOf({ letter, acc: 0 });
    let acc = mod(tonicPc + semis - natural, 12);
    if (acc > 6) acc -= 12;
    return { letter, acc: acc as Accidental };
  });
}

/**
 * A spelled note for a scale degree (1-based, may exceed 7 or go below 1) with
 * the tonic placed at `tonicOctave`.
 */
export function degreeNote(
  key: Key,
  degree: number,
  tonicOctave: number,
  variant: ScaleVariant = scaleVariantFor(key),
): Spelled {
  const names = scalePitchNames(key, variant);
  const zeroBased = degree - 1;
  const name = names[mod(zeroBased, 7)];
  const tonicIdx = diatonicIndex({ ...key.tonic, octave: tonicOctave });
  const idx = tonicIdx + zeroBased;
  return { ...fromDiatonicIndex(idx), acc: name.acc };
}

/** Whether to show flats when spelling free-played notes in this key context. */
export function prefersFlats(key: Key): boolean {
  return keySignatureCount(key) < 0;
}

/** Clockwise circle-of-fifths order: C G D A E B F#/Gb Db Ab Eb Bb F (majors before minors). */
export function circleOfFifthsOrder(keys: Key[]): Key[] {
  const pos = (k: Key) => mod(keySignatureCount(k), 12) + (k.tonality === 'minor' ? 12 : 0);
  return [...keys].sort((a, b) => pos(a) - pos(b));
}

export function tonicMidi(key: Key, octave: number): number {
  return midiOf({ ...key.tonic, octave });
}
