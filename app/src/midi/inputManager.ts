import { NoteTracker, type TrackerChange } from './noteTracker';
import { normalizeMessage, splitMessages } from './parse';
import { BLE_MIDI_CHARACTERISTIC, BLE_MIDI_SERVICE, decodeBleMidiPacket, packetTimes } from './bleMidi';
import type { InputInfo, InputRoute, MidiEvent, SourceKind, TimestampSource } from './types';
import { NO_TEST, useDeviceStore, type SelectedInput } from '../state/deviceStore';

// Device layer: Web MIDI (USB, or Bluetooth exposed by the OS / a BLE-to-USB
// receiver), direct BLE-MIDI over Web Bluetooth (the reliable Bluetooth route
// on Android), and a virtual on-screen/computer keyboard. Only the selected
// input reaches the app, so a keyboard visible over both USB and Bluetooth is
// never counted twice.

export interface InputMessage {
  event: MidiEvent;
  changes: TrackerChange[];
  held: number[];
  source: TimestampSource;
}

export type ConnectionNotice = { kind: 'disconnected' | 'reconnected' | 'selected'; t: number; name: string };

const tracker = new NoteTracker();
const inputListeners = new Set<(m: InputMessage) => void>();
const connectionListeners = new Set<(n: ConnectionNotice) => void>();

let access: MIDIAccess | null = null;
let webMidiInput: MIDIInput | null = null;
let bleDevice: BluetoothDevice | null = null;
let bleChar: BluetoothRemoteGATTCharacteristic | null = null;
let bleReconnectTimer: ReturnType<typeof setTimeout> | null = null;

const store = () => useDeviceStore.getState();

export function onInput(fn: (m: InputMessage) => void): () => void {
  inputListeners.add(fn);
  return () => inputListeners.delete(fn);
}

export function onConnection(fn: (n: ConnectionNotice) => void): () => void {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}

export function heldNotes(): number[] {
  return tracker.heldNotes();
}

export function sustainOn(): boolean {
  return tracker.sustain;
}

function notifyConnection(kind: ConnectionNotice['kind']) {
  const name = store().selected?.name ?? '';
  for (const fn of connectionListeners) fn({ kind, t: performance.now(), name });
}

function dispatch(event: MidiEvent, source: TimestampSource) {
  const changes = tracker.apply(event);
  const held = tracker.heldNotes();
  const s = store();
  const tested = { ...s.tested };
  let lastNote = s.lastNote;
  let rangeSeen = s.rangeSeen;
  for (const c of changes) {
    if (c.kind === 'attack') {
      tested.press = true;
      lastNote = { note: c.note, velocity: c.velocity, t: c.t };
      rangeSeen = rangeSeen
        ? { low: Math.min(rangeSeen.low, c.note), high: Math.max(rangeSeen.high, c.note) }
        : { low: c.note, high: c.note };
    }
    if (c.kind === 'release' && tested.press) tested.release = true;
    if (c.kind === 'sustain' && c.on) tested.pedal = true;
  }
  if (held.length >= 3) tested.chord = true;
  s.set({ held, sustain: tracker.sustain, pedalSustained: tracker.pedalSustained(), tested, lastNote, rangeSeen });
  const msg: InputMessage = { event, changes, held, source };
  for (const fn of inputListeners) fn(msg);
}

function handleBytes(bytes: ArrayLike<number>, t: number, source: TimestampSource) {
  for (const m of splitMessages(bytes)) {
    const ev = normalizeMessage(m, t);
    if (ev) dispatch(ev, source);
  }
}

/** Clear stale held notes (disconnect, input change, recovery) without fabricating releases into scores. */
export function clearHeld(): void {
  tracker.clear();
  store().set({ held: [], sustain: false, pedalSustained: [] });
}

function select(sel: SelectedInput | null, route: InputRoute) {
  clearHeld();
  store().set({ selected: sel, route, tested: NO_TEST, rangeSeen: null, lastNote: null });
}

// ---------------------------------------------------------------------------
// Web MIDI

export function webMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

/** Query permission without prompting; returns true when access can be requested silently. */
export async function midiPermissionGranted(): Promise<boolean> {
  try {
    const p = await navigator.permissions.query({ name: 'midi' as PermissionName });
    return p.state === 'granted';
  } catch {
    return false;
  }
}

function listInputs(): InputInfo[] {
  if (!access) return [];
  return [...access.inputs.values()].map((i) => ({
    id: i.id,
    name: i.name ?? 'MIDI input',
    manufacturer: i.manufacturer ?? '',
    state: i.state,
  }));
}

