import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { familyById, type ParamDef, type Params } from '../../content/practiceFamilies';
import { exerciseRange, fitsRange, type ExerciseSpec } from '../../engine/exercise';
import { useSettingsStore } from '../../state/settingsStore';
import { launchSession } from '../../state/sessionRoute';
import { useReadyGate } from '../../components/ReadyGate';
import { KeyPicker } from '../../components/KeyPicker';
import { StaffView } from '../../components/Staff';
import { DevicePill, Pill } from '../../components/StatusPill';
import { midiText } from '../../music/pitch';
import { listPresets, savePreset } from '../../data/repositories/presets';
import { newId } from '../../data/ids';
import type { Preset } from '../../data/schema';

/** Families that can rotate through (or mix) several selected keys. */
const MULTI_KEY = new Set(['scales', 'arpeggios', 'progressions', 'chordReading', 'chordBuilding']);

export function SetupScreen() {
  const { familyId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const family = familyById(familyId ?? '');
  const range = useSettingsStore((s) => s.settings.range);
  const [params, setParams] = useState<Params>(() => ({ ...(family?.defaults ?? {}) }));
  const [preset, setPreset] = useState<Preset | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [seed, setSeed] = useState(() => Date.now() % 2147483647);
  const { guard, dialog } = useReadyGate({ needsAudio: family?.needsAudio });

  useEffect(() => {
    const id = search.get('preset');
    if (!id) return;
    void listPresets().then((all) => {
      const p = all.find((x) => x.id === id);
      if (p) {
        setPreset(p);
        setParams({ ...(family?.defaults ?? {}), ...p.params });
      }
    });
  }, [search, family]);

  const spec: ExerciseSpec | null = useMemo(() => {
    if (!family) return null;
    try {
      return family.build(params, { seed, range });
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [family, params, seed, range]);

  if (!family) return <Navigate to="/practise" replace />;

  const set = (id: string, v: Params[string]) => setParams((p) => ({ ...p, [id]: v }));
  const visible = (d: ParamDef) => (!d.showIf || d.showIf(params)) && (!d.advanced || advanced);
  const r = spec ? exerciseRange(spec) : null;
  const fits = spec ? fitsRange(spec, range) : false;
  const valid = !!spec && (spec.mode === 'timed' ? spec.phrases.length > 0 : spec.items.length > 0);

  const start = () => {
    if (!spec) return;
    const withPreset = preset ? { ...spec, presetId: preset.id, presetRevision: preset.revision } : spec;
    guard(() => {
      launchSession(withPreset, navigate, { returnTo: `/practise/${family.id}${preset ? `?preset=${preset.id}` : ''}` });
      setSeed(Date.now() % 2147483647); // next start gets fresh examples
    });
  };

  const saveAsPreset = async () => {
    const name = prompt('Preset name', preset?.name ?? family.title);
    if (!name) return;
    const now = new Date().toISOString();
    const p: Preset = preset
      ? { ...preset, name, params, revision: preset.revision + 1, updatedAt: now }
      : { schemaVersion: 1, id: newId('preset'), revision: 1, name, family: family.id, params, createdAt: now, updatedAt: now };
    await savePreset(p);
    setPreset(p);
  };

  const previewPhrase = spec?.phrases[0];
  const previewItem = spec?.items[0];

  return (
    <main className="screen stack">
      <div className="topbar">
        <div>
          <Link to="/practise" className="small">
            ← Practise
          </Link>
          <h1>{family.title}</h1>
          <p className="muted">{family.goal}</p>
        </div>
        <DevicePill />
      </div>
      <div className="grid two">
        <div className="card stack">
          {family.params.filter(visible).map((d) => (
            <ParamControl key={d.id} def={d} value={params[d.id]} onChange={(v) => set(d.id, v)} multipleKeys={MULTI_KEY.has(family.id)} />
          ))}
          {family.params.some((d) => d.advanced) ? (
            <label className="check">
              <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /> Show advanced settings
            </label>
          ) : null}
        </div>
        <div className="stack">
          <div className="card stack">
            <span className="eyebrow">Preview</span>
            {previewPhrase ? (
              <StaffView
                events={previewPhrase.events}
                keySig={previewPhrase.key}
                clef="auto"
                beatsPerBar={previewPhrase.beatsPerBar}
                showFingering={params.showFingering !== false}
                restsOnIdleStaff={previewPhrase.hand === 'both' || previewPhrase.hand === 'alternate'}
                maxSystemWidth={520}
              />
            ) : previewItem?.display ? (
              <StaffView events={previewItem.display.events.map((notes) => ({ notes, beats: 1 }))} keySig={spec!.key} clef={previewItem.clef ?? 'auto'} bars={false} maxSystemWidth={300} />
            ) : previewItem?.prompt ? (
              <p className="prompt-text">{previewItem.prompt}</p>
            ) : null}
            {spec && spec.phrases.length > 1 ? <span className="small muted">+ {spec.phrases.length - 1} more key{spec.phrases.length > 2 ? 's' : ''}, each with its own count-in</span> : null}
            {r ? (
              <span className="small">
                Lowest note <strong>{midiText(r.low)}</strong> · highest <strong>{midiText(r.high)}</strong>
              </span>
            ) : null}
            {spec && !fits ? (
              <div className="banner danger small">
                This needs {midiText(r!.low)}–{midiText(r!.high)}, but your keyboard range is set to {midiText(range.low)}–{midiText(range.high)}. Choose a
                narrower pattern (fewer octaves, another hand or key), or check your range in Devices. Notes are never moved silently.
              </div>
            ) : null}
            {range.method === 'default' ? (
              <span className="tiny muted">
                Keyboard range not confirmed yet (assuming {midiText(range.low)}–{midiText(range.high)}). <Link to="/devices">Confirm range</Link>
              </span>
            ) : null}
            <div className="row">
              <Pill>{spec?.mode === 'timed' ? `Timed · ${spec.bpm} BPM` : 'Guided'}</Pill>
              {spec?.mode === 'guided' ? <Pill>{spec.items.length} items</Pill> : null}
              {spec?.highlighted ? <Pill kind="warn">Assisted</Pill> : null}
            </div>
          </div>
          <div className="row">
            <button className="primary big" disabled={!valid || !fits} onClick={start}>
              Start
            </button>
            <button onClick={() => void saveAsPreset()}>{preset ? 'Update preset' : 'Save as preset'}</button>
            <button className="ghost" onClick={() => setSeed(Date.now() % 2147483647)}>
              New examples
            </button>
          </div>
          {preset ? <span className="small muted">Preset “{preset.name}”, revision {preset.revision}</span> : null}
        </div>
      </div>
      {dialog}
    </main>
  );
}

function ParamControl({ def, value, onChange, multipleKeys }: { def: ParamDef; value: Params[string]; onChange: (v: Params[string]) => void; multipleKeys: boolean }) {
  switch (def.type) {
    case 'keys':
      return (
        <div className="field">
          <span className="field-label">{def.label}</span>
          {def.help && multipleKeys ? <span className="tiny muted">{def.help}</span> : null}
          <KeyPicker value={Array.isArray(value) ? value : ['C-major']} onChange={onChange} multiple={multipleKeys} />
        </div>
      );
    case 'toggle':
      return (
        <label className="check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {def.label}
        </label>
      );
    case 'number': {
      const n = Number.isFinite(Number(value)) ? Number(value) : (def.min ?? 0);
      return (
        <div className="field">
          <label htmlFor={def.id}>{def.label}</label>
          <div className="row">
            <button className="small" onClick={() => onChange(Math.max(def.min ?? 0, n - (def.step ?? 1)))} aria-label="Decrease">
              −
            </button>
            <input
              id={def.id}
              type="number"
              inputMode="numeric"
              min={def.min}
              max={def.max}
              step={def.step}
              value={n}
              onChange={(e) => onChange(Math.min(def.max ?? 999, Math.max(def.min ?? 0, Number(e.target.value) || (def.min ?? 0))))}
              style={{ width: 90 }}
            />
            <button className="small" onClick={() => onChange(Math.min(def.max ?? 999, n + (def.step ?? 1)))} aria-label="Increase">
              +
            </button>
          </div>
        </div>
      );
    }
    case 'select':
      return (
        <div className="field">
          <label htmlFor={def.id}>{def.label}</label>
          <select id={def.id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {def.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
  }
}
