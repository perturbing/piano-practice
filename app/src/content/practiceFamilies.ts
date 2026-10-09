import {
  type Key,
  C_MAJOR,
  circleOfFifthsOrder,
  keyId,
  keyName,
  parseKeyId,
  signatureAccidental,
} from '../music/keys';
import { type Accidental, type Spelled, fromDiatonicIndex, midiOf, parseSpelled, pitchClassOf, spelledText } from '../music/pitch';
import {
  type Inversion,
  type Triad,
  INVERSION_NAMES,
  diatonicTriad,
  romanNumeral,
  triadName,
  triadPitchClasses,
  triadPitchNames,
  voiceTriad,
} from '../music/chords';
import {
  RHYTHMS,
  arpeggioPattern,
  brokenChordPattern,
  mulberry32,
  progressionPattern,
  readingStudy,
  rhythmPattern,
  scalePattern,
  type Direction,
  type OneHand,
} from '../music/patterns';
import type { Phrase } from '../music/score';
import type { GuidedItem } from '../engine/targets';
import { exactItem } from '../engine/targets';
import { type ExerciseSpec, guidedPhraseSpec, timedPhraseSpec } from '../engine/exercise';

export type ParamValue = string | number | boolean | string[];
export type Params = Record<string, ParamValue>;

export interface ParamDef {
  id: string;
  label: string;
  type: 'select' | 'keys' | 'number' | 'toggle';
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  /** Shown only when this returns true for the current params. */
  showIf?: (p: Params) => boolean;
  advanced?: boolean;
  help?: string;
}

export type FamilyId =
  | 'noteReading'
  | 'intervalReading'
  | 'chordReading'
  | 'chordBuilding'
  | 'scales'
  | 'arpeggios'
  | 'progressions'
  | 'rhythm'
  | 'studies'
  | 'listening';

export interface BuildContext {
  seed: number;
  range: { low: number; high: number };
}

export interface FamilyDef {
  id: FamilyId;
  title: string;
  goal: string;
  example: string;
  checks: string;
  skill: 'Reading' | 'Harmony' | 'Patterns' | 'Rhythm' | 'Listening';
  difficulty: 'Starter' | 'Beginner' | 'Developing';
  minutes: number;
  needsAudio: boolean;
  modes: ('guided' | 'timed')[];
  params: ParamDef[];
  defaults: Params;
  build: (p: Params, ctx: BuildContext) => ExerciseSpec;
}

// --- shared parameter definitions ----------------------------------------

const MODE: ParamDef = {
  id: 'mode',
  label: 'Practice mode',
  type: 'select',
  options: [
    { value: 'guided', label: 'Guided — waits for you' },
    { value: 'timed', label: 'Timed — keeps the beat' },
  ],
};
const isTimed = (p: Params) => p.mode === 'timed';
const BPM: ParamDef = { id: 'bpm', label: 'Tempo (BPM, quarter note)', type: 'number', min: 30, max: 160, step: 2, showIf: isTimed };
const REPS: ParamDef = { id: 'reps', label: 'Repetitions per key', type: 'number', min: 1, max: 8, step: 1 };
const KEYS: ParamDef = {
  id: 'keys',
  label: 'Key',
  type: 'keys',
  help: 'Choose one key, or several to practise selected keys in turn.',
};
const KEY_ORDER: ParamDef = {
  id: 'keyOrder',
  label: 'Key order',
  type: 'select',
  options: [
    { value: 'listed', label: 'As listed' },
    { value: 'circle', label: 'Circle of fifths' },
    { value: 'shuffle', label: 'Shuffled' },
  ],
  showIf: (p) => Array.isArray(p.keys) && p.keys.length > 1,
};
const HAND: ParamDef = {
  id: 'hand',
  label: 'Hand (instruction)',
  type: 'select',
  options: [
    { value: 'right', label: 'Right hand' },
    { value: 'left', label: 'Left hand' },
  ],
};
const SUPPORT: ParamDef = {
  id: 'support',
  label: 'Support',
  type: 'select',
  options: [
    { value: 'none', label: 'No highlights (hints on request)' },
    { value: 'highlighted', label: 'Highlight target keys (assisted)' },
  ],
  showIf: (p) => p.mode !== 'timed',
};
const COUNT: ParamDef = { id: 'count', label: 'Items', type: 'number', min: 4, max: 30, step: 1 };
const KEYBOARD: ParamDef = { id: 'showKeyboard', label: 'Show keyboard diagram', type: 'toggle' };
const PROFILE: ParamDef = {
  id: 'profile',
  label: 'Timing tolerance',
  type: 'select',
  options: [
    { value: 'standard', label: 'Standard (±200 ms or ¼ of the gap)' },
    { value: 'forgiving', label: 'Forgiving (±300 ms or 0.4 of the gap)' },
  ],
  showIf: isTimed,
  advanced: true,
};

