import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeviceStore, readiness } from '../state/deviceStore';
import { selectVirtual } from '../midi/inputManager';
import { useSettingsStore } from '../state/settingsStore';
import { useAudioStore, ensureAudio } from '../audio/audioEngine';
import { midiText } from '../music/pitch';

/**
 * Measured practice needs a tested input. Returns a guard that runs `start`
 * immediately when ready, or opens a short check first.
 */
export function useReadyGate(opts: { needsAudio?: boolean } = {}) {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (start: () => void) => {
    void ensureAudio();
    const r = readiness(useDeviceStore.getState());
    const audioBad = opts.needsAudio && useSettingsStore.getState().settings.soundMode === 'visual';
    if (r.state === 'ready' && !audioBad) start();
    else setPending(() => start);
  };
  const dialog = pending ? <ReadyDialog needsAudio={!!opts.needsAudio} onCancel={() => setPending(null)} onStart={() => { const s = pending; setPending(null); s(); }} /> : null;
  return { guard, dialog };
}

function ReadyDialog({ onCancel, onStart, needsAudio }: { onCancel: () => void; onStart: () => void; needsAudio: boolean }) {
  const dev = useDeviceStore();
  const r = readiness(dev);
  const navigate = useNavigate();
  const soundMode = useSettingsStore((s) => s.settings.soundMode);
  const update = useSettingsStore((s) => s.update);
  const audio = useAudioStore((s) => s.status);
  const audioOk = !needsAudio || (soundMode !== 'visual' && audio !== 'unavailable');
  const ready = r.state === 'ready' && audioOk;

  // Start as soon as the check passes.
  useEffect(() => {
    if (ready) {
      const t = setTimeout(onStart, 500);
      return () => clearTimeout(t);
    }
  }, [ready, onStart]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog stack">
        <h2 style={{ marginTop: 0 }}>Check your keyboard</h2>
        {r.state === 'no-input' || r.state === 'no-api' ? (
          <>
            <p>No input is selected yet. Connect your MIDI keyboard in Devices, or use the on-screen keyboard for now.</p>
            <div className="row">
              <button className="primary" onClick={() => navigate('/devices')}>
                Set up keyboard
              </button>
              <button onClick={selectVirtual}>Use on-screen keyboard</button>
            </div>
          </>
        ) : r.state === 'disconnected' ? (
          <>
            <p>{r.detail}</p>
            <button className="primary" onClick={() => navigate('/devices')}>
              Open Devices
            </button>
          </>
        ) : r.state === 'untested' ? (
          <>
            <p style={{ fontSize: '1.2rem' }}>
              Press and release any key on <strong>{dev.selected?.name}</strong>.
            </p>
            <ul className="checklist">
              <li>{dev.tested.press ? '✓' : '○'} Key pressed {dev.lastNote ? `(${midiText(dev.lastNote.note)})` : ''}</li>
              <li>{dev.tested.release ? '✓' : '○'} Key released</li>
            </ul>
          </>
        ) : (
          <p className="banner ok">✓ {dev.selected?.name} is ready.</p>
        )}
        {!audioOk ? (
          <div className="banner">
            This exercise plays sounds you need to hear. <button className="small" onClick={() => void update({ soundMode: 'app' })}>Turn on app sound</button>
          </div>
        ) : null}
        <div className="row end">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!ready} onClick={onStart}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
