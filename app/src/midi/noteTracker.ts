import type { MidiEvent } from './types';

export interface HeldNote {
  note: number;
  channel: number;
  velocity: number;
  t: number;
}

export type TrackerChange =
  | { kind: 'attack'; note: number; velocity: number; t: number; retrigger: boolean }
  | { kind: 'release'; note: number; t: number }
  | { kind: 'sustain'; on: boolean; t: number }
  | { kind: 'reset'; released: number[]; t: number };

/**
 * Physically held keys, tracked by channel and pitch, kept separate from
 * pedal-sustained sounding notes. Matching uses held keys; the pedal never
 * counts as fingers holding keys.
 */
export class NoteTracker {
  private held = new Map<string, HeldNote>();
  private sustainedByPedal = new Set<number>();
  sustain = false;

  apply(ev: MidiEvent): TrackerChange[] {
    switch (ev.type) {
      case 'noteon': {
        const k = `${ev.channel}:${ev.note}`;
        // A second note-on without a release is treated as a fresh re-strike
        // (some keyboards send this); genuine fast repetitions are never debounced.
        const retrigger = this.held.has(k);
        this.held.set(k, { note: ev.note, channel: ev.channel, velocity: ev.velocity, t: ev.t });
        this.sustainedByPedal.delete(ev.note);
        return [{ kind: 'attack', note: ev.note, velocity: ev.velocity, t: ev.t, retrigger }];
      }
      case 'noteoff': {
        const k = `${ev.channel}:${ev.note}`;
        if (!this.held.delete(k)) return [];
        if (this.sustain) this.sustainedByPedal.add(ev.note);
        // Still held on another channel? Then the pitch is not released.
        if (this.isHeld(ev.note)) return [];
        return [{ kind: 'release', note: ev.note, t: ev.t }];
      }
      case 'sustain':
        if (ev.on === this.sustain) return [];
        this.sustain = ev.on;
        if (!ev.on) this.sustainedByPedal.clear();
        return [{ kind: 'sustain', on: ev.on, t: ev.t }];
      case 'reset': {
        const released: number[] = [];
        for (const [k, h] of this.held) {
          if (ev.channel === -1 || h.channel === ev.channel) {
            this.held.delete(k);
            if (!this.isHeld(h.note)) released.push(h.note);
          }
        }
        this.sustainedByPedal.clear();
        return [{ kind: 'reset', released, t: ev.t }];
      }
    }
  }

  isHeld(note: number): boolean {
    for (const h of this.held.values()) if (h.note === note) return true;
    return false;
  }

  /** Distinct held pitches, ascending. */
  heldNotes(): number[] {
    return [...new Set([...this.held.values()].map((h) => h.note))].sort((a, b) => a - b);
  }

  /** Notes still sounding only because of the pedal. */
  pedalSustained(): number[] {
    return [...this.sustainedByPedal].sort((a, b) => a - b);
  }

  /** Drop all state (disconnect, input change, recovery). Returns pitches that were held. */
  clear(): number[] {
    const was = this.heldNotes();
    this.held.clear();
    this.sustainedByPedal.clear();
    this.sustain = false;
    return was;
  }
}
