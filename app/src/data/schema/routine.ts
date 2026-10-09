import { z } from 'zod';
import { KeyIdSchema, LocalDate, SkillTrackSchema } from './common';

export const RoutineTask = z.object({
  id: z.string(),
  slot: z.enum(['settle', 'movement', 'speed', 'apply', 'coordination']),
  title: z.string(),
  purpose: z.string(),
  /** Short reason for inclusion, shown in task details. */
  reason: z.string(),
  track: SkillTrackSchema.nullable(),
  level: z.number().int().min(1).max(4),
  pattern: z.object({
    kind: z.enum(['track', 'scale', 'arpeggio', 'broken']),
    example: z.number().int().min(0),
  }),
  keyId: KeyIdSchema,
  /** Hand instruction: configuration, never a measured fact. */
  hand: z.enum(['right', 'left', 'both', 'alternate']),
  mode: z.enum(['guided', 'timed']),
  bpm: z.number().positive().nullable(),
  repetitions: z.number().int().positive(),
  estMin: z.number().positive(),
});
export type RoutineTask = z.infer<typeof RoutineTask>;

export const TaskState = z.object({
  taskId: z.string(),
  status: z.enum(['pending', 'done', 'skipped', 'partial']),
  attemptIds: z.array(z.string()),
});
export type TaskState = z.infer<typeof TaskState>;

export const DailyRoutine = z.object({
  schemaVersion: z.literal(1),
  date: LocalDate,
  timezone: z.string(),
  revision: z.number().int().min(1),
  generatedAt: z.string(),
  rulesVersion: z.string(),
  lengthMin: z.number().int(),
  tasks: z.array(RoutineTask).min(1),
  position: z.number().int().min(0),
  status: z.enum(['not-started', 'in-progress', 'done']),
  taskStates: z.array(TaskState),
  swaps: z.array(
    z.object({ at: z.string(), taskIndex: z.number().int(), from: z.string(), to: z.string(), reason: z.string() }),
  ),
});
export type DailyRoutine = z.infer<typeof DailyRoutine>;
