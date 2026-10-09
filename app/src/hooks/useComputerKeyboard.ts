import { useEffect } from 'react';
import { virtualNote, virtualSustain } from '../midi/inputManager';
import { useDeviceStore } from '../state/deviceStore';

// Piano layout on a computer keyboard: A row = white keys, W row = black keys.
// Z / X shift the octave; Space is the sustain pedal.
const LAYOUT: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16,
};

let octaveBase = 60;

export function useComputerKeyboard(): void {
  const isVirtual = useDeviceStore((s) => s.selected?.source === 'virtual');
  useEffect(() => {
    if (!isVirtual) return;
    const down = new Map<string, number>();
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.repeat) {
        if (k in LAYOUT || k === ' ') e.preventDefault();
        return;
      }
      if (k === 'z') octaveBase = Math.max(24, octaveBase - 12);
      else if (k === 'x') octaveBase = Math.min(96, octaveBase + 12);
      else if (k === ' ') {
        e.preventDefault();
        virtualSustain(true);
      } else if (k in LAYOUT) {
        const note = octaveBase + LAYOUT[k];
        down.set(k, note);
        virtualNote(true, note);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === ' ') virtualSustain(false);
      const note = down.get(k);
      if (note !== undefined) {
        down.delete(k);
        virtualNote(false, note);
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      for (const n of down.values()) virtualNote(false, n);
    };
  }, [isVirtual]);
}
