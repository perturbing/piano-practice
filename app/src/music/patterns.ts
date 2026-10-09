import { type Key, type ScaleVariant, degreeNote, keyName, scaleVariantFor } from './keys';
import { type Triad, diatonicTriad, romanNumeral, triadName, triadPitchNames, voiceProgression } from './chords';
import { type Spelled, diatonicIndex } from './pitch';
import { type Phrase, type ScoreEvent, type Staff, noteEvent, rest } from './score';
import {
  FINGERING_PROVENANCE,
  arpeggioFingering,
  fivePositionFinger,
  scaleFingering,
} from './fingering';

// Exercise patterns are generated from a musical template and the selected key
// (never from a fixed C-major exercise with relabelled notes). Degrees are
// 1-based scale degrees; null is a rest.

export type OneHand = 'right' | 'left';

export interface PatternOptions {
  key: Key;
  hand: OneHand;
  /** Octave of the tonic; defaults to 4 for the right hand, 3 for the left. */
  octave?: number;
}

export type SkillTrack = 'fingerPatterns' | 'pulse' | 'positionChanges' | 'coordination';
export const SKILL_TRACKS: SkillTrack[] = ['fingerPatterns', 'pulse', 'positionChanges', 'coordination'];
export const MAX_LEVEL = 4;

export const TRACK_LABELS: Record<SkillTrack, string> = {
  fingerPatterns: 'Finger patterns',
  pulse: 'Pulse and evenness',
  positionChanges: 'Position changes',
  coordination: 'Coordination',
};

export const LEVEL_DESCRIPTIONS: Record<SkillTrack, string[]> = {
  fingerPatterns: [
    'Five adjacent notes up and down',
    'Neighbor pairs and short alternations',
    'Skips and reordered patterns',
    'Longer combinations with changes of direction',
  ],
  pulse: [
    'Repeat one note at a comfortable pulse',
    'Alternate two notes evenly',
    'Maintain a specified subdivision through a pattern',
    'Short faster bursts followed by controlled recovery',
  ],
  positionChanges: [
    'Stay in one five-note position',
    'Move to a neighboring position after a rest',
    'Follow a scale passage with suggested crossing fingering',
    'Connect a wider scale pattern',
  ],
  coordination: [
    'Right- and left-hand instructions separately',
    'Alternate the instructed hands',
    'Play a simple matching pattern together',
    'Combine short contrasting rhythmic patterns',
  ],
};

function octaveFor(o: PatternOptions): number {
  return o.octave ?? (o.hand === 'right' ? 4 : 3);
}

function handWord(h: OneHand): string {
  return h === 'right' ? 'RH' : 'LH';
}

/** A single-line pattern from degrees; `beats` per note (eighths = 0.5). */
function degreeLine(
  o: PatternOptions,
  degrees: (number | null)[],
  beats: number | number[],
  fingerFor?: (degree: number, index: number) => number | null,
  variant?: ScaleVariant,
): ScoreEvent[] {
  const oct = octaveFor(o);
  return degrees.map((d, i) => {
    const b = Array.isArray(beats) ? beats[i] : beats;
    if (d === null) return rest(b);
    const note = degreeNote(o.key, d, oct, variant);
    return noteEvent([note], b, fingerFor ? [fingerFor(d, i)] : undefined);
  });
}

/** Pad a phrase so the last note lasts to the end of the bar. */
function fillBar(events: ScoreEvent[], beatsPerBar = 4): ScoreEvent[] {
  const total = events.reduce((a, e) => a + e.beats, 0);
  const rem = (beatsPerBar - (total % beatsPerBar)) % beatsPerBar;
  if (rem === 0) return events;
  const out = [...events];
  const last = out[out.length - 1];
  // Lengthen the final note where it gives a standard value; otherwise add a rest.
  if ([1, 2, 3].includes(last.beats + rem) && last.notes.length > 0) out[out.length - 1] = { ...last, beats: last.beats + rem };
  else out.push(rest(rem));
  return out;
}

const posFinger = (hand: OneHand, start = 1) => (d: number) => fivePositionFinger(d - start, hand);

