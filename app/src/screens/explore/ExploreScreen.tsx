import { useState } from 'react';
import { useDeviceStore } from '../../state/deviceStore';
import { useSettingsStore } from '../../state/settingsStore';
import { StaffView } from '../../components/Staff';
import { Keyboard, keyboardWindow } from '../../components/Keyboard';
import { DevicePill, Pill } from '../../components/StatusPill';
import { CHORD_TONE_NAMES, INVERSION_NAMES, identifyChord, triadName, voiceProgression, voiceTriad, diatonicTriad, romanNumeral } from '../../music/chords';
import { allKeys, keyId, keyName, parseKeyId, prefersFlats } from '../../music/keys';
import { intervalName, semitoneName } from '../../music/intervals';
import { midiOf, pitchClass, spelledText, type Spelled } from '../../music/pitch';
import { virtualNote } from '../../midi/inputManager';
import { ensureAudio, playNotes } from '../../audio/audioEngine';

interface Example {
  label: string;
  chords: Spelled[][];
  captions: string[];
}

export function ExploreScreen() {
  const dev = useDeviceStore();
  const settings = useSettingsStore((s) => s.settings);
  const [keyIdSel, setKeyIdSel] = useState('C-major');
  const [tapped, setTapped] = useState<number[]>([]);
  const [example, setExample] = useState<{ ex: Example; index: number } | null>(null);
  const key = parseKeyId(keyIdSel)!;

  // Physical keys from the selected input, plus on-screen taps when it isn't the virtual keyboard.
  const notes = [...new Set([...dev.held, ...tapped])].sort((a, b) => a - b);
  const shownNotes = example ? example.ex.chords[example.index].map(midiOf) : notes;
  const id = identifyChord(shownNotes, key);
  const best = id.candidates[0];
  const captions = new Map<number, string>();
  if (best) for (const n of shownNotes) captions.set(n, CHORD_TONE_NAMES[best.roles.get(pitchClass(n)) ?? 0]);
  const win = keyboardWindow(shownNotes, 48, 84, { low: Math.max(21, settings.range.low), high: Math.min(108, settings.range.high) });

  const tonic = diatonicTriad(key, 1);
  const parallel = { root: tonic.root, quality: tonic.quality === 'major' ? ('minor' as const) : ('major' as const) };
  const examples: Example[] = [
    {
      label: `${triadName(tonic)} vs ${triadName(parallel)}`,
      chords: [voiceTriad(tonic, 0, 4), voiceTriad(parallel, 0, 4)],
      captions: [triadName(tonic), triadName(parallel)],
    },
    {
      label: `${triadName(tonic)}: three inversions`,
      chords: [0, 1, 2].map((i) => voiceTriad(tonic, i as 0 | 1 | 2, 4)),
      captions: [...INVERSION_NAMES],
    },
    {
      label: 'I–IV–V–I',
      chords: voiceProgression(key, [1, 4, 5, 1], 4),
      captions: [1, 4, 5, 1].map((d) => `${romanNumeral(d, diatonicTriad(key, d).quality)} (${triadName(diatonicTriad(key, d))})`),
    },
  ];

  const playExample = async (ex: Example) => {
    await ensureAudio();
    const t0 = performance.now() + 100;
    ex.chords.forEach((c, i) => {
      playNotes(c.map(midiOf), 1100, t0 + i * 1300);
      setTimeout(() => setExample({ ex, index: i }), t0 + i * 1300 - performance.now());
    });
    setTimeout(() => setExample(null), t0 + ex.chords.length * 1300 + 600 - performance.now());
  };

  return (
    <main className="screen stack">
      <div className="topbar">
        <h1>Explore</h1>
        <div className="row">
          <label className="small muted" htmlFor="key">
            Key context
          </label>
          <select id="key" value={keyIdSel} onChange={(e) => setKeyIdSel(e.target.value)}>
            {allKeys().map((k) => (
              <option key={keyId(k)} value={keyId(k)}>
                {keyName(k)}
              </option>
            ))}
          </select>
          <DevicePill />
        </div>
      </div>
      <p className="muted">Play freely. The staff, keyboard and chord name follow what you hold. This is exploration — nothing here is scored.</p>

      <div className="card stack">
        <div className="row between">
          <div className="stack tight">
            {example ? <span className="eyebrow">{example.ex.captions[example.index]}</span> : null}
            <div className="chord-name">{best ? triadName(best.triad) : shownNotes.length ? id.notes.map(spelledText).join(' · ') : 'Play some notes'}</div>
            <div className="muted">
              {best
                ? `${best.inversion !== null ? INVERSION_NAMES[best.inversion] : ''}${best.roman ? ` · ${best.roman} in ${keyName(key)}` : ''} · lowest note ${spelledText(id.notes[0])}`
                : id.interval && id.notes.length >= 2
                  ? `${intervalName(id.notes[0], id.notes[id.notes.length - 1])} (${semitoneName(id.interval.semitones)})`
                  : shownNotes.length > 3
                    ? 'No single triad name for this set.'
                    : shownNotes.length === 3
                      ? 'Not a major, minor, diminished or augmented triad.'
                      : ''}
            </div>
            {id.candidates.length > 1 ? (
              <div className="small">Also readable as: {id.candidates.slice(1).map((c) => triadName(c.triad)).join(', ')}</div>
            ) : null}
            {dev.pedalSustained.length ? <Pill kind="purple">Pedal holding {dev.pedalSustained.length} more note(s) — not counted as held keys</Pill> : null}
          </div>
        </div>
        <StaffView events={[{ notes: id.notes, beats: 4 }]} keySig={key} clef="grand" bars={false} maxSystemWidth={260} ariaLabel="Held notes" />
        <Keyboard
          low={win.low}
          high={win.high}
          held={shownNotes}
          pedal={dev.pedalSustained}
          captions={captions}
          preferFlats={prefersFlats(key)}
          showNames={settings.showNoteNames}
          onPress={(n) => {
            if (!virtualNote(true, n)) {
              playNotes([n], 900);
              setTapped((t) => [...t, n]);
            }
          }}
          onRelease={(n) => {
            if (!virtualNote(false, n)) setTapped((t) => t.filter((x) => x !== n));
          }}
        />
      </div>

      <h2>Hear and compare</h2>
      <div className="grid">
        {examples.map((ex) => (
          <div key={ex.label} className="card stack">
            <strong>{ex.label}</strong>
            <span className="small muted">{ex.captions.join(' → ')}</span>
            <div>
              <button className="primary" onClick={() => void playExample(ex)}>
                ▶ Play
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="tiny muted">
        Names are explanations, not verdicts: ambiguous sets list every reading, and incomplete sets are shown as notes. The bass note sets the
        inversion; the root does not change.
      </p>
    </main>
  );
}
