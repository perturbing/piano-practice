import { z } from 'zod';
import { InputRouteSchema, KeyIdSchema, LocalDate, MidiNote, SpelledSchema } from './common';

export const AttemptKind = z.enum(['lesson', 'practice', 'daily']);
export type AttemptKind = z.infer<typeof AttemptKind>;

export const AttemptStatus = z.enum(['in-progress', 'completed', 'ended-early', 'recovered']);
export type AttemptStatus = z.infer<typeof AttemptStatus>;

const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Normalized performance evidence; `t` = monotonic ms since the attempt started. */
export const AttemptEvent = z.object({
  t: z.number(),
  type: z.enum([
    'noteon',
    'noteoff',
    'sustain',
    'reset',
    'pause',
    'resume',
    'interruption',
    'recovered',
    'connection',
    'hint',
    'skip',
    'countIn',
    'segmentStart',
    'segmentEnd',
    'tempo',
    'demo',
  ]),
  note: MidiNote.optional(),
  velocity: z.number().int().min(0).max(127).optional(),
  detail: z.record(Scalar).optional(),
});
export type AttemptEvent = z.infer<typeof AttemptEvent>;

export const MatchPolicySchema = z.union([
  z.object({ kind: z.literal('exact') }),
  z.object({ kind: z.literal('pitchClass') }),
  z.object({
    kind: z.literal('chordName'),
    pcs: z.array(z.number().int().min(0).max(11)),
    bassPc: z.number().int().min(0).max(11).optional(),
    allowDoubling: z.boolean(),
    low: MidiNote,
    high: MidiNote,
  }),
]);

export const ResolvedItem = z.object({
  id: z.string(),
  notes: z.array(SpelledSchema),
  midis: z.array(MidiNote),
  policy: MatchPolicySchema,
  prompt: z.string().optional(),
  eventIndex: z.number().int().optional(),
  phraseIndex: z.number().int().optional(),
  display: z.object({ events: z.array(z.array(SpelledSchema)), cursor: z.number().int() }).optional(),
  clef: z.enum(['treble', 'bass']).optional(),
  audio: z.array(MidiNote).optional(),
  choices: z.array(z.object({ label: z.string(), correct: z.boolean() })).optional(),
});

export const ResolvedPhrase = z.object({
  patternId: z.string(),
  title: z.string(),
  keyId: KeyIdSchema,
  hand: z.enum(['right', 'left', 'both', 'alternate']),
  beatsPerBar: z.number().int().positive(),
  events: z.array(
    z.object({
      notes: z.array(SpelledSchema),
      midis: z.array(MidiNote),
      beats: z.number().positive(),
      fingers: z.array(z.number().int().nullable()).optional(),
      staves: z.array(z.enum(['treble', 'bass'])).optional(),
    }),
  ),
  fingeringNote: z.string().optional(),
});
export type ResolvedPhrase = z.infer<typeof ResolvedPhrase>;

export const ItemResultSchema = z.object({
  itemId: z.string(),
  outcome: z.enum(['pending', 'correct', 'skipped']),
  firstTry: z.boolean(),
  assisted: z.boolean(),
  hintLevel: z.number().int().min(0).max(3),
  highlighted: z.boolean(),
  mistakes: z.array(z.object({ played: z.array(MidiNote), t: z.number(), cue: z.string() })),
  activatedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
});

export const TimedSummarySchema = z.object({
  expected: z.number().int(),
  matched: z.number().int(),
  timingMisses: z.number().int(),
  wrongPitches: z.number().int(),
  missed: z.number().int(),
  extras: z.number().int(),
  medianAbsErrorMs: z.number().nullable(),
  meanSignedErrorMs: z.number().nullable(),
});

export const TimedSegment = z.object({
  index: z.number().int(),
  /** Segment playing order within the attempt (key rotation keeps one key per segment). */
  keyId: KeyIdSchema,
  bpm: z.number().positive(),
  subdivision: z.number().int().positive(),
  /** Attempt-time of the first beat. */
  startT: z.number(),
  status: z.enum(['complete', 'interrupted', 'restarted']),
  toleranceConfig: z.object({
    maxToleranceMs: z.number(),
    ioiFraction: z.number(),
    chordSpreadMs: z.number(),
    beatMs: z.number(),
    profile: z.enum(['standard', 'forgiving']),
  }),
  /** Attacks relative to the first beat — with the targets they reproduce the score. */
  attacks: z.array(z.object({ note: MidiNote, t: z.number() })),
  targets: z.array(z.object({ id: z.string(), midi: MidiNote, onsetMs: z.number(), group: z.number(), eventIndex: z.number() })),
  outcomes: z.array(z.record(z.unknown())),
  summary: TimedSummarySchema.nullable(),
  qualifies: z.boolean(),
  assisted: z.boolean(),
});
export type TimedSegment = z.infer<typeof TimedSegment>;

export const Attempt = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  kind: AttemptKind,
  /** Lesson step, practice family/preset or daily task id. */
  sourceId: z.string(),
  presetId: z.string().optional(),
  presetRevision: z.number().int().optional(),
  routineDate: LocalDate.optional(),
  taskId: z.string().optional(),
  title: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  localDate: LocalDate,
  status: AttemptStatus,
  mode: z.enum(['guided', 'timed']),
  contentRevision: z.number().int(),
  evaluatorVersion: z.string(),
  settings: z.record(Scalar),
  /** Key order played (one entry per key segment for key rotation). */
  keyOrder: z.array(KeyIdSchema),
  skills: z.array(z.string()),
  confirmedRange: z.object({ low: MidiNote, high: MidiNote, method: z.string() }).nullable(),
  input: z.object({
    source: z.enum(['webmidi', 'ble', 'virtual', 'none']),
    route: InputRouteSchema,
    name: z.string(),
  }),
  timing: z.object({
    timestampSource: z.string(),
    clock: z.literal('performance.now'),
    offsetMs: z.number(),
    reliable: z.boolean(),
    note: z.string().optional(),
  }),
  seed: z.number().int().optional(),
  phrase: ResolvedPhrase.optional(),
  /** Additional phrases for key rotation (one per key). */
  phrases: z.array(ResolvedPhrase).optional(),
  items: z.array(ResolvedItem).optional(),
  itemResults: z.array(ItemResultSchema).optional(),
  segments: z.array(TimedSegment).optional(),
  events: z.array(AttemptEvent),
  interruptions: z.number().int().min(0),
});
export type Attempt = z.infer<typeof Attempt>;
