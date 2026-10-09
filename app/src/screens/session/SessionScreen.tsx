import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePracticeStore } from '../../state/practiceStore';
import { useDeviceStore, readiness } from '../../state/deviceStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useDailyStore, taskSummary } from '../../state/dailyStore';
import { useSessionRoute } from '../../state/sessionRoute';
import { StaffView, type EventMark } from '../../components/Staff';
import { Keyboard, keyboardWindow, type KeyState } from '../../components/Keyboard';
import { DevicePill, Pill, SoundPill } from '../../components/StatusPill';
import { midiOf } from '../../music/pitch';
import { spellInContext } from '../../music/chords';
import { keyName, prefersFlats } from '../../music/keys';
import { describeTimed, type TimedResult } from '../../engine/timed';
import type { Phrase } from '../../music/score';
import { virtualNote } from '../../midi/inputManager';
import { playNotes } from '../../audio/audioEngine';
import { hintText } from './hints';
import { download } from '../../ui/download';
import { useAppWakeLock } from '../../hooks/useAppWakeLock';
import { useComputerKeyboard } from '../../hooks/useComputerKeyboard';
import { AttemptSummary, suggestion } from './Review';

function eventMarksFromTimed(phrase: Phrase, live: TimedResult | null, targets: { eventIndex: number }[]): (EventMark | null)[] {
  const marks: (EventMark | null)[] = phrase.events.map(() => null);
  if (!live) return marks;
  phrase.events.forEach((_, ei) => {
    const outs = live.targets.filter((_, ti) => targets[ti].eventIndex === ei);
    if (!outs.length) return;
    if (outs.some((o) => o.kind === 'pending')) return;
    if (outs.some((o) => o.kind === 'wrongPitch')) marks[ei] = 'wrong';
    else if (outs.some((o) => o.kind === 'missed')) marks[ei] = 'missed';
    else if (outs.some((o) => o.kind === 'timing')) marks[ei] = 'timing';
    else marks[ei] = 'correct';
  });
  return marks;
}

