import { C_MAJOR, keyId, parseKeyId, type Key } from '../music/keys';
import { parseSpelled, type Spelled, midiOf } from '../music/pitch';
import { voiceTriad } from '../music/chords';
import { type Phrase, noteEvent, rest } from '../music/score';
import { arpeggioPattern, fingerPattern, progressionPattern, scalePattern } from '../music/patterns';
import type { GuidedItem } from '../engine/targets';
import type { ExerciseSpec } from '../engine/exercise';
import { familyById, type BuildContext, type FamilyId, type Params } from './practiceFamilies';

// Proposed beginner sequence (spec §3) — to be reviewed with a piano educator.
// Each lesson: Understand -> Observe -> Try with help -> Recall -> Apply.

export type StepKind = 'understand' | 'observe' | 'try' | 'recall' | 'apply';

export interface ObserveDemo {
  phrase: Phrase;
  /** Label under each event, e.g. chord names or "semitone". */
  labels?: string[];
  bpm: number;
  clef: 'treble' | 'bass' | 'grand';
}

export interface LessonStep {
  kind: StepKind;
  title: string;
  text: string[];
  demo?: ObserveDemo;
  exercise?: (ctx: BuildContext) => ExerciseSpec;
}

export interface Lesson {
  id: string;
  stage: number;
  title: string;
  summary: string;
  minutes: number;
  prereqs: string[];
  steps: LessonStep[];
}

export const STAGES = [
  '',
  'Keyboard and pulse',
  'First reading',
  'Intervals and scales',
  'Triads and inversions',
  'Harmony in motion',
  'Reading and application',
];

const sp = (t: string) => parseSpelled(t)!;
const k = (id: string) => parseKeyId(id)!;

function fromFamily(
  family: FamilyId,
  params: Params,
  title: string,
): (lesson: string, kind: StepKind) => (ctx: BuildContext) => ExerciseSpec {
  return (lesson, kind) => (ctx) => {
    const f = familyById(family)!;
    const spec = f.build({ ...f.defaults, ...params, support: kind === 'try' ? 'highlighted' : 'none' }, ctx);
    return {
      ...spec,
      kind: 'lesson',
      sourceId: `${lesson}:${kind}`,
      title,
      highlighted: kind === 'try' && spec.mode === 'guided',
      // A recall check gives no answer playback.
      demo: kind === 'try' ? spec.demo : false,
    };
  };
}

/** Prompt items answered by playing a named note ("Play any D"). */
function promptExercise(
  lesson: string,
  kind: StepKind,
  title: string,
  instruction: string,
  prompts: { prompt: string; note: Spelled; anyOctave: boolean }[],
  skills: string[],
): (ctx: BuildContext) => ExerciseSpec {
  return (ctx) => {
    const items: GuidedItem[] = prompts.map((p, i) => ({
      id: `p${i}`,
      notes: [p.note],
      midis: [midiOf(p.note)],
      policy: p.anyOctave ? { kind: 'pitchClass' } : { kind: 'exact' },
      prompt: p.prompt,
    }));
    return {
      kind: 'lesson',
      sourceId: `${lesson}:${kind}`,
      title,
      instruction,
      mode: 'guided',
      key: C_MAJOR,
      phrases: [],
      items,
      display: 'item',
      highlighted: kind === 'try',
      hints: true,
      releaseBetweenItems: true,
      showKeyboard: true,
      showFingering: false,
      settings: { lesson, step: kind },
      skills,
      seed: ctx.seed,
      demo: false,
    };
  };
}