// ---------------------------------------------------------------------------
// Daily-trainer movement tracks (spec §5 levels table). `example` selects one
// of several equivalent examples so successful patterns rotate with variety.

const FINGER_PATTERNS: number[][][] = [
  [
    [1, 2, 3, 4, 5, 4, 3, 2, 1],
    [5, 4, 3, 2, 1, 2, 3, 4, 5],
  ],
  [
    [1, 2, 1, 2, 2, 3, 2, 3, 3, 4, 3, 4, 4, 5, 4, 5],
    [5, 4, 5, 4, 4, 3, 4, 3, 3, 2, 3, 2, 2, 1, 2, 1],
  ],
  [
    [1, 3, 2, 4, 3, 5, 4, 2, 1],
    [1, 3, 5, 3, 1, 2, 4, 2, 1],
  ],
  [
    [1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 3, 2, 3, 2, 1],
    [5, 4, 3, 4, 3, 2, 3, 2, 1, 2, 3, 4, 5],
  ],
];

export function exampleCount(track: SkillTrack, level: number): number {
  if (track === 'fingerPatterns') return FINGER_PATTERNS[level - 1].length;
  return 2;
}

export function fingerPattern(o: PatternOptions, level: number, example = 0): Phrase {
  const set = FINGER_PATTERNS[level - 1];
  const degrees = set[example % set.length];
  return {
    patternId: `finger-L${level}-${example % set.length}`,
    title: `Finger pattern L${level} · ${handWord(o.hand)}`,
    key: o.key,
    hand: o.hand,
    beatsPerBar: 4,
    events: fillBar(degreeLine(o, degrees, 1, posFinger(o.hand))),
    fingeringNote: FINGERING_PROVENANCE,
  };
}

export function pulsePattern(o: PatternOptions, level: number, example = 0): Phrase {
  const ex = example % 2;
  let events: ScoreEvent[];
  let subdivision = 1;
  switch (level) {
    case 1:
      events = degreeLine(o, Array(8).fill(ex === 0 ? 1 : 5), 1);
      break;
    case 2:
      events = degreeLine(o, ex === 0 ? [1, 2, 1, 2, 1, 2, 1, 2] : [1, 3, 1, 3, 1, 3, 1, 3], 1, posFinger(o.hand));
      break;
    case 3:
      subdivision = 2;
      events = fillBar(
        degreeLine(o, ex === 0 ? [1, 2, 3, 4, 5, 4, 3, 2, 1] : [1, 1, 2, 2, 3, 3, 2, 2, 1], 0.5, posFinger(o.hand)),
      );
      break;
    default:
      subdivision = 2;
      events = degreeLine(
        o,
        ex === 0 ? [1, 2, 1, 2, 3, 2, 1, null] : [3, 2, 1, 2, 3, 4, 5, null],
        [1, 1, 0.5, 0.5, 0.5, 0.5, 1, 3],
        posFinger(o.hand),
      );
  }
  return {
    patternId: `pulse-L${level}-${ex}${subdivision === 2 ? '-e' : ''}`,
    title: `Pulse L${level} · ${handWord(o.hand)}`,
    key: o.key,
    hand: o.hand,
    beatsPerBar: 4,
    events,
    fingeringNote: FINGERING_PROVENANCE,
  };
}

/** Notes per beat implied by a phrase's shortest note (1 = quarters, 2 = eighths). */
export function subdivisionOf(p: Phrase): number {
  const minBeats = Math.min(...p.events.filter((e) => e.notes.length > 0).map((e) => e.beats));
  return minBeats < 1 ? Math.round(1 / minBeats) : 1;
}