export function SessionScreen() {
  const navigate = useNavigate();
  const p = usePracticeStore();
  const dev = useDeviceStore();
  const settings = useSettingsStore((s) => s.settings);
  const daily = useDailyStore();
  const route = useSessionRoute();
  const [now, setNow] = useState(Date.now());
  useAppWakeLock(true);
  useComputerKeyboard();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const spec = p.spec;
  const guided = p.guided;
  const item = guided?.current ?? null;
  const result = guided?.currentResult ?? null;

  const allNotes = useMemo(() => {
    if (!spec) return [];
    return [
      ...spec.phrases.flatMap((ph) => ph.events.flatMap((e) => e.notes.map(midiOf))),
      ...spec.items.flatMap((i) => i.midis),
    ];
  }, [spec]);

  if (!spec) return <Navigate to={route.returnTo} replace />;

  const r = readiness(dev);
  const kbWindow = keyboardWindow([...allNotes, ...dev.held], 60, 72, { low: Math.max(21, settings.range.low), high: Math.min(108, settings.range.high) });

  // ----- what to draw ---------------------------------------------------
  let staff: React.ReactNode = null;
  let prompt: React.ReactNode = null;
  const keyStates = new Map<number, KeyState>();
  const showTargets = spec.highlighted || (result?.hintLevel ?? 0) >= 3;

  if (spec.mode === 'guided' && item) {
    if (showTargets) {
      const st: KeyState = spec.highlighted ? 'target' : 'reveal';
      // "Any octave" prompts reveal every matching key.
      if (item.policy.kind === 'pitchClass')
        for (let n = kbWindow.low; n <= kbWindow.high; n++) {
          if (item.midis.some((m) => (m - n) % 12 === 0)) keyStates.set(n, st);
        }
      else for (const m of item.midis) keyStates.set(m, st);
    }
    const lastMistake = result?.mistakes[result.mistakes.length - 1];
    const freshMistake = lastMistake && p.feedback?.kind === 'mistake' && p.feedback.at === lastMistake.t ? lastMistake : null;
    if (freshMistake && item.policy.kind !== 'chordName')
      for (const m of freshMistake.played) if (!item.midis.includes(m)) keyStates.set(m, 'wrong');

    if (spec.display === 'phrase') {
      const phrase = spec.phrases[item.phraseIndex ?? 0];
      const passItems = spec.items.filter((x) => x.phraseIndex === item.phraseIndex && x.id.split('n')[0] === item.id.split('n')[0]);
      const marks: (EventMark | null)[] = phrase.events.map(() => null);
      for (const x of passItems) {
        const res = guided!.results[spec.items.indexOf(x)];
        if (x.eventIndex !== undefined && res.outcome !== 'pending')
          marks[x.eventIndex] = res.outcome === 'skipped' ? 'missed' : res.firstTry ? 'correct' : 'timing';
      }
      staff = (
        <StaffView
          events={phrase.events}
          keySig={phrase.key}
          clef="auto"
          beatsPerBar={phrase.beatsPerBar}
          cursor={p.phase === 'demo' ? p.demoEvent : (item.eventIndex ?? null)}
          marks={p.phase === 'demo' ? undefined : marks}
          showFingering={spec.showFingering}
          restsOnIdleStaff={phrase.hand === 'both' || phrase.hand === 'alternate'}
          ariaLabel={phrase.title}
        />
      );
    } else if (item.display) {
      staff = (
        <StaffView
          events={item.display.events.map((notes) => ({ notes, beats: 1 }))}
          keySig={spec.phrases[item.phraseIndex ?? 0]?.key ?? spec.key}
          clef={item.clef ?? 'auto'}
          cursor={item.display.events.length > 1 ? item.display.cursor : null}
          ghost={
            freshMistake
              ? {
                  eventIndex: item.display.cursor,
                  notes: freshMistake.played.filter((m) => !item.midis.includes(m)).map((m) => spellInContext(m, spec.key)),
                }
              : null
          }
          bars={false}
          ariaLabel="Written prompt"
        />
      );
    }
    if (item.prompt) prompt = <div className="prompt-big">{item.prompt}</div>;
  }

  let marks: (EventMark | null)[] | undefined;
  let timedPhrase: Phrase | null = null;
  if (spec.mode === 'timed') {
    const seg = p.segment;
    const pi = seg?.phraseIndex ?? 0;
    timedPhrase = spec.phrases[pi] ?? spec.phrases[0];
    if (seg) marks = eventMarksFromTimed(timedPhrase, seg.live, seg.targets);
    else if (p.lastSegment) {
      const ls = p.lastSegment;
      marks = eventMarksFromTimed(timedPhrase, { targets: ls.outcomes as unknown as TimedResult['targets'] } as TimedResult, ls.targets);
    }
    staff = (
      <StaffView
        events={timedPhrase.events}
        keySig={timedPhrase.key}
        clef="auto"
        beatsPerBar={timedPhrase.beatsPerBar}
        cursor={p.phase === 'demo' ? p.demoEvent : null}
        marks={p.phase === 'demo' ? undefined : marks}
        showFingering={spec.showFingering}
        restsOnIdleStaff={timedPhrase.hand === 'both' || timedPhrase.hand === 'alternate'}
        ariaLabel={timedPhrase.title}
      />
    );
  }

  if (p.phase === 'demo') {
    const ph = spec.phrases[(spec.mode === 'timed' ? p.segment?.phraseIndex : item?.phraseIndex) ?? 0];
    const ev = p.demoEvent !== null ? ph?.events[p.demoEvent] : null;
    keyStates.clear();
    for (const n of ev?.notes ?? []) keyStates.set(midiOf(n), 'reveal');
  }

  // ----- progress text --------------------------------------------------
  let progress = '';
  let fraction = 0;
  if (guided) {
    const done = guided.results.filter((x) => x.outcome !== 'pending').length;
    progress = `Item ${Math.min(done + 1, spec.items.length)} of ${spec.items.length}`;
    fraction = done / Math.max(1, spec.items.length);
  } else if (spec.mode === 'timed') {
    const reps = spec.repetitions ?? 1;
    const seg = p.segment;
    const doneSegs = (p.attempt?.segments ?? []).filter((s) => s.status === 'complete').length;
    const total = reps * spec.phrases.length;
    progress = `Attempt ${Math.min(doneSegs + (seg ? 1 : 0), total) || 1} of ${total}`;
    if (spec.phrases.length > 1 && timedPhrase) progress += ` · ${keyName(timedPhrase.key)}`;
    fraction = doneSegs / Math.max(1, total);
  }

  const cue =
    p.phase === 'demo'
      ? { cls: 'info', text: 'Demonstration — listen and watch. Playing along is not scored.' }
      : p.feedback && p.feedback.cue
        ? { cls: p.feedback.kind === 'mistake' ? 'mistake' : 'info', text: p.feedback.cue }
        : p.feedback?.kind === 'correct' && now - p.feedback.at < 1500
          ? { cls: 'correct', text: 'Yes!' }
          : result && result.hintLevel > 0 && item
            ? { cls: 'info', text: hintText(item, result.hintLevel) ?? '' }
            : null;

  const isDaily = daily.active;
  const dailyTask = isDaily && daily.routine ? daily.routine.tasks[Math.min(daily.routine.position, daily.routine.tasks.length - 1)] : null;

  const pressVirtual = (n: number) => {
    if (!virtualNote(true, n)) playNotes([n], 600);
  };

  const leave = () => {
    if (isDaily) daily.close();
    else p.reset();
    navigate(route.returnTo);
  };

  const finishedView = p.phase === 'finished' && p.attempt && !isDaily;

  return (
    <div className="session">
      <div className="session-head">
        <span className="pill accent">{isDaily ? 'DAILY' : spec.mode === 'timed' ? 'TIMED' : 'GUIDED'}</span>
        <span className="title grow">{spec.title}</span>
        <span className="muted small num">{progress}</span>
        <div className="progress-bar" style={{ maxWidth: 160 }}>
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
        <DevicePill />
        <SoundPill />
        {p.phase !== 'finished' ? (
          <>
            <button className="small" onClick={() => p.pause('user')} disabled={p.phase === 'paused' || p.phase === 'recovering'}>
              Pause
            </button>
            <button className="small" onClick={() => (isDaily ? daily.endSession() : p.end())}>
              End
            </button>
          </>
        ) : null}
      </div>

      {p.saveError ? (
        <div className="banner danger row between">
          <span className="small grow">This session could not be saved on this device. Download a copy so nothing is lost.</span>
          <button className="small" onClick={() => p.attempt && download(`attempt-${p.attempt.id}.json`, JSON.stringify(p.attempt, null, 1))}>
            Download copy
          </button>
        </div>
      ) : null}

      <div className="session-main">
        <div className="prompt-card stack">
          <div className="row between">
            <span className="eyebrow">{spec.instruction}</span>
            {spec.mode === 'timed' ? (
              <span className="row">
                <span className="pill purple num">
                  {p.bpm} BPM · {timedPhrase && timedPhrase.events.some((e) => e.beats === 0.5) ? '2 notes per beat' : '1 note per beat'}
                </span>
                <BeatDots beat={p.beat} beatsPerBar={timedPhrase?.beatsPerBar ?? 4} />
              </span>
            ) : null}
          </div>
          {p.phase === 'countIn' && p.beat?.countIn ? <div className="countin">{p.beat.n}</div> : null}
          {prompt}
          {staff}
          {item?.choices ? (
            <div className="row" style={{ justifyContent: 'center' }}>
              {item.choices.map((c) => (
                <button key={c.label} className="big" onClick={() => p.answer(c.label)}>
                  {c.label}
                </button>
              ))}
            </div>
          ) : null}
          {timedPhrase?.fingeringNote && spec.showFingering ? <span className="tiny muted">{timedPhrase.fingeringNote}</span> : null}
          {p.phase === 'segmentResult' && p.lastSegment?.summary ? (
            <div className="banner info row between">
              <span className="grow">
                <strong>Attempt result:</strong> {describeTimed(p.lastSegment.summary)}
              </span>
              {p.lastSegment.qualifies ? <Pill kind="ok">Clean attempt</Pill> : null}
            </div>
          ) : null}
          <div className={`cue ${cue ? cue.cls : 'empty'}`} role="status" aria-live="polite">
            {cue?.text ?? '·'}
          </div>
        </div>

        {spec.showKeyboard ? (
          <Keyboard
            low={kbWindow.low}
            high={kbWindow.high}
            held={dev.held}
            pedal={dev.pedalSustained}
            states={keyStates}
            preferFlats={prefersFlats(spec.key)}
            showNames={settings.showNoteNames}
            onPress={pressVirtual}
            onRelease={(n) => virtualNote(false, n)}
            playable={settings.range}
          />
        ) : null}

        <div className="controls">
          {item?.audio ? <button onClick={p.replayAudio}>Play again</button> : null}
          {spec.hints && guided && item && !item.choices ? (
            <button onClick={p.hint} disabled={(result?.hintLevel ?? 0) >= 3 || p.phase !== 'playing'}>
              Hint{result?.hintLevel ? ` (${result.hintLevel}/3)` : ''}
            </button>
          ) : null}
          {spec.demo ? (
            <button onClick={p.demo} disabled={p.phase === 'demo' || p.phase === 'finished' || p.phase === 'paused'}>
              Replay example
            </button>
          ) : null}
          {spec.mode === 'timed' ? (
            <button onClick={p.slower} disabled={p.phase === 'finished' || p.bpm <= 30}>
              Slower
            </button>
          ) : null}
          {isDaily ? (
            <button onClick={daily.skipTask}>Skip task</button>
          ) : guided ? (
            <button onClick={p.skip} disabled={p.phase !== 'playing'}>
              Skip
            </button>
          ) : null}
        </div>
        {spec.mode === 'timed' && dev.selected?.source === 'virtual' ? (
          <p className="tiny muted">On-screen input adds touch latency; timing results are approximate.</p>
        ) : null}
      </div>

      {/* ---------- overlays ---------- */}
      {p.phase === 'paused' ? (
        <div className="overlay">
          <div className="card stack">
            <h2 style={{ marginTop: 0 }}>
              {p.pauseReason === 'disconnected' ? 'Keyboard disconnected' : p.pauseReason === 'hidden' ? 'Paused while away' : 'Paused'}
            </h2>
            <p className="muted">
              {p.pauseReason === 'disconnected'
                ? 'Completed work is saved. Reconnect the keyboard (or pick another input in Devices), then resume.'
                : 'Completed work is saved.'}
              {spec.mode === 'timed' ? ' The interrupted attempt restarts with a new count-in and is not scored.' : ''}
            </p>
            <div className="row">
              <button className="primary big" onClick={p.resume}>
                Resume
              </button>
              <button onClick={() => navigate('/devices')}>Devices</button>
              <button onClick={() => (isDaily ? daily.endSession() : p.end())}>End and save</button>
            </div>
          </div>
        </div>
      ) : null}

      {p.phase === 'recovering' ? (
        <div className="overlay">
          <div className="card stack">
            <h2 style={{ marginTop: 0 }}>Ready to continue?</h2>
            <ul className="checklist">
              <li>{dev.held.length === 0 ? '✓' : '○'} Release all keys</li>
              <li>{!dev.sustain ? '✓' : '○'} Pedal up</li>
              <li>
                {r.state === 'ready' ? '✓' : '○'} {r.state === 'untested' ? 'Play and release one note to recheck the input' : r.label}
              </li>
              {spec.mode === 'timed' ? <li>○ A new count-in starts automatically</li> : null}
            </ul>
            <div className="row">
              <button onClick={() => navigate('/devices')}>Devices</button>
              <button onClick={() => (isDaily ? daily.endSession() : p.end())}>End and save</button>
            </div>
          </div>
        </div>
      ) : null}


      {p.phase === 'keyChange' && spec.phrases.length > 1 ? (
        <div className="overlay">
          <div className="card stack">
            <span className="eyebrow">Next key</span>
            <h1>{keyName(spec.phrases[Math.min((p.attempt?.segments ?? []).filter((s) => s.status === 'complete').length / (spec.repetitions ?? 1), spec.phrases.length - 1)].key)}</h1>
            <p className="muted">Reset your hand. A count-in follows.</p>
          </div>
        </div>
      ) : null}

      {isDaily && daily.stage === 'break' && daily.routine ? (
        <DailyBreak now={now} />
      ) : null}

      {isDaily && daily.stage === 'summary' ? <DailySummary onDone={leave} /> : null}

      {finishedView && p.attempt ? (
        <div className="overlay">
          <div className="card stack" style={{ width: 'min(680px, 100%)' }}>
            <span className="eyebrow">Review</span>
            <h2 style={{ marginTop: 0 }}>{spec.title}</h2>
            <AttemptSummary attempt={p.attempt} />
            {suggestion(p.attempt) ? <div className="banner info small">{suggestion(p.attempt)}</div> : null}
            <div className="row">
              {route.next ? (
                <button className="primary" onClick={() => { p.reset(); navigate(route.next!.to); }}>
                  {route.next.label}
                </button>
              ) : null}
              {spec.mode === 'guided' && !spec.highlighted && (p.attempt.itemResults ?? []).some((x) => !x.firstTry) && spec.display === 'item' ? (
                <button
                  onClick={() => {
                    const retry = spec.items.filter((_, i) => !p.attempt!.itemResults![i].firstTry);
                    void p.start({ ...spec, items: retry, title: `${spec.title} · retry` });
                  }}
                >
                  Retry these items
                </button>
              ) : null}
              <button onClick={() => void p.start(spec)}>Repeat exercise</button>
              <button className={route.next ? '' : 'primary'} onClick={leave}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {dailyTask && daily.stage === 'task' && p.phase !== 'finished' ? (
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          {dailyTask.reason}
        </p>
      ) : null}
    </div>
  );
}

function BeatDots({ beat, beatsPerBar }: { beat: { n: number; accent: boolean; countIn: boolean } | null; beatsPerBar: number }) {
  return (
    <span className="beat-dots" aria-hidden>
      {Array.from({ length: beatsPerBar }, (_, i) => (
        <span key={i} className={`beat-dot ${beat && beat.n === i + 1 ? 'on' : ''} ${i === 0 ? 'accent' : ''}`} />
      ))}
    </span>
  );
}

function DailyBreak({ now }: { now: number }) {
  const daily = useDailyStore();
  const r = daily.routine!;
  const next = r.tasks[r.position];
  const left = daily.breakPaused ? Math.ceil((daily.breakRemainingMs ?? 0) / 1000) : Math.max(0, Math.ceil(((daily.breakEndsAt ?? now) - now) / 1000));
  const prevTask = r.tasks[r.position - 1];
  const prev = prevTask ? daily.results[prevTask.id] : undefined;
  const prevSkipped = prevTask && r.taskStates.find((t) => t.taskId === prevTask.id)?.status === 'skipped';
  return (
    <div className="overlay">
      <div className="card stack">
        <span className="eyebrow">Reset break</span>
        {prevSkipped ? <p className="muted">{prevTask!.title}: skipped.</p> : prev ? <AttemptSummary attempt={prev} /> : null}
        <h2 style={{ marginTop: 0 }}>
          Next: {next?.title} <span className="muted small">{next ? taskSummary(next) : ''}</span>
        </h2>
        <div className="countin">{daily.breakPaused ? 'Paused' : `${left}s`}</div>
        <div className="row">
          <button className="primary" onClick={daily.nextNow}>
            Start now
          </button>
          <button onClick={daily.extendBreak}>+20 s</button>
          <button onClick={daily.toggleBreakPause}>{daily.breakPaused ? 'Continue break' : 'Pause break'}</button>
          <button onClick={daily.endSession}>End session</button>
        </div>
      </div>
    </div>
  );
}

function DailySummary({ onDone }: { onDone: () => void }) {
  const daily = useDailyStore();
  const r = daily.routine;
  if (!r) return null;
  const done = r.taskStates.filter((t) => t.status === 'done').length;
  return (
    <div className="overlay">
      <div className="card stack" style={{ width: 'min(680px, 100%)' }}>
        <span className="eyebrow">Today's session</span>
        <h2 style={{ marginTop: 0 }}>{done === r.tasks.length ? 'Done for today' : `${done} of ${r.tasks.length} tasks done`}</h2>
        <div className="list">
          {r.tasks.map((t) => {
            const st = r.taskStates.find((s) => s.taskId === t.id)!;
            const a = daily.results[t.id];
            return (
              <div key={t.id} className="list-item">
                <Pill kind={st.status === 'done' ? 'ok' : st.status === 'pending' ? undefined : 'warn'}>{st.status}</Pill>
                <div className="grow">
                  <strong>{t.title}</strong>
                  <div className="small muted">{a ? (a.mode === 'timed' ? summarizeTimedAttempt(a) : `${a.itemResults?.filter((x) => x.firstTry).length ?? 0} of ${a.itemResults?.length ?? 0} notes right first time`) : taskSummary(t)}</div>
                </div>
              </div>
            );
          })}
        </div>
        <p className="small muted">Completing today’s list is not the same as mastering a level — levels change only when you accept an offer below.</p>
        {daily.offers.map((o, i) => (
          <div key={i} className="banner info row between">
            <span className="grow small">{o.label}</span>
            {o.accepted ? <Pill kind="ok">Saved</Pill> : <button className="small" onClick={() => void daily.acceptOffer(o)}>Yes, next time</button>}
          </div>
        ))}
        <div className="row">
          <button className="primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function summarizeTimedAttempt(a: import('../../data/schema').Attempt): string {
  const segs = (a.segments ?? []).filter((s) => s.status === 'complete' && s.summary);
  if (!segs.length) return 'Timing not assessed';
  const exp = segs.reduce((n, s) => n + s.summary!.expected, 0);
  const m = segs.reduce((n, s) => n + s.summary!.matched, 0);
  return `${m} of ${exp} notes on time at ${segs[segs.length - 1].bpm} BPM`;
}