// --- helpers ------------------------------------------------------------

function str(p: Params, k: string, d = ''): string {
  const v = p[k];
  return typeof v === 'string' ? v : d;
}
function num(p: Params, k: string, d: number): number {
  const v = p[k];
  return typeof v === 'number' ? v : d;
}
function bool(p: Params, k: string, d = false): boolean {
  const v = p[k];
  return typeof v === 'boolean' ? v : d;
}

/** Resolve the selected keys in their chosen order (saved into the attempt). */
export function resolveKeys(p: Params, seed: number): Key[] {
  const ids = Array.isArray(p.keys) && p.keys.length ? p.keys : ['C-major'];
  let keys = ids.map((id) => parseKeyId(id) ?? C_MAJOR);
  const order = str(p, 'keyOrder', 'listed');
  if (order === 'circle') keys = circleOfFifthsOrder(keys);
  if (order === 'shuffle') {
    const rnd = mulberry32(seed);
    keys = keys
      .map((k) => ({ k, r: rnd() }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.k);
  }
  return keys;
}

function common(
  p: Params,
  family: FamilyId,
  title: string,
  instruction: string,
  keys: Key[],
  phrases: Phrase[],
  skills: string[],
  ctx: BuildContext,
) {
  const timed = p.mode === 'timed';
  return {
    kind: 'practice' as const,
    sourceId: family,
    title,
    instruction,
    key: keys[0],
    phrases,
    highlighted: !timed && p.support === 'highlighted',
    hints: !timed,
    showKeyboard: bool(p, 'showKeyboard', true),
    showFingering: bool(p, 'showFingering', true),
    bpm: timed ? num(p, 'bpm', 60) : undefined,
    repetitions: timed ? num(p, 'reps', 2) : undefined,
    profile: (str(p, 'profile', 'standard') as 'standard' | 'forgiving') ?? 'standard',
    settings: flatten(p, keys),
    skills,
    seed: ctx.seed,
  };
}

function flatten(p: Params, keys: Key[]): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(p)) out[k] = Array.isArray(v) ? v.join(',') : v;
  out.resolvedKeyOrder = keys.map(keyId).join(',');
  return out;
}

function phraseExercise(
  p: Params,
  family: FamilyId,
  title: string,
  instruction: string,
  keys: Key[],
  phrases: Phrase[],
  skills: string[],
  ctx: BuildContext,
): ExerciseSpec {
  const base = common(p, family, title, instruction, keys, phrases, skills, ctx);
  return p.mode === 'timed' ? timedPhraseSpec(base) : guidedPhraseSpec(base, num(p, 'reps', 1));
}

/** Diatonic notes of a key between two MIDI bounds (inclusive), spelled with the key signature. */
export function diatonicPool(key: Key, low: number, high: number): Spelled[] {
  const out: Spelled[] = [];
  for (let idx = 0; idx < 80; idx++) {
    const n = fromDiatonicIndex(idx);
    const s: Spelled = { ...n, acc: signatureAccidental(key, n.letter) };
    const m = midiOf(s);
    if (m >= low && m <= high) out.push(s);
  }
  return out;
}

function pick<T>(rnd: () => number, arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}

const LANDMARKS: Record<'treble' | 'bass', string[]> = {
  treble: ['C4', 'G4', 'C5'],
  bass: ['C4', 'F3', 'C3'],
};
const READING_RANGES: Record<'treble' | 'bass', Record<string, [number, number]>> = {
  treble: { small: [60, 72], medium: [60, 79], wide: [57, 84] },
  bass: { small: [48, 60], medium: [41, 60], wide: [40, 64] },
};

