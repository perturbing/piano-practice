import { describe, expect, it } from 'vitest';
import { changeTaskKey, generateRoutine, lowerTask, swapTask, taskPhrase, tempoKey, type RoutineInput } from './dailyRoutine';
import { defaultSkillState } from '../data/schema';
import { DailyRoutine } from '../data/schema';

const base = (over: Partial<RoutineInput> = {}): RoutineInput => ({
  date: '2026-10-09',
  timezone: 'UTC',
  lengthMin: 10,
  keyPool: ['C-major'],
  hands: 'alternate',
  skills: defaultSkillState(),
  recent: {},
  now: new Date('2026-10-09T08:00:00Z'),
  ...over,
});

describe('daily routine', () => {
  it('prepares the authored 10-minute beginner routine with no evidence', () => {
    const r = generateRoutine(base());
    expect(DailyRoutine.parse(r)).toBeTruthy();
    expect(r.tasks.map((t) => t.slot)).toEqual(['settle', 'movement', 'speed', 'apply']);
    expect(r.tasks.reduce((a, t) => a + t.estMin, 0)).toBe(10);
    expect(r.tasks.every((t) => t.keyId === 'C-major')).toBe(true);
    expect(r.tasks.find((t) => t.slot === 'speed')).toMatchObject({ mode: 'timed', bpm: 60, level: 1 });
    expect(r.tasks[0].reason).toMatch(/beginner/);
  });

  it('is deterministic for a date and varies across days', () => {
    expect(generateRoutine(base())).toEqual(generateRoutine(base()));
    const other = generateRoutine(base({ date: '2026-10-10' }));
    expect(other.tasks.map((t) => taskPhrase(t).patternId)).not.toEqual(
      generateRoutine(base()).tasks.map((t) => taskPhrase(t).patternId),
    );
  });

  it('supports 5 and 15 minute sessions', () => {
    expect(generateRoutine(base({ lengthMin: 5 })).tasks.map((t) => t.slot)).toEqual(['settle', 'speed', 'apply']);
    expect(generateRoutine(base({ lengthMin: 15 })).tasks.map((t) => t.slot)).toContain('coordination');
  });

  it('uses separate levels per track and the saved working tempo', () => {
    const skills = defaultSkillState();
    skills.levels = { fingerPatterns: 3, pulse: 2, positionChanges: 1, coordination: 1 };
    const probe = generateRoutine(base({ skills }));
    const speed = probe.tasks.find((t) => t.slot === 'speed')!;
    const p = taskPhrase(speed);
    skills.workingTempos[tempoKey(p.patternId, 'C-major', speed.hand, 2, 1)] = 72;
    const r = generateRoutine(base({ skills }));
    expect(r.tasks[0].level).toBe(2); // familiar opening below current level
    expect(r.tasks.find((t) => t.slot === 'speed')).toMatchObject({ level: 2, bpm: 72 });
  });

  it('focuses movement on the track with less clean evidence', () => {
    const r = generateRoutine(
      base({
        recent: {
          fingerPatterns: { attempts: 4, qualified: 4 },
          positionChanges: { attempts: 4, qualified: 1 },
        },
      }),
    );
    expect(r.tasks.find((t) => t.slot === 'movement')?.track).toBe('positionChanges');
  });

  it('rotates the apply key through the pool; other tasks stay in the home key', () => {
    const pool = ['C-major', 'G-major', 'F-major'];
    const keys = ['2026-10-09', '2026-10-10', '2026-10-11'].map(
      (date) => generateRoutine(base({ date, keyPool: pool })).tasks.find((t) => t.slot === 'apply')!.keyId,
    );
    expect(new Set(keys)).toEqual(new Set(pool));
    const r = generateRoutine(base({ keyPool: pool, date: '2026-10-10' }));
    expect(r.tasks.filter((t) => t.slot !== 'apply').every((t) => t.keyId === 'C-major')).toBe(true);
  });

  it('alternates hands for hands-separate practice', () => {
    const hands = generateRoutine(base()).tasks.map((t) => t.hand);
    expect(hands).toContain('right');
    expect(hands).toContain('left');
  });

  it('adjustments create explicit revisions', () => {
    const r = generateRoutine(base());
    const s = swapTask(r, 0, 'learner swap');
    expect(s.revision).toBe(2);
    expect(s.swaps).toHaveLength(1);
    expect(taskPhrase(s.tasks[0]).patternId).not.toBe(taskPhrase(r.tasks[0]).patternId);
    const k = changeTaskKey(s, 3, 'G-major');
    expect(k.tasks[3].keyId).toBe('G-major');
    expect(k.revision).toBe(3);
    const skills = defaultSkillState();
    skills.levels.fingerPatterns = 3;
    const r3 = generateRoutine(base({ skills }));
    const movementIdx = r3.tasks.findIndex((t) => t.slot === 'movement');
    const lowered = lowerTask(r3, movementIdx);
    expect(lowered.tasks[movementIdx].level).toBe(Math.max(1, r3.tasks[movementIdx].level - 1));
  });
});