export function positionChangePattern(o: PatternOptions, level: number, example = 0): Phrase {
  const ex = example % 2;
  let events: ScoreEvent[];
  let note: string | undefined = FINGERING_PROVENANCE;
  switch (level) {
    case 1:
      events = fillBar(degreeLine(o, ex === 0 ? [1, 2, 3, 4, 5, 3, 1] : [5, 4, 3, 2, 1, 3, 5], 1, posFinger(o.hand)));
      break;
    case 2: {
      const shift = ex === 0 ? 1 : 3; // move up a step, or to the next position up a fourth
      const first = degreeLine(o, [1, 2, 3, 4, 5], 1, posFinger(o.hand));
      const second = degreeLine(
        o,
        [1, 2, 3, 4, 5].map((d) => d + shift),
        1,
        posFinger(o.hand, 1 + shift),
      );
      events = [...first, rest(3), ...second, rest(3)];
      break;
    }
    case 3: {
      const p = scalePattern({ ...o }, 1, ex === 0 ? 'updown' : 'up');
      events = p.events;
      note = p.fingeringNote;
      break;
    }
    default: {
      const p = scalePattern({ ...o }, 2, 'updown');
      events = p.events;
      note = p.fingeringNote;
    }
  }
  return {
    patternId: `position-L${level}-${ex}`,
    title: `Position change L${level} · ${handWord(o.hand)}`,
    key: o.key,
    hand: o.hand,
    beatsPerBar: 4,
    events,
    fingeringNote: note,
  };
}

/** Coordination patterns use both staves; hand instructions are configuration, not measurement. */
export function coordinationPattern(key: Key, level: number, example = 0): Phrase {
  const ex = example % 2;
  const rh = (d: number) => degreeNote(key, d, 4);
  const lh = (d: number) => degreeNote(key, d, 3);
  const both = (l: number | null, r: number | null, beats = 1): ScoreEvent => {
    const notes: Spelled[] = [];
    const staves: Staff[] = [];
    const fingers: (number | null)[] = [];
    if (l !== null) {
      notes.push(lh(l));
      staves.push('bass');
      fingers.push(fivePositionFinger(l - 1, 'left'));
    }
    if (r !== null) {
      notes.push(rh(r));
      staves.push('treble');
      fingers.push(fivePositionFinger(r - 1, 'right'));
    }
    return notes.length ? noteEvent(notes, beats, fingers, staves) : rest(beats);
  };
  const up = [1, 2, 3, 4, 5, 4, 3, 2];
  let events: ScoreEvent[];
  switch (level) {
    case 1: {
      const seq = ex === 0 ? [1, 2, 3, 4, 5, 4, 3, 2] : [1, 3, 5, 3, 1, 2, 3, 2];
      events = [...seq.map((d) => both(null, d)), ...seq.map((d) => both(d, null))];
      break;
    }
    case 2: {
      const seq = ex === 0 ? [1, 2, 3, 4, 5, 4, 3, 2] : [1, 3, 2, 4, 3, 5, 4, 2];
      events = seq.flatMap((d) => [both(d, null), both(null, d)]);
      break;
    }
    case 3:
      events = (ex === 0 ? up : [1, 3, 2, 4, 3, 5, 3, 1]).map((d) => both(d, d));
      break;
    default:
      events =
        ex === 0
          ? [both(1, 1), both(null, 2), both(5, 3), both(null, 4), both(1, 5), both(null, 4), both(5, 3), both(null, 2)]
          : [both(1, 3), both(1, 2), both(null, 1), both(5, 2), both(1, 3), both(1, 4), both(null, 5), both(1, null)];
  }
  return {
    patternId: `coord-L${level}-${ex}`,
    title: `Coordination L${level}`,
    key,
    hand: level === 1 || level === 2 ? 'alternate' : 'both',
    beatsPerBar: 4,
    events: fillBar(events),
    fingeringNote: FINGERING_PROVENANCE,
  };
}

// ---------------------------------------------------------------------------
// Scales, arpeggios, broken chords and progressions.

export type Direction = 'up' | 'down' | 'updown';