function patternExercise(
  lesson: string,
  kind: StepKind,
  phrase: Phrase,
  mode: 'guided' | 'timed',
  skills: string[],
  bpm = 60,
): (ctx: BuildContext) => ExerciseSpec {
  return (ctx) => {
    const timed = mode === 'timed';
    const items: GuidedItem[] = [];
    if (!timed)
      phrase.events.forEach((e, i) => {
        if (e.notes.length) items.push({ id: `n${i}`, notes: e.notes, midis: e.notes.map(midiOf), policy: { kind: 'exact' }, eventIndex: i, phraseIndex: 0 });
      });
    return {
      kind: 'lesson',
      sourceId: `${lesson}:${kind}`,
      title: phrase.title,
      instruction: timed ? 'Play with the beat after the count-in' : 'Play the notes in order',
      mode,
      key: phrase.key,
      phrases: [phrase],
      items,
      display: 'phrase',
      highlighted: kind === 'try',
      hints: !timed,
      releaseBetweenItems: timed,
      showKeyboard: true,
      showFingering: true,
      bpm: timed ? bpm : undefined,
      repetitions: timed ? 2 : undefined,
      profile: 'standard',
      settings: { lesson, step: kind, keyId: keyId(phrase.key), patternId: phrase.patternId },
      skills,
      seed: ctx.seed,
      demo: kind === 'try',
    };
  };
}

const anyC = (n: number) => Array.from({ length: n }, () => ({ prompt: 'Play any C', note: sp('C4'), anyOctave: true }));
const named = (names: string[]) => names.map((t) => ({ prompt: `Play any ${t}`, note: sp(`${t}4`), anyOctave: true }));

const chordPhrase = (chords: Spelled[][], key: Key = C_MAJOR, title = 'Chords'): Phrase => ({
  patternId: 'demo',
  title,
  key,
  hand: 'right',
  beatsPerBar: 4,
  events: chords.flatMap((c) => [noteEvent(c, 2), rest(2)]),
});

const linePhrase = (notes: string[], key: Key = C_MAJOR, title = 'Example'): Phrase => ({
  patternId: 'demo',
  title,
  key,
  hand: 'right',
  beatsPerBar: 4,
  events: notes.map((n) => (n === '-' ? rest(1) : noteEvent([sp(n)], 1))),
});

const L = {
  landmarks: 'keyboard-landmarks',
  pulse: 'steady-pulse',
  treble: 'treble-landmarks',
  bass: 'bass-landmarks',
  steps: 'steps-and-skips',
  semitones: 'semitones-and-tones',
  five: 'five-note-patterns',
  scale: 'major-scale-pattern',
  triad: 'major-triad',
  minor: 'major-and-minor',
  inversions: 'inversions',
  progression: 'primary-chords',
  arpeggio: 'tonic-arpeggio',
  signatures: 'key-signatures',
};