export async function requestWebMidi(): Promise<boolean> {
  const s = store();
  if (!webMidiSupported()) {
    s.set({ webMidi: 'unavailable' });
    return false;
  }
  if (!window.isSecureContext) {
    s.set({ webMidi: 'insecure' });
    return false;
  }
  s.set({ webMidi: 'requesting', webMidiError: null });
  try {
    // No SysEx: the lessons do not need it.
    access = await navigator.requestMIDIAccess({ sysex: false });
    access.onstatechange = onMidiStateChange;
    s.set({ webMidi: 'granted', inputs: listInputs() });
    return true;
  } catch (e) {
    const name = (e as DOMException)?.name;
    store().set({
      webMidi: name === 'SecurityError' || name === 'NotAllowedError' ? 'denied' : 'error',
      webMidiError: (e as Error)?.message ?? String(e),
    });
    return false;
  }
}

export function refreshInputs(): void {
  store().set({ inputs: listInputs() });
}

function onMidiStateChange(e: Event) {
  refreshInputs();
  const port = (e as MIDIConnectionEvent).port;
  const sel = store().selected;
  if (!port || !sel || sel.source !== 'webmidi' || port.id !== sel.id || port.type !== 'input') return;
  if (port.state === 'disconnected') {
    detachWebMidi();
    clearHeld();
    store().set({ connection: 'disconnected' });
    notifyConnection('disconnected');
  } else if (port.state === 'connected' && store().connection !== 'connected') {
    attachWebMidi(port as MIDIInput);
    // After a link returns the input must be rechecked before it is Ready again.
    store().set({ connection: 'connected', tested: NO_TEST, selected: { ...sel, name: port.name ?? sel.name } });
    notifyConnection('reconnected');
  }
}

function attachWebMidi(input: MIDIInput) {
  detachWebMidi();
  webMidiInput = input;
  input.onmidimessage = (ev: MIDIMessageEvent) => {
    if (ev.data) handleBytes(ev.data, ev.timeStamp, 'webmidi-event');
  };
}

function detachWebMidi() {
  if (webMidiInput) webMidiInput.onmidimessage = null;
  webMidiInput = null;
}

export function selectWebMidiInput(id: string, route: InputRoute): boolean {
  const input = access?.inputs.get(id);
  disconnectAll();
  if (!input) {
    store().set({ connection: 'disconnected' });
    return false;
  }
  attachWebMidi(input);
  select({ source: 'webmidi', id, name: input.name ?? 'MIDI input' }, route);
  store().set({ connection: input.state === 'connected' ? 'connected' : 'disconnected' });
  notifyConnection('selected');
  return true;
}

// ---------------------------------------------------------------------------
// Direct BLE-MIDI (Web Bluetooth)

export function bluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export async function connectBleMidi(): Promise<boolean> {
  if (!bluetoothSupported()) {
    store().set({ bleError: 'Web Bluetooth is not available in this browser.' });
    return false;
  }
  store().set({ bleError: null });
  let device: BluetoothDevice;
  try {
    device = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }] });
  } catch (e) {
    // User closed the chooser: not an error worth shouting about.
    if ((e as DOMException)?.name !== 'NotFoundError') store().set({ bleError: (e as Error).message });
    return false;
  }
  disconnectAll();
  return attachBle(device);
}

async function attachBle(device: BluetoothDevice): Promise<boolean> {
  bleDevice = device;
  device.removeEventListener('gattserverdisconnected', onBleDisconnected);
  device.addEventListener('gattserverdisconnected', onBleDisconnected);
  select({ source: 'ble', id: device.id, name: device.name ?? 'Bluetooth MIDI' }, 'bluetooth-direct');
  store().set({ connection: 'connecting' });
  const ok = await gattConnect(device);
  store().set({ connection: ok ? 'connected' : 'disconnected' });
  if (ok) notifyConnection('selected');
  return ok;
}

async function gattConnect(device: BluetoothDevice): Promise<boolean> {
  try {
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
    const ch = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);
    ch.removeEventListener('characteristicvaluechanged', onBlePacket);
    ch.addEventListener('characteristicvaluechanged', onBlePacket);
    await ch.startNotifications();
    bleChar = ch;
    return true;
  } catch (e) {
    store().set({ bleError: (e as Error).message });
    return false;
  }
}

function onBlePacket(e: Event) {
  const ch = e.target as BluetoothRemoteGATTCharacteristic;
  if (!ch.value) return;
  const data = new Uint8Array(ch.value.buffer, ch.value.byteOffset, ch.value.byteLength);
  const receivedAt = e.timeStamp > 0 ? e.timeStamp : performance.now();
  const msgs = decodeBleMidiPacket(data);
  const times = packetTimes(msgs, receivedAt);
  msgs.forEach((m, i) => {
    const ev = normalizeMessage(m.bytes, times[i]);
    if (ev) dispatch(ev, 'ble-packet');
  });
}