// --- families -------------------------------------------------------------

const noteReading: FamilyDef = {
  id: 'noteReading',
  title: 'Note reading',
  goal: 'Read single notes on the staff and play them in the right octave.',
  example: 'Read the displayed F4',
  checks: 'Exact pitch and octave',
  skill: 'Reading',
  difficulty: 'Starter',
  minutes: 3,
  needsAudio: false,
  modes: ['guided'],
  params: [
    {
      id: 'clef',
      label: 'Clef',
      type: 'select',
      options: [
        { value: 'treble', label: 'Treble' },
        { value: 'bass', label: 'Bass' },
        { value: 'both', label: 'Treble and bass, interleaved' },
      ],
    },
    {
      id: 'range',
      label: 'Range',
      type: 'select',
      options: [
        { value: 'landmarks', label: 'Landmark notes only' },
        { value: 'small', label: 'Small range around landmarks' },
        { value: 'medium', label: 'Medium range' },
        { value: 'wide', label: 'Wide range (ledger lines)' },
      ],
    },
    { ...KEYS, label: 'Key signature' },
    { id: 'accidentals', label: 'Include accidentals', type: 'toggle' },
    COUNT,
    SUPPORT,
    KEYBOARD,
  ],
  defaults: {
    clef: 'treble',
    range: 'small',
    keys: ['C-major'],
    accidentals: false,
    count: 10,
    support: 'none',
    showKeyboard: true,
    mode: 'guided',
  },
  build(p, ctx) {
    const key = resolveKeys(p, ctx.seed)[0];
    const rnd = mulberry32(ctx.seed);
    const clefSel = str(p, 'clef', 'treble');
    const rangeSel = str(p, 'range', 'small');
    const clefs: ('treble' | 'bass')[] = clefSel === 'both' ? ['treble', 'bass'] : [clefSel as 'treble' | 'bass'];
    const pools = clefs.map((clef) => {
      if (rangeSel === 'landmarks')
        return LANDMARKS[clef].map((t) => {
          const n = parseSpelled(t)!;
          return { ...n, acc: signatureAccidental(key, n.letter) };
        });
      const [lo, hi] = READING_RANGES[clef][rangeSel] ?? READING_RANGES[clef].small;
      return diatonicPool(key, lo, hi);
    });
    const items: GuidedItem[] = [];
    let prev = '';
    for (let i = 0; i < num(p, 'count', 10); i++) {
      const ci = clefSel === 'both' ? i % 2 : 0;
      let note = pick(rnd, pools[ci]);
      for (let guard = 0; guard < 5 && spelledText(note) === prev; guard++) note = pick(rnd, pools[ci]);
      if (bool(p, 'accidentals') && rnd() < 0.3) {
        const alt = (note.acc + (rnd() < 0.5 ? 1 : -1)) as Accidental;
        if (alt >= -1 && alt <= 1) note = { ...note, acc: alt };
      }
      prev = spelledText(note);
      items.push({ ...exactItem(`r${i}`, [note]), clef: clefs[ci], display: { events: [[note]], cursor: 0 } });
    }
    return {
      ...common(p, 'noteReading', `Note reading · ${clefSel === 'both' ? 'treble and bass' : clefSel}`, 'Play the written note', [key], [], clefs.map((c) => `reading:${c}`), ctx),
      items,
      display: 'item',
      mode: 'guided',
      releaseBetweenItems: true,
      demo: false,
    };
  },
};

