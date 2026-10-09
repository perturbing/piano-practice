import { useRef } from 'react';
import { isBlackKey, midiText, pitchClass } from '../music/pitch';

export type KeyState = 'target' | 'correct' | 'wrong' | 'reveal';

export interface KeyboardProps {
  low: number;
  high: number;
  /** Physically held keys (detected). */
  held?: number[];
  /** Keys sounding only because of the pedal. */
  pedal?: number[];
  states?: Map<number, KeyState>;
  /** Small text under specific keys (e.g. chord-tone roles). */
  captions?: Map<number, string>;
  showNames?: boolean;
  preferFlats?: boolean;
  onPress?: (note: number) => void;
  onRelease?: (note: number) => void;
  /** Keys outside the confirmed range are drawn dimmed. */
  playable?: { low: number; high: number };
  ariaLabel?: string;
}

const WHITE_W = 24;
const WHITE_H = 120;
const BLACK_W = 15;
const BLACK_H = 74;

const STATE_SYMBOL: Record<KeyState, string> = { target: '●', correct: '✓', wrong: '✕', reveal: '●' };

/** Expand a range to whole octaves C..C (or B) so the keyboard reads naturally. */
export function keyboardWindow(notes: number[], minLow = 48, minHigh = 72, bounds = { low: 21, high: 108 }) {
  const lo = Math.min(minLow, ...notes);
  let hi = Math.max(minHigh, ...notes);
  // At least two octaves, so a few notes don't produce giant keys.
  if (hi - lo < 24) hi = lo + 24;
  const low = Math.max(bounds.low, lo - pitchClass(lo));
  const high = Math.min(bounds.high, hi + ((12 - pitchClass(hi)) % 12));
  return { low, high };
}

export function Keyboard(props: KeyboardProps) {
  const { low, high, held = [], pedal = [], states, captions, showNames, onPress, onRelease, playable } = props;
  const pointers = useRef(new Map<number, number>());
  const whites: number[] = [];
  for (let n = low; n <= high; n++) if (!isBlackKey(n)) whites.push(n);
  const width = whites.length * WHITE_W;
  const xOfWhite = new Map(whites.map((n, i) => [n, i * WHITE_W]));
  const heldSet = new Set(held);
  const pedalSet = new Set(pedal);
  const interactive = !!onPress;

  const down = (e: React.PointerEvent, note: number) => {
    if (!onPress) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, note);
    onPress(note);
  };
  const up = (e: React.PointerEvent) => {
    const note = pointers.current.get(e.pointerId);
    if (note === undefined) return;
    pointers.current.delete(e.pointerId);
    onRelease?.(note);
  };

  const keyClass = (n: number) => {
    const st = states?.get(n);
    return [
      isBlackKey(n) ? 'kb-black' : 'kb-white',
      heldSet.has(n) ? 'held' : pedalSet.has(n) ? 'pedal' : '',
      st ? `st-${st}` : '',
      playable && (n < playable.low || n > playable.high) ? 'out' : '',
    ].join(' ');
  };

  const symbol = (n: number, x: number, y: number) => {
    const st = states?.get(n);
    if (!st) return null;
    return (
      <text x={x} y={y} className={`kb-symbol st-${st}`} textAnchor="middle">
        {STATE_SYMBOL[st]}
      </text>
    );
  };

  return (
    <div className="keyboard-wrap">
      <svg
        className={`keyboard ${interactive ? 'interactive' : ''}`}
        viewBox={`0 0 ${width} ${WHITE_H + 18}`}
        role="group"
        aria-label={props.ariaLabel ?? 'Keyboard'}
        style={{ touchAction: interactive ? 'none' : 'auto' }}
      >
        {whites.map((n) => {
          const x = xOfWhite.get(n)!;
          const isC = pitchClass(n) === 0;
          return (
            <g key={n}>
              <rect
                x={x + 0.5}
                y={0.5}
                width={WHITE_W - 1}
                height={WHITE_H}
                rx={3}
                className={keyClass(n)}
                onPointerDown={(e) => down(e, n)}
                onPointerUp={up}
                onPointerCancel={up}
                aria-label={midiText(n, props.preferFlats)}
              />
              {symbol(n, x + WHITE_W / 2, WHITE_H - 30)}
              {showNames || isC ? (
                <text x={x + WHITE_W / 2} y={WHITE_H - 8} className={`kb-name ${n === 60 ? 'middle-c' : ''} ${heldSet.has(n) ? 'on-held' : ''}`} textAnchor="middle">
                  {showNames && !isC ? midiText(n).replace(/-?\d+$/, '') : midiText(n)}
                </text>
              ) : null}
              {captions?.get(n) ? (
                <text x={x + WHITE_W / 2} y={WHITE_H + 14} className="kb-caption" textAnchor="middle">
                  {captions.get(n)}
                </text>
              ) : null}
            </g>
          );
        })}
        {Array.from({ length: high - low + 1 }, (_, i) => low + i)
          .filter(isBlackKey)
          .map((n) => {
            const leftWhite = xOfWhite.get(n - 1);
            if (leftWhite === undefined) return null;
            const x = leftWhite + WHITE_W - BLACK_W / 2;
            return (
              <g key={n}>
                <rect
                  x={x}
                  y={0}
                  width={BLACK_W}
                  height={BLACK_H}
                  rx={2}
                  className={keyClass(n)}
                  onPointerDown={(e) => down(e, n)}
                  onPointerUp={up}
                  onPointerCancel={up}
                  aria-label={midiText(n, props.preferFlats)}
                />
                {symbol(n, x + BLACK_W / 2, BLACK_H - 10)}
                {captions?.get(n) ? (
                  <text x={x + BLACK_W / 2} y={WHITE_H + 14} className="kb-caption" textAnchor="middle">
                    {captions.get(n)}
                  </text>
                ) : null}
              </g>
            );
          })}
      </svg>
    </div>
  );
}
