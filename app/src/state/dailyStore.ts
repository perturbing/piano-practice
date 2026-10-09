import { create } from 'zustand';
import type { Attempt, DailyRoutine, RoutineTask, SkillState } from '../data/schema';
import { getRoutine, saveRoutine } from '../data/repositories/routines';
import { listAttempts } from '../data/repositories/attempts';
import { loadSkills, saveSkills } from '../data/repositories/skills';
import { localDateIn } from '../data/ids';
import { generateRoutine, taskPhrase, tempoKey } from '../engine/dailyRoutine';
import { guidedPhraseSpec, timedPhraseSpec, type ExerciseSpec } from '../engine/exercise';
import { levelUpAvailable, tempoOfferFor, trackEvidence } from '../engine/evidence';
import { MAX_BPM, TEMPO_STEP_BPM } from '../engine/progression';
import { parseKeyId } from '../music/keys';
import { subdivisionOf, type SkillTrack } from '../music/patterns';
import { usePracticeStore } from './practiceStore';
import { useSettingsStore } from './settingsStore';

export const BREAK_SECONDS = 12;

export interface DailyOffer {
  kind: 'tempo' | 'level';
  taskId: string;
  label: string;
  tempoKey?: string;
  bpm?: number;
  track?: SkillTrack;
  level?: number;
  accepted?: boolean;
}

interface DailyState {
  routine: DailyRoutine | null;
  skills: SkillState | null;
  /** The routine is being run on the live screen. */
  active: boolean;
  stage: 'idle' | 'task' | 'break' | 'summary';
  breakEndsAt: number | null;
  breakPaused: boolean;
  /** Remaining break time while the break is paused. */
  breakRemainingMs: number | null;
  /** Attempts completed in this sitting, by task id. */
  results: Record<string, Attempt>;
  offers: DailyOffer[];
  load: () => Promise<void>;
  setRoutine: (r: DailyRoutine) => Promise<void>;
  /** Rebuild today's routine from current settings, only if no task has started. */
  regenerate: () => Promise<void>;
  start: () => Promise<void>;
  extendBreak: () => void;
  toggleBreakPause: () => void;
  nextNow: () => void;
  skipTask: () => void;
  endSession: () => void;
  acceptOffer: (o: DailyOffer) => Promise<void>;
  close: () => void;
}

let breakTimer: ReturnType<typeof setInterval> | null = null;

const settings = () => useSettingsStore.getState().settings;

function dateMinusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function taskSpec(task: RoutineTask, routine: DailyRoutine): ExerciseSpec {
  const phrase = taskPhrase(task);
  const key = parseKeyId(task.keyId)!;
  const tk = tempoKey(phrase.patternId, task.keyId, task.hand, task.level, subdivisionOf(phrase));
  const base = {
    kind: 'daily' as const,
    sourceId: `daily:${task.slot}`,
    title: `${task.title} · ${phrase.title}`,
    instruction: task.mode === 'timed' ? 'Play with the beat after the count-in' : 'Play the pattern',
    key,
    phrases: [phrase],
    highlighted: false,
    hints: task.mode === 'guided',
    showKeyboard: true,
    showFingering: true,
    bpm: task.bpm ?? undefined,
    repetitions: task.mode === 'timed' ? task.repetitions : undefined,
    profile: 'standard' as const,
    settings: {
      slot: task.slot,
      track: task.track,
      level: task.level,
      patternId: phrase.patternId,
      keyId: task.keyId,
      hand: task.hand,
      tempoKey: tk,
      reason: task.reason,
    },
    skills: [...(task.track ? [`track:${task.track}:L${task.level}`] : []), `pattern:${phrase.patternId}:${task.keyId}`],
    routineDate: routine.date,
    taskId: task.id,
  };
  return task.mode === 'timed' ? timedPhraseSpec(base) : guidedPhraseSpec(base, task.repetitions);
}

