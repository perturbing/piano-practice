import type { TimedTarget } from './targets';

export const TIMED_EVALUATOR_VERSION = 'timed-v1';

/** Prototype parameters, stored with every attempt (spec §10). */
export interface TimedConfig {
  /** Upper bound of the symmetric onset window. */
  maxToleranceMs: number;
  /** Fraction of the inter-onset interval used as the window. */
  ioiFraction: number;
  /** Required new chord notes must fall within this spread. */
  chordSpreadMs: number;
  /** Declared beat duration, used for isolated targets. */
  beatMs: number;
  /** 'standard' or an explicitly chosen forgiving profile; saved with results. */
  profile: 'standard' | 'forgiving';
}

export function timedConfig(beatMs: number, profile: TimedConfig['profile'] = 'standard'): TimedConfig {
  return profile === 'forgiving'
    ? { maxToleranceMs: 300, ioiFraction: 0.4, chordSpreadMs: 250, beatMs, profile }
    : { maxToleranceMs: 200, ioiFraction: 0.25, chordSpreadMs: 180, beatMs, profile };
}

export interface Attack {
  note: number;
  /** ms relative to the segment's first beat (same clock as target onsets). */
  t: number;
}

export type TargetOutcome =
  | { kind: 'matched'; attack: number; errorMs: number }
  | { kind: 'timing'; attack: number; errorMs: number } // right pitch, outside the window
  | { kind: 'wrongPitch'; attack: number; played: number; errorMs: number }
  | { kind: 'missed' }
  | { kind: 'pending' };

export type AttackOutcome = 'matched' | 'timing' | 'wrongPitch' | 'extra' | 'pending';

export interface TimedResult {
  targets: TargetOutcome[];
  attacks: AttackOutcome[];
  tolerances: number[];
  /** Chord groups whose matched notes spread more than allowed. */
  spreadGroups: number[];
  summary: TimedSummary;
}

export interface TimedSummary {
  expected: number;
  matched: number;
  timingMisses: number;
  wrongPitches: number;
  missed: number;
  extras: number;
  /** Median absolute onset error of matched notes; null when nothing matched. */
  medianAbsErrorMs: number | null;
  /** Mean signed error (negative = early) — informational, never cancels in the summary. */
  meanSignedErrorMs: number | null;
}

/** Window for each target: min(max tolerance, fraction × nearest distinct onset gap). */
export function tolerancesFor(targets: TimedTarget[], cfg: TimedConfig): number[] {
  const onsets = [...new Set(targets.map((t) => t.onsetMs))].sort((a, b) => a - b);
  return targets.map((t) => {
    const i = onsets.indexOf(t.onsetMs);
    const gaps: number[] = [];
    if (i > 0) gaps.push(t.onsetMs - onsets[i - 1]);
    if (i < onsets.length - 1) gaps.push(onsets[i + 1] - t.onsetMs);
    const ioi = gaps.length ? Math.min(...gaps) : cfg.beatMs;
    return Math.min(cfg.maxToleranceMs, ioi * cfg.ioiFraction);
  });
}

/** How far past a target's window a same-pitch attack is still reported as a timing miss. */
function nearWindow(tol: number): number {
  return tol * 2;
}

/** When the target can no longer change outcome (used for live display and segment end). */
export function closesAt(target: TimedTarget, tol: number): number {
  return target.onsetMs + nearWindow(tol);
}

/**
 * Match attacks to the fixed score timeline. Each attack matches at most one
 * target; candidates resolve by closest scheduled onset, then score order. A
 * wrong attack never shifts later targets. With `nowMs`, targets whose window
 * is still open stay pending instead of missed.
 */