export function scalePattern(
  o: PatternOptions,
  octaves: 1 | 2 = 1,
  direction: Direction = 'updown',
  harmonicMinor = false,
): Phrase {
  const variant = scaleVariantFor(o.key, harmonicMinor);
  const top = octaves * 7 + 1;
  const upDegrees = Array.from({ length: top }, (_, i) => i + 1);
  const degrees =
    direction === 'up' ? upDegrees : direction === 'down' ? [...upDegrees].reverse() : [...upDegrees, ...upDegrees.slice(0, -1).reverse()];
  const asc = scaleFingers(o.key, o.hand, octaves);
  const fingers = asc ? degrees.map((d) => asc[d - 1]) : null;
  const vName = variant === 'harmonic-minor' ? ' (harmonic)' : variant === 'natural-minor' ? ' (natural)' : '';
  return {
    patternId: `scale-${octaves}oct-${direction}${harmonicMinor ? '-harm' : ''}`,
    title: `${keyName(o.key)} scale${vName} · ${handWord(o.hand)}`,
    key: o.key,
    hand: o.hand,
    beatsPerBar: 4,
    events: fillBar(degreeLine(o, degrees, 1, fingers ? (_d, i) => fingers![i] : undefined, variant)),
    fingeringNote: fingers ? FINGERING_PROVENANCE : 'No authored fingering for this key yet.',
  };
}

/** Ascending fingering for 1 or 2 octaves; two octaves only where the 3+4 grouping extends cleanly. */
function scaleFingers(key: Key, hand: OneHand, octaves: 1 | 2): number[] | null {
  const one = scaleFingering(key, hand);
  if (!one || octaves === 1) return one;
  if (hand === 'right') return one.join() === '1,2,3,1,2,3,4,5' ? [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5] : null;
  return one.join() === '5,4,3,2,1,3,2,1' ? [5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1] : null;
}

/**
 * Arpeggio of a triad: root-third-fifth-octave and back, e.g. C4-E4-G4-C5-G4-E4-C4
 * (seven attacks, one top note). Uses the tonic triad unless a degree is given.
 */
export function arpeggioPattern(o: PatternOptions, degree = 1, direction: Direction = 'updown'): Phrase {
  const triad = diatonicTriad(o.key, degree);
  const rootOct = octaveFor(o);
  const root = degreeNote(o.key, degree, rootOct, o.key.tonality === 'minor' && degree === 5 ? 'harmonic-minor' : undefined);
  const notes = stackTriad(triad, root);
  const up = [notes[0], notes[1], notes[2], notes[3]];
  const seq = direction === 'up' ? up : direction === 'down' ? [...up].reverse() : [...up, notes[2], notes[1], notes[0]];
  const asc = degree === 1 ? arpeggioFingering(o.key, o.hand) : null;
  const fingers = asc
    ? direction === 'down'
      ? [...asc].reverse()
      : direction === 'up'
        ? asc
        : [...asc, asc[2], asc[1], asc[0]]
    : null;
  const events = seq.map((n, i) => noteEvent([n], 1, fingers ? [fingers[i]] : undefined));
  const label = degree === 1 ? 'tonic' : `${romanNumeral(degree, triad.quality)} (${triadName(triad)})`;
  return {
    patternId: `arp-${degree}-${direction}`,
    title: `${keyName(o.key)} ${label} arpeggio · ${handWord(o.hand)}`,
    key: o.key,
    hand: o.hand,
    beatsPerBar: 4,
    events: fillBar(events),
    fingeringNote: fingers ? FINGERING_PROVENANCE : 'No authored fingering for this chord yet.',
  };
}

/** Root, third, fifth and octave above a spelled root. */
function stackTriad(triad: Triad, root: Spelled): Spelled[] {
  const names = triadPitchNames(triad);
  const rIdx = diatonicIndex(root);
  const at = (steps: number, nameIdx: number): Spelled => {
    const idx = rIdx + steps;
    return { letter: names[nameIdx].letter, acc: names[nameIdx].acc, octave: Math.floor(idx / 7) };
  };
  return [root, at(2, 1), at(4, 2), at(7, 0)];
}

