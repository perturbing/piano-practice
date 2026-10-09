import { create } from 'zustand';

// Browser sound. MIDI carries events, not audio: a silent controller needs the
// app piano, a digital piano can use its own sound (no doubled monitoring).
// Demonstrations and the metronome always use app audio unless Visual only.

export type AudioStatus = 'uninitialized' | 'running' | 'suspended' | 'unavailable';

interface AudioState {
  status: AudioStatus;
  set: (p: Partial<AudioState>) => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  status: 'uninitialized',
  set: (p) => set(p),
}));

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let wave: PeriodicWave | null = null;
let volume = 0.7;
let muted = false;
let silent = false; // visual-only mode

interface Voice {
  osc: OscillatorNode;
  osc2: OscillatorNode;
  gain: GainNode;
  held: boolean;
}
const learnerVoices = new Map<number, Voice>();
let learnerSustain = false;
const scheduled = new Set<AudioScheduledSourceNode>();

function setStatus(s: AudioStatus) {
  useAudioStore.getState().set({ status: s });
}

/** Create/resume audio. Must be called from a user gesture the first time. */
export async function ensureAudio(): Promise<boolean> {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) {
        setStatus('unavailable');
        return false;
      }
      ctx = new AC({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      master = ctx.createGain();
      master.connect(comp).connect(ctx.destination);
      applyVolume();
      // Piano-ish spectrum: strong fundamental, quickly falling partials.
      const n = 12;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      [0, 1, 0.55, 0.35, 0.22, 0.14, 0.1, 0.06, 0.05, 0.03, 0.02, 0.01].forEach((a, i) => (imag[i] = a));
      wave = ctx.createPeriodicWave(real, imag);
      ctx.onstatechange = () => setStatus(ctx!.state === 'running' ? 'running' : 'suspended');
    }
    if (ctx.state !== 'running') await ctx.resume();
    setStatus(ctx.state === 'running' ? 'running' : 'suspended');
    return ctx.state === 'running';
  } catch {
    setStatus('unavailable');
    return false;
  }
}

export function audioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

function applyVolume() {
  if (master && ctx) master.gain.setTargetAtTime(muted || silent ? 0 : volume * 0.5, ctx.currentTime, 0.01);
}

export function setVolume(v: number, isMuted: boolean): void {
  volume = v;
  muted = isMuted;
  applyVolume();
}

export function setVisualOnly(v: boolean): void {
  silent = v;
  applyVolume();
}

const freq = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/** Map a performance.now() time to the audio clock. */
export function perfToAudio(perfMs: number): number {
  if (!ctx) return 0;
  const ts = ctx.getOutputTimestamp?.();
  if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
    return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
  }
  return ctx.currentTime + (perfMs - performance.now()) / 1000;
}

function startVoice(note: number, velocity: number, when: number): Voice | null {
  if (!ctx || !master || !wave) return null;
  const t = Math.max(when, ctx.currentTime);
  const v = Math.max(0.08, velocity / 127);
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc2.type = 'sine';
  osc.frequency.value = freq(note);
  osc2.frequency.value = freq(note) * 2.003;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900 + 5000 * v;
  const gain = ctx.createGain();
  const g2 = ctx.createGain();
  g2.gain.value = 0.12;
  // Lower notes ring longer.
  const decay = 0.6 + (108 - Math.min(108, note)) / 30;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.6 * v, t + 0.006);
  gain.gain.setTargetAtTime(0.25 * v, t + 0.01, 0.12);
  gain.gain.setTargetAtTime(0.0001, t + 0.2, decay);
  osc.connect(filter);
  osc2.connect(g2).connect(filter);
  filter.connect(gain).connect(master);
  osc.start(t);
  osc2.start(t);
  osc.stop(t + 12);
  osc2.stop(t + 12);
  return { osc, osc2, gain, held: true };
}

function releaseVoice(v: Voice, when?: number) {
  if (!ctx) return;
  const t = Math.max(when ?? ctx.currentTime, ctx.currentTime);
  v.gain.gain.cancelScheduledValues(t);
  v.gain.gain.setTargetAtTime(0, t, 0.08);
  v.osc.stop(t + 0.6);
  v.osc2.stop(t + 0.6);
}

// --- learner monitoring (app piano mode) --------------------------------

export function learnerNoteOn(note: number, velocity: number): void {
  const prev = learnerVoices.get(note);
  if (prev) releaseVoice(prev);
  const v = startVoice(note, velocity, 0);
  if (v) learnerVoices.set(note, v);
}

export function learnerNoteOff(note: number): void {
  const v = learnerVoices.get(note);
  if (!v) return;
  v.held = false;
  if (learnerSustain) return;
  releaseVoice(v);
  learnerVoices.delete(note);
}

export function learnerSustainChange(on: boolean): void {
  learnerSustain = on;
  if (on) return;
  for (const [note, v] of learnerVoices) {
    if (!v.held) {
      releaseVoice(v);
      learnerVoices.delete(note);
    }
  }
}

export function learnerAllOff(): void {
  learnerSustain = false;
  for (const v of learnerVoices.values()) releaseVoice(v);
  learnerVoices.clear();
}

// --- scheduled sound (demos, metronome) ---------------------------------

/** Play notes now or at a performance-clock time; never enters the learner event stream. */
export function playNotes(notes: number[], durationMs: number, atPerf?: number, velocity = 80): void {
  if (!ctx) return;
  const when = atPerf !== undefined ? perfToAudio(atPerf) : ctx.currentTime + 0.02;
  for (const n of notes) {
    const v = startVoice(n, velocity, when);
    if (!v) continue;
    scheduled.add(v.osc);
    v.osc.onended = () => scheduled.delete(v.osc);
    releaseVoice(v, when + durationMs / 1000);
  }
}

export function click(atPerf: number, accent: boolean): void {
  if (!ctx || !master) return;
  const t = Math.max(perfToAudio(atPerf), ctx.currentTime);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = accent ? 1760 : 1175;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.08);
  scheduled.add(osc);
  osc.onended = () => scheduled.delete(osc);
}

/** Stop scheduled demonstrations and clicks (pause, end, interruption). */
export function stopScheduled(): void {
  for (const n of scheduled) {
    try {
      n.stop();
    } catch {
      // already stopped
    }
  }
  scheduled.clear();
}

export function testSound(): void {
  playNotes([60, 64, 67], 900);
}