const intervalReading: FamilyDef = {
  id: 'intervalReading',
  title: 'Interval reading',
  goal: 'Read two written notes and play them together or one after the other.',
  example: 'Play the two written notes',
  checks: 'Both pitches; together or separately as specified',
  skill: 'Reading',
  difficulty: 'Beginner',
  minutes: 4,
  needsAudio: false,
  modes: ['guided'],
  params: [
    {
      id: 'clef',
      label: 'Clef',
      type: 'select',
      options: [
        { value: 'treble', label: 'Treble' },
        { value: 'bass', label: 'Bass' },
      ],
    },
    {
      id: 'maxInterval',
      label: 'Largest interval',
      type: 'select',
      options: [
        { value: '3', label: 'Up to a 3rd' },
        { value: '5', label: 'Up to a 5th' },
        { value: '8', label: 'Up to an octave' },
      ],
    },
    {
      id: 'together',
      label: 'How to play',
      type: 'select',
      options: [
        { value: 'together', label: 'Together' },
        { value: 'separately', label: 'Lower note, then upper note' },
      ],
    },
    { ...KEYS, label: 'Key signature' },
    COUNT,
    SUPPORT,
    KEYBOARD,
  ],
  defaults: { clef: 'treble', maxInterval: '5', together: 'together', keys: ['C-major'], count: 8, support: 'none', showKeyboard: true, mode: 'guided' },
  build(p, ctx) {
    const key = resolveKeys(p, ctx.seed)[0];
    const rnd = mulberry32(ctx.seed);
    const clef = str(p, 'clef', 'treble') as 'treble' | 'bass';
    const [lo, hi] = READING_RANGES[clef].medium;
    const pool = diatonicPool(key, lo, hi);
    const maxSteps = Number(str(p, 'maxInterval', '5')) - 1;
    const together = str(p, 'together', 'together') === 'together';
    const items: GuidedItem[] = [];
    for (let i = 0; i < num(p, 'count', 8); i++) {
      const steps = 1 + Math.floor(rnd() * maxSteps);
      const baseIdx = Math.floor(rnd() * Math.max(1, pool.length - steps));
      const a = pool[baseIdx];
      const b = pool[Math.min(pool.length - 1, baseIdx + steps)];
      if (together) {
        items.push({ ...exactItem(`i${i}`, [a, b]), clef, display: { events: [[a, b]], cursor: 0 } });
      } else {
        items.push({ ...exactItem(`i${i}a`, [a]), clef, display: { events: [[a], [b]], cursor: 0 } });
        items.push({ ...exactItem(`i${i}b`, [b]), clef, display: { events: [[a], [b]], cursor: 1 } });
      }
    }
    return {
      ...common(p, 'intervalReading', `Interval reading · ${clef}`, together ? 'Play both written notes together' : 'Play the lower note, then the upper note', [key], [], ['intervals', `reading:${clef}`], ctx),
      items,
      display: 'item',
      mode: 'guided',
      releaseBetweenItems: together,
      demo: false,
    };
  },
};

function diatonicChordChoices(key: Key, set: string): number[] {
  if (set === 'primary') return [1, 4, 5];
  return key.tonality === 'major' ? [1, 2, 4, 5, 6] : [1, 4, 5, 6];
}

const chordReading: FamilyDef = {
  id: 'chordReading',
  title: 'Chord reading',
  goal: 'Read a written triad and play exactly the written voicing.',
  example: 'Play this written triad',
  checks: 'Exact written voicing; no extra held notes',
  skill: 'Harmony',
  difficulty: 'Beginner',
  minutes: 4,
  needsAudio: false,
  modes: ['guided'],
  params: [
    KEYS,
    {
      id: 'chords',
      label: 'Chords',
      type: 'select',
      options: [
        { value: 'primary', label: 'I, IV and V' },
        { value: 'diatonic', label: 'Common diatonic chords' },
      ],
    },
    { id: 'inversions', label: 'Include inversions', type: 'toggle' },
    COUNT,
    SUPPORT,
    KEYBOARD,
  ],
  defaults: { keys: ['C-major'], chords: 'primary', inversions: false, count: 8, support: 'none', showKeyboard: true, mode: 'guided' },
  build(p, ctx) {
    const keys = resolveKeys(p, ctx.seed);
    const rnd = mulberry32(ctx.seed);
    const items: GuidedItem[] = [];
    const n = num(p, 'count', 8);
    for (let i = 0; i < n; i++) {
      const key = keys[i % keys.length];
      const degree = pick(rnd, diatonicChordChoices(key, str(p, 'chords', 'primary')));
      const triad = diatonicTriad(key, degree);
      const inv = (bool(p, 'inversions') ? Math.floor(rnd() * 3) : 0) as Inversion;
      const v = voiceTriad(triad, inv, 4);
      const voicing = midiOf(v[2]) > 81 ? voiceTriad(triad, inv, 3) : v;
      items.push({
        ...exactItem(`c${i}`, voicing),
        clef: midiOf(voicing[0]) >= 57 ? 'treble' : 'bass',
        display: { events: [voicing], cursor: 0 },
        phraseIndex: keys.indexOf(key),
      });
    }
    return {
      ...common(p, 'chordReading', 'Chord reading', 'Play the written chord exactly as written', keys, [], ['chords:read'], ctx),
      items,
      display: 'item',
      mode: 'guided',
      releaseBetweenItems: true,
      demo: false,
    };
  },
};

