import { type Key, signatureAccidental } from '../music/keys';
import { spellInContext } from '../music/chords';
import {
  type Spelled,
  diatonicIndex,
  midiOf,
  pitchClass,
  pitchNameWords,
  spellWithLetter,
  spelledText,
} from '../music/pitch';
import type { GuidedItem } from './targets';

export const GUIDED_EVALUATOR_VERSION = 'guided-v1';

export interface GuidedConfig {
  /** Correct held chord must stay stable this long before acceptance. */
  settleMs: number;
  /** Wait for every key to be released before the next item becomes active. */
  releaseBetweenItems: boolean;
  /** Target keys highlighted from the start (Try with help): every item is assisted. */
  highlighted: boolean;
  key: Key;
}

export const DEFAULT_SETTLE_MS = 120;

export interface Mistake {
  played: number[];
  t: number;
  cue: string;
}

export type ItemOutcome = 'pending' | 'correct' | 'skipped';

export interface ItemResult {
  itemId: string;
  outcome: ItemOutcome;
  /** Correct with no mistakes and no assistance. */
  firstTry: boolean;
  assisted: boolean;
  /** 0 none, 1 landmark/clef reminder, 2 note name, 3 key revealed. */
  hintLevel: number;
  highlighted: boolean;
  mistakes: Mistake[];
  activatedAt: number | null;
  completedAt: number | null;
}

export type GuidedPhase = 'active' | 'awaitingRelease' | 'done';

export interface GuidedFeedback {
  kind: 'none' | 'correct' | 'mistake' | 'release' | 'done';
  cue?: string;
}

/**
 * Event-based guided evaluator, independent of screen animation. It consumes
 * attacks/releases with the held-key set after each change; a timer `tick`
 * completes chord acceptance after the settle time. One result per item, never
 * one failure per MIDI message.
 */
export class GuidedEvaluator {
  readonly items: GuidedItem[];
  readonly config: GuidedConfig;
  readonly results: ItemResult[];
  index = 0;
  phase: GuidedPhase = 'active';
  private settleSince: number | null = null;
  /** Wrong notes already reported for the current item (one mistake per wrong key press). */
  private reportedInversion = false;
  /** A chord prompt needs at least one fresh attack after it became active. */
  private attacksThisItem = 0;

  constructor(items: GuidedItem[], config: GuidedConfig, startT = 0) {
    this.items = items;
    this.config = config;
    this.results = items.map((it) => ({
      itemId: it.id,
      outcome: 'pending',
      firstTry: false,
      assisted: config.highlighted,
      hintLevel: 0,
      highlighted: config.highlighted,
      mistakes: [],
      activatedAt: null,
      completedAt: null,
    }));
    if (items.length === 0) this.phase = 'done';
    else this.results[0].activatedAt = startT;
  }

  get current(): GuidedItem | null {
    return this.phase === 'done' ? null : (this.items[this.index] ?? null);
  }

  get currentResult(): ItemResult | null {
    return this.results[this.index] ?? null;
  }

  /** A fresh key press. `held` is the physically held set after the press. */
  onAttack(note: number, t: number, held: number[]): GuidedFeedback {
    if (this.phase === 'done') return { kind: 'done' };
    if (this.phase === 'awaitingRelease') return { kind: 'release', cue: 'Release all keys to continue.' };
    const item = this.items[this.index];
    const res = this.results[this.index];
    if (item.choices) return { kind: 'none' }; // answered with buttons, not keys
    this.attacksThisItem++;
    if (item.midis.length === 1 && item.policy.kind !== 'chordName') {
      const ok = item.policy.kind === 'pitchClass' ? pitchClass(note) === pitchClass(item.midis[0]) : note === item.midis[0];
      if (ok) return this.accept(t, held);
      const cue = singleNoteCue(note, item, this.config.key);
      res.mistakes.push({ played: [note], t, cue });
      return { kind: 'mistake', cue };
    }
    // Chord item: an extra or wrong key blocks acceptance until released.
    if (!this.allowedInChord(note, item)) {
      const cue = chordCue(note, item, this.config.key);
      res.mistakes.push({ played: held, t, cue });
      this.settleSince = null;
      return { kind: 'mistake', cue };
    }
    return this.evaluateHeld(t, held);
  }

