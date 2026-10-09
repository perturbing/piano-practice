import { z } from 'zod';
import { SkillTrackSchema } from './common';

const Level = z.number().int().min(1).max(4);

/**
 * Learner decisions that cannot be rebuilt from attempts: accepted levels and
 * working tempos. Demonstrated tempos and skill evidence are derived views
 * over attempts.
 */
export const SkillState = z.object({
  schemaVersion: z.literal(1),
  levels: z.object({
    fingerPatterns: Level,
    pulse: Level,
    positionChanges: Level,
    coordination: Level,
  }),
  levelHistory: z.array(
    z.object({ track: SkillTrackSchema, from: z.number().int(), to: z.number().int(), at: z.string(), reason: z.string() }),
  ),
  /** Working tempo per tempo key (pattern|key|hand|level|subdivision|profile). */
  workingTempos: z.record(z.string(), z.number().positive()),
  rulesVersion: z.string(),
});
export type SkillState = z.infer<typeof SkillState>;

export function defaultSkillState(): SkillState {
  return {
    schemaVersion: 1,
    levels: { fingerPatterns: 1, pulse: 1, positionChanges: 1, coordination: 1 },
    levelHistory: [],
    workingTempos: {},
    rulesVersion: 'progression-v1',
  };
}