export const LESSONS: Lesson[] = [
  {
    id: L.landmarks,
    stage: 1,
    title: 'Keyboard landmarks',
    summary: 'Find C from the black-key groups, then middle C.',
    minutes: 5,
    prereqs: [],
    steps: [
      {
        kind: 'understand',
        title: 'Black keys come in groups',
        text: [
          'Black keys alternate in groups of two and three. They are your map.',
          'C is the white key just to the left of every group of two black keys. Middle C — C4 — is the C nearest the middle of your keyboard.',
        ],
      },
      {
        kind: 'observe',
        title: 'Every C, low to high',
        text: ['Listen and watch: the same letter repeats every 12 keys, each one an octave higher.'],
        demo: { phrase: linePhrase(['C3', 'C4', 'C5']), labels: ['C3', 'C4 (middle C)', 'C5'], bpm: 60, clef: 'grand' },
      },
      { kind: 'try', title: 'Find C with help', text: ['The C keys are highlighted. Play any of them, release, and play another.'], exercise: promptExercise(L.landmarks, 'try', 'Find C', 'Play the named note', anyC(4), ['keyboard:names']) },
      { kind: 'recall', title: 'Find notes from memory', text: ['No highlights now. Use the black-key groups to find each letter.'], exercise: promptExercise(L.landmarks, 'recall', 'Find named notes', 'Play the named note in any octave', named(['C', 'D', 'E', 'C', 'F', 'G', 'A', 'B', 'D', 'F']), ['keyboard:names']) },
      { kind: 'apply', title: 'Middle C and its neighbours', text: ['Now the exact octave matters.'], exercise: promptExercise(L.landmarks, 'apply', 'Middle C', 'Play the exact note', [
        { prompt: 'Play middle C (C4)', note: sp('C4'), anyOctave: false },
        { prompt: 'Play the C one octave higher (C5)', note: sp('C5'), anyOctave: false },
        { prompt: 'Play the C one octave lower (C3)', note: sp('C3'), anyOctave: false },
        { prompt: 'Play the D just above middle C', note: sp('D4'), anyOctave: false },
        { prompt: 'Play the B just below middle C', note: sp('B3'), anyOctave: false },
      ], ['keyboard:names']) },
    ],
  },
  {
    id: L.pulse,
    stage: 1,
    title: 'A steady beat',
    summary: 'Play one note with the click, then add rests.',
    minutes: 5,
    prereqs: [],
    steps: [
      { kind: 'understand', title: 'Pulse', text: ['A pulse is an even beat, like a clock. A quarter note lasts one beat; a rest is a beat of silence.', 'The app counts in one bar (four clicks) before you start.'] },
      { kind: 'observe', title: 'Four quarter notes', text: ['Listen to the even spacing.'], demo: { phrase: linePhrase(['C4', 'C4', 'C4', 'C4']), bpm: 60, clef: 'treble' } },
      { kind: 'try', title: 'Play with the click', text: ['Play C4 on every click after the count-in.'], exercise: fromFamily('rhythm', { rhythm: 'quarters', bpm: 60, reps: 2 }, 'Quarter notes')(L.pulse, 'try') },
      { kind: 'recall', title: 'Rests too', text: ['Stay silent on the rests — they are part of the rhythm.'], exercise: fromFamily('rhythm', { rhythm: 'q-rest', bpm: 60, reps: 2 }, 'Quarters with rests')(L.pulse, 'recall') },
      { kind: 'apply', title: 'Long and short', text: ['A half note lasts two beats.'], exercise: fromFamily('rhythm', { rhythm: 'halves', bpm: 60, reps: 2 }, 'Halves and quarters')(L.pulse, 'apply') },
    ],
  },
  {
    id: L.treble,
    stage: 2,
    title: 'Treble clef landmarks',
    summary: 'Middle C, treble G and high C.',
    minutes: 6,
    prereqs: [L.landmarks],
    steps: [
      { kind: 'understand', title: 'The treble clef', text: ['The treble clef curls around the second line from the bottom: that line is G4.', 'Middle C sits on a short ledger line below the staff. C5 is in the third space.'] },
      { kind: 'observe', title: 'Three landmarks', text: ['Each written position links to one key.'], demo: { phrase: linePhrase(['C4', 'G4', 'C5']), labels: ['Middle C', 'Treble G', 'High C'], bpm: 50, clef: 'treble' } },
      { kind: 'try', title: 'Read with help', text: ['Target keys are highlighted.'], exercise: fromFamily('noteReading', { clef: 'treble', range: 'landmarks', count: 6 }, 'Treble landmarks')(L.treble, 'try') },
      { kind: 'recall', title: 'Read without help', text: ['No highlights. A hint is available, but it will be recorded.'], exercise: fromFamily('noteReading', { clef: 'treble', range: 'landmarks', count: 10 }, 'Treble landmarks')(L.treble, 'recall') },
      { kind: 'apply', title: 'Notes around the landmarks', text: ['Find nearby notes by counting steps from a landmark.'], exercise: fromFamily('noteReading', { clef: 'treble', range: 'small', count: 10 }, 'Treble, small range')(L.treble, 'apply') },
    ],
  },
  {
    id: L.bass,
    stage: 2,
    title: 'Bass clef landmarks',
    summary: 'Middle C, bass F and low C.',
    minutes: 6,
    prereqs: [L.treble],
    steps: [
      { kind: 'understand', title: 'The bass clef', text: ['The two dots of the bass clef surround the fourth line: that line is F3.', 'Middle C sits on a ledger line above the bass staff. C3 is in the second space.'] },
      { kind: 'observe', title: 'Three landmarks', text: ['Middle C is the same key in both clefs.'], demo: { phrase: linePhrase(['C4', 'F3', 'C3']), labels: ['Middle C', 'Bass F', 'Low C'], bpm: 50, clef: 'bass' } },
      { kind: 'try', title: 'Read with help', text: ['Target keys are highlighted.'], exercise: fromFamily('noteReading', { clef: 'bass', range: 'landmarks', count: 6 }, 'Bass landmarks')(L.bass, 'try') },
      { kind: 'recall', title: 'Read without help', text: ['Interleaved with nothing yet — just bass clef.'], exercise: fromFamily('noteReading', { clef: 'bass', range: 'landmarks', count: 10 }, 'Bass landmarks')(L.bass, 'recall') },
      { kind: 'apply', title: 'Both clefs', text: ['Treble and bass take turns. Check the clef first.'], exercise: fromFamily('noteReading', { clef: 'both', range: 'landmarks', count: 10 }, 'Treble and bass landmarks')(L.bass, 'apply') },
    ],
  },
  {
    id: L.steps,
    stage: 2,
    title: 'Steps and skips',
    summary: 'Read by direction and distance, not letter by letter.',
    minutes: 7,
    prereqs: [L.treble],
    steps: [
      { kind: 'understand', title: 'Steps and skips', text: ['A step moves from a line to the next space (or space to line): the next white key.', 'A skip moves line to line or space to space: it skips one key.'] },
      { kind: 'observe', title: 'Steps, then skips', text: ['C D E F G moves in steps; C E G moves in skips.'], demo: { phrase: linePhrase(['C4', 'D4', 'E4', 'F4', 'G4', '-', 'C4', 'E4', 'G4', '-']), bpm: 72, clef: 'treble' } },
      { kind: 'try', title: 'A short phrase with help', text: ['Follow the highlighted keys.'], exercise: fromFamily('studies', { phrases: 1, mode: 'guided' }, 'Reading study')(L.steps, 'try') },
      { kind: 'recall', title: 'Read new phrases', text: ['Each phrase is new — read it, don\'t memorise it.'], exercise: fromFamily('studies', { phrases: 3, mode: 'guided' }, 'Reading studies')(L.steps, 'recall') },
      { kind: 'apply', title: 'Keep going with the beat', text: ['A slow beat keeps moving. Recover after a mistake rather than stopping.'], exercise: fromFamily('studies', { phrases: 2, mode: 'timed', bpm: 50 }, 'Timed reading study')(L.steps, 'apply') },
    ],
  },
  {
    id: L.semitones,
    stage: 3,
    title: 'Semitones and tones',
    summary: 'The two building blocks of scales.',
    minutes: 5,
    prereqs: [L.landmarks],
    steps: [
      { kind: 'understand', title: 'Semitone and tone', text: ['A semitone is the very next key, black or white. A tone is two semitones.', 'E–F and B–C are semitones with no black key between them.'] },
      { kind: 'observe', title: 'Hear the difference', text: ['E–F (semitone), then C–D (tone).'], demo: { phrase: linePhrase(['E4', 'F4', '-', '-', 'C4', 'D4', '-', '-']), labels: ['E', 'F: semitone', '', '', 'C', 'D: tone'], bpm: 60, clef: 'treble' } },
      { kind: 'try', title: 'Find them with help', text: ['Play the note a semitone or tone above.'], exercise: promptExercise(L.semitones, 'try', 'Semitones and tones', 'Play the note in any octave', [
        { prompt: 'A semitone above E', note: sp('F4'), anyOctave: true },
        { prompt: 'A tone above C', note: sp('D4'), anyOctave: true },
        { prompt: 'A semitone above B', note: sp('C5'), anyOctave: true },
        { prompt: 'A tone above F', note: sp('G4'), anyOctave: true },
      ], ['intervals']) },
      { kind: 'recall', title: 'From memory', text: ['Black keys count too: a semitone above F is F-sharp.'], exercise: promptExercise(L.semitones, 'recall', 'Semitones and tones', 'Play the note in any octave', [
        { prompt: 'A semitone above F', note: sp('F#4'), anyOctave: true },
        { prompt: 'A tone above E', note: sp('F#4'), anyOctave: true },
        { prompt: 'A semitone above A', note: sp('Bb4'), anyOctave: true },
        { prompt: 'A tone above G', note: sp('A4'), anyOctave: true },
        { prompt: 'A semitone above B', note: sp('C5'), anyOctave: true },
        { prompt: 'A tone above B', note: sp('C#5'), anyOctave: true },
      ], ['intervals']) },
      { kind: 'apply', title: 'Read intervals', text: ['Play two written notes together.'], exercise: fromFamily('intervalReading', { maxInterval: '3', count: 6 }, 'Seconds and thirds')(L.semitones, 'apply') },
    ],
  },
  {
    id: L.five,
    stage: 3,
    title: 'Five-note patterns',
    summary: 'Tone-tone-semitone-tone in C, then G.',
    minutes: 6,
    prereqs: [L.semitones],
    steps: [
      { kind: 'understand', title: 'A major five-note pattern', text: ['From the tonic: tone, tone, semitone, tone. In C that is C D E F G.', 'One finger per key: right hand 1-2-3-4-5 (thumb is 1). Suggested fingering is guidance; the app cannot see your fingers.'] },
      { kind: 'observe', title: 'C position', text: ['Listen and watch the fingering numbers.'], demo: { phrase: fingerPattern({ key: C_MAJOR, hand: 'right' }, 1), bpm: 72, clef: 'treble' } },
      { kind: 'try', title: 'C with help', text: ['Highlighted keys, in order.'], exercise: patternExercise(L.five, 'try', fingerPattern({ key: C_MAJOR, hand: 'right' }, 1), 'guided', ['pattern:finger-L1-0:C-major']) },
      { kind: 'recall', title: 'G position', text: ['Same pattern from G: G A B C D. Only the starting key changes.'], exercise: patternExercise(L.five, 'recall', fingerPattern({ key: k('G-major'), hand: 'right' }, 1), 'guided', ['pattern:finger-L1-0:G-major']) },
      { kind: 'apply', title: 'Left hand in C', text: ['Left hand starts with finger 5 on C3.'], exercise: patternExercise(L.five, 'apply', fingerPattern({ key: C_MAJOR, hand: 'left' }, 1), 'guided', ['pattern:finger-L1-0:C-major']) },
    ],
  },
  {
    id: L.scale,
    stage: 3,
    title: 'The major scale',
    summary: 'T-T-S-T-T-T-S, then G major (F-sharp) and F major (B-flat).',
    minutes: 8,
    prereqs: [L.five],
    steps: [
      { kind: 'understand', title: 'The major-scale pattern', text: ['Tone, tone, semitone, tone, tone, tone, semitone. Every major scale uses this pattern.', 'Starting on G needs F-sharp to keep the pattern; starting on F needs B-flat.'] },
      { kind: 'observe', title: 'C major', text: ['Watch the thumb pass under after E (suggested fingering).'], demo: { phrase: scalePattern({ key: C_MAJOR, hand: 'right' }, 1, 'up'), bpm: 72, clef: 'treble' } },
      { kind: 'try', title: 'C major with help', text: ['Up and down.'], exercise: fromFamily('scales', { keys: ['C-major'], mode: 'guided', reps: 1 }, 'C major scale')(L.scale, 'try') },
      { kind: 'recall', title: 'G major', text: ['Remember the F-sharp.'], exercise: fromFamily('scales', { keys: ['G-major'], mode: 'guided', reps: 1 }, 'G major scale')(L.scale, 'recall') },
      { kind: 'apply', title: 'F major', text: ['Remember the B-flat.'], exercise: fromFamily('scales', { keys: ['F-major'], mode: 'guided', reps: 1 }, 'F major scale')(L.scale, 'apply') },
    ],
  },
  {
    id: L.triad,
    stage: 4,
    title: 'Build a major triad',
    summary: 'Root, major third and perfect fifth.',
    minutes: 6,
    prereqs: [L.scale],
    steps: [
      { kind: 'understand', title: 'Root, third, fifth', text: ['A triad stacks three notes a third apart. A major triad has a major third (4 semitones) and a perfect fifth (7 semitones) above the root.', 'C major is C–E–G.'] },
      { kind: 'observe', title: 'C, F and G major', text: ['The primary chords of C major.'], demo: { phrase: chordPhrase([voiceTriad({ root: sp('C4'), quality: 'major' }, 0, 4), voiceTriad({ root: sp('F4'), quality: 'major' }, 0, 4), voiceTriad({ root: sp('G4'), quality: 'major' }, 0, 4)]), labels: ['C major', '', 'F major', '', 'G major', ''], bpm: 60, clef: 'treble' } },
      { kind: 'try', title: 'Read triads with help', text: ['Play all three written notes together.'], exercise: fromFamily('chordReading', { keys: ['C-major'], chords: 'primary', count: 4 }, 'C, F and G')(L.triad, 'try') },
      { kind: 'recall', title: 'Build them by name', text: ['Any voicing counts; only chord tones.'], exercise: fromFamily('chordBuilding', { roots: 'key', keys: ['C-major'], inversion: 'any', count: 6 }, 'Build triads')(L.triad, 'recall') },
      { kind: 'apply', title: 'New roots', text: ['Use the same distances from a new root.'], exercise: fromFamily('chordBuilding', { roots: 'all', quality: 'major', inversion: 'root', count: 6 }, 'Major triads, any root')(L.triad, 'apply') },
    ],
  },
  {
    id: L.minor,
    stage: 4,
    title: 'Major and minor',
    summary: 'Lower the third to change the quality.',
    minutes: 6,
    prereqs: [L.triad],
    steps: [
      { kind: 'understand', title: 'Change the third', text: ['Lowering the third by a semitone turns a major triad into a minor one. C major (C–E–G) becomes C minor (C–E-flat–G).', 'The root stays C.'] },
      { kind: 'observe', title: 'C major, then C minor', text: ['Hear how the colour changes.'], demo: { phrase: chordPhrase([voiceTriad({ root: sp('C4'), quality: 'major' }, 0, 4), voiceTriad({ root: sp('C4'), quality: 'minor' }, 0, 4)], k('C-major')), labels: ['C major', '', 'C minor', ''], bpm: 50, clef: 'treble' } },
      { kind: 'try', title: 'Build minor with help', text: [], exercise: fromFamily('chordBuilding', { roots: 'all', quality: 'minor', inversion: 'root', count: 4 }, 'Minor triads')(L.minor, 'try') },
      { kind: 'recall', title: 'Major or minor', text: ['Mixed qualities, any voicing.'], exercise: fromFamily('chordBuilding', { roots: 'all', quality: 'both', inversion: 'any', count: 8 }, 'Major and minor triads')(L.minor, 'recall') },
      { kind: 'apply', title: 'By ear', text: ['Listen and decide.'], exercise: fromFamily('listening', { task: 'quality', count: 6 }, 'Major or minor?')(L.minor, 'apply') },
    ],
  },
  {
    id: L.inversions,
    stage: 4,
    title: 'Inversions',
    summary: 'Same chord, different bass note.',
    minutes: 7,
    prereqs: [L.minor],
    steps: [
      { kind: 'understand', title: 'The bass names the inversion', text: ['E–G–C is still C major: the root is C. Because E is the lowest note, it is in first inversion.', 'With G in the bass (G–C–E) it is in second inversion.'] },
      { kind: 'observe', title: 'The root stays C', text: ['Root position, first inversion, second inversion.'], demo: { phrase: chordPhrase([0, 1, 2].map((inv) => voiceTriad({ root: sp('C4'), quality: 'major' }, inv as 0 | 1 | 2, 4))), labels: ['Root position', '', 'First inversion', '', 'Second inversion', ''], bpm: 50, clef: 'treble' } },
      { kind: 'try', title: 'Read inversions with help', text: [], exercise: fromFamily('chordReading', { keys: ['C-major'], chords: 'primary', inversions: true, count: 5 }, 'Written inversions')(L.inversions, 'try') },
      { kind: 'recall', title: 'Play a requested inversion', text: ['The lowest note decides.'], exercise: fromFamily('chordBuilding', { roots: 'key', keys: ['C-major'], inversion: 'mixed', count: 8 }, 'Requested inversions')(L.inversions, 'recall') },
      { kind: 'apply', title: 'In G major', text: [], exercise: fromFamily('chordBuilding', { roots: 'key', keys: ['G-major'], inversion: 'mixed', count: 6 }, 'Inversions in G')(L.inversions, 'apply') },
    ],
  },
  {
    id: L.progression,
    stage: 5,
    title: 'I–IV–V–I',
    summary: 'Primary chords, common tones and a cadence.',
    minutes: 8,
    prereqs: [L.inversions],
    steps: [
      { kind: 'understand', title: 'Roman numerals', text: ['Number the scale degrees 1–7. The triads on degrees 1, 4 and 5 are I, IV and V: in C major, C, F and G.', 'Choosing nearby inversions keeps common tones and makes the hand move less.'] },
      { kind: 'observe', title: 'C–F–G–C', text: ['C stays from I to IV; G stays from V to I.'], demo: { phrase: progressionPattern(C_MAJOR), labels: ['I (C)', 'IV (F)', 'V (G)', 'I (C)'], bpm: 60, clef: 'treble' } },
      { kind: 'try', title: 'Play it with help', text: ['Keep the common tone held if you can.'], exercise: fromFamily('progressions', { keys: ['C-major'], mode: 'guided', reps: 1 }, 'I–IV–V–I in C')(L.progression, 'try') },
      { kind: 'recall', title: 'Without highlights', text: [], exercise: fromFamily('progressions', { keys: ['C-major'], mode: 'guided', reps: 2 }, 'I–IV–V–I in C')(L.progression, 'recall') },
      { kind: 'apply', title: 'Transpose to G', text: ['Same shape, new key.'], exercise: fromFamily('progressions', { keys: ['G-major'], mode: 'guided', reps: 1 }, 'I–IV–V–I in G')(L.progression, 'apply') },
    ],
  },
  {
    id: L.arpeggio,
    stage: 5,
    title: 'Tonic arpeggio',
    summary: 'Unfold the tonic triad across an octave.',
    minutes: 6,
    prereqs: [L.triad],
    steps: [
      { kind: 'understand', title: 'Chord tones in order', text: ['An arpeggio plays chord tones one at a time through a range: C4–E4–G4–C5 and back.', 'The top C is played once.'] },
      { kind: 'observe', title: 'C major arpeggio', text: [], demo: { phrase: arpeggioPattern({ key: C_MAJOR, hand: 'right' }), bpm: 72, clef: 'treble' } },
      { kind: 'try', title: 'With help', text: [], exercise: fromFamily('arpeggios', { keys: ['C-major'], mode: 'guided', reps: 1 }, 'C major arpeggio')(L.arpeggio, 'try') },
      { kind: 'recall', title: 'From memory', text: [], exercise: fromFamily('arpeggios', { keys: ['C-major'], mode: 'guided', reps: 2 }, 'C major arpeggio')(L.arpeggio, 'recall') },
      { kind: 'apply', title: 'With the beat', text: ['Slow and even.'], exercise: fromFamily('arpeggios', { keys: ['C-major'], mode: 'timed', bpm: 60, reps: 2 }, 'C major arpeggio, timed')(L.arpeggio, 'apply') },
    ],
  },
  {
    id: L.signatures,
    stage: 6,
    title: 'Key signatures',
    summary: 'Sharps and flats at the start apply everywhere.',
    minutes: 7,
    prereqs: [L.scale, L.bass],
    steps: [
      { kind: 'understand', title: 'The key signature', text: ['Sharps or flats written after the clef apply to that letter in every octave, all the way through.', 'G major has F-sharp; F major has B-flat. A natural sign cancels it until the end of the bar.'] },
      { kind: 'observe', title: 'G major', text: ['Every F is played as F-sharp.'], demo: { phrase: { ...linePhrase(['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5'], k('G-major')), key: k('G-major') }, bpm: 72, clef: 'treble' } },
      { kind: 'try', title: 'Read in G with help', text: [], exercise: fromFamily('noteReading', { keys: ['G-major'], range: 'medium', count: 8 }, 'Reading in G major')(L.signatures, 'try') },
      { kind: 'recall', title: 'Read in F', text: ['Watch for B-flat.'], exercise: fromFamily('noteReading', { keys: ['F-major'], range: 'medium', count: 10 }, 'Reading in F major')(L.signatures, 'recall') },
      { kind: 'apply', title: 'A study in G', text: [], exercise: fromFamily('studies', { keys: ['G-major'], phrases: 2, mode: 'guided' }, 'Study in G major')(L.signatures, 'apply') },
    ],
  },
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