const chordBuilding: FamilyDef = {
  id: 'chordBuilding',
  title: 'Chord building',
  goal: 'Build a named triad from its root, third and fifth.',
  example: 'Build a C-minor triad',
  checks: 'Chord tones only; required inversion if specified',
  skill: 'Harmony',
  difficulty: 'Beginner',
  minutes: 4,
  needsAudio: false,
  modes: ['guided'],
  params: [
    {
      id: 'roots',
      label: 'Roots',
      type: 'select',
      options: [
        { value: 'key', label: 'Chords of the selected key' },
        { value: 'all', label: 'Any of the 12 roots' },
      ],
    },
    { ...KEYS, showIf: (p) => p.roots === 'key' },
    {
      id: 'quality',
      label: 'Quality',
      type: 'select',
      options: [
        { value: 'major', label: 'Major' },
        { value: 'minor', label: 'Minor' },
        { value: 'both', label: 'Major and minor' },
      ],
      showIf: (p) => p.roots === 'all',
    },
    {
      id: 'inversion',
      label: 'Inversion',
      type: 'select',
      options: [
        { value: 'any', label: 'Any voicing' },
        { value: 'root', label: 'Root position' },
        { value: 'mixed', label: 'Requested inversions (mixed)' },
      ],
    },
    { id: 'doubling', label: 'Allow doubled notes', type: 'toggle', advanced: true },
    COUNT,
    SUPPORT,
    KEYBOARD,
  ],
  defaults: { roots: 'key', keys: ['C-major'], quality: 'both', inversion: 'any', doubling: false, count: 8, support: 'none', showKeyboard: true, mode: 'guided' },
  build(p, ctx) {
    const keys = resolveKeys(p, ctx.seed);
    const rnd = mulberry32(ctx.seed);
    const items: GuidedItem[] = [];
    const allRoots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    for (let i = 0; i < num(p, 'count', 8); i++) {
      let triad: Triad;
      const key = keys[i % keys.length];
      if (str(p, 'roots', 'key') === 'all') {
        const q = str(p, 'quality', 'both');
        const quality = q === 'both' ? (rnd() < 0.5 ? 'major' : 'minor') : (q as 'major' | 'minor');
        const rootKey = parseKeyId(`${pick(rnd, allRoots)}-${quality}`)!;
        triad = { root: rootKey.tonic, quality };
      } else {
        const degree = pick(rnd, diatonicChordChoices(key, 'diatonic'));
        triad = diatonicTriad(key, degree);
      }
      const invSel = str(p, 'inversion', 'any');
      const inv: Inversion | undefined = invSel === 'root' ? 0 : invSel === 'mixed' ? (Math.floor(rnd() * 3) as Inversion) : undefined;
      const example = voiceTriad(triad, inv ?? 0, 4);
      const pcs = triadPitchClasses(triad);
      const bassName = inv !== undefined ? triadPitchNames(triad)[inv] : undefined;
      items.push({
        id: `b${i}`,
        notes: example,
        midis: example.map(midiOf),
        prompt:
          `Build ${triadName(triad)}` +
          (inv === undefined ? '' : inv === 0 ? ' in root position' : ` in ${INVERSION_NAMES[inv]}`),
        policy: {
          kind: 'chordName',
          pcs,
          ...(bassName ? { bassPc: pitchClassOf(bassName) } : {}),
          allowDoubling: bool(p, 'doubling'),
          low: ctx.range.low,
          high: ctx.range.high,
        },
        phraseIndex: 0,
      });
    }
    return {
      ...common(p, 'chordBuilding', 'Chord building', 'Build the named chord', keys, [], ['chords:build'], ctx),
      items,
      display: 'item',
      mode: 'guided',
      releaseBetweenItems: true,
      demo: false,
    };
  },
};

