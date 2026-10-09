import type { Attempt } from '../data/schema';
import type { SkillTrack } from '../music/patterns';
import {
  type CheckEvidence,
  type PatternEvidence,
  demonstratedUntimed,
  levelUpOffered,
  tempoIncreaseOffered,
} from './progression';
import type { TrackEvidence } from './dailyRoutine';

// Derived, rebuildable views over attempts. Nothing here is stored: changing
// a rule recomputes the view instead of rewriting history.

export interface GuidedCounts {
  total: number;
  firstTry: number;
  completed: number;
  assisted: number;
  skipped: number;
}

export function guidedCounts(a: Attempt): GuidedCounts {
  const r = a.itemResults ?? [];
  return {
    total: r.length,
    firstTry: r.filter((x) => x.firstTry).length,
    completed: r.filter((x) => x.outcome === 'correct').length,
    assisted: r.filter((x) => x.assisted).length,
    skipped: r.filter((x) => x.outcome === 'skipped').length,
  };
}

/** A clean, complete attempt: counts as evidence for a level. */
export function attemptQualified(a: Attempt): boolean {
  if (a.status !== 'completed') return false;
  if (a.mode === 'timed') return (a.segments ?? []).some((s) => s.status === 'complete' && s.qualifies);
  const c = guidedCounts(a);
  return c.total > 0 && c.skipped === 0 && c.firstTry / c.total >= 0.9;
}

export type LessonStatus = 'not-started' | 'practising' | 'demonstrated';

export function lessonStatus(attempts: Attempt[], lessonId: string): { status: LessonStatus; checks: CheckEvidence[] } {
  const mine = attempts.filter((a) => a.kind === 'lesson' && a.sourceId.startsWith(`${lessonId}:`));
  if (mine.length === 0) return { status: 'not-started', checks: [] };
  // Independent checks are the Recall and Apply steps; their items are fresh examples.
  const checks: CheckEvidence[] = mine
    .filter((a) => /:(recall|apply)$/.test(a.sourceId) && a.status === 'completed')
    .map((a) => {
      if (a.mode === 'timed') {
        const segs = (a.segments ?? []).filter((s) => s.status === 'complete' && s.summary);
        const total = segs.reduce((n, s) => n + (s.summary?.expected ?? 0), 0);
        const matched = segs.reduce((n, s) => n + (s.summary?.matched ?? 0), 0);
        return { date: a.localDate, total, independent: matched };
      }
      const c = guidedCounts(a);
      return { date: a.localDate, total: c.total, independent: c.firstTry };
    });
  return { status: demonstratedUntimed(checks, 4) ? 'demonstrated' : 'practising', checks };
}

/** Per-track evidence over recent daily attempts (for choosing today's focus). */
export function trackEvidence(attempts: Attempt[], sinceDate: string): Partial<Record<SkillTrack, TrackEvidence>> {
  const out: Partial<Record<SkillTrack, TrackEvidence>> = {};
  for (const a of attempts) {
    const track = a.settings.track as SkillTrack | undefined;
    if (a.kind !== 'daily' || !track || a.localDate < sinceDate) continue;
    const e = (out[track] ??= { attempts: 0, qualified: 0 });
    e.attempts++;
    if (attemptQualified(a)) e.qualified++;
  }
  return out;
}

export function levelEvidence(attempts: Attempt[], track: SkillTrack, level: number): PatternEvidence[] {
  return attempts
    .filter((a) => a.settings.track === track && a.settings.level === level)
    .map((a) => ({ patternId: String(a.settings.patternId ?? ''), date: a.localDate, qualified: attemptQualified(a) }));
}

export function levelUpAvailable(attempts: Attempt[], track: SkillTrack, level: number): boolean {
  return level < 4 && levelUpOffered(levelEvidence(attempts, track, level));
}

export interface QualifiedTempo {
  tempoKey: string;
  bpm: number;
  keyId: string;
  date: string;
  attemptId: string;
  subdivision: number;
  profile: string;
  title: string;
}

