import { type Spelled, diatonicIndex, midiOf } from './pitch';

const NUMBER_WORDS = ['unison', '2nd', '3rd', '4th', '5th', '6th', '7th', 'octave'];

// Semitone size of the perfect/major form of each simple interval number (0-based).
const MAJOR_OR_PERFECT = [0, 2, 4, 5, 7, 9, 11, 12];
const PERFECT = new Set([0, 3, 4, 7]);

/**
 * Spelled interval name, e.g. C4->E4 "major 3rd", C4->Eb4 "minor 3rd",
 * C4->D#4 "augmented 2nd". Compound intervals reduce to simple + octaves.
 */
export function intervalName(a: Spelled, b: Spelled): string {
  let [lo, hi] = midiOf(a) <= midiOf(b) ? [a, b] : [b, a];
  if (midiOf(lo) === midiOf(hi) && diatonicIndex(lo) > diatonicIndex(hi)) [lo, hi] = [hi, lo];
  const steps = diatonicIndex(hi) - diatonicIndex(lo);
  const semis = midiOf(hi) - midiOf(lo);
  // An octave (7 steps) stays simple; a 9th is a 2nd + 1 octave.
  const octaves = steps <= 7 ? 0 : Math.floor((steps - 1) / 7);
  const simpleSteps = steps - octaves * 7;
  const simpleSemis = semis - octaves * 12;
  const base = MAJOR_OR_PERFECT[simpleSteps];
  const diff = simpleSemis - base;
  let quality: string;
  if (PERFECT.has(simpleSteps)) {
    quality = diff === 0 ? 'perfect' : diff > 0 ? 'augmented' : 'diminished';
  } else {
    quality = diff === 0 ? 'major' : diff === -1 ? 'minor' : diff > 0 ? 'augmented' : 'diminished';
  }
  const name = simpleSteps === 0 && quality === 'perfect' ? 'unison' : `${quality} ${NUMBER_WORDS[simpleSteps]}`;
  return octaves > 0 ? `${name} + ${octaves} octave${octaves > 1 ? 's' : ''}` : name;
}

const SEMITONE_NAMES = [
  'unison',
  'semitone (minor 2nd)',
  'tone (major 2nd)',
  'minor 3rd',
  'major 3rd',
  'perfect 4th',
  'tritone',
  'perfect 5th',
  'minor 6th',
  'major 6th',
  'minor 7th',
  'major 7th',
  'octave',
];

/** Size-only name for an unspelled distance (free play has no spelling). */
export function semitoneName(semis: number): string {
  const s = Math.abs(semis);
  if (s <= 12) return SEMITONE_NAMES[s];
  const oct = Math.floor(s / 12);
  const rest = s % 12;
  return rest === 0 ? `${oct} octaves` : `${SEMITONE_NAMES[rest]} + ${oct} octave${oct > 1 ? 's' : ''}`;
}
