import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDailyStore, taskSummary } from '../../state/dailyStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useSessionRoute } from '../../state/sessionRoute';
import { useReadyGate } from '../../components/ReadyGate';
import { DevicePill, Pill } from '../../components/StatusPill';
import { KeyPicker } from '../../components/KeyPicker';
import { changeTaskKey, lowerTask, swapTask, taskPhrase } from '../../engine/dailyRoutine';
import { LEVEL_DESCRIPTIONS, SKILL_TRACKS, TRACK_LABELS } from '../../music/patterns';
import { keyName, parseKeyId, allKeys, keyId } from '../../music/keys';
import { saveSkills } from '../../data/repositories/skills';
import type { DailyRoutine } from '../../data/schema';

export function DailyScreen() {
  const navigate = useNavigate();
  const daily = useDailyStore();
  const settings = useSettingsStore((s) => s.settings);
  const [adjust, setAdjust] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const { guard, dialog } = useReadyGate();

  useEffect(() => {
    void daily.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.timezone]);

  const r = daily.routine;
  if (!r) return <main className="screen">Preparing today’s routine…</main>;
  const doneCount = r.taskStates.filter((t) => t.status !== 'pending').length;
  const started = r.status === 'in-progress' && doneCount > 0;
  const done = r.status === 'done';
  const anyDone = r.taskStates.some((t) => t.status === 'done');

  const start = () =>
    guard(() => {
      useSessionRoute.getState().set({ returnTo: '/daily', next: null });
      void daily.start();
      navigate('/session');
    });

  return (
    <main className="screen stack">
      <div className="topbar">
        <h1>Daily trainer</h1>
        <DevicePill />
      </div>

      <div className="card stack">
        <div className="row between">
          <Pill kind="accent">DAILY TRAINER · {r.date}</Pill>
          <span className="muted small">
            {doneCount} of {r.tasks.length} tasks done
          </span>
        </div>
        <h2 style={{ margin: 0 }}>{done ? (anyDone ? 'Done for today' : 'Session ended — nothing completed today') : `Your ${r.lengthMin}-minute routine`}</h2>
        <div className="list">
          {r.tasks.map((t, i) => {
            const st = r.taskStates[i];
            const phrase = taskPhrase(t);
            return (
              <div key={t.id} className="stack tight">
                <button className={`list-item card clickable ${i === r.position && !done ? 'current' : ''}`} style={{ boxShadow: 'none' }} onClick={() => setOpenTask(openTask === t.id ? null : t.id)} aria-expanded={openTask === t.id}>
                  <div className="row between" style={{ width: '100%' }}>
                    <div className="grow">
                      <strong>
                        {i + 1}. {t.title}
                      </strong>
                      <div className="small muted">{taskSummary(t)}</div>
                    </div>
                    {st.status !== 'pending' ? <Pill kind={st.status === 'done' ? 'ok' : 'warn'}>{st.status}</Pill> : null}
                  </div>
                </button>
                {openTask === t.id ? (
                  <div className="small muted" style={{ padding: '0 0.9rem 0.5rem' }}>
                    <div>Why: {t.reason}</div>
                    <div>
                      {t.track ? `${TRACK_LABELS[t.track]} level ${t.level} · ` : ''}
                      {keyName(parseKeyId(t.keyId)!)} · hand instruction: {t.hand} · {t.mode}
                      {t.bpm ? ` at ${t.bpm} BPM` : ''} · {t.mode === 'timed' ? `${t.repetitions} short attempts` : `${t.repetitions} passes`}
                    </div>
                    <div>{phrase.fingeringNote}</div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="primary big" onClick={start}>
            {done ? 'Practise again (another attempt)' : started ? 'Resume session' : 'Start today’s session'}
          </button>
          <button className="ghost" onClick={() => setAdjust(true)}>
            Adjust routine
          </button>
        </div>
        <p className="small muted">
          Press Start and follow along: demonstrations, count-ins, short attempts and reset breaks run automatically. Pause, Slower and Skip are always
          there. Missed days don’t create homework or erase progress.
        </p>
      </div>

      <h2>Levels by skill</h2>
      <div className="grid">
        {SKILL_TRACKS.map((t) => {
          const lv = daily.skills?.levels[t] ?? 1;
          return (
            <div key={t} className="card stack tight">
              <div className="row between">
                <strong>{TRACK_LABELS[t]}</strong>
                <Pill kind="purple">Level {lv}</Pill>
              </div>
              <span className="small muted">{LEVEL_DESCRIPTIONS[t][lv - 1]}</span>
            </div>
          );
        })}
      </div>
      <p className="tiny muted">
        Levels are proposed exercise levels, not piano grades. MIDI checks notes, order and timing — it can’t see which finger or hand played, so
        results never claim finger technique.
      </p>

      {adjust ? <AdjustDrawer routine={r} onClose={() => setAdjust(false)} /> : null}
      {dialog}
    </main>
  );
}

function AdjustDrawer({ routine, onClose }: { routine: DailyRoutine; onClose: () => void }) {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const daily = useDailyStore();
  const [keyFor, setKeyFor] = useState<number | null>(null);

  const regenerate = async (patch: Partial<typeof settings>) => {
    await update(patch);
    await daily.regenerate();
  };

  const setLevel = async (track: (typeof SKILL_TRACKS)[number], level: number) => {
    const skills = daily.skills!;
    const next = {
      ...skills,
      levels: { ...skills.levels, [track]: level },
      levelHistory: [...skills.levelHistory, { track, from: skills.levels[track], to: level, at: new Date().toISOString(), reason: 'adjusted by learner' }],
    };
    await saveSkills(next);
    useDailyStore.setState({ skills: next });
    await daily.regenerate();
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer stack" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>Adjust routine</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <p className="small muted">Optional. Changes are remembered, so you don’t need to set anything up each day.</p>

        <div className="field">
          <span className="field-label">Session length</span>
          <div className="segmented">
            {([5, 10, 15] as const).map((m) => (
              <button key={m} className={settings.sessionLengthMin === m ? 'on' : ''} onClick={() => void regenerate({ sessionLengthMin: m })}>
                {m} min
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Hands (instruction)</span>
          <div className="segmented">
            {(['alternate', 'right', 'left'] as const).map((h) => (
              <button key={h} className={settings.dailyHands === h ? 'on' : ''} onClick={() => void regenerate({ dailyHands: h })}>
                {h === 'alternate' ? 'Separately, alternating' : h === 'right' ? 'Right hand' : 'Left hand'}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Key pool (first key is home; others rotate in “Apply in a key”)</span>
          <KeyPicker value={settings.keyPool} multiple onChange={(v) => void regenerate({ keyPool: v })} />
        </div>

        <h3>Today’s tasks</h3>
        <div className="list">
          {routine.tasks.map((t, i) => (
            <div key={t.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <strong>
                {i + 1}. {t.title} <span className="muted small">{taskSummary(t)}</span>
              </strong>
              <div className="row">
                <button className="small" disabled={!t.track} onClick={() => void daily.setRoutine(swapTask(routine, i, 'learner swap'))}>
                  Swap example
                </button>
                <button className="small" disabled={!t.track || t.level <= 1} onClick={() => void daily.setRoutine(lowerTask(routine, i))}>
                  Lower difficulty
                </button>
                <button className="small" onClick={() => setKeyFor(keyFor === i ? null : i)}>
                  Change key
                </button>
              </div>
              {keyFor === i ? (
                <select
                  value={t.keyId}
                  onChange={(e) => {
                    void daily.setRoutine(changeTaskKey(routine, i, e.target.value));
                    setKeyFor(null);
                  }}
                >
                  {allKeys().map((k) => (
                    <option key={keyId(k)} value={keyId(k)}>
                      {keyName(k)}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ))}
        </div>

        <h3>Levels</h3>
        <p className="small muted">Normally a level rises only when you accept an offer after demonstrating it. You can set it here directly.</p>
        {SKILL_TRACKS.map((t) => (
          <div key={t} className="field">
            <span className="field-label">{TRACK_LABELS[t]}</span>
            <div className="segmented">
              {[1, 2, 3, 4].map((l) => (
                <button key={l} className={daily.skills?.levels[t] === l ? 'on' : ''} onClick={() => void setLevel(t, l)} title={LEVEL_DESCRIPTIONS[t][l - 1]}>
                  L{l}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="tiny muted">Level changes apply from tomorrow’s routine, or now if today’s hasn’t started.</p>
      </div>
    </div>
  );
}