/** Broken chord: root-third-fifth-third-root. */
export function brokenChordPattern(o: PatternOptions, degree = 1): Phrase {
  const triad = diatonicTriad(o.key, degree);
  const root = degreeNote(o.key, degree, octaveFor(o), o.key.tonality === 'minor' && degree === 5 ? 'harmonic-minor' : undefined);
  const [r, t, f] = stackTriad(triad, root);
  const fingers = o.hand === 'right' ? [1, 3, 5, 3, 1] : [5, 3, 1, 3, 5];
  return {
    patternId: `broken-${degree}`,
    title: `${triadName(triad)} broken chord · ${handWord(o.hand)}`,
    key: o.key,
    hand: o.hand,
    beatsPerBar: 4,
    events: fillBar([r, t, f, t, r].map((n, i) => noteEvent([n], 1, [fingers[i]]))),
    fingeringNote: FINGERING_PROVENANCE,
  };
}

/** Block-chord progression (default I-IV-V-I), voiced with minimal movement. */
export function progressionPattern(key: Key, degrees = [1, 4, 5, 1], bassOctave = 4, beatsEach = 2): Phrase {
  const voicings = voiceProgression(key, degrees, bassOctave);
  const romans = degrees.map((d) => romanNumeral(d, diatonicTriad(key, d).quality));
  return {
    patternId: `prog-${degrees.join('')}`,
    title: `${romans.join('-')} in ${keyName(key)}`,
    key,
    hand: 'right',
    beatsPerBar: 4,
    events: voicings.map((v) => noteEvent(v, beatsEach)),
  };
}

/** A rhythm on one repeated note; null beats in `rhythm` are not allowed — use negative for rests. */
export function rhythmPattern(key: Key, rhythm: number[], id: string, title: string): Phrase {
  const note = degreeNote(key, 1, 4);
  return {
    patternId: `rhythm-${id}`,
    title,
    key,
    hand: 'right',
    beatsPerBar: 4,
    events: rhythm.map((b) => (b < 0 ? rest(-b) : noteEvent([note], b))),
  };
}

export const RHYTHMS: { id: string; title: string; beats: number[] }[] = [
  { id: 'quarters', title: 'Steady quarter notes', beats: [1, 1, 1, 1, 1, 1, 1, 1] },
  { id: 'q-rest', title: 'Quarters with rests', beats: [1, 1, 1, -1, 1, -1, 1, -1] },
  { id: 'halves', title: 'Halves and quarters', beats: [2, 1, 1, 2, 2] },
  { id: 'eighths', title: 'Eighth-note pairs', beats: [1, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 0.5, 2] },
];

/** Short single-line reading study: a stepwise/skip phrase generated from a seed. */
export function readingStudy(key: Key, hand: OneHand, seed: number, bars = 2): Phrase {
  const rnd = mulberry32(seed);
  const degrees: number[] = [1];
  const total = bars * 4;
  let beats: number[] = [];
  let used = 0;
  while (used < total) {
    const left = total - used;
    const b = left >= 2 && rnd() < 0.25 ? 2 : 1;
    beats.push(b);
    used += b;
  }
  for (let i = 1; i < beats.length; i++) {
    const prev = degrees[i - 1];
    const moves = [-2, -1, 1, 2, 1, -1];
    let next = prev + moves[Math.floor(rnd() * moves.length)];
    if (next < 1) next = prev + 1;
    if (next > 5) next = prev - 1;
    degrees.push(next);
  }
  // End on the tonic with a longer note when there is room.
  degrees[degrees.length - 1] = 1;
  beats = beats.slice(0, degrees.length);
  return {
    patternId: `study-${seed}`,
    title: `Reading study · ${handWord(hand)}`,
    key,
    hand,
    beatsPerBar: 4,
    events: degreeLine({ key, hand }, degrees, beats),
  };
}

/** Small deterministic PRNG for reproducible generated content (seed stored with attempts). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function trackPattern(track: SkillTrack, key: Key, hand: OneHand, level: number, example: number): Phrase {
  switch (track) {
    case 'fingerPatterns':
      return fingerPattern({ key, hand }, level, example);
    case 'pulse':
      return pulsePattern({ key, hand }, level, example);
    case 'positionChanges':
      return positionChangePattern({ key, hand }, level, example);
    case 'coordination':
      return coordinationPattern(key, level, example);
  }
}
