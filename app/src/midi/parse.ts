import type { MidiEvent } from './types';

/** Data bytes following a status byte. */
export function dataLength(status: number): number {
  if (status >= 0x80 && status < 0xc0) return 2;
  if (status >= 0xc0 && status < 0xe0) return 1;
  if (status >= 0xe0 && status < 0xf0) return 2;
  if (status === 0xf1 || status === 0xf3) return 1;
  if (status === 0xf2) return 2;
  return 0;
}

/**
 * Normalize one complete MIDI message (status + data) into an app event.
 * Note-on with velocity 0 is a release. Messages that carry nothing the app
 * uses (aftertouch, program change, clock…) return null; SysEx is never requested.
 */
export function normalizeMessage(bytes: ArrayLike<number>, t: number): MidiEvent | null {
  const status = bytes[0];
  if (status === undefined || status < 0x80 || status >= 0xf0) {
    if (status === 0xff) return { type: 'reset', channel: -1, t };
    return null;
  }
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const d1 = bytes[1] ?? 0;
  const d2 = bytes[2] ?? 0;
  switch (kind) {
    case 0x90:
      return d2 === 0
        ? { type: 'noteoff', note: d1, velocity: 0, channel, t }
        : { type: 'noteon', note: d1, velocity: d2, channel, t };
    case 0x80:
      return { type: 'noteoff', note: d1, velocity: d2, channel, t };
    case 0xb0:
      if (d1 === 64) return { type: 'sustain', on: d2 >= 64, value: d2, channel, t };
      // 120 all sound off, 121 reset controllers (clears sustain), 123 all notes off
      if (d1 === 120 || d1 === 123) return { type: 'reset', channel, t };
      if (d1 === 121) return { type: 'sustain', on: false, value: 0, channel, t };
      return null;
    default:
      return null;
  }
}

/**
 * Split a byte stream that may use running status into complete messages.
 * Real-time bytes may appear anywhere and are passed through as single bytes.
 */
export function splitMessages(bytes: ArrayLike<number>): number[][] {
  const out: number[][] = [];
  let running: number | null = null;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b >= 0xf8) {
      out.push([b]);
      i++;
      continue;
    }
    if (b === 0xf0) {
      // Skip SysEx to its terminator.
      while (i < bytes.length && bytes[i] !== 0xf7) i++;
      i++;
      running = null;
      continue;
    }
    let status: number;
    if (b & 0x80) {
      status = b;
      i++;
      running = status < 0xf0 ? status : null;
    } else if (running !== null) {
      status = running;
    } else {
      i++; // stray data byte
      continue;
    }
    const n = dataLength(status);
    const msg = [status];
    for (let k = 0; k < n && i < bytes.length && !(bytes[i] & 0x80); k++) msg.push(bytes[i++]);
    if (msg.length === n + 1) out.push(msg);
  }
  return out;
}