const scales: FamilyDef = {
  id: 'scales',
  title: 'Scales',
  goal: 'Play a scale in any key with the right notes in order.',
  example: 'Play C major ascending',
  checks: 'Ordered attacks; optional rhythm',
  skill: 'Patterns',
  difficulty: 'Beginner',
  minutes: 4,
  needsAudio: false,
  modes: ['guided', 'timed'],
  params: [
    KEYS,
    KEY_ORDER,
    HAND,
    {
      id: 'octaves',
      label: 'Octaves',
      type: 'select',
      options: [
        { value: '1', label: 'One octave' },
        { value: '2', label: 'Two octaves' },
      ],
    },
    {
      id: 'direction',
      label: 'Direction',
      type: 'select',
      options: [
        { value: 'updown', label: 'Up and down' },
        { value: 'up', label: 'Ascending' },
        { value: 'down', label: 'Descending' },
      ],
    },
    { id: 'harmonic', label: 'Harmonic minor (for minor keys)', type: 'toggle' },
    MODE,
    BPM,
    REPS,
    SUPPORT,
    { id: 'showFingering', label: 'Show suggested fingering', type: 'toggle' },
    KEYBOARD,
    PROFILE,
  ],
  defaults: { keys: ['C-major'], keyOrder: 'listed', hand: 'right', octaves: '1', direction: 'updown', harmonic: false, mode: 'guided', bpm: 60, reps: 2, support: 'none', showFingering: true, showKeyboard: true, profile: 'standard' },
  build(p, ctx) {
    const keys = resolveKeys(p, ctx.seed);
    const hand = str(p, 'hand', 'right') as OneHand;
    const phrases = keys.map((key) =>
      scalePattern({ key, hand }, Number(str(p, 'octaves', '1')) as 1 | 2, str(p, 'direction', 'updown') as Direction, bool(p, 'harmonic')),
    );
    const title = keys.length > 1 ? `Scales · ${keys.length} keys` : phrases[0].title;
    return phraseExercise(p, 'scales', title, 'Play the scale', keys, phrases, phrases.map((ph, i) => `pattern:${ph.patternId}:${keyId(keys[i])}`), ctx);
  },
};

const arpeggios: FamilyDef = {
  id: 'arpeggios',
  title: 'Broken chords and arpeggios',
  goal: 'Unfold chord tones in order, in any key.',
  example: 'Play C4-E4-G4-C5-G4-E4-C4',
  checks: 'Order, register, turn and optional timing',
  skill: 'Patterns',
  difficulty: 'Beginner',
  minutes: 4,
  needsAudio: false,
  modes: ['guided', 'timed'],
  params: [
    KEYS,
    KEY_ORDER,
    HAND,
    {
      id: 'shape',
      label: 'Shape',
      type: 'select',
      options: [
        { value: 'arpeggio', label: 'Arpeggio (root-3rd-5th-octave and back)' },
        { value: 'broken', label: 'Broken chord (root-3rd-5th-3rd-root)' },
      ],
    },
    {
      id: 'degree',
      label: 'Chord',
      type: 'select',
      options: [
        { value: '1', label: 'Tonic (I)' },
        { value: '4', label: 'Subdominant (IV)' },
        { value: '5', label: 'Dominant (V)' },
      ],
    },
    MODE,
    BPM,
    REPS,
    SUPPORT,
    { id: 'showFingering', label: 'Show suggested fingering', type: 'toggle' },
    KEYBOARD,
    PROFILE,
  ],
  defaults: { keys: ['C-major'], keyOrder: 'listed', hand: 'right', shape: 'arpeggio', degree: '1', mode: 'guided', bpm: 60, reps: 2, support: 'none', showFingering: true, showKeyboard: true, profile: 'standard' },
  build(p, ctx) {
    const keys = resolveKeys(p, ctx.seed);
    const hand = str(p, 'hand', 'right') as OneHand;
    const degree = Number(str(p, 'degree', '1'));
    const phrases = keys.map((key) =>
      str(p, 'shape', 'arpeggio') === 'broken' ? brokenChordPattern({ key, hand }, degree) : arpeggioPattern({ key, hand }, degree),
    );
    const title = keys.length > 1 ? `Arpeggios · ${keys.length} keys` : phrases[0].title;
    return phraseExercise(p, 'arpeggios', title, 'Play the pattern', keys, phrases, phrases.map((ph, i) => `pattern:${ph.patternId}:${keyId(keys[i])}`), ctx);
  },
};

