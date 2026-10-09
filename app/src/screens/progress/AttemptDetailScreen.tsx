import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { deleteAttempts, getAttempt } from '../../data/repositories/attempts';
import type { Attempt } from '../../data/schema';
import { AttemptSummary } from '../session/Review';
import { ROUTE_LABELS } from '../../midi/types';
import { midiText } from '../../music/pitch';
import { download } from '../../ui/download';

export function AttemptDetailScreen() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [a, setA] = useState<Attempt | null | undefined>(undefined);
  useEffect(() => {
    void getAttempt(attemptId ?? '').then((x) => setA(x ?? null));
  }, [attemptId]);

  if (a === undefined) return <main className="screen">Loading…</main>;
  if (a === null)
    return (
      <main className="screen">
        <p>Session not found.</p>
        <Link to="/progress">Back</Link>
      </main>
    );

  const notes = a.events.filter((e) => e.type === 'noteon').length;
  return (
    <main className="screen stack">
      <div>
        <Link to="/progress" className="small">
          ← Progress
        </Link>
        <h1>{a.title}</h1>
        <p className="muted">{new Date(a.startedAt).toLocaleString()}</p>
      </div>
      <div className="card">
        <AttemptSummary attempt={a} />
      </div>
      <div className="card stack tight small">
        <strong>Conditions</strong>
        <span>
          Input: {a.input.name} · {ROUTE_LABELS[a.input.route]}
        </span>
        <span>
          Keys: {a.keyOrder.map((k) => k.replace('-', ' ')).join(' → ')}
          {a.confirmedRange ? ` · range ${midiText(a.confirmedRange.low)}–${midiText(a.confirmedRange.high)} (${a.confirmedRange.method})` : ''}
        </span>
        <span>
          Evaluator {a.evaluatorVersion} · content revision {a.contentRevision}
          {a.seed !== undefined ? ` · seed ${a.seed}` : ''}
        </span>
        <span>
          Timing: {a.timing.timestampSource}
          {a.timing.reliable ? '' : ' (approximate)'}
          {a.timing.note ? ` — ${a.timing.note}` : ''}
        </span>
        <span>
          {notes} note attacks recorded · {a.interruptions} interruption{a.interruptions === 1 ? '' : 's'}
        </span>
      </div>
      <div className="row">
        <button onClick={() => download(`attempt-${a.id}.json`, JSON.stringify(a, null, 2))}>Export this session (JSON)</button>
        <button
          className="danger"
          onClick={() => {
            if (confirm('Delete this session? This cannot be undone.')) void deleteAttempts([a.id]).then(() => navigate('/progress'));
          }}
        >
          Delete session
        </button>
      </div>
    </main>
  );
}
