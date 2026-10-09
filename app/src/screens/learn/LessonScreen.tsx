import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { lessonById, type ObserveDemo } from '../../content/lessons';
import { lessonStatus } from '../../engine/evidence';
import { useAttemptsStore } from '../../state/attemptsStore';
import { useSettingsStore } from '../../state/settingsStore';
import { launchSession } from '../../state/sessionRoute';
import { useReadyGate } from '../../components/ReadyGate';
import { StaffView } from '../../components/Staff';
import { Keyboard, keyboardWindow, type KeyState } from '../../components/Keyboard';
import { Pill } from '../../components/StatusPill';
import { ensureAudio, playNotes } from '../../audio/audioEngine';
import { midiOf } from '../../music/pitch';
import { onsetBeats } from '../../music/score';

const STEP_LABELS = { understand: 'Understand', observe: 'Observe', try: 'Try with help', recall: 'Recall', apply: 'Apply' };

export function LessonScreen() {
  const { lessonId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const lesson = lessonById(lessonId ?? '');
  const range = useSettingsStore((s) => s.settings.range);
  const { attempts, refresh } = useAttemptsStore();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const stepIndex = Math.max(0, Math.min(Number(params.get('step') ?? 0), (lesson?.steps.length ?? 1) - 1));
  const exercise = lesson?.steps[stepIndex]?.exercise;
  // Seeded preview of the step's exercise (counts, mode, whether it plays prompts).
  const preview = exercise ? exercise({ seed: 1, range }) : null;
  const needsAudio = !!preview?.items.some((i) => i.audio);
  const { guard, dialog } = useReadyGate({ needsAudio });

  if (!lesson) return <Navigate to="/learn" replace />;
  const step = lesson.steps[stepIndex];
  const st = lessonStatus(attempts, lesson.id);
  const doneSteps = new Set(attempts.filter((a) => a.kind === 'lesson' && a.sourceId.startsWith(`${lesson.id}:`) && a.status === 'completed').map((a) => a.sourceId.split(':')[1]));
  const goStep = (i: number) => setParams({ step: String(i) });

  const startExercise = () => {
    const spec = step.exercise!({ seed: Date.now() % 2147483647, range });
    const run = () =>
      launchSession(spec, navigate, {
        returnTo: `/learn/${lesson.id}?step=${stepIndex}`,
        next:
          stepIndex + 1 < lesson.steps.length
            ? { label: `Continue: ${STEP_LABELS[lesson.steps[stepIndex + 1].kind]}`, to: `/learn/${lesson.id}?step=${stepIndex + 1}` }
            : { label: 'Back to Learn', to: '/learn' },
      });
    guard(run);
  };

  return (
    <main className="screen stack">
      <div className="topbar">
        <div>
          <Link to="/learn" className="small">
            ← Learn
          </Link>
          <h1>{lesson.title}</h1>
          <p className="muted">{lesson.summary}</p>
        </div>
        <Pill kind={st.status === 'demonstrated' ? 'ok' : st.status === 'practising' ? 'accent' : undefined}>
          {st.status === 'demonstrated' ? 'Demonstrated' : st.status === 'practising' ? 'Practising' : 'Not started'}
        </Pill>
      </div>

      <div className="lesson-steps" role="tablist">
        {lesson.steps.map((s, i) => (
          <button key={s.kind} role="tab" aria-selected={i === stepIndex} className={`${i === stepIndex ? 'on' : ''} ${doneSteps.has(s.kind) ? 'done' : ''}`} onClick={() => goStep(i)}>
            {i + 1}. {STEP_LABELS[s.kind]}
          </button>
        ))}
      </div>

      <div className="card stack">
        <span className="eyebrow">{STEP_LABELS[step.kind]}</span>
        <h2 style={{ margin: 0 }}>{step.title}</h2>
        {step.text.map((t, i) => (
          <p key={i} style={{ fontSize: '1.1rem' }}>
            {t}
          </p>
        ))}
        {step.demo ? <ObservePlayer demo={step.demo} /> : null}
        {preview ? (
          <ExerciseIntro
            kind={step.kind}
            onStart={startExercise}
            preview={`${preview.mode === 'timed' ? `Timed at ${preview.bpm} BPM` : 'Guided'} · ${
              preview.mode === 'timed' ? `${(preview.repetitions ?? 1) * preview.phrases.length} attempts` : `${preview.items.length} items`
            }${preview.highlighted ? ' · target keys highlighted' : ''}`}
            needsAudio={needsAudio}
          />
        ) : null}
      </div>

      <div className="row between">
        <button disabled={stepIndex === 0} onClick={() => goStep(stepIndex - 1)}>
          ← Back
        </button>
        {stepIndex + 1 < lesson.steps.length ? (
          <button className={step.exercise ? '' : 'primary'} onClick={() => goStep(stepIndex + 1)}>
            {step.exercise ? 'Skip to' : 'Next:'} {STEP_LABELS[lesson.steps[stepIndex + 1].kind]} →
          </button>
        ) : (
          <button onClick={() => navigate('/learn')}>Finish lesson</button>
        )}
      </div>
      {st.checks.length ? (
        <details className="small">
          <summary>Evidence behind the status</summary>
          <ul>
            {st.checks.map((c, i) => (
              <li key={i}>
                {c.date}: {c.independent} of {c.total} first-try, unassisted
              </li>
            ))}
          </ul>
          <p className="muted">Demonstrated needs at least 90% in checks on two different days.</p>
        </details>
      ) : null}
      {dialog}
    </main>
  );
}

function ExerciseIntro({ kind, onStart, preview, needsAudio }: { kind: string; onStart: () => void; preview: string; needsAudio: boolean }) {
  return (
    <div className="stack">
      <div className="row">
        <Pill kind="accent">{preview}</Pill>
        {needsAudio ? <Pill kind="purple">Uses app sound</Pill> : null}
      </div>
      {kind === 'recall' || kind === 'apply' ? (
        <p className="small muted">No highlights. Hints stay available but are recorded, so the result shows what you did on your own.</p>
      ) : null}
      <div>
        <button className="primary big" onClick={onStart}>
          Start
        </button>
      </div>
    </div>
  );
}

/** Animated demonstration: staff, keyboard and sound together. Never learner input. */
export function ObservePlayer({ demo }: { demo: ObserveDemo }) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const range = useSettingsStore((s) => s.settings.range);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const play = async () => {
    await ensureAudio();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const beatMs = 60000 / (demo.bpm * (slow ? 0.6 : 1));
    const onsets = onsetBeats(demo.phrase);
    const t0 = performance.now() + 150;
    demo.phrase.events.forEach((e, i) => {
      const at = t0 + onsets[i] * beatMs;
      if (e.notes.length) playNotes(e.notes.map(midiOf), e.beats * beatMs * 0.92, at);
      timers.current.push(setTimeout(() => setCursor(i), at - performance.now()));
    });
    const end = t0 + onsets[onsets.length - 1] * beatMs + demo.phrase.events[demo.phrase.events.length - 1].beats * beatMs;
    timers.current.push(setTimeout(() => setCursor(null), end - performance.now()));
  };

  const all = demo.phrase.events.flatMap((e) => e.notes.map(midiOf));
  const win = keyboardWindow(all, 60, 72, { low: Math.max(21, range.low), high: Math.min(108, range.high) });
  const states = new Map<number, KeyState>();
  const shown = cursor !== null ? demo.phrase.events[cursor] : null;
  for (const n of shown?.notes ?? []) states.set(midiOf(n), 'reveal');
  return (
    <div className="stack">
      <StaffView
        events={demo.phrase.events}
        keySig={demo.phrase.key}
        clef={demo.clef === 'grand' ? 'grand' : demo.clef}
        cursor={cursor}
        labels={demo.labels}
        showFingering
        bars={demo.phrase.patternId !== 'demo' || demo.phrase.events.length > 3}
      />
      <Keyboard low={win.low} high={win.high} states={states} />
      <div className="row">
        <button className="primary" onClick={() => void play()}>
          ▶ Play demonstration
        </button>
        <label className="check">
          <input type="checkbox" checked={slow} onChange={(e) => setSlow(e.target.checked)} /> Slower
        </label>
      </div>
    </div>
  );
}