const PROGRESSIONS: Record<string, number[]> = {
  'I-IV-V-I': [1, 4, 5, 1],
  'I-vi-IV-V': [1, 6, 4, 5],
  'I-IV-I-V-I': [1, 4, 1, 5, 1],
};

const progressions: FamilyDef = {
  id: 'progressions',
  title: 'Progressions',
  goal: 'Play a chord progression with smooth, close voicings.',
  example: 'Play I-IV-V-I in C',
  checks: 'Written voicings and transitions; common tones may stay held',
  skill: 'Harmony',
  difficulty: 'Developing',
  minutes: 4,
  needsAudio: false,
  modes: ['guided', 'timed'],
  params: [
    KEYS,
    KEY_ORDER,
    {
      id: 'progression',
      label: 'Progression',
      type: 'select',
      options: Object.keys(PROGRESSIONS).map((k) => ({ value: k, label: k })),
    },
    MODE,
    BPM,
    REPS,
    SUPPORT,
    KEYBOARD,
    PROFILE,
  ],
  defaults: { keys: ['C-major'], keyOrder: 'listed', progression: 'I-IV-V-I', mode: 'guided', bpm: 60, reps: 2, support: 'none', showKeyboard: true, profile: 'standard' },
  build(p, ctx) {
    const keys = resolveKeys(p, ctx.seed);
    const degrees = PROGRESSIONS[str(p, 'progression', 'I-IV-V-I')] ?? PROGRESSIONS['I-IV-V-I'];
    const phrases = keys.map((key) => progressionPattern(key, degrees));
    const title = keys.length > 1 ? `${str(p, 'progression')} · ${keys.length} keys` : phrases[0].title;
    return phraseExercise(p, 'progressions', title, 'Play each chord as written; keep common tones if you like', keys, phrases, keys.map((k) => `progression:${degrees.join('')}:${keyId(k)}`), ctx);
  },
};

const rhythm: FamilyDef = {
  id: 'rhythm',
  title: 'Rhythm',
  goal: 'Keep a steady pulse and place notes and rests on time.',
  example: 'Repeat C4 in this rhythm',
  checks: 'Onsets and rests against the beat',
  skill: 'Rhythm',
  difficulty: 'Starter',
  minutes: 3,
  needsAudio: false,
  modes: ['timed'],
  params: [
    { id: 'rhythm', label: 'Rhythm', type: 'select', options: RHYTHMS.map((r) => ({ value: r.id, label: r.title })) },
    { ...KEYS, label: 'Note (tonic of key)' },
    { ...BPM, showIf: undefined },
    { ...REPS, label: 'Repetitions' },
    { ...PROFILE, showIf: undefined },
  ],
  defaults: { rhythm: 'quarters', keys: ['C-major'], bpm: 60, reps: 3, mode: 'timed', profile: 'standard' },
  build(p, ctx) {
    const key = resolveKeys(p, ctx.seed)[0];
    const r = RHYTHMS.find((x) => x.id === str(p, 'rhythm', 'quarters')) ?? RHYTHMS[0];
    const phrase = rhythmPattern(key, r.beats, r.id, r.title);
    return timedPhraseSpec(common({ ...p, mode: 'timed' }, 'rhythm', `Rhythm · ${r.title}`, 'Play the rhythm on one note', [key], [phrase], [`rhythm:${r.id}`], ctx));
  },
};

