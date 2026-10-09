import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAttemptsStore } from '../../state/attemptsStore';
import { commonMistakes, guidedCounts, lessonStatus, qualifiedTempos, skillRows } from '../../engine/evidence';
import { LESSONS } from '../../content/lessons';
import { loadSkills } from '../../data/repositories/skills';
import type { SkillState } from '../../data/schema';
import { LEVEL_DESCRIPTIONS, SKILL_TRACKS, TRACK_LABELS } from '../../music/patterns';
import { Pill } from '../../components/StatusPill';

export function ProgressScreen() {
  const { attempts, refresh } = useAttemptsStore();
  const [skills, setSkills] = useState<SkillState | null>(null);
  useEffect(() => {
    void refresh();
    void loadSkills().then(setSkills);
  }, [refresh]);

  const finished = attempts.filter((a) => a.status !== 'in-progress');
  const rows = skillRows(finished);
  const tempos = qualifiedTempos(finished);
  const best = new Map<string, (typeof tempos)[number]>();
  for (const t of tempos) if (!best.has(t.tempoKey) || best.get(t.tempoKey)!.bpm < t.bpm) best.set(t.tempoKey, t);
  const mistakes = commonMistakes(finished.slice(0, 50));
  const days = new Set(finished.map((a) => a.localDate)).size;

  return (
    <main className="screen stack">
      <div className="topbar">
        <h1>Progress</h1>
        <Link to="/data" className="button">
          Your data
        </Link>
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className="v">{finished.length}</div>
          <div className="l">sessions saved</div>
        </div>
        <div className="stat">
          <div className="v">{days}</div>
          <div className="l">days practised</div>
        </div>
        <div className="stat">
          <div className="v">{LESSONS.filter((l) => lessonStatus(attempts, l.id).status === 'demonstrated').length}</div>
          <div className="l">lessons demonstrated</div>
        </div>
      </div>
      <p className="small muted">Progress is tracked per specific skill. Success in one key or clef doesn’t imply it in another, and there is no overall “piano level”.</p>

      <h2>Skills</h2>
      {rows.length === 0 ? (
        <p className="muted">Nothing yet — finish a lesson or exercise and the evidence appears here.</p>
      ) : (
        <div className="table-wrap card">
          <table className="data">
            <thead>
              <tr>
                <th>Skill</th>
                <th className="num">Sessions</th>
                <th>First-try (guided)</th>
                <th>On time (timed)</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.skill}>
                  <td>{r.label}</td>
                  <td className="num">{r.attempts}</td>
                  <td className="num">{r.items ? `${r.firstTry} / ${r.items}` : '—'}</td>
                  <td className="num">{r.notesExpected ? `${r.notesMatched} / ${r.notesExpected}` : '—'}</td>
                  <td className="small">{r.lastDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Daily trainer</h2>
      <div className="grid">
        {SKILL_TRACKS.map((t) => (
          <div key={t} className="card stack tight">
            <div className="row between">
              <strong>{TRACK_LABELS[t]}</strong>
              <Pill kind="purple">L{skills?.levels[t] ?? 1}</Pill>
            </div>
            <span className="small muted">{LEVEL_DESCRIPTIONS[t][(skills?.levels[t] ?? 1) - 1]}</span>
          </div>
        ))}
      </div>
      {best.size ? (
        <div className="table-wrap card">
          <table className="data">
            <thead>
              <tr>
                <th>Demonstrated tempo</th>
                <th className="num">BPM</th>
                <th>Conditions</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {[...best.values()].map((t) => (
                <tr key={t.tempoKey}>
                  <td>{t.title}</td>
                  <td className="num">{t.bpm}</td>
                  <td className="small">
                    {t.keyId.replace('-', ' ')} · {t.subdivision === 2 ? 'eighth notes' : 'quarter notes'} · {t.profile} tolerance
                  </td>
                  <td className="small">{t.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {skills?.levelHistory.length ? (
        <details className="small">
          <summary>Level changes</summary>
          <ul>
            {skills.levelHistory.map((h, i) => (
              <li key={i}>
                {h.at.slice(0, 10)}: {TRACK_LABELS[h.track]} L{h.from} → L{h.to} ({h.reason})
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {mistakes.length ? (
        <>
          <h2>Specific difficulties</h2>
          <div className="list">
            {mistakes.map((m) => (
              <div key={m.cue} className="list-item">
                <span className="grow small">{m.cue}</span>
                <Pill>{m.count}×</Pill>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h2>Recent sessions</h2>
      <div className="list">
        {finished.slice(0, 30).map((a) => {
          const c = guidedCounts(a);
          return (
            <Link key={a.id} to={`/progress/${a.id}`} className="list-item" style={{ color: 'inherit', textDecoration: 'none' }}>
              <div className="grow">
                <strong>{a.title}</strong>
                <div className="small muted">
                  {new Date(a.startedAt).toLocaleString()} · {a.kind} · {a.mode}
                  {a.mode === 'guided' && c.total ? ` · ${c.firstTry}/${c.total} first try` : ''}
                </div>
              </div>
              <Pill kind={a.status === 'completed' ? 'ok' : 'warn'}>{a.status}</Pill>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
