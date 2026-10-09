import { parseKeyId, type Key } from '../music/keys';
import {
  arpeggioPattern,
  brokenChordPattern,
  exampleCount,
  scalePattern,
  subdivisionOf,
  trackPattern,
  TRACK_LABELS,
  type OneHand,
  type SkillTrack,
} from '../music/patterns';
import type { Phrase } from '../music/score';
import type { DailyRoutine, RoutineTask, SkillState } from '../data/schema';
import { keyName } from '../music/keys';

export const ROUTINE_RULES_VERSION = 'routine-v1';
/** Prototype starting tempo for timed movement work (spec §5) — a parameter to test. */
export const DEFAULT_DAILY_BPM = 60;

export interface TrackEvidence {
  attempts: number;
  qualified: number;
}

export interface RoutineInput {
  date: string;
  timezone: string;
  lengthMin: 5 | 10 | 15;
  keyPool: string[];
  hands: 'right' | 'left' | 'alternate';
  skills: SkillState;
  /** Recent per-track evidence; empty = authored beginner routine. */
  recent: Partial<Record<SkillTrack, TrackEvidence>>;
  now?: Date;
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Tempo history key: the conditions a tempo belongs to. */
export function tempoKey(patternId: string, keyId: string, hand: string, level: number, subdivision: number, profile = 'standard'): string {
  return `${patternId}|${keyId}|${hand}|L${level}|sub${subdivision}|${profile}`;
}

/**
 * Prepare today's balanced routine: a familiar opening, one current movement
 * focus, a short pulse/speed task and an application in a key. Only one
 * challenge dimension differs from the familiar baseline in each task.
 */
export function generateRoutine(input: RoutineInput): DailyRoutine {
  const day = dayNumber(input.date);
  const lv = input.skills.levels;
  const pool = input.keyPool.length ? input.keyPool : ['C-major'];
  const homeKey = pool[0];
  const applyKey = pool[day % pool.length];
  let handIdx = 0;
  const nextHand = (): OneHand => {
    if (input.hands !== 'alternate') return input.hands;
    return (day + handIdx++) % 2 === 0 ? 'right' : 'left';
  };
  const ex = (track: SkillTrack, level: number, salt: number) => (day + salt) % exampleCount(track, level);

  // Movement focus: the track with less recent clean evidence; alternate days on a tie.
  const score = (t: SkillTrack) => {
    const e = input.recent[t];
    return e && e.attempts > 0 ? e.qualified / e.attempts : -1;
  };
  const fp = score('fingerPatterns');
  const pc = score('positionChanges');
  const focus: SkillTrack = fp === pc ? (day % 2 === 0 ? 'fingerPatterns' : 'positionChanges') : fp < pc ? 'fingerPatterns' : 'positionChanges';
  const noEvidence = Object.values(input.recent).every((e) => !e || e.attempts === 0);

  const tasks: RoutineTask[] = [];
  const add = (t: Omit<RoutineTask, 'id'>) => tasks.push({ ...t, id: `${input.date}-${tasks.length + 1}` });

  const settleLevel = Math.max(1, lv.fingerPatterns - 1);
  const settleHand = nextHand();
  add({
    slot: 'settle',
    title: 'Settle in',
    purpose: 'Comfortable five-note pattern',
    reason: noEvidence
      ? 'Authored beginner opening: a comfortable five-note pattern, hands separately.'
      : `A familiar opening one level below your current finger-pattern level (L${lv.fingerPatterns}).`,
    track: 'fingerPatterns',
    level: settleLevel,
    pattern: { kind: 'track', example: ex('fingerPatterns', settleLevel, 0) },
    keyId: homeKey,
    hand: settleHand,
    mode: 'guided',
    bpm: null,
    repetitions: input.lengthMin === 5 ? 1 : 2,
    estMin: input.lengthMin === 5 ? 1.5 : 2,
  });

  if (input.lengthMin !== 5) {
    add({
      slot: 'movement',
      title: TRACK_LABELS[focus],
      purpose: 'Current movement focus',
      reason: noEvidence
        ? `Beginner routine: ${TRACK_LABELS[focus].toLowerCase()} at level ${lv[focus]}.`
        : `Your current ${TRACK_LABELS[focus].toLowerCase()} level (L${lv[focus]}) has the least recent clean evidence.`,
      track: focus,
      level: lv[focus],
      pattern: { kind: 'track', example: ex(focus, lv[focus], 1) },
      keyId: homeKey,
      hand: nextHand(),
      mode: 'guided',
      bpm: null,
      repetitions: 3,
      estMin: 3,
    });
  }

  if (input.lengthMin === 15) {
    add({
      slot: 'coordination',
      title: 'Coordination',
      purpose: 'Instructed hands',
      reason: `Coordination level ${lv.coordination}. Hand instructions are guidance; MIDI cannot tell which hand played.`,
      track: 'coordination',
      level: lv.coordination,
      pattern: { kind: 'track', example: ex('coordination', lv.coordination, 2) },
      keyId: homeKey,
      hand: lv.coordination <= 2 ? 'alternate' : 'both',
      mode: 'guided',
      bpm: null,
      repetitions: 2,
      estMin: 3,
    });
  }

  const pulseHand = nextHand();
  const pulseEx = ex('pulse', lv.pulse, 3);
  const pulsePhrase = trackPattern('pulse', parseKeyId(homeKey)!, pulseHand, lv.pulse, pulseEx);
  const tk = tempoKey(pulsePhrase.patternId, homeKey, pulseHand, lv.pulse, subdivisionOf(pulsePhrase));
  const bpm = input.skills.workingTempos[tk] ?? DEFAULT_DAILY_BPM;
  add({
    slot: 'speed',
    title: 'Steady speed',
    purpose: 'Short timed attempts with reset breaks',
    reason: input.skills.workingTempos[tk]
      ? `Your working tempo for this pattern: ${bpm} BPM.`
      : `Starting at the beginner default of ${DEFAULT_DAILY_BPM} BPM — use Slower whenever you like.`,
    track: 'pulse',
    level: lv.pulse,
    pattern: { kind: 'track', example: pulseEx },
    keyId: homeKey,
    hand: pulseHand,
    mode: 'timed',
    bpm,
    repetitions: 3,
    estMin: input.lengthMin === 5 ? 2 : 3,
  });

  // Application: the key may change here, so the pattern stays familiar and untimed.
  const kinds: RoutineTask['pattern']['kind'][] = ['scale', 'broken', 'arpeggio'];
  const applyKind = kinds[day % kinds.length];
  const applyKeyObj = parseKeyId(applyKey)!;
  add({
    slot: 'apply',
    title: 'Apply in a key',
    purpose: `${applyKind === 'scale' ? 'Scale' : applyKind === 'broken' ? 'Broken chord' : 'Arpeggio'} in ${keyName(applyKeyObj)}`,
    reason:
      pool.length > 1
        ? `${keyName(applyKeyObj)} from your key pool (rotating daily). Untimed, so only the key is new.`
        : `A familiar shape in ${keyName(applyKeyObj)}, untimed.`,
    track: null,
    level: 1,
    pattern: { kind: applyKind, example: 0 },
    keyId: applyKey,
    hand: nextHand(),
    mode: 'guided',
    bpm: null,
    repetitions: 2,
    estMin: input.lengthMin === 5 ? 1.5 : 2,
  });

  return {
    schemaVersion: 1,
    date: input.date,
    timezone: input.timezone,
    revision: 1,
    generatedAt: (input.now ?? new Date()).toISOString(),
    rulesVersion: ROUTINE_RULES_VERSION,
    lengthMin: input.lengthMin,
    tasks,
    position: 0,
    status: 'not-started',
    taskStates: tasks.map((t) => ({ taskId: t.id, status: 'pending', attemptIds: [] })),
    swaps: [],
  };
}

/** Resolve a routine task into its phrase. */
export function taskPhrase(task: RoutineTask): Phrase {
  const key: Key = parseKeyId(task.keyId)!;
  const hand: OneHand = task.hand === 'left' ? 'left' : 'right';
  switch (task.pattern.kind) {
    case 'track':
      return trackPattern(task.track!, key, hand, task.level, task.pattern.example);
    case 'scale':
      return scalePattern({ key, hand }, 1, 'updown');
    case 'broken':
      return brokenChordPattern({ key, hand });
    case 'arpeggio':
      return arpeggioPattern({ key, hand });
  }
}

/** Swap to an equivalent example (Adjust routine); recorded as an explicit revision. */
export function swapTask(r: DailyRoutine, index: number, reason: string, now = new Date()): DailyRoutine {
  const t = r.tasks[index];
  if (!t.track) return r;
  const count = exampleCount(t.track, t.level);
  const next = { ...t, pattern: { ...t.pattern, example: (t.pattern.example + 1) % count } };
  const before = taskPhrase(t).patternId;
  return {
    ...r,
    revision: r.revision + 1,
    tasks: r.tasks.map((x, i) => (i === index ? next : x)),
    swaps: [...r.swaps, { at: now.toISOString(), taskIndex: index, from: before, to: taskPhrase(next).patternId, reason }],
  };
}

/** Lower a task's difficulty (level - 1) for today only. */
export function lowerTask(r: DailyRoutine, index: number, now = new Date()): DailyRoutine {
  const t = r.tasks[index];
  if (!t.track || t.level <= 1) return r;
  const next: RoutineTask = { ...t, level: t.level - 1, pattern: { ...t.pattern, example: 0 } };
  return {
    ...r,
    revision: r.revision + 1,
    tasks: r.tasks.map((x, i) => (i === index ? next : x)),
    swaps: [
      ...r.swaps,
      { at: now.toISOString(), taskIndex: index, from: taskPhrase(t).patternId, to: taskPhrase(next).patternId, reason: 'lower difficulty' },
    ],
  };
}

/** Change a task's key for today only. */
export function changeTaskKey(r: DailyRoutine, index: number, keyId: string, now = new Date()): DailyRoutine {
  const t = r.tasks[index];
  return {
    ...r,
    revision: r.revision + 1,
    tasks: r.tasks.map((x, i) => (i === index ? { ...t, keyId } : x)),
    swaps: [...r.swaps, { at: now.toISOString(), taskIndex: index, from: t.keyId, to: keyId, reason: 'change key' }],
  };
}