/** Every qualifying timed segment with its conditions; a faster attempted tempo is not a demonstrated one. */
export function qualifiedTempos(attempts: Attempt[]): QualifiedTempo[] {
  const out: QualifiedTempo[] = [];
  for (const a of attempts) {
    for (const s of a.segments ?? []) {
      if (s.status !== 'complete' || !s.qualifies) continue;
      out.push({
        tempoKey: String(a.settings.tempoKey ?? `${a.sourceId}|${s.keyId}`),
        bpm: s.bpm,
        keyId: s.keyId,
        date: a.localDate,
        attemptId: a.id,
        subdivision: s.subdivision,
        profile: s.toleranceConfig.profile,
        title: a.title,
      });
    }
  }
  return out;
}

/** Try +2 BPM: the attempt's last two segments (restarts aside) at one key and tempo both qualify. */
export function tempoOfferFor(a: Attempt): boolean {
  const segs = (a.segments ?? []).filter((s) => s.status !== 'restarted');
  return tempoIncreaseOffered(
    segs.map((s) => ({
      settingsKey: `${s.keyId}|${s.bpm}`,
      complete: s.status === 'complete',
      assisted: s.assisted,
      interrupted: s.status === 'interrupted',
      summary: s.summary ?? EMPTY_SUMMARY,
    })),
  );
}

const EMPTY_SUMMARY = {
  expected: 0,
  matched: 0,
  timingMisses: 0,
  wrongPitches: 0,
  missed: 0,
  extras: 0,
  medianAbsErrorMs: null,
  meanSignedErrorMs: null,
};

export interface SkillRow {
  skill: string;
  label: string;
  attempts: number;
  /** For guided work. */
  items: number;
  firstTry: number;
  /** For timed work. */
  notesExpected: number;
  notesMatched: number;
  lastDate: string;
}

/** Group evidence by specific skill tag (clef, chord task, pattern in a key...). */
export function skillRows(attempts: Attempt[]): SkillRow[] {
  const rows = new Map<string, SkillRow>();
  for (const a of attempts) {
    if (a.status === 'in-progress') continue;
    for (const skill of a.skills) {
      const r = rows.get(skill) ?? {
        skill,
        label: skillLabel(skill),
        attempts: 0,
        items: 0,
        firstTry: 0,
        notesExpected: 0,
        notesMatched: 0,
        lastDate: a.localDate,
      };
      r.attempts++;
      const c = guidedCounts(a);
      r.items += c.total;
      r.firstTry += c.firstTry;
      for (const s of a.segments ?? []) {
        if (s.status !== 'complete' || !s.summary) continue;
        r.notesExpected += s.summary.expected;
        r.notesMatched += s.summary.matched;
      }
      if (a.localDate > r.lastDate) r.lastDate = a.localDate;
      rows.set(skill, r);
    }
  }
  return [...rows.values()].sort((x, y) => x.label.localeCompare(y.label));
}

export function skillLabel(tag: string): string {
  const [kind, ...rest] = tag.split(':');
  switch (kind) {
    case 'reading':
      return rest[0] === 'study' ? `Reading studies (${rest[1]})` : `Note reading — ${rest[0]} clef`;
    case 'intervals':
      return 'Intervals';
    case 'chords':
      return rest[0] === 'read' ? 'Chord reading (written voicings)' : 'Chord building (by name)';
    case 'pattern':
      return `${rest[0]} — ${rest[1]?.replace('-', ' ')}`;
    case 'progression':
      return `Progression ${rest[0]} — ${rest[1]?.replace('-', ' ')}`;
    case 'rhythm':
      return `Rhythm — ${rest[0]}`;
    case 'track':
      return `Daily: ${rest[0]} ${rest[1]}`;
    case 'ear':
      return 'Listening — major/minor';
    case 'keyboard':
      return 'Keyboard landmarks';
    default:
      return tag;
  }
}

/** Notes most often missed or mistaken in guided items — specific difficulties. */
export function commonMistakes(attempts: Attempt[], limit = 6): { cue: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of attempts)
    for (const r of a.itemResults ?? [])
      for (const m of r.mistakes) {
        const key = m.cue.replace(/^You played [^.]+\. /, '');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
  return [...counts.entries()]
    .map(([cue, count]) => ({ cue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