export const useDailyStore = create<DailyState>((set, get) => {
  const save = async (r: DailyRoutine) => {
    set({ routine: r });
    await saveRoutine(r);
  };

  const clearBreak = () => {
    if (breakTimer) clearInterval(breakTimer);
    breakTimer = null;
  };

  const runTask = (index: number) => {
    const r = get().routine;
    if (!r) return;
    const task = r.tasks[index];
    if (!task) {
      void finishRoutine();
      return;
    }
    set({ stage: 'task', breakEndsAt: null });
    void usePracticeStore.getState().start(taskSpec(task, r), { onFinished: (a) => void onTaskFinished(index, a) });
  };

  const onTaskFinished = async (index: number, a: Attempt) => {
    const r = get().routine;
    if (!r || !get().active) return;
    const task = r.tasks[index];
    const skipped = (a.itemResults ?? []).every((x) => x.outcome === 'skipped') && a.mode === 'guided';
    const status = a.status === 'completed' ? (skipped ? 'skipped' : 'done') : a.events.some((e) => e.type === 'skip') ? 'skipped' : 'partial';
    const taskStates = r.taskStates.map((t) =>
      t.taskId === task.id ? { ...t, status: status as typeof t.status, attemptIds: [...t.attemptIds, a.id] } : t,
    );
    const next = { ...r, taskStates, position: Math.max(r.position, index + 1), status: 'in-progress' as const };
    await save(next);
    set({ results: { ...get().results, [task.id]: a } });
    await collectOffers(task, a);
    if (get().stage === 'summary') return; // session ended early
    if (index + 1 >= r.tasks.length) {
      await finishRoutine();
      return;
    }
    // Visible reset break, then the next task loads with its own count-in.
    set({ stage: 'break', breakEndsAt: Date.now() + BREAK_SECONDS * 1000, breakPaused: false });
    clearBreak();
    breakTimer = setInterval(() => {
      const s = get();
      if (s.stage !== 'break' || s.breakPaused || !s.breakEndsAt) return;
      if (Date.now() >= s.breakEndsAt) {
        clearBreak();
        runTask(index + 1);
      }
    }, 200);
  };

  const collectOffers = async (task: RoutineTask, a: Attempt) => {
    const offers: DailyOffer[] = [];
    const tk = String(a.settings.tempoKey ?? '');
    if (a.mode === 'timed' && task.bpm && tempoOfferFor(a) && task.bpm + TEMPO_STEP_BPM <= MAX_BPM) {
      offers.push({
        kind: 'tempo',
        taskId: task.id,
        label: `${task.title}: two clean attempts at ${task.bpm} BPM. Try ${task.bpm + TEMPO_STEP_BPM} BPM next time?`,
        tempoKey: tk,
        bpm: task.bpm + TEMPO_STEP_BPM,
      });
    }
    if (task.track && task.slot !== 'settle') {
      const all = await listAttempts();
      if (levelUpAvailable(all, task.track, task.level)) {
        offers.push({
          kind: 'level',
          taskId: task.id,
          label: `${task.title}: level ${task.level} demonstrated across fresh examples on two days. Try level ${task.level + 1}?`,
          track: task.track,
          level: task.level + 1,
        });
      }
    }
    if (offers.length) set({ offers: [...get().offers.filter((o) => o.taskId !== task.id), ...offers] });
  };

  const prepare = async (date: string, skills: SkillState) => {
    const st = settings();
    const attempts = await listAttempts();
    return generateRoutine({
      date,
      timezone: st.timezone,
      lengthMin: st.sessionLengthMin,
      keyPool: st.keyPool,
      hands: st.dailyHands,
      skills,
      recent: trackEvidence(attempts, dateMinusDays(date, 14)),
    });
  };

  const finishRoutine = async () => {
    clearBreak();
    const r = get().routine;
    if (r) {
      const allDone = r.taskStates.every((t) => t.status !== 'pending');
      await save({ ...r, status: allDone ? 'done' : 'in-progress' });
    }
    set({ stage: 'summary', breakEndsAt: null });
  };

  return {
    routine: null,
    skills: null,
    active: false,
    stage: 'idle',
    breakEndsAt: null,
    breakPaused: false,
    breakRemainingMs: null,
    results: {},
    offers: [],

    load: async () => {
      const date = localDateIn(settings().timezone);
      const skills = await loadSkills();
      let r = await getRoutine(date);
      if (!r) {
        // A new day prepares a new routine; earlier partial records stay as they are.
        r = await prepare(date, skills);
        await saveRoutine(r);
      }
      set({ routine: r, skills });
    },

    regenerate: async () => {
      const r = get().routine;
      if (!r || r.taskStates.some((t) => t.status !== 'pending')) return;
      const skills = get().skills ?? (await loadSkills());
      const fresh = await prepare(r.date, skills);
      await save({ ...fresh, revision: r.revision + 1, swaps: r.swaps });
    },

    setRoutine: async (r) => save(r),

    start: async () => {
      const r = get().routine;
      if (!r) return;
      set({ active: true, results: {}, offers: [] });
      const first = r.taskStates.findIndex((t) => t.status === 'pending');
      // After Done, further practice is another attempt: start from the top.
      runTask(first === -1 ? 0 : first);
    },

    extendBreak: () => {
      const s = get();
      if (s.breakEndsAt) set({ breakEndsAt: s.breakEndsAt + 20_000 });
    },

    toggleBreakPause: () => {
      const s = get();
      if (!s.breakEndsAt) return;
      // Keep the remaining time while paused.
      if (s.breakPaused) set({ breakPaused: false, breakEndsAt: Date.now() + (s.breakRemainingMs ?? 0), breakRemainingMs: null });
      else set({ breakPaused: true, breakRemainingMs: Math.max(0, s.breakEndsAt - Date.now()) });
    },

    nextNow: () => {
      const r = get().routine;
      if (!r || get().stage !== 'break') return;
      clearBreak();
      runTask(r.position);
    },

    skipTask: () => {
      const p = usePracticeStore.getState();
      if (p.attempt) p.attempt.events.push({ t: 0, type: 'skip', detail: { task: true } });
      p.end();
    },

    endSession: () => {
      clearBreak();
      set({ stage: 'summary' });
      const p = usePracticeStore.getState();
      if (p.phase !== 'finished' && p.phase !== 'idle') p.end();
      void finishRoutine();
    },

    acceptOffer: async (o) => {
      const skills = { ...(get().skills ?? (await loadSkills())) };
      if (o.kind === 'tempo' && o.tempoKey && o.bpm) {
        skills.workingTempos = { ...skills.workingTempos, [o.tempoKey]: o.bpm };
      }
      if (o.kind === 'level' && o.track && o.level) {
        const from = skills.levels[o.track];
        skills.levels = { ...skills.levels, [o.track]: o.level };
        skills.levelHistory = [...skills.levelHistory, { track: o.track, from, to: o.level, at: new Date().toISOString(), reason: 'accepted offer' }];
      }
      await saveSkills(skills);
      set({ skills, offers: get().offers.map((x) => (x === o ? { ...x, accepted: true } : x)) });
    },

    close: () => {
      clearBreak();
      usePracticeStore.getState().reset();
      set({ active: false, stage: 'idle', breakEndsAt: null });
    },
  };
});

/** Build a quick-look list for the Daily tab preview. */
export function taskSummary(task: RoutineTask): string {
  const p = taskPhrase(task);
  const parts = [p.title];
  if (task.mode === 'timed' && task.bpm) parts.push(`${task.bpm} BPM, ${subdivisionOf(p) === 2 ? 'eighth notes' : 'quarter notes'}`);
  parts.push(`${task.estMin} min`);
  return parts.join(' · ');
}
