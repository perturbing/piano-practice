import { create } from 'zustand';
import type { InputInfo, InputRoute, SourceKind } from '../midi/types';

export type WebMidiStatus = 'unknown' | 'unavailable' | 'insecure' | 'idle' | 'requesting' | 'granted' | 'denied' | 'error';
export type ConnectionState = 'none' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface SelectedInput {
  source: SourceKind;
  id: string;
  name: string;
}

export interface InputTest {
  press: boolean;
  release: boolean;
  chord: boolean;
  pedal: boolean;
}

export const NO_TEST: InputTest = { press: false, release: false, chord: false, pedal: false };

interface DeviceState {
  webMidi: WebMidiStatus;
  webMidiError: string | null;
  bluetoothAvailable: boolean;
  bleError: string | null;
  inputs: InputInfo[];
  selected: SelectedInput | null;
  route: InputRoute;
  connection: ConnectionState;
  /** Press/release/chord/pedal observed on the selected input since it was (re)connected. */
  tested: InputTest;
  held: number[];
  sustain: boolean;
  pedalSustained: number[];
  lastNote: { note: number; velocity: number; t: number } | null;
  /** Lowest/highest notes seen during the range check. */
  rangeSeen: { low: number; high: number } | null;
  set: (partial: Partial<DeviceState>) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  webMidi: 'unknown',
  webMidiError: null,
  bluetoothAvailable: typeof navigator !== 'undefined' && !!navigator.bluetooth,
  bleError: null,
  inputs: [],
  selected: null,
  route: 'unknown',
  connection: 'none',
  tested: NO_TEST,
  held: [],
  sustain: false,
  pedalSustained: [],
  lastNote: null,
  rangeSeen: null,
  set: (partial) => set(partial),
}));

export type Readiness =
  | { state: 'no-api'; label: string; detail: string }
  | { state: 'no-input'; label: string; detail: string }
  | { state: 'disconnected'; label: string; detail: string }
  | { state: 'untested'; label: string; detail: string }
  | { state: 'ready'; label: string; detail: string };

/** User-facing input readiness (spec §11 state table). Idle silence stays Ready. */
export function readiness(s: Pick<DeviceState, 'selected' | 'connection' | 'tested' | 'webMidi' | 'bluetoothAvailable'>): Readiness {
  if (!s.selected) {
    if ((s.webMidi === 'unavailable' || s.webMidi === 'insecure') && !s.bluetoothAvailable)
      return { state: 'no-api', label: 'MIDI unavailable', detail: 'This browser cannot access MIDI here. You can still browse and use the on-screen keyboard.' };
    return { state: 'no-input', label: 'No input', detail: 'Choose an input in Devices.' };
  }
  if (s.connection === 'reconnecting' || s.connection === 'connecting')
    return { state: 'disconnected', label: 'Reconnecting…', detail: `Waiting for ${s.selected.name}.` };
  if (s.connection !== 'connected')
    return { state: 'disconnected', label: 'Disconnected', detail: `${s.selected.name} is not connected.` };
  if (!s.tested.press || !s.tested.release)
    return { state: 'untested', label: 'Play a note to test', detail: 'Press and release one key to confirm the input.' };
  return { state: 'ready', label: 'MIDI ready', detail: s.selected.name };
}
