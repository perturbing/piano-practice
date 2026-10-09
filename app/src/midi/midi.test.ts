import { describe, expect, it } from 'vitest';
import { normalizeMessage, splitMessages } from './parse';
import { decodeBleMidiPacket, packetTimes } from './bleMidi';
import { NoteTracker } from './noteTracker';
import type { MidiEvent } from './types';

const hex = (s: string) => Uint8Array.from(s.split(' ').map((b) => parseInt(b, 16)));

describe('normalizeMessage', () => {
  it('treats note-on velocity 0 as a release', () => {
    expect(normalizeMessage([0x90, 60, 0], 5)).toEqual({ type: 'noteoff', note: 60, velocity: 0, channel: 0, t: 5 });
    expect(normalizeMessage([0x91, 60, 1], 5)).toMatchObject({ type: 'noteon', velocity: 1, channel: 1 });
  });
  it('keeps soft notes (no velocity cutoff)', () => {
    expect(normalizeMessage([0x90, 60, 1], 0)?.type).toBe('noteon');
  });
  it('maps sustain and all-notes-off', () => {
    expect(normalizeMessage([0xb0, 64, 127], 0)).toMatchObject({ type: 'sustain', on: true });
    expect(normalizeMessage([0xb0, 64, 10], 0)).toMatchObject({ type: 'sustain', on: false });
    expect(normalizeMessage([0xb0, 123, 0], 0)).toMatchObject({ type: 'reset', channel: 0 });
  });
  it('ignores messages the app does not use', () => {
    expect(normalizeMessage([0xf8], 0)).toBeNull();
    expect(normalizeMessage([0xc0, 5], 0)).toBeNull();
    expect(normalizeMessage([0xb0, 1, 40], 0)).toBeNull();
  });
});

describe('splitMessages', () => {
  it('expands running status and passes real-time bytes', () => {
    expect(splitMessages([0x90, 60, 100, 64, 100, 0xf8, 67, 100])).toEqual([
      [0x90, 60, 100],
      [0x90, 64, 100],
      [0xf8],
      [0x90, 67, 100],
    ]);
  });
  it('skips SysEx', () => {
    expect(splitMessages([0xf0, 1, 2, 3, 0xf7, 0x80, 60, 0])).toEqual([[0x80, 60, 0]]);
  });
});

describe('decodeBleMidiPacket', () => {
  it('decodes a single note-on', () => {
    // header 0x80 (high 0), ts-low 0x81 (1), note on C4 vel 100
    expect(decodeBleMidiPacket(hex('80 81 90 3c 64'))).toEqual([{ timestamp: 1, bytes: [0x90, 60, 100] }]);
  });
  it('decodes multiple messages with their own timestamps', () => {
    const msgs = decodeBleMidiPacket(hex('81 85 90 3c 64 8a 80 3c 00'));
    expect(msgs).toEqual([
      { timestamp: (1 << 7) | 5, bytes: [0x90, 60, 100] },
      { timestamp: (1 << 7) | 10, bytes: [0x80, 60, 0] },
    ]);
  });
  it('handles running status with and without timestamp bytes (a chord)', () => {
    const msgs = decodeBleMidiPacket(hex('80 81 90 3c 64 40 64 82 43 64'));
    expect(msgs.map((m) => m.bytes)).toEqual([
      [0x90, 60, 100],
      [0x90, 64, 100],
      [0x90, 67, 100],
    ]);
    expect(msgs.map((m) => m.timestamp)).toEqual([1, 1, 2]);
  });
  it('increments the high bits when the low timestamp wraps inside a packet', () => {
    const msgs = decodeBleMidiPacket(hex('80 ff 90 3c 64 81 80 3c 00'));
    expect(msgs.map((m) => m.timestamp)).toEqual([127, 129]);
  });
  it('skips SysEx and real-time messages pass through', () => {
    const msgs = decodeBleMidiPacket(hex('80 81 f0 01 02 81 f7 82 f8 83 b0 40 7f'));
    expect(msgs.map((m) => m.bytes)).toEqual([[0xf8], [0xb0, 64, 127]]);
  });
  it('rejects packets without a valid header', () => {
    expect(decodeBleMidiPacket(hex('90 3c 64'))).toEqual([]);
  });
  it('anchors packet times to receive time and keeps spacing across the wrap', () => {
    expect(packetTimes([{ timestamp: 8190, bytes: [] }, { timestamp: 2, bytes: [] }], 1000)).toEqual([996, 1000]);
  });
});

describe('NoteTracker', () => {
  const on = (note: number, t = 0, channel = 0): MidiEvent => ({ type: 'noteon', note, velocity: 80, channel, t });
  const off = (note: number, t = 0, channel = 0): MidiEvent => ({ type: 'noteoff', note, velocity: 0, channel, t });
  const ped = (v: boolean): MidiEvent => ({ type: 'sustain', on: v, value: v ? 127 : 0, channel: 0, t: 0 });

  it('tracks held keys separately from pedal-sustained notes', () => {
    const tr = new NoteTracker();
    tr.apply(ped(true));
    tr.apply(on(60));
    tr.apply(off(60));
    expect(tr.heldNotes()).toEqual([]);
    expect(tr.pedalSustained()).toEqual([60]);
    tr.apply(ped(false));
    expect(tr.pedalSustained()).toEqual([]);
  });
  it('reports fast repeated attacks as separate attacks', () => {
    const tr = new NoteTracker();
    const changes = [on(60, 0), off(60, 30), on(60, 60), off(60, 90)].flatMap((e) => tr.apply(e));
    expect(changes.filter((c) => c.kind === 'attack')).toHaveLength(2);
  });
  it('treats a duplicate note-on as a re-strike', () => {
    const tr = new NoteTracker();
    tr.apply(on(60));
    expect(tr.apply(on(60))).toEqual([{ kind: 'attack', note: 60, velocity: 80, t: 0, retrigger: true }]);
  });
  it('ignores stray note-offs and resets without stuck notes', () => {
    const tr = new NoteTracker();
    expect(tr.apply(off(61))).toEqual([]);
    tr.apply(on(60));
    tr.apply(on(64, 0, 1));
    const r = tr.apply({ type: 'reset', channel: -1, t: 0 });
    expect(r).toEqual([{ kind: 'reset', released: [60, 64], t: 0 }]);
    expect(tr.heldNotes()).toEqual([]);
  });
  it('clear drops everything', () => {
    const tr = new NoteTracker();
    tr.apply(on(60));
    tr.apply(ped(true));
    expect(tr.clear()).toEqual([60]);
    expect(tr.sustain).toBe(false);
  });
});
