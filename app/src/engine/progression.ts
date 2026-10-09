import type { TimedSummary } from './timed';

// Adjustable product heuristics (spec §5, §13) — not validated training rules.
// The version is stored with skill evidence so rule changes never silently
// rewrite history.
export const PROGRESSION_RULES_VERSION = 'progression-v1';
export const TEMPO_STEP_BPM = 2;
export const MIN_BPM = 30;
export const MAX_BPM = 200;
export const QUALIFY_MATCH_RATIO = 0.95;

export interface SegmentEvidence {
  /** Same pattern, key, hand, level, bpm, subdivision and tolerance profile. */
  settingsKey: string;
  complete: boolean;
  assisted: boolean;
  interrupted: boolean;
  summary: TimedSummary;
}

/** A timed segment that counts toward a tempo claim. */
export function segmentQualifies(s: SegmentEvidence): boolean {
  return (
    s.complete &&
    !s.assisted &&
    !s.interrupted &&
    s.summary.expected > 0 &&
    s.summary.matched / s.summary.expected >= QUALIFY_MATCH_RATIO &&
    s.summary.extras === 0
  );
}

/**
 * Offer "Try +2 BPM" after the two most recent attempts at the same settings
 * both qualify. Never applied automatically and never during an attempt.
 */
export function tempoIncreaseOffered(segments: SegmentEvidence[]): boolean {
  if (segments.length < 2) return false;
  const last = segments[segments.length - 1];
  const prev = segments[segments.length - 2];
  return last.settingsKey === prev.settingsKey && segmentQualifies(last) && segmentQualifies(prev);
}

/** Repeated difficulty suggests going slower (or a smaller / guided version). */
export function slowerSuggested(segments: SegmentEvidence[]): boolean {
  const recent = segments.slice(-2);
  return (
    recent.length === 2 &&
    recent.every((s) => s.complete && s.summary.expected > 0 && s.summary.matched / s.summary.expected < 0.7)
  );
}

export interface CheckEvidence {
  /** Local date of the session (YYYY-MM-DD). */
  date: string;
  total: number;
  /** First-attempt, unassisted correct items (hinted items stay in the denominator). */
  independent: number;
}

/**
 * Untimed demonstration: at least 90% first-attempt unassisted items in each of
 * two fresh checks on different days.
 */
export function demonstratedUntimed(checks: CheckEvidence[], minItems = 5, ratio = 0.9): boolean {
  const passingDates = new Set(
    checks.filter((c) => c.total >= minItems && c.independent / c.total >= ratio).map((c) => c.date),
  );
  return passingDates.size >= 2;
}

export interface PatternEvidence {
  patternId: string;
  date: string;
  qualified: boolean;
}

/**
 * Offer the next level for a skill track only after the current level has been
 * demonstrated across fresh examples (two different patterns) on two different
 * days. Tempo progress never advances a level by itself; the learner accepts.
 */
export function levelUpOffered(evidence: PatternEvidence[]): boolean {
  const q = evidence.filter((e) => e.qualified);
  return new Set(q.map((e) => e.patternId)).size >= 2 && new Set(q.map((e) => e.date)).size >= 2;
}