function onBleDisconnected() {
  if (store().selected?.source !== 'ble') return;
  clearHeld();
  bleChar = null;
  store().set({ connection: 'reconnecting', tested: NO_TEST });
  notifyConnection('disconnected');
  scheduleBleReconnect(1000);
}

function scheduleBleReconnect(delay: number) {
  if (bleReconnectTimer) clearTimeout(bleReconnectTimer);
  bleReconnectTimer = setTimeout(async () => {
    const device = bleDevice;
    if (!device || store().selected?.source !== 'ble') return;
    const ok = await gattConnect(device);
    if (ok) {
      store().set({ connection: 'connected', tested: NO_TEST });
      notifyConnection('reconnected');
    } else {
      scheduleBleReconnect(Math.min(delay * 2, 30_000));
    }
  }, delay);
}

/** Manual retry from the UI. */
export async function reconnectBle(): Promise<boolean> {
  if (!bleDevice) return false;
  store().set({ connection: 'connecting' });
  const ok = await gattConnect(bleDevice);
  store().set({ connection: ok ? 'connected' : 'disconnected', tested: NO_TEST });
  if (ok) notifyConnection('reconnected');
  return ok;
}

/** Reattach a previously granted BLE-MIDI device after a reload, without the chooser. */
export async function reattachBle(id: string): Promise<boolean> {
  const bt = navigator.bluetooth as Bluetooth & { getDevices?: () => Promise<BluetoothDevice[]> };
  if (!bt?.getDevices) return false;
  try {
    const device = (await bt.getDevices()).find((d) => d.id === id);
    if (!device) return false;
    return attachBle(device);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Virtual input (on-screen keyboard and computer keys)

export function selectVirtual(): void {
  disconnectAll();
  select({ source: 'virtual', id: 'virtual', name: 'On-screen / computer keyboard' }, 'virtual');
  store().set({ connection: 'connected' });
  notifyConnection('selected');
}

/** Returns false when the virtual keyboard is not the selected input (the tap is not counted). */
export function virtualNote(on: boolean, note: number, velocity = 80): boolean {
  if (store().selected?.source !== 'virtual') return false;
  const t = performance.now();
  dispatch(on ? { type: 'noteon', note, velocity, channel: 0, t } : { type: 'noteoff', note, velocity: 0, channel: 0, t }, 'virtual-input');
  return true;
}

export function virtualSustain(on: boolean): boolean {
  if (store().selected?.source !== 'virtual') return false;
  dispatch({ type: 'sustain', on, value: on ? 127 : 0, channel: 0, t: performance.now() }, 'virtual-input');
  return true;
}

// ---------------------------------------------------------------------------

export function disconnectAll(): void {
  detachWebMidi();
  if (bleReconnectTimer) clearTimeout(bleReconnectTimer);
  bleReconnectTimer = null;
  if (bleChar) bleChar.removeEventListener('characteristicvaluechanged', onBlePacket);
  bleChar = null;
  if (bleDevice) {
    bleDevice.removeEventListener('gattserverdisconnected', onBleDisconnected);
    if (bleDevice.gatt?.connected) bleDevice.gatt.disconnect();
  }
  bleDevice = null;
  store().set({ connection: 'none' });
}

export function forgetInput(): void {
  disconnectAll();
  select(null, 'unknown');
}

export function currentTimestampSource(source: SourceKind | undefined): TimestampSource {
  return source === 'ble' ? 'ble-packet' : source === 'virtual' ? 'virtual-input' : 'webmidi-event';
}

/**
 * Startup: reattach the saved input without prompting. Web MIDI is only
 * requested silently when permission was already granted.
 */
export async function restoreSavedInput(saved: { source: SourceKind; id: string; route: InputRoute } | null): Promise<void> {
  const s = store();
  if (!webMidiSupported()) s.set({ webMidi: 'unavailable' });
  else if (!window.isSecureContext) s.set({ webMidi: 'insecure' });
  else s.set({ webMidi: 'idle' });

  if (webMidiSupported() && window.isSecureContext && (await midiPermissionGranted())) await requestWebMidi();
  if (!saved) return;
  if (saved.source === 'virtual') selectVirtual();
  else if (saved.source === 'webmidi' && access) {
    if (!selectWebMidiInput(saved.id, saved.route)) {
      // Keep the selection so it reattaches when the port appears.
      select({ source: 'webmidi', id: saved.id, name: 'Saved MIDI input' }, saved.route);
      store().set({ connection: 'disconnected' });
    }
  } else if (saved.source === 'ble') await reattachBle(saved.id);
}