  onRelease(t: number, held: number[]): GuidedFeedback {
    if (this.phase === 'awaitingRelease') {
      if (held.length === 0) {
        // The last item never waits for release, so this always opens a next item.
        this.activateNext(t);
        return { kind: 'none' };
      }
      return { kind: 'release', cue: 'Release all keys to continue.' };
    }
    if (this.phase === 'active' && this.isChordItem()) return this.evaluateHeld(t, held);
    return { kind: 'none' };
  }

  /** Call periodically; completes a settled chord. */
  tick(t: number, held: number[]): GuidedFeedback {
    if (this.phase !== 'active' || !this.isChordItem() || this.settleSince === null) return { kind: 'none' };
    if (!this.heldSatisfies(held)) {
      this.settleSince = null;
      return { kind: 'none' };
    }
    if (t - this.settleSince >= this.config.settleMs) return this.accept(t, held);
    return { kind: 'none' };
  }

  /** A button answer for a conceptual question (e.g. major or minor by ear). */
  answerChoice(label: string, t: number): GuidedFeedback {
    if (this.phase !== 'active') return { kind: 'none' };
    const item = this.items[this.index];
    const choice = item.choices?.find((c) => c.label === label);
    if (!choice) return { kind: 'none' };
    if (choice.correct) return this.accept(t, []);
    const cue = `Not ${label.toLowerCase()} — listen again and compare.`;
    this.results[this.index].mistakes.push({ played: [], t, cue });
    return { kind: 'mistake', cue };
  }

  /** Next hint level for the current item; level >= 2 reveals the answer and marks it assisted. */
  hint(): number {
    const res = this.currentResult;
    if (!res || this.phase === 'done') return 0;
    res.hintLevel = Math.min(3, res.hintLevel + 1);
    if (res.hintLevel >= 2) res.assisted = true;
    return res.hintLevel;
  }

  /** Skip is a recorded outcome, never a correct one. */
  skip(t: number, held: number[]): void {
    if (this.phase === 'done') return;
    const res = this.results[this.index];
    res.outcome = 'skipped';
    res.firstTry = false;
    res.completedAt = t;
    this.advance(t, held);
  }

  /** After a pause/interruption the active item restarts its settle timer; nothing else is lost. */
  resetTransient(): void {
    this.settleSince = null;
  }

  private isChordItem(): boolean {
    const item = this.items[this.index];
    return item.midis.length > 1 || item.policy.kind === 'chordName';
  }

  private allowedInChord(note: number, item: GuidedItem): boolean {
    const p = item.policy;
    if (p.kind === 'chordName') return p.pcs.includes(pitchClass(note)) && note >= p.low && note <= p.high;
    return item.midis.includes(note);
  }

  private heldSatisfies(held: number[]): boolean {
    if (this.attacksThisItem === 0) return false;
    const item = this.items[this.index];
    const p = item.policy;
    if (p.kind === 'chordName') {
      if (held.length < p.pcs.length) return false;
      if (!held.every((n) => p.pcs.includes(pitchClass(n)) && n >= p.low && n <= p.high)) return false;
      if (new Set(held.map(pitchClass)).size !== p.pcs.length) return false;
      if (!p.allowDoubling && held.length !== p.pcs.length) return false;
      if (p.bassPc !== undefined && pitchClass(Math.min(...held)) !== p.bassPc) return false;
      return true;
    }
    if (held.length !== item.midis.length) return false;
    const target = new Set(item.midis);
    return held.every((n) => target.has(n));
  }

  private evaluateHeld(t: number, held: number[]): GuidedFeedback {
    const item = this.items[this.index];
    const p = item.policy;
    if (this.heldSatisfies(held)) {
      if (this.settleSince === null) this.settleSince = t;
      return { kind: 'none' };
    }
    this.settleSince = null;
    // Complete chord with the wrong bass for a requested inversion: one cue per item.
    if (
      p.kind === 'chordName' &&
      p.bassPc !== undefined &&
      !this.reportedInversion &&
      new Set(held.map(pitchClass)).size === p.pcs.length &&
      held.every((n) => p.pcs.includes(pitchClass(n)))
    ) {
      this.reportedInversion = true;
      const want =
        item.notes.find((n) => pitchClass(midiOf(n)) === p.bassPc) ?? spellInContext(p.bassPc + 60, this.config.key);
      const cue = `All the chord tones are there; this one needs ${pitchNameWords(want)} as the lowest note.`;
      this.results[this.index].mistakes.push({ played: held, t, cue });
      return { kind: 'mistake', cue };
    }
    return { kind: 'none' };
  }

