import {
  type PitchName,
  type Spelled,
  defaultSpelling,
  diatonicIndex,
  midiOf,
  mod,
  pitchClass,
  pitchClassOf,
  pitchNameText,
  spellWithLetter,
  transposeSpelled,
} from './pitch';
import { type Key, type ScaleVariant, degreeNote, prefersFlats, scalePitchNames, scaleVariantFor } from './keys';

export type TriadQuality = 'major' | 'minor' | 'diminished' | 'augmented';
/** 0 = root position, 1 = first inversion (third in the bass), 2 = second inversion. */
export type Inversion = 0 | 1 | 2;

// [third, fifth] above the root in semitones.
const QUALITY_SEMIS: Record<TriadQuality, [number, number]> = {
  major: [4, 7],
  minor: [3, 7],
  diminished: [3, 6],
  augmented: [4, 8],
};

export const INVERSION_NAMES = ['root position', 'first inversion', 'second inversion'] as const;
export const CHORD_TONE_NAMES = ['root', 'third', 'fifth'] as const;

export interface Triad {
  root: PitchName;
  quality: TriadQuality;
}

/** Root, third, fifth spelled with stacked letters (C minor -> C, E-flat, G). */
export function triadPitchNames(t: Triad): PitchName[] {
  const root: Spelled = { ...t.root, octave: 4 };
  const [third, fifth] = QUALITY_SEMIS[t.quality];
  return [root, transposeSpelled(root, 2, third), transposeSpelled(root, 4, fifth)].map(({ letter, acc }) => ({
    letter,
    acc,
  }));
}

export function triadPitchClasses(t: Triad): number[] {
  return triadPitchNames(t).map(pitchClassOf);
}

export function triadName(t: Triad): string {
  return `${pitchNameText(t.root)} ${t.quality}`;
}

/** Short chord symbol: C, Cm, Bdim, Caug. */
export function triadSymbol(t: Triad): string {
  const suffix = { major: '', minor: 'm', diminished: 'dim', augmented: 'aug' }[t.quality];
  return pitchNameText(t.root) + suffix;
}

/**
 * A close-position voicing as written notes, ascending, starting with the bass
 * note chosen by the inversion. `bassOctave` is the octave of the lowest note.
 */
