import { create } from 'zustand';
import type { Attempt, AttemptEvent, TimedSegment } from '../data/schema';
import { saveAttempt } from '../data/repositories/attempts';
import { localDateIn, newId } from '../data/ids';
import { keyId } from '../music/keys';
import { midiOf } from '../music/pitch';
import { onsetBeats, totalBeats } from '../music/score';
import { subdivisionOf } from '../music/patterns';
import { CONTENT_REVISION, resolvePhrase, type ExerciseSpec } from '../engine/exercise';
import { DEFAULT_SETTLE_MS, GUIDED_EVALUATOR_VERSION, GuidedEvaluator, type GuidedFeedback } from '../engine/guided';
import { timedTargetsFromPhrase, type TimedTarget } from '../engine/targets';
import {
  TIMED_EVALUATOR_VERSION,
  closesAt,
  evaluateTimed,
  timedConfig,
  type Attack,
  type TimedConfig,
  type TimedResult,
} from '../engine/timed';
import { MIN_BPM, segmentQualifies } from '../engine/progression';
import { clearHeld, currentTimestampSource, heldNotes, onConnection, onInput, sustainOn, type InputMessage } from '../midi/inputManager';
import { click, ensureAudio, learnerAllOff, playNotes, stopScheduled } from '../audio/audioEngine';
import { useDeviceStore, readiness } from './deviceStore';
import { useSettingsStore } from './settingsStore';

export type PracticePhase =
  | 'idle'
  | 'countIn'
  | 'playing'
  | 'segmentResult'
  | 'keyChange'
  | 'demo'
  | 'paused'
  | 'recovering'
  | 'finished';

export type PauseReason = 'user' | 'hidden' | 'disconnected';

export interface LiveSegment {
  phraseIndex: number;
  rep: number;
  bpm: number;
  beatMs: number;
  countInStart: number;
  /** performance.now() of the first beat. */
  startPerf: number;
  endPerf: number;
  targets: TimedTarget[];
  attacks: Attack[];
  cfg: TimedConfig;
  live: TimedResult | null;
}

export interface FinishOptions {
  onFinished?: (a: Attempt) => void;
}

interface PracticeState {
  spec: ExerciseSpec | null;
  attempt: Attempt | null;
  phase: PracticePhase;
  pauseReason: PauseReason | null;
  guided: GuidedEvaluator | null;
  feedback: (GuidedFeedback & { at: number }) | null;
  segment: LiveSegment | null;
  lastSegment: TimedSegment | null;
  bpm: number;
  beat: { n: number; accent: boolean; countIn: boolean } | null;
  demoEvent: number | null;
  nextAt: number | null;
  /** Saving failed: shown to the learner with an immediate export. */
  saveError: string | null;
  version: number;

  start: (spec: ExerciseSpec, opts?: FinishOptions) => Promise<void>;
  pause: (reason: PauseReason) => void;
  resume: () => void;
  hint: () => void;
  skip: () => void;
  slower: () => void;
  demo: () => void;
  replayAudio: () => void;
  answer: (label: string) => void;
  end: () => void;
  reset: () => void;
}

// Module-level runtime (not reactive).
let timer: ReturnType<typeof setInterval> | null = null;
let unsubs: (() => void)[] = [];
let attemptT0 = 0;
let opts: FinishOptions = {};
let saveChain: Promise<void> = Promise.resolve();
let lastSaveAt = 0;
let lastLiveEval = 0;
let recoveryStableSince: number | null = null;
let demoTimers: ReturnType<typeof setTimeout>[] = [];
let resultTimer: ReturnType<typeof setTimeout> | null = null;
/** Timed segment to (re)start after a pause, demonstration or recovery. */
let pendingRestart: { phraseIndex: number; rep: number } | null = null;

const settings = () => useSettingsStore.getState().settings;
const now = () => performance.now();

