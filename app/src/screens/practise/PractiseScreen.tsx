import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FAMILIES, familyById } from '../../content/practiceFamilies';
import { listPresets, deletePreset } from '../../data/repositories/presets';
import type { Preset } from '../../data/schema';
import { DevicePill, Pill } from '../../components/StatusPill';

const SKILLS = ['All', 'Reading', 'Harmony', 'Patterns', 'Rhythm', 'Listening'] as const;

export function PractiseScreen() {
  const navigate = useNavigate();
  const [skill, setSkill] = useState<(typeof SKILLS)[number]>('All');
  const [presets, setPresets] = useState<Preset[]>([]);
  useEffect(() => void listPresets().then(setPresets), []);

  const shown = FAMILIES.filter((f) => skill === 'All' || f.skill === skill);
  return (
    <main className="screen stack">
      <div className="topbar">
        <h1>Practise</h1>
        <DevicePill />
      </div>
      <div className="segmented" role="group" aria-label="Filter by skill">
        {SKILLS.map((s) => (
          <button key={s} className={skill === s ? 'on' : ''} onClick={() => setSkill(s)}>
            {s}
          </button>
        ))}
      </div>

      {presets.length ? (
        <section className="stack">
          <h2>Your presets</h2>
          <div className="list">
            {presets.map((p) => (
              <div key={p.id} className="list-item">
                <div className="grow">
                  <strong>{p.name}</strong>
                  <div className="small muted">
                    {familyById(p.family)?.title} · revision {p.revision}
                  </div>
                </div>
                <button className="primary small" onClick={() => navigate(`/practise/${p.family}?preset=${p.id}`)}>
                  Open
                </button>
                <button
                  className="small"
                  onClick={() => {
                    if (confirm(`Delete preset “${p.name}”? Saved attempts are kept.`)) void deletePreset(p.id).then(() => listPresets().then(setPresets));
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid">
        {shown.map((f) => (
          <button key={f.id} className="card clickable stack" onClick={() => navigate(`/practise/${f.id}`)}>
            <div className="row between">
              <Pill kind="accent">{f.skill}</Pill>
              <span className="small muted">~{f.minutes} min</span>
            </div>
            <h3>{f.title}</h3>
            <p className="small">{f.goal}</p>
            <p className="small muted">
              <em>“{f.example}”</em> · checks: {f.checks.toLowerCase()}
            </p>
            <div className="row">
              <Pill>{f.difficulty}</Pill>
              {f.modes.map((m) => (
                <Pill key={m}>{m}</Pill>
              ))}
              <Pill>{f.needsAudio ? 'MIDI + app sound' : 'MIDI keyboard'}</Pill>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
}