const studies: FamilyDef = {
  id: 'studies',
  title: 'Short reading studies',
  goal: 'Read an unfamiliar two-bar phrase and keep going through mistakes.',
  example: 'Play an unfamiliar two-bar phrase',
  checks: 'Notes, rhythm and recovery through the phrase',
  skill: 'Reading',
  difficulty: 'Developing',
  minutes: 4,
  needsAudio: false,
  modes: ['guided', 'timed'],
  params: [KEYS, HAND, { id: 'phrases', label: 'Phrases', type: 'number', min: 1, max: 6, step: 1 }, MODE, BPM, SUPPORT, KEYBOARD, PROFILE],
  defaults: { keys: ['C-major'], hand: 'right', phrases: 3, mode: 'guided', bpm: 60, support: 'none', showKeyboard: false, profile: 'standard' },
  build(p, ctx) {
    const key = resolveKeys(p, ctx.seed)[0];
    const hand = str(p, 'hand', 'right') as OneHand;
    const n = num(p, 'phrases', 3);
    const phrases = Array.from({ length: n }, (_, i) => readingStudy(key, hand, ctx.seed + i * 7919));
    const keys = phrases.map(() => key);
    // Each fresh study is its own segment; timed mode plays each once.
    const spec = phraseExercise({ ...p, reps: 1 }, 'studies', `Reading studies · ${keyName(key)}`, 'Read and play the phrase', keys, phrases, [`reading:study:${hand === 'right' ? 'treble' : 'bass'}`], ctx);
    // A sight-reading attempt cannot have prior answer playback.
    return { ...spec, demo: false };
  },
};

const listening: FamilyDef = {
  id: 'listening',
  title: 'Listening and application',
  goal: 'Hear the difference between major and minor, then use it at the keyboard.',
  example: 'Hear a chord, then play its missing third',
  checks: 'The answer the task asks for',
  skill: 'Listening',
  difficulty: 'Beginner',
  minutes: 3,
  needsAudio: true,
  modes: ['guided'],
  params: [
    {
      id: 'task',
      label: 'Task',
      type: 'select',
      options: [
        { value: 'quality', label: 'Major or minor? (answer with buttons)' },
        { value: 'third', label: 'Hear a chord, then play its missing third' },
      ],
    },
    COUNT,
  ],
  defaults: { task: 'quality', count: 8, mode: 'guided', showKeyboard: true },
  build(p, ctx) {
    const rnd = mulberry32(ctx.seed);
    const roots = ['C', 'D', 'E', 'F', 'G', 'A'];
    const items: GuidedItem[] = [];
    const task = str(p, 'task', 'quality');
    for (let i = 0; i < num(p, 'count', 8); i++) {
      const quality = rnd() < 0.5 ? 'major' : 'minor';
      const rootKey = parseKeyId(`${pick(rnd, roots)}-${quality}`)!;
      const triad: Triad = { root: rootKey.tonic, quality };
      const v = voiceTriad(triad, 0, 4);
      const audio = v.map(midiOf);
      if (task === 'quality') {
        items.push({
          id: `q${i}`,
          notes: v,
          midis: audio,
          policy: { kind: 'exact' },
          prompt: 'Is this chord major or minor?',
          audio,
          choices: [
            { label: 'Major', correct: quality === 'major' },
            { label: 'Minor', correct: quality === 'minor' },
          ],
        });
      } else {
        const third = v[1];
        items.push({
          id: `t${i}`,
          notes: [third],
          midis: [midiOf(third)],
          policy: { kind: 'pitchClass' },
          prompt: `Root ${spelledText(v[0]).replace(/\d/, '')} and fifth ${spelledText(v[2]).replace(/\d/, '')} — play the third you heard (any octave).`,
          audio,
        });
      }
    }
    return {
      kind: 'practice',
      sourceId: 'listening',
      title: task === 'quality' ? 'Listening · major or minor' : 'Listening · missing third',
      instruction: task === 'quality' ? 'Listen, then choose' : 'Listen, then play the missing third',
      mode: 'guided',
      key: C_MAJOR,
      phrases: [],
      items,
      display: 'item',
      highlighted: false,
      hints: true,
      releaseBetweenItems: true,
      showKeyboard: true,
      showFingering: false,
      settings: flatten(p, [C_MAJOR]),
      skills: ['ear:quality'],
      seed: ctx.seed,
      demo: false,
    };
  },
};

export const FAMILIES: FamilyDef[] = [
  noteReading,
  intervalReading,
  chordReading,
  chordBuilding,
  scales,
  arpeggios,
  progressions,
  rhythm,
  studies,
  listening,
];

export function familyById(id: string): FamilyDef | undefined {
  return FAMILIES.find((f) => f.id === id);
}

/** Romans for display in setup previews. */
export function degreeLabel(key: Key, degree: number): string {
  return romanNumeral(degree, diatonicTriad(key, degree).quality);
}