  private accept(t: number, held: number[]): GuidedFeedback {
    const res = this.results[this.index];
    res.outcome = 'correct';
    res.completedAt = t;
    res.firstTry = res.mistakes.length === 0 && !res.assisted;
    this.advance(t, held);
    return this.phase === 'done' ? { kind: 'done' } : { kind: 'correct' };
  }

  private advance(t: number, held: number[]): void {
    this.settleSince = null;
    this.reportedInversion = false;
    this.attacksThisItem = 0;
    const isLast = this.index === this.items.length - 1;
    if (this.config.releaseBetweenItems && held.length > 0 && !isLast) {
      this.phase = 'awaitingRelease';
      return;
    }
    this.activateNext(t);
  }

  private activateNext(t: number): void {
    this.index++;
    if (this.index >= this.items.length) {
      this.phase = 'done';
      return;
    }
    this.phase = 'active';
    this.results[this.index].activatedAt = t;
  }
}

/** "That is C5; the written note is C4." / "You played F4. Try one step lower." */
export function singleNoteCue(played: number, item: GuidedItem, key: Key): string {
  const target: Spelled = item.notes[0];
  const targetMidi = midiOf(target);
  if (item.policy.kind === 'pitchClass') {
    return `That is ${pitchNameWords(spellInContext(played, key))}. Look for ${pitchNameWords(target)}.`;
  }
  if (pitchClass(played) === pitchClass(targetMidi)) {
    const asTarget = spellWithLetter(played, target.letter) ?? spellInContext(played, key);
    const dir = played > targetMidi ? 'high' : 'low';
    return `That is ${spelledText(asTarget)}; the written note is ${spelledText(target)} — one octave too ${dir}.`;
  }
  const playedSpelled = spellInContext(played, key);
  if (playedSpelled.letter === target.letter && playedSpelled.octave === target.octave) {
    const fromSig = signatureAccidental(key, target.letter) === target.acc && target.acc !== 0;
    return `You played ${spelledText(playedSpelled)}. The note is ${pitchNameWords(target)}${
      fromSig ? ' — check the key signature' : ''
    }.`;
  }
  const steps = diatonicIndex(target) - diatonicIndex(playedSpelled);
  const n = Math.abs(steps);
  const dir = played < targetMidi ? 'higher' : 'lower';
  if (n >= 7) return `You played ${spelledText(playedSpelled)}. The written note is more than an octave ${dir} — check the clef and ledger lines.`;
  const amount = n === 0 ? 'a half step' : n === 1 ? 'one step' : n === 2 ? 'two steps' : `${n} steps`;
  return `You played ${spelledText(playedSpelled)}. Try ${amount} ${dir}.`;
}

function chordCue(played: number, item: GuidedItem, key: Key): string {
  const p = item.policy;
  const playedName = spelledText(spellInContext(played, key));
  if (p.kind === 'chordName') {
    if (p.pcs.includes(pitchClass(played))) return `${playedName} is outside the allowed range.`;
    // A wrong third is the most common chord-quality error: name the needed note.
    const near = item.notes.find((n) => Math.abs(pitchClass(midiOf(n)) - pitchClass(played)) === 1);
    if (near) return `${playedName} is not in this chord; ${pitchNameWords(near)} is needed.`;
    return `${playedName} is not in this chord. Release it and try again.`;
  }
  const samePc = item.notes.find((n) => pitchClass(midiOf(n)) === pitchClass(played));
  if (samePc) return `That is ${playedName}; the written note is ${spelledText(samePc)}.`;
  const near = item.notes.find((n) => Math.abs(midiOf(n) - played) === 1);
  if (near) return `${playedName} is not written here; ${pitchNameWords(near)} is needed.`;
  return `${playedName} is not part of this chord. Release it and try again.`;
}

export interface GuidedSummary {
  total: number;
  completed: number;
  firstTry: number;
  corrected: number;
  skipped: number;
  assisted: number;
  keyRevealed: number;
}

export function summarizeGuided(results: ItemResult[]): GuidedSummary {
  return {
    total: results.length,
    completed: results.filter((r) => r.outcome === 'correct').length,
    firstTry: results.filter((r) => r.firstTry).length,
    corrected: results.filter((r) => r.outcome === 'correct' && r.mistakes.length > 0).length,
    skipped: results.filter((r) => r.outcome === 'skipped').length,
    assisted: results.filter((r) => r.assisted).length,
    keyRevealed: results.filter((r) => r.hintLevel >= 3).length,
  };
}
