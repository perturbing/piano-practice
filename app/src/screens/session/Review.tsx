import type { Attempt } from '../../data/schema';
import { describeTimed } from '../../engine/timed';
import { guidedCounts, tempoOfferFor } from '../../engine/evidence';
import { spelledText } from '../../music/pitch';
import { Pill } from '../../components/StatusPill';

/** Plain-language guided summary: never calls corrected or hinted answers independent. */
export function guidedSentence(a: Attempt): string {
  const c = guidedCounts(a);
  const r = a.itemResults ?? [];
  if (r.length && r.every((x) => x.highlighted)) {
    // Try-with-help: completion with visible targets is assisted practice, not an independent result.
    const withMistakes = r.filter((x) => x.outcome === 'correct' && x.mistakes.length > 0).length;
    return `${c.completed} of ${c.total} completed with the target keys highlighted${withMistakes ? ` (${withMistakes} after a correction)` : ''}. This is assisted practice; the Recall step checks it on your own.`;
  }
  const corrected = r.filter((x) => x.outcome === 'correct' && x.mistakes.length > 0).length;
  const revealed = r.filter((x) => x.hintLevel >= 3).length;
  const named = r.filter((x) => x.hintLevel === 2).length;
  const parts = [`${c.firstTry} of ${c.total} correct on the first try`];
  if (corrected) parts.push(`${corrected} corrected`);
  if (named) parts.push(`${named} used a name hint`);
  if (revealed) parts.push(`${revealed} used a key hint`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  let s = parts.join('; ') + '.';
  const pending = r.filter((x) => x.outcome === 'pending').length;
  if (pending) s += ` ${pending} not completed.`;
  return s;
}

export function suggestion(a: Attempt): string | null {
  if (a.mode === 'timed') {
    const segs = (a.segments ?? []).filter((s) => s.status === 'complete' && s.summary);
    if (!segs.length) return 'Timing was not assessed. Try the guided version to check the notes.';
    const ratio = segs.reduce((n, s) => n + s.summary!.matched, 0) / Math.max(1, segs.reduce((n, s) => n + s.summary!.expected, 0));
    if (ratio < 0.7) return 'Several notes were missed or off the beat — try Slower, or the guided version first.';
    if (tempoOfferFor(a)) return 'Two clean attempts at this tempo. You could try 2 BPM faster next time.';
    return null;
  }
  const r = a.itemResults ?? [];
  if (!r.length || r.every((x) => x.highlighted)) return null;
  const wrongOctave = r.flatMap((x) => x.mistakes).filter((m) => m.cue.includes('octave')).length;
  if (wrongOctave >= 2) return 'Several right letters in the wrong octave — review middle C and the clef landmarks.';
  const sig = r.flatMap((x) => x.mistakes).filter((m) => m.cue.includes('key signature')).length;
  if (sig >= 2) return 'The key signature caught you a few times — say its sharps or flats before you start.';
  const c = guidedCounts(a);
  if (c.total && c.firstTry / c.total < 0.7) return 'Try this again with highlighted keys, then without.';
  return null;
}

export function AttemptSummary({ attempt, phrasesTitle }: { attempt: Attempt; phrasesTitle?: string }) {
  const a = attempt;
  const interrupted = (a.segments ?? []).some((s) => s.status === 'interrupted');
  return (
    <div className="stack">
      <div className="row">
        <Pill kind={a.status === 'completed' ? 'ok' : 'warn'}>{a.status === 'completed' ? 'Completed' : a.status === 'ended-early' ? 'Ended early' : a.status}</Pill>
        <Pill>{a.mode === 'timed' ? 'Timed' : 'Guided'}</Pill>
        {a.input.source === 'virtual' ? <Pill kind="warn">On-screen input</Pill> : null}
        {phrasesTitle ? <span className="muted small">{phrasesTitle}</span> : null}
      </div>
      {a.mode === 'guided' ? (
        <>
          <p className="prompt-text" style={{ fontSize: '1.15rem' }}>
            {guidedSentence(a)}
          </p>
          <MistakeList attempt={a} />
        </>
      ) : (
        <div className="stack tight">
          {(a.segments ?? [])
            .filter((s) => s.status !== 'restarted')
            .map((s) => (
              <div key={s.index} className="list-item">
                <span className="pill">{s.keyId.replace('-', ' ')}</span>
                <span className="pill">{s.bpm} BPM</span>
                <span className="grow small">
                  {s.summary ? describeTimed(s.summary) : 'Interrupted — excluded from timing results.'}
                </span>
                {s.qualifies ? <Pill kind="ok">Clean</Pill> : null}
              </div>
            ))}
          {interrupted ? <p className="small muted">Interrupted segments are kept with your evidence but never scored for timing.</p> : null}
        </div>
      )}
    </div>
  );
}

function MistakeList({ attempt }: { attempt: Attempt }) {
  const rows = (attempt.itemResults ?? [])
    .map((r, i) => ({ r, item: attempt.items?.[i] }))
    .filter(({ r }) => r.mistakes.length > 0 || r.outcome === 'skipped' || r.hintLevel > 0);
  if (!rows.length) return null;
  return (
    <details>
      <summary className="small">Details for {rows.length} item{rows.length > 1 ? 's' : ''}</summary>
      <ul className="small">
        {rows.map(({ r, item }) => (
          <li key={r.itemId}>
            <strong>{item?.prompt ?? item?.notes.map(spelledText).join(' ')}</strong>
            {r.outcome === 'skipped' ? ' — skipped' : ''}
            {r.hintLevel ? ` — hint level ${r.hintLevel}` : ''}
            {r.mistakes.length ? ` — ${r.mistakes[0].cue}` : ''}
          </li>
        ))}
      </ul>
    </details>
  );
}
