import { dataLength } from './parse';

// Bluetooth LE MIDI (MIDI Association BLE-MIDI 1.0) service/characteristic.
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

export interface BleMidiMessage {
  /** 13-bit millisecond timestamp from the sender's clock (wraps at 8192). */
  timestamp: number;
  bytes: number[];
}

/**
 * Decode one BLE-MIDI notification packet.
 *
 * Layout: header byte 10hhhhhh (timestamp high 6 bits), then repeated
 * [timestamp-low byte 1lllllll] [status] [data…]. Running status may omit the
 * status byte (and the timestamp byte, keeping the previous timestamp). A
 * timestamp-low smaller than the previous one means the high bits wrapped.
 * SysEx is skipped.
 */
export function decodeBleMidiPacket(data: Uint8Array): BleMidiMessage[] {
  const out: BleMidiMessage[] = [];
  if (data.length < 2 || !(data[0] & 0x80) || data[0] & 0x40) return out;
  let high = data[0] & 0x3f;
  let lastLow = -1;
  let ts = 0;
  let running: number | null = null;
  let i = 1;

  const readData = (status: number) => {
    const n = dataLength(status);
    const msg = [status];
    while (msg.length < n + 1 && i < data.length && !(data[i] & 0x80)) msg.push(data[i++]);
    if (msg.length === n + 1) out.push({ timestamp: ts, bytes: msg });
  };

  while (i < data.length) {
    const b = data[i];
    if (b & 0x80) {
      // Timestamp-low byte.
      const low = b & 0x7f;
      if (lastLow >= 0 && low < lastLow) high = (high + 1) & 0x3f;
      lastLow = low;
      ts = (high << 7) | low;
      i++;
      if (i >= data.length) break;
      const s = data[i];
      if (s & 0x80) {
        if (s === 0xf0) {
          while (i < data.length && data[i] !== 0xf7) i++;
          i++;
          running = null;
          continue;
        }
        i++;
        if (s >= 0xf8) {
          out.push({ timestamp: ts, bytes: [s] });
          continue;
        }
        running = s < 0xf0 ? s : null;
        readData(s);
      } else if (running !== null) {
        readData(running);
      } else {
        i++;
      }
    } else if (running !== null) {
      // Running status without a new timestamp.
      readData(running);
    } else {
      i++;
    }
  }
  return out;
}

/**
 * Convert packet-relative sender timestamps to local receive-clock times. The
 * newest message in the packet is anchored at the receive time; earlier ones
 * keep their relative spacing (handles the 8192 ms wrap).
 */
export function packetTimes(messages: BleMidiMessage[], receivedAt: number): number[] {
  if (messages.length === 0) return [];
  const last = messages[messages.length - 1].timestamp;
  return messages.map((m) => {
    const delta = (last - m.timestamp + 8192) % 8192;
    // A gap of more than ~1 s inside one packet is not plausible; treat as simultaneous.
    return receivedAt - (delta > 1000 ? 0 : delta);
  });
}