export const usePracticeStore = create<PracticeState>((set, get) => {
  const bump = () => set((s) => ({ version: s.version + 1 }));

  const rel = (t: number) => Math.round((t - attemptT0) * 10) / 10;

  const record = (e: AttemptEvent) => {
    get().attempt?.events.push(e);
  };

  const persist = (force = false) => {
    const a = get().attempt;
    if (!a) return;
    if (!force && now() - lastSaveAt < 3000) return;
    lastSaveAt = now();
    const snapshot = structuredClone(a);
    saveChain = saveChain
      .then(() => saveAttempt(snapshot))
      .then(() => {
        if (get().saveError) set({ saveError: null });
      })
      .catch((e) => {
        console.error('piano-app: save failed', e);
        set({ saveError: e instanceof Error ? e.message.slice(0, 300) : String(e) });
      });
  };

  const soundOn = () => settings().soundMode !== 'visual';

  // --- guided -----------------------------------------------------------

  const playItemAudio = () => {
    const ev = get().guided;
    const item = ev?.current;
    if (item?.audio && soundOn()) playNotes(item.audio, 1200);
  };

  const applyFeedback = (fb: GuidedFeedback, t: number) => {
    if (fb.kind === 'none') return;
    const before = get().guided?.index;
    set({ feedback: { ...fb, at: t } });
    if (fb.kind === 'done') {
      finish('completed');
      return;
    }
    if (fb.kind === 'correct') {
      persist(true);
      if (get().guided?.index !== before) setTimeout(playItemAudio, 250);
    }
  };

  // --- timed ------------------------------------------------------------

  const startSegment = (phraseIndex: number, rep: number) => {
    const spec = get().spec!;
    const phrase = spec.phrases[phraseIndex];
    const bpm = get().bpm;
    const beatMs = 60000 / bpm;
    const countInBeats = phrase.beatsPerBar;
    const countInStart = now() + 500;
    const startPerf = countInStart + countInBeats * beatMs;
    const targets = timedTargetsFromPhrase(phrase, beatMs);
    const cfg = timedConfig(beatMs, spec.profile ?? 'standard');
    const tolerances = evaluateTimed(targets, [], cfg, 0).tolerances;
    const lastClose = Math.max(0, ...targets.map((t, i) => closesAt(t, tolerances[i])));
    const endPerf = startPerf + Math.max(totalBeats(phrase) * beatMs, lastClose) + 150;

    if (soundOn()) {
      for (let i = 0; i < countInBeats; i++) click(countInStart + i * beatMs, i === 0);
      if (settings().metronome) {
        const beats = Math.ceil(totalBeats(phrase));
        for (let b = 0; b < beats; b++) click(startPerf + b * beatMs, b % phrase.beatsPerBar === 0);
      }
    }
    record({ t: rel(countInStart), type: 'countIn', detail: { bpm, beats: countInBeats } });
    record({ t: rel(startPerf), type: 'segmentStart', detail: { phrase: phraseIndex, rep, bpm, key: keyId(phrase.key) } });
    set({
      phase: 'countIn',
      segment: { phraseIndex, rep, bpm, beatMs, countInStart, startPerf, endPerf, targets, attacks: [], cfg, live: null },
      lastSegment: null,
    });
  };

  const finalizeSegment = (status: TimedSegment['status']) => {
    const seg = get().segment;
    const spec = get().spec;
    const attempt = get().attempt;
    if (!seg || !spec || !attempt) return null;
    const result = evaluateTimed(seg.targets, seg.attacks, seg.cfg);
    const phrase = spec.phrases[seg.phraseIndex];
    const out: TimedSegment = {
      index: attempt.segments?.length ?? 0,
      keyId: keyId(phrase.key),
      bpm: seg.bpm,
      subdivision: subdivisionOf(phrase),
      startT: rel(seg.startPerf),
      status,
      toleranceConfig: seg.cfg,
      attacks: seg.attacks,
      targets: seg.targets,
      outcomes: result.targets as unknown as Record<string, unknown>[],
      // An incomplete segment is excluded from timing summaries.
      summary: status === 'complete' ? result.summary : null,
      qualifies: false,
      assisted: false,
    };
    out.qualifies =
      status === 'complete' &&
      segmentQualifies({ settingsKey: '', complete: true, assisted: false, interrupted: false, summary: result.summary });
    attempt.segments = [...(attempt.segments ?? []), out];
    record({ t: rel(now()), type: 'segmentEnd', detail: { status, index: out.index } });
    persist(true);
    set({ segment: null, lastSegment: out });
    return out;
  };

  const advanceAfterSegment = (phraseIndex: number, rep: number) => {
    const spec = get().spec!;
    const reps = spec.repetitions ?? 1;
    set({ phase: 'segmentResult', nextAt: now() + 2600 });
    resultTimer = setTimeout(() => {
      if (get().phase !== 'segmentResult') return;
      if (rep + 1 < reps) startSegment(phraseIndex, rep + 1);
      else if (phraseIndex + 1 < spec.phrases.length) {
        // Explicit transition between keys: show the next key, then a new count-in.
        set({ phase: 'keyChange', nextAt: now() + 3000 });
        resultTimer = setTimeout(() => {
          if (get().phase === 'keyChange') startSegment(phraseIndex + 1, 0);
        }, 3000);
      } else finish('completed');
    }, 2600);
  };

  // --- input ------------------------------------------------------------

  const onMessage = (m: InputMessage) => {
    const s = get();
    if (!s.spec || !s.attempt || s.phase === 'finished') return;
    const ev = m.event;
    if (ev.type === 'noteon' || ev.type === 'noteoff')
      record({ t: rel(ev.t), type: ev.type, note: ev.note, velocity: ev.velocity });
    else if (ev.type === 'sustain') record({ t: rel(ev.t), type: 'sustain', detail: { on: ev.on, value: ev.value } });
    else record({ t: rel(ev.t), type: 'reset', detail: { channel: ev.channel } });

    // Demonstration playback is never learner input; paused input is not scored.
    if (s.phase === 'demo' || s.phase === 'paused' || s.phase === 'recovering') {
      bump();
      return;
    }

    if (s.spec.mode === 'guided' && s.guided && s.phase === 'playing') {
      for (const c of m.changes) {
        if (c.kind === 'attack') applyFeedback(s.guided.onAttack(c.note, c.t, m.held), c.t);
        else if (c.kind === 'release' || c.kind === 'reset') applyFeedback(s.guided.onRelease(c.t, m.held), c.t);
        if (get().phase === 'finished') return;
      }
    }

    if (s.spec.mode === 'timed' && s.segment && (s.phase === 'countIn' || s.phase === 'playing')) {
      const seg = s.segment;
      for (const c of m.changes) {
        if (c.kind !== 'attack') continue;
        const t = c.t - seg.startPerf;
        // Noodling during the count-in is ignored; an early first note still counts.
        if (t < -2 * seg.cfg.maxToleranceMs) continue;
        seg.attacks.push({ note: c.note, t: Math.round(t * 10) / 10 });
      }
    }
    bump();
  };

  const onConn = (n: { kind: string }) => {
    const s = get();
    record({ t: rel(now()), type: 'connection', detail: { kind: n.kind } });
    if (n.kind === 'disconnected' && s.phase !== 'finished' && s.phase !== 'idle' && s.phase !== 'paused') get().pause('disconnected');
    bump();
  };

  const onVisibility = () => {
    const s = get();
    if (document.hidden && s.phase !== 'finished' && s.phase !== 'idle' && s.phase !== 'paused') get().pause('hidden');
  };

  // --- clock ------------------------------------------------------------

  const tickFn = () => {
    const s = get();
    const t = now();
    if (s.phase === 'playing' && s.guided) {
      const fb = s.guided.tick(t, heldNotes());
      if (fb.kind !== 'none') applyFeedback(fb, t);
    }
    if ((s.phase === 'countIn' || s.phase === 'playing') && s.segment) {
      const seg = s.segment;
      const sinceCount = t - seg.countInStart;
      const n = Math.floor(sinceCount / seg.beatMs);
      const inCount = t < seg.startPerf;
      const beatIndex = inCount ? n : Math.floor((t - seg.startPerf) / seg.beatMs);
      const beatsPerBar = s.spec!.phrases[seg.phraseIndex].beatsPerBar;
      const beat = sinceCount >= 0 ? { n: inCount ? n + 1 : (beatIndex % beatsPerBar) + 1, accent: inCount ? n === 0 : beatIndex % beatsPerBar === 0, countIn: inCount } : null;
      if (!s.beat || beat?.n !== s.beat.n || beat?.countIn !== s.beat.countIn) set({ beat });
      if (s.phase === 'countIn' && t >= seg.startPerf - seg.cfg.maxToleranceMs) set({ phase: 'playing' });
      if (t - lastLiveEval > 80) {
        lastLiveEval = t;
        seg.live = evaluateTimed(seg.targets, seg.attacks, seg.cfg, t - seg.startPerf);
        bump();
      }
      if (t >= seg.endPerf) {
        const { phraseIndex, rep } = seg;
        const out = finalizeSegment('complete');
        set({ beat: null });
        if (out) advanceAfterSegment(phraseIndex, rep);
      }
    }
    if (s.phase === 'recovering') {
      const r = readiness(useDeviceStore.getState());
      const ok = heldNotes().length === 0 && !sustainOn() && r.state === 'ready';
      if (!ok) recoveryStableSince = null;
      else if (recoveryStableSince === null) recoveryStableSince = t;
      else if (t - recoveryStableSince > 600) continueAfterRecovery();
    }
    if (s.phase !== 'finished') persist();
  };

  const continueAfterRecovery = () => {
    recoveryStableSince = null;
    const s = get();
    record({ t: rel(now()), type: 'recovered' });
    if (s.spec?.mode === 'guided') {
      s.guided?.resetTransient();
      set({ phase: 'playing', pauseReason: null, feedback: null });
      playItemAudio();
    } else {
      // Restart the interrupted segment with a new count-in.
      const r = pendingRestart ?? { phraseIndex: 0, rep: 0 };
      pendingRestart = null;
      set({ pauseReason: null });
      startSegment(r.phraseIndex, r.rep);
    }
  };

  const finish = (status: Attempt['status']) => {
    const s = get();
    const a = s.attempt;
    if (!a || s.phase === 'finished') return;
    if (s.segment) finalizeSegment(status === 'completed' ? 'complete' : 'interrupted');
    teardown();
    a.status = status;
    a.endedAt = new Date().toISOString();
    if (s.guided) a.itemResults = structuredClone(s.guided.results);
    record({ t: rel(now()), type: status === 'completed' ? 'segmentEnd' : 'interruption', detail: { finish: status } });
    persist(true);
    set({ phase: 'finished', beat: null, nextAt: null });
    const done = opts.onFinished;
    void saveChain.then(() => done?.(a));
  };

  const teardown = () => {
    if (timer) clearInterval(timer);
    timer = null;
    for (const u of unsubs) u();
    unsubs = [];
    for (const d of demoTimers) clearTimeout(d);
    demoTimers = [];
    if (resultTimer) clearTimeout(resultTimer);
    resultTimer = null;
    stopScheduled();
  };

  return {
    spec: null,
    attempt: null,
    phase: 'idle',
    pauseReason: null,
    guided: null,
    feedback: null,
    segment: null,
    lastSegment: null,
    bpm: 60,
    beat: null,
    demoEvent: null,
    nextAt: null,
    saveError: null,
    version: 0,

    start: async (spec, o = {}) => {
      teardown();
      opts = o;
      pendingRestart = null;
      // Called from a tap: start audio within the gesture, but never let it delay
      // the session state (the live screen renders immediately).
      const audio = ensureAudio();
      const st = settings();
      const dev = useDeviceStore.getState();
      attemptT0 = now();
      const keys = spec.phrases.length ? spec.phrases.map((p) => keyId(p.key)) : [keyId(spec.key)];
      const source = dev.selected?.source;
      const attempt: Attempt = {
        schemaVersion: 1,
        id: newId('att'),
        kind: spec.kind,
        sourceId: spec.sourceId,
        ...(spec.presetId ? { presetId: spec.presetId, presetRevision: spec.presetRevision } : {}),
        ...(spec.routineDate ? { routineDate: spec.routineDate, taskId: spec.taskId } : {}),
        title: spec.title,
        startedAt: new Date().toISOString(),
        localDate: localDateIn(st.timezone),
        status: 'in-progress',
        mode: spec.mode,
        contentRevision: CONTENT_REVISION,
        evaluatorVersion: spec.mode === 'timed' ? TIMED_EVALUATOR_VERSION : GUIDED_EVALUATOR_VERSION,
        settings: { ...spec.settings, settleMs: DEFAULT_SETTLE_MS, highlighted: spec.highlighted },
        keyOrder: keys,
        skills: spec.skills,
        confirmedRange: { low: st.range.low, high: st.range.high, method: st.range.method },
        input: { source: source ?? 'none', route: dev.route, name: dev.selected?.name ?? 'none' },
        timing: {
          timestampSource: currentTimestampSource(source),
          clock: 'performance.now',
          offsetMs: 0,
          reliable: source !== 'virtual',
          ...(source === 'virtual' ? { note: 'On-screen/computer input: touch and key-repeat latency make timing approximate.' } : {}),
          ...(source === 'ble' ? { note: 'Bluetooth packet timestamps anchored to receive time.' } : {}),
        },
        ...(spec.seed !== undefined ? { seed: spec.seed } : {}),
        ...(spec.phrases.length === 1 ? { phrase: resolvePhrase(spec.phrases[0]) } : {}),
        ...(spec.phrases.length > 1 ? { phrases: spec.phrases.map(resolvePhrase) } : {}),
        ...(spec.items.length ? { items: spec.items } : {}),
        events: [],
        interruptions: 0,
      };
      const guided =
        spec.mode === 'guided'
          ? new GuidedEvaluator(
              spec.items,
              { settleMs: DEFAULT_SETTLE_MS, releaseBetweenItems: spec.releaseBetweenItems, highlighted: spec.highlighted, key: spec.key },
              attemptT0,
            )
          : null;
      set({
        spec,
        attempt,
        guided,
        phase: spec.mode === 'guided' ? 'playing' : 'idle',
        pauseReason: null,
        feedback: null,
        segment: null,
        lastSegment: null,
        bpm: spec.bpm ?? 60,
        beat: null,
        demoEvent: null,
        nextAt: null,
      });
      lastSaveAt = 0;
      persist(true);
      unsubs.push(onInput(onMessage), onConnection(onConn));
      document.addEventListener('visibilitychange', onVisibility);
      unsubs.push(() => document.removeEventListener('visibilitychange', onVisibility));
      timer = setInterval(tickFn, 20);
      if (spec.mode === 'timed') {
        // Clicks are scheduled on the audio clock, so wait for it before the count-in.
        await audio;
        if (get().attempt?.id === attempt.id) startSegment(0, 0);
      } else setTimeout(playItemAudio, 300);
    },

    pause: (reason) => {
      const s = get();
      if (!s.attempt || s.phase === 'finished' || s.phase === 'paused') return;
      if (resultTimer) clearTimeout(resultTimer);
      for (const d of demoTimers) clearTimeout(d);
      demoTimers = [];
      stopScheduled();
      learnerAllOff();
      if (s.segment) {
        pendingRestart = { phraseIndex: s.segment.phraseIndex, rep: s.segment.rep };
        finalizeSegment('interrupted');
      } else if (s.spec?.mode === 'timed' && (s.phase === 'segmentResult' || s.phase === 'keyChange')) {
        // Between segments: resume continues with the next one.
        const last = s.attempt.segments?.[s.attempt.segments.length - 1];
        const pi = last ? s.spec.phrases.findIndex((p) => keyId(p.key) === last.keyId) : 0;
        const done = (s.attempt.segments ?? []).filter((x) => x.keyId === last?.keyId && x.status === 'complete').length;
        const reps = s.spec.repetitions ?? 1;
        pendingRestart = done < reps ? { phraseIndex: pi, rep: done } : { phraseIndex: Math.min(pi + 1, s.spec.phrases.length - 1), rep: 0 };
      }
      s.guided?.resetTransient();
      s.attempt.interruptions++;
      record({ t: rel(now()), type: reason === 'user' ? 'pause' : 'interruption', detail: { reason } });
      persist(true);
      set({ phase: 'paused', pauseReason: reason, beat: null, demoEvent: null, nextAt: null });
    },

    resume: () => {
      if (get().phase !== 'paused') return;
      // Clear stale held-note state; the learner releases keys and pedal, then we continue.
      clearHeld();
      record({ t: rel(now()), type: 'resume' });
      recoveryStableSince = null;
      set({ phase: 'recovering' });
    },

    hint: () => {
      const s = get();
      if (!s.guided || s.phase !== 'playing') return;
      const level = s.guided.hint();
      record({ t: rel(now()), type: 'hint', detail: { level, item: s.guided.current?.id ?? '' } });
      bump();
    },

    skip: () => {
      const s = get();
      if (s.guided && s.phase === 'playing') {
        record({ t: rel(now()), type: 'skip', detail: { item: s.guided.current?.id ?? '' } });
        s.guided.skip(now(), heldNotes());
        if (s.guided.phase === 'done') finish('completed');
        else {
          set({ feedback: null });
          playItemAudio();
        }
        bump();
      }
    },

    slower: () => {
      const s = get();
      if (s.spec?.mode !== 'timed') return;
      const bpm = Math.max(MIN_BPM, Math.round(s.bpm * 0.9));
      record({ t: rel(now()), type: 'tempo', detail: { from: s.bpm, to: bpm } });
      set({ bpm });
      // Tempo never changes during an attempt: restart the current segment at the new tempo.
      if (s.segment && (s.phase === 'countIn' || s.phase === 'playing')) {
        const { phraseIndex, rep } = s.segment;
        stopScheduled();
        finalizeSegment('restarted');
        startSegment(phraseIndex, rep);
      }
    },

    demo: () => {
      const s = get();
      if (!s.spec || !s.spec.demo || s.phase === 'demo' || s.phase === 'finished') return;
      const phraseIndex = s.segment?.phraseIndex ?? s.guided?.current?.phraseIndex ?? pendingRestart?.phraseIndex ?? 0;
      const phrase = s.spec.phrases[Math.min(phraseIndex, s.spec.phrases.length - 1)];
      if (!phrase) return;
      if (s.segment) {
        pendingRestart = { phraseIndex: s.segment.phraseIndex, rep: s.segment.rep };
        stopScheduled();
        finalizeSegment('restarted');
      }
      if (resultTimer) clearTimeout(resultTimer);
      const beatMs = 60000 / Math.min(s.bpm, 80);
      const t0 = now() + 300;
      const onsets = onsetBeats(phrase);
      record({ t: rel(t0), type: 'demo', detail: { patternId: phrase.patternId } });
      phrase.events.forEach((e, i) => {
        const at = t0 + onsets[i] * beatMs;
        if (e.notes.length && soundOn()) playNotes(e.notes.map(midiOf), e.beats * beatMs * 0.9, at);
        demoTimers.push(setTimeout(() => set({ demoEvent: i }), at - now()));
      });
      const endAt = t0 + totalBeats(phrase) * beatMs;
      set({ phase: 'demo' });
      demoTimers.push(
        setTimeout(() => {
          set({ demoEvent: null });
          if (get().phase !== 'demo') return;
          if (s.spec!.mode === 'timed') {
            // Back to a fresh count-in once keys are released.
            set({ phase: 'recovering' });
            if (!pendingRestart) pendingRestart = { phraseIndex, rep: 0 };
          } else set({ phase: 'playing' });
        }, endAt - now() + 200),
      );
    },

    replayAudio: playItemAudio,

    answer: (label) => {
      const s = get();
      if (!s.guided || s.phase !== 'playing') return;
      applyFeedback(s.guided.answerChoice(label, now()), now());
      bump();
    },

    end: () => finish('ended-early'),

    reset: () => {
      teardown();
      set({ spec: null, attempt: null, guided: null, phase: 'idle', segment: null, lastSegment: null, feedback: null, beat: null });
    },
  };
});