export function voiceTriad(t: Triad, inversion: Inversion, bassOctave: number): Spelled[] {
  const names = triadPitchNames(t);
  const order = [names[inversion], names[(inversion + 1) % 3], names[(inversion + 2) % 3]];
  const out: Spelled[] = [];
  let prevIdx = -Infinity;
  for (const n of order) {
    let s: Spelled = { ...n, octave: bassOctave };
    if (out.length === 0) {
      out.push(s);
      prevIdx = diatonicIndex(s);
      continue;
    }
    while (diatonicIndex(s) <= prevIdx) s = { ...s, octave: s.octave + 1 };
    out.push(s);
    prevIdx = diatonicIndex(s);
  }
  return out;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** The diatonic triad on a scale degree (1-7). V in a minor key uses harmonic minor. */
export function diatonicTriad(key: Key, degree: number): Triad {
  const variant: ScaleVariant = key.tonality === 'minor' && degree === 5 ? 'harmonic-minor' : scaleVariantFor(key);
  const names = scalePitchNames(key, variant);
  const root = names[mod(degree - 1, 7)];
  const third = names[mod(degree + 1, 7)];
  const fifth = names[mod(degree + 3, 7)];
  const r = pitchClassOf(root);
  const q3 = mod(pitchClassOf(third) - r, 12);
  const q5 = mod(pitchClassOf(fifth) - r, 12);
  const quality: TriadQuality =
    q3 === 4 && q5 === 7 ? 'major' : q3 === 3 && q5 === 7 ? 'minor' : q3 === 3 ? 'diminished' : 'augmented';
  return { root, quality };
}

/** Roman numeral with case for quality: I, ii, vii°, V. */
export function romanNumeral(degree: number, quality: TriadQuality): string {
  const base = ROMAN[mod(degree - 1, 7)];
  if (quality === 'major') return base;
  if (quality === 'minor') return base.toLowerCase();
  if (quality === 'diminished') return base.toLowerCase() + '°';
  return base + '+';
}

/**
 * Chord progression voiced with minimal movement from one chord to the next
 * (common tones kept where possible). The first chord uses the given voicing.
 */
export function voiceProgression(key: Key, degrees: number[], firstBassOctave: number): Spelled[][] {
  const chords: Spelled[][] = [];
  for (const degree of degrees) {
    const triad = diatonicTriad(key, degree);
    if (chords.length === 0) {
      chords.push(voiceTriad(triad, 0, firstBassOctave));
      continue;
    }
    const prev = chords[chords.length - 1].map(midiOf);
    let best: Spelled[] | null = null;
    let bestCost = Infinity;
    for (const inv of [0, 1, 2] as Inversion[]) {
      for (const oct of [firstBassOctave - 1, firstBassOctave, firstBassOctave + 1]) {
        const v = voiceTriad(triad, inv, oct);
        const m = v.map(midiOf);
        const cost = m.reduce((acc, n, i) => acc + Math.abs(n - prev[i]), 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = v;
        }
      }
    }
    chords.push(best!);
  }
  return chords;
}

export interface ChordCandidate {
  triad: Triad;
  inversion: Inversion | null; // null when the bass is not a chord tone (not possible for complete triads)
  /** Which chord tone each played pitch class is: 0 root, 1 third, 2 fifth. */
  roles: Map<number, number>;
  roman?: string;
}

export interface Identification {
  /** Played notes, lowest first, spelled for display. */
  notes: Spelled[];
  candidates: ChordCandidate[];
  /** For two distinct pitch classes. */
  interval?: { semitones: number };
}

const ROOT_SPELL_FLAT = new Set([1, 3, 8, 10]); // Db Eb Ab Bb read better than C# D# G# A# as roots

/**
 * Explanatory free-play identification. Only complete triads (three pitch
 * classes, doubling allowed) get chord names; ambiguous sets list every
 * reading, and anything else is shown as notes without an invented name.
 */
export function identifyChord(midis: number[], keyContext?: Key): Identification {
  const sorted = [...new Set(midis)].sort((a, b) => a - b);
  const flats = keyContext ? prefersFlats(keyContext) : false;
  const notes = sorted.map((m) => spellInContext(m, keyContext, flats));
  const pcs = [...new Set(sorted.map(pitchClass))];
  const result: Identification = { notes, candidates: [] };
  if (pcs.length === 2) {
    result.interval = { semitones: sorted[sorted.length - 1] - sorted[0] };
  }
  if (pcs.length !== 3) return result;
  const bassPc = pitchClass(sorted[0]);
  for (const rootPc of pcs) {
    const rel = pcs.map((pc) => mod(pc - rootPc, 12)).sort((a, b) => a - b);
    for (const [quality, [third, fifth]] of Object.entries(QUALITY_SEMIS) as [TriadQuality, [number, number]][]) {
      if (rel[0] === 0 && rel[1] === third && rel[2] === fifth) {
        const root = rootName(rootPc, keyContext, flats);
        const triad: Triad = { root, quality };
        const roles = new Map<number, number>();
        roles.set(rootPc, 0);
        roles.set(mod(rootPc + third, 12), 1);
        roles.set(mod(rootPc + fifth, 12), 2);
        const inversion = (roles.get(bassPc) ?? null) as Inversion | null;
        const cand: ChordCandidate = { triad, inversion, roles };
        if (keyContext) {
          const names = scalePitchNames(keyContext, scaleVariantFor(keyContext, true));
          const degree = names.findIndex((n) => pitchClassOf(n) === rootPc);
          if (degree >= 0) {
            const dt = diatonicTriad(keyContext, degree + 1);
            if (dt.quality === quality) cand.roman = romanNumeral(degree + 1, quality);
          }
        }
        result.candidates.push(cand);
      }
    }
  }
  // A diatonic reading in the chosen key comes first.
  result.candidates.sort((a, b) => Number(!!b.roman) - Number(!!a.roman));
  return result;
}

function rootName(pc: number, key: Key | undefined, flats: boolean): PitchName {
  if (key) {
    const inKey = scalePitchNames(key, scaleVariantFor(key, true)).find((n) => pitchClassOf(n) === pc);
    if (inKey) return inKey;
  }
  const s = defaultSpelling(pc + 60, flats || ROOT_SPELL_FLAT.has(pc));
  return { letter: s.letter, acc: s.acc };
}

/** Spell a played note using the key's scale letters when it belongs to the key. */
export function spellInContext(midi: number, key: Key | undefined, flats = false): Spelled {
  if (key) {
    const inKey = scalePitchNames(key, scaleVariantFor(key, true)).find((n) => pitchClassOf(n) === pitchClass(midi));
    if (inKey) {
      const s = spellWithLetter(midi, inKey.letter);
      if (s) return s;
    }
  }
  return defaultSpelling(midi, flats);
}

/** Tonic triad for a key: C major -> C-E-G, A minor -> A-C-E. */
export function tonicTriad(key: Key): Triad {
  return { root: key.tonic, quality: key.tonality === 'major' ? 'major' : 'minor' };
}

/** Degree note helper re-exported for pattern code. */
export { degreeNote };
