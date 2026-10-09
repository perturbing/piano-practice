import type { ReactNode } from 'react';
import { useDeviceStore, readiness } from '../state/deviceStore';
import { useAudioStore } from '../audio/audioEngine';
import { useSettingsStore } from '../state/settingsStore';

export function Pill({ kind, children, dot }: { kind?: 'ok' | 'warn' | 'danger' | 'accent' | 'purple'; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`pill ${kind ?? ''}`}>
      {dot ? <span className="dot" /> : null}
      {children}
    </span>
  );
}

/** MIDI readiness. Idle silence stays Ready; untested inputs never show Ready. */
export function DevicePill() {
  const s = useDeviceStore();
  const r = readiness(s);
  const kind = r.state === 'ready' ? 'ok' : r.state === 'untested' ? 'accent' : r.state === 'no-input' ? undefined : 'warn';
  return (
    <span title={r.detail}>
      <Pill kind={kind} dot>
        {r.label}
      </Pill>
    </span>
  );
}

export function SoundPill() {
  const status = useAudioStore((s) => s.status);
  const mode = useSettingsStore((s) => s.settings.soundMode);
  const muted = useSettingsStore((s) => s.settings.muted);
  if (mode === 'visual') return <Pill>Visual only</Pill>;
  if (muted) return <Pill kind="warn">Muted</Pill>;
  if (status === 'running') return <Pill kind="ok">Sound on</Pill>;
  if (status === 'unavailable') return <Pill kind="danger">No sound</Pill>;
  return <Pill kind="warn">Tap to enable sound</Pill>;
}