export function evaluateTimed(
  targets: TimedTarget[],
  attacks: Attack[],
  cfg: TimedConfig,
  nowMs = Infinity,
): TimedResult {
  const tol = tolerancesFor(targets, cfg);
  const tOut: (TargetOutcome | null)[] = targets.map(() => null);
  const aOut: (AttackOutcome | null)[] = attacks.map(() => null);

  const greedy = (
    accept: (ti: number, ai: number, err: number) => boolean,
    assign: (ti: number, ai: number, err: number) => void,
  ) => {
    const pairs: { ti: number; ai: number; err: number }[] = [];
    targets.forEach((tg, ti) => {
      if (tOut[ti]) return;
      attacks.forEach((at, ai) => {
        if (aOut[ai]) return;
        const err = at.t - tg.onsetMs;
        if (accept(ti, ai, err)) pairs.push({ ti, ai, err });
      });
    });
    pairs.sort((x, y) => Math.abs(x.err) - Math.abs(y.err) || x.ti - y.ti || x.ai - y.ai);
    for (const p of pairs) {
      if (tOut[p.ti] || aOut[p.ai]) continue;
      assign(p.ti, p.ai, p.err);
    }
  };

  // 1. Right pitch inside the window.
  greedy(
    (ti, ai, err) => attacks[ai].note === targets[ti].midi && Math.abs(err) <= tol[ti],
    (ti, ai, err) => {
      tOut[ti] = { kind: 'matched', attack: ai, errorMs: err };
      aOut[ai] = 'matched';
    },
  );
  // 2. Right pitch, too early/late but near.
  greedy(
    (ti, ai, err) => attacks[ai].note === targets[ti].midi && Math.abs(err) <= nearWindow(tol[ti]),
    (ti, ai, err) => {
      tOut[ti] = { kind: 'timing', attack: ai, errorMs: err };
      aOut[ai] = 'timing';
    },
  );
  // 3. Wrong pitch at the right time.
  greedy(
    (ti, _ai, err) => Math.abs(err) <= tol[ti],
    (ti, ai, err) => {
      tOut[ti] = { kind: 'wrongPitch', attack: ai, played: attacks[ai].note, errorMs: err };
      aOut[ai] = 'wrongPitch';
    },
  );

  const targetsFinal: TargetOutcome[] = targets.map((tg, ti) => {
    const o = tOut[ti];
    if (o) return o;
    return nowMs >= closesAt(tg, tol[ti]) ? { kind: 'missed' } : { kind: 'pending' };
  });
  // An unmatched attack could still pair with a target whose window is open.
  const attacksFinal: AttackOutcome[] = attacks.map((at, ai) => {
    const o = aOut[ai];
    if (o) return o;
    const couldPair = targets.some(
      (tg, ti) => targetsFinal[ti].kind === 'pending' && Math.abs(at.t - tg.onsetMs) <= nearWindow(tol[ti]),
    );
    return couldPair ? 'pending' : 'extra';
  });

  // Chord spread: matched notes of a group must attack within the spread limit.
  const groups = new Map<number, number[]>();
  targets.forEach((tg, ti) => groups.set(tg.group, [...(groups.get(tg.group) ?? []), ti]));
  const spreadGroups: number[] = [];
  for (const [g, tis] of groups) {
    if (tis.length < 2) continue;
    const times = tis
      .map((ti) => targetsFinal[ti])
      .filter((o): o is Extract<TargetOutcome, { kind: 'matched' }> => o.kind === 'matched')
      .map((o) => attacks[o.attack].t);
    if (times.length >= 2 && Math.max(...times) - Math.min(...times) > cfg.chordSpreadMs) spreadGroups.push(g);
  }

  return { targets: targetsFinal, attacks: attacksFinal, tolerances: tol, spreadGroups, summary: summarize(targetsFinal, attacksFinal) };
}

function summarize(targets: TargetOutcome[], attacks: AttackOutcome[]): TimedSummary {
  const errs = targets.flatMap((o) => (o.kind === 'matched' ? [o.errorMs] : []));
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const median =
    abs.length === 0 ? null : abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2;
  return {
    expected: targets.length,
    matched: targets.filter((o) => o.kind === 'matched').length,
    timingMisses: targets.filter((o) => o.kind === 'timing').length,
    wrongPitches: targets.filter((o) => o.kind === 'wrongPitch').length,
    missed: targets.filter((o) => o.kind === 'missed').length,
    extras: attacks.filter((o) => o === 'extra').length,
    medianAbsErrorMs: median,
    meanSignedErrorMs: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
  };
}

/** Plain-language description of a timed summary. */
export function describeTimed(s: TimedSummary): string {
  const parts = [`${s.matched} of ${s.expected} notes on time`];
  if (s.timingMisses) parts.push(`${s.timingMisses} right note${s.timingMisses > 1 ? 's' : ''} but early or late`);
  if (s.wrongPitches) parts.push(`${s.wrongPitches} wrong note${s.wrongPitches > 1 ? 's' : ''}`);
  if (s.missed) parts.push(`${s.missed} missed`);
  if (s.extras) parts.push(`${s.extras} extra attack${s.extras > 1 ? 's' : ''}`);
  let text = parts.join(', ') + '.';
  if (s.medianAbsErrorMs !== null) {
    text += ` Typical timing difference ${Math.round(s.medianAbsErrorMs)} ms`;
    if (s.meanSignedErrorMs !== null && Math.abs(s.meanSignedErrorMs) > 25)
      text += `, tending ${s.meanSignedErrorMs < 0 ? 'early' : 'late'}`;
    text += '.';
  }
  return text;
}
