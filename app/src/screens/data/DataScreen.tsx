import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { applyImport, deleteAllData, exportAll, ImportFormatError, previewImport, resultsCsv, type ImportPreview } from '../../data/exportImport';
import { deleteAttempts, listAttempts } from '../../data/repositories/attempts';
import type { Attempt } from '../../data/schema';
import { useSettingsStore } from '../../state/settingsStore';
import { useAttemptsStore } from '../../state/attemptsStore';
import { download } from '../../ui/download';
import { Pill } from '../../components/StatusPill';

export function DataScreen() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | null>(null);
  const [conflicts, setConflicts] = useState<'copy' | 'skip'>('skip');
  const [applySettings, setApplySettings] = useState(false);
  const [applySkills, setApplySkills] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const reload = () => listAttempts().then(setAttempts);
  useEffect(() => {
    void reload();
  }, []);

  const exportJson = async () => {
    const env = await exportAll();
    download(`piano-practice-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(env, null, 1));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setMessage(null);
    try {
      setPreview(await previewImport(await f.text()));
    } catch (e) {
      setMessage({ kind: 'danger', text: e instanceof ImportFormatError ? e.message : `Import failed: ${(e as Error).message}` });
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const doImport = async () => {
    if (!preview) return;
    const r = await applyImport(preview, { conflicts, applySettings, applySkills });
    setPreview(null);
    setMessage({ kind: 'ok', text: `Imported ${r.added} record(s), ${r.copied} as copies, skipped ${r.skipped}.` });
    await reload();
    await useSettingsStore.getState().load();
    await useAttemptsStore.getState().refresh();
  };

  const count = (items: { action: string }[], a: string) => items.filter((i) => i.action === a).length;

  return (
    <main className="screen stack">
      <div>
        <Link to="/progress" className="small">
          ← Progress
        </Link>
        <h1>Your data</h1>
        <p className="muted">
          Everything stays in this browser on this device — no account and no server. Browser data can be cleared, and it doesn’t sync between devices,
          so export a backup now and then.
        </p>
      </div>
      {message ? <div className={`banner ${message.kind}`}>{message.text}</div> : null}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Backup and restore</h2>
        <div className="row">
          <button className="primary" onClick={() => void exportJson()}>
            Export all (JSON)
          </button>
          <button onClick={() => download(`piano-results-${new Date().toISOString().slice(0, 10)}.csv`, resultsCsv(attempts), 'text/csv')}>Export results (CSV)</button>
          <button onClick={() => fileRef.current?.click()}>Import…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        <p className="small muted">JSON is the complete backup (every attempt with its targets, events and settings). CSV is a results table for spreadsheets.</p>
      </section>

      {preview ? (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Import preview</h2>
          <ul className="small">
            <li>
              Sessions: {count(preview.attempts, 'add')} new, {count(preview.attempts, 'skip')} already here, {count(preview.attempts, 'copy')} conflicting
            </li>
            <li>
              Daily routines: {count(preview.routines, 'add')} new, {preview.routines.length - count(preview.routines, 'add')} days already here (kept)
            </li>
            <li>
              Presets: {count(preview.presets, 'add')} new, {count(preview.presets, 'copy')} conflicting
            </li>
          </ul>
          {preview.errors.length ? (
            <div className="banner danger small">
              {preview.errors.length} record(s) are invalid and will not be imported: {preview.errors.slice(0, 3).join('; ')}
            </div>
          ) : null}
          {count(preview.attempts, 'copy') + count(preview.presets, 'copy') > 0 ? (
            <div className="field">
              <span className="field-label">Conflicting records (same id, different content)</span>
              <div className="segmented">
                <button className={conflicts === 'skip' ? 'on' : ''} onClick={() => setConflicts('skip')}>
                  Skip them
                </button>
                <button className={conflicts === 'copy' ? 'on' : ''} onClick={() => setConflicts('copy')}>
                  Import as copies
                </button>
              </div>
              <span className="tiny muted">Existing records are never overwritten.</span>
            </div>
          ) : null}
          {preview.settings ? (
            <label className="check">
              <input type="checkbox" checked={applySettings} onChange={(e) => setApplySettings(e.target.checked)} /> Use the file’s preferences (keeps this
              device’s keyboard setup)
            </label>
          ) : null}
          {preview.skills ? (
            <label className="check">
              <input type="checkbox" checked={applySkills} onChange={(e) => setApplySkills(e.target.checked)} /> Use the file’s daily-trainer levels and
              tempos
            </label>
          ) : null}
          <div className="row">
            <button className="primary" onClick={() => void doImport()}>
              Import
            </button>
            <button onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </section>
      ) : null}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Sessions</h2>
        {attempts.length === 0 ? (
          <p className="muted">No sessions saved yet.</p>
        ) : (
          <>
            <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
              {attempts.map((a) => (
                <label key={a.id} className="list-item">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={(e) => {
                      const n = new Set(selected);
                      if (e.target.checked) n.add(a.id);
                      else n.delete(a.id);
                      setSelected(n);
                    }}
                  />
                  <span className="grow">
                    {a.title}
                    <span className="small muted"> · {new Date(a.startedAt).toLocaleString()}</span>
                  </span>
                  <Pill kind={a.status === 'completed' ? 'ok' : 'warn'}>{a.status}</Pill>
                </label>
              ))}
            </div>
            <div className="row">
              <button
                className="danger"
                disabled={selected.size === 0}
                onClick={() => {
                  if (confirm(`Delete ${selected.size} session(s)? This cannot be undone.`))
                    void deleteAttempts([...selected]).then(() => {
                      setSelected(new Set());
                      void reload();
                    });
                }}
              >
                Delete selected
              </button>
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>Settings</h2>
        <div className="field">
          <label htmlFor="tz">Timezone for daily routines</label>
          <input id="tz" value={settings.timezone} onChange={(e) => void update({ timezone: e.target.value })} />
        </div>
        <button
          className="danger"
          onClick={() => {
            if (confirm('Delete ALL data — sessions, routines, presets, levels and settings? Export a backup first. This cannot be undone.'))
              void deleteAllData().then(() => location.reload());
          }}
        >
          Delete all data
        </button>
      </section>
    </main>
  );
}
