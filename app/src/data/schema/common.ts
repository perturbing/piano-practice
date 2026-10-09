import { z } from 'zod';

export const SpelledSchema = z.object({
  letter: z.enum(['C', 'D', 'E', 'F', 'G', 'A', 'B']),
  acc: z.union([z.literal(-2), z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]),
  octave: z.number().int().min(-1).max(9),
});

export const MidiNote = z.number().int().min(0).max(127);

export const InputRouteSchema = z.enum(['usb', 'bluetooth-os', 'ble-receiver', 'bluetooth-direct', 'virtual', 'unknown']);

/** Local calendar date in the learner's timezone, YYYY-MM-DD. */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const KeyIdSchema = z.string().regex(/^[A-G][#b]?-(major|minor)$/);

export const SkillTrackSchema = z.enum(['fingerPatterns', 'pulse', 'positionChanges', 'coordination']);
