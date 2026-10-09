/**
 * How the selected input reaches the app. The browser usually cannot tell USB
 * from Bluetooth, so this is the learner's configuration unless the app made
 * the connection itself (direct Bluetooth, virtual).
 */
export type InputRoute = 'usb' | 'bluetooth-os' | 'ble-receiver' | 'bluetooth-direct' | 'virtual' | 'unknown';

export const ROUTE_LABELS: Record<InputRoute, string> = {
  usb: 'USB MIDI',
  'bluetooth-os': 'Bluetooth MIDI (via operating system)',
  'ble-receiver': 'Bluetooth MIDI (via BLE-to-USB receiver)',
  'bluetooth-direct': 'Bluetooth MIDI (direct from browser)',
  virtual: 'On-screen / computer keyboard',
  unknown: 'Unknown route',
};

/** Normalized input events. `t` is milliseconds in the performance.now() clock domain. */
export type MidiEvent =
  | { type: 'noteon'; note: number; velocity: number; channel: number; t: number }
  | { type: 'noteoff'; note: number; velocity: number; channel: number; t: number }
  | { type: 'sustain'; on: boolean; value: number; channel: number; t: number }
  /** All notes off / all sound off / reset: release every held note on that channel. */
  | { type: 'reset'; channel: number; t: number };

export type SourceKind = 'webmidi' | 'ble' | 'virtual';

export interface InputInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
}

/** Where timestamps come from; stored with attempts for provenance. */
export type TimestampSource = 'webmidi-event' | 'ble-packet' | 'virtual-input';
