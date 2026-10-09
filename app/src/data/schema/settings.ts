import { z } from 'zod';
import { InputRouteSchema, KeyIdSchema, MidiNote } from './common';

export const SoundMode = z.enum(['app', 'keyboard', 'visual']);
export type SoundMode = z.infer<typeof SoundMode>;

export const WakeLockMode = z.enum(['always', 'practice', 'off']);
export type WakeLockMode = z.infer<typeof WakeLockMode>;

export const KeyboardRange = z.object({
  low: MidiNote,
  high: MidiNote,
  /** 'default' is an unconfirmed assumption; exercises still validate against it. */
  method: z.enum(['default', 'checked', 'entered']),
  confirmedAt: z.string().nullable(),
});
export type KeyboardRange = z.infer<typeof KeyboardRange>;

export const Settings = z.object({
  schemaVersion: z.literal(1),
  startTab: z.enum(['learn', 'daily']),
  sessionLengthMin: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  /** Keys the daily trainer rotates through. */
  keyPool: z.array(KeyIdSchema).min(1),
  /** Hand instruction for single-hand daily tasks: configuration, never measured. */
  dailyHands: z.enum(['right', 'left', 'alternate']),
  soundMode: SoundMode,
  volume: z.number().min(0).max(1),
  muted: z.boolean(),
  metronome: z.boolean(),
  showNoteNames: z.boolean(),
  wakeLock: WakeLockMode,
  timezone: z.string(),
  range: KeyboardRange,
  input: z
    .object({
      source: z.enum(['webmidi', 'ble', 'virtual']),
      route: InputRouteSchema,
      name: z.string(),
      id: z.string(),
    })
    .nullable(),
  onboarded: z.boolean(),
});
export type Settings = z.infer<typeof Settings>;

export function defaultSettings(): Settings {
  return {
    schemaVersion: 1,
    startTab: 'learn',
    sessionLengthMin: 10,
    keyPool: ['C-major'],
    dailyHands: 'alternate',
    soundMode: 'app',
    volume: 0.7,
    muted: false,
    metronome: true,
    showNoteNames: false,
    wakeLock: 'always',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    // 61 keys (C2-C7) until the learner confirms the real range.
    range: { low: 36, high: 96, method: 'default', confirmedAt: null },
    input: null,
    onboarded: false,
  };
}
