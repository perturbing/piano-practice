import { Fragment, type ReactNode } from 'react';
import type { Key } from '../music/keys';
import { type Accidental, type Spelled, accidentalSymbol, midiOf } from '../music/pitch';
import type { Staff as StaffName } from '../music/score';
import { staffFor } from '../music/score';
import { barStartIndices, displayedAccidentals, keySignaturePositions, ledgerLines, staffPosition } from '../music/staffLayout';

export interface StaffEvent {
  notes: Spelled[];
  beats: number;
  fingers?: (number | null)[];
  staves?: StaffName[];
}

export type EventMark = 'correct' | 'wrong' | 'timing' | 'missed' | 'pending';

export interface StaffProps {
  events: StaffEvent[];
  keySig: Key;
  clef: 'treble' | 'bass' | 'grand' | 'auto';
  beatsPerBar?: number;
  /** Event drawn as the current prompt. */
  cursor?: number | null;
  marks?: (EventMark | null)[];
  /** A played wrong note drawn next to an event. */
  ghost?: { eventIndex: number; notes: Spelled[] } | null;
  labels?: string[];
  showFingering?: boolean;
  /** Fill the other staff with rests (two-hand patterns on a grand staff). */
  restsOnIdleStaff?: boolean;
  /** Draw bar lines (single prompts don't need them). */
  bars?: boolean;
  maxSystemWidth?: number;
  ariaLabel?: string;
}

const S = 10; // staff line gap
const STAFF_GAP = 70; // between treble bottom line and bass top line on a grand staff
const TOP_PAD = 46;
const LEFT = 10;

const MARK_SYMBOL: Record<EventMark, string> = { correct: '✓', wrong: '✕', timing: '◷', missed: '–', pending: '' };

/** Horizontal space for an event; labelled events need room for their text. */
function eventWidth(beats: number, minWidth = 0): number {
  return Math.max(minWidth, 30 + Math.min(4, beats) * 9);
}

function staffTop(staff: StaffName, grand: boolean): number {
  return TOP_PAD + (grand && staff === 'bass' ? 4 * S + STAFF_GAP : 0);
}

function yOf(pos: number, staff: StaffName, grand: boolean): number {
  return staffTop(staff, grand) + (8 - pos) * (S / 2);
}

function chooseClef(events: StaffEvent[], clef: StaffProps['clef']): { staves: StaffName[]; grand: boolean } {
  if (clef === 'treble') return { staves: ['treble'], grand: false };
  if (clef === 'bass') return { staves: ['bass'], grand: false };
  if (clef === 'grand') return { staves: ['treble', 'bass'], grand: true };
  const used = new Set(events.flatMap((e) => e.notes.map((n, i) => staffFor(n, e.staves?.[i]))));
  if (used.size === 2) return { staves: ['treble', 'bass'], grand: true };
  return { staves: [used.has('bass') ? 'bass' : 'treble'], grand: false };
}

function restGlyph(beats: number, x: number, staff: StaffName, grand: boolean, key: string): ReactNode {
  const mid = yOf(4, staff, grand);
  if (beats >= 4)
    return <rect key={key} x={x - 6} y={yOf(6, staff, grand)} width={12} height={5} className="glyph" />;
  if (beats >= 2)
    return (
      <g key={key}>
        <rect x={x - 6} y={mid - 5} width={12} height={5} className="glyph" />
        {beats === 3 ? <circle cx={x + 10} cy={mid - 3} r={1.8} className="glyph" /> : null}
      </g>
    );
  return (
    <text key={key} x={x} y={mid + 2} className="music-glyph" fontSize={34} textAnchor="middle" dominantBaseline="middle">
      {beats >= 1 ? '\u{1D13D}' : '\u{1D13E}'}
    </text>
  );
}

/** Split events into systems at bar lines so long phrases wrap on narrow screens. */
function systems(events: StaffEvent[], bars: Set<number>, maxWidth: number, prefix: number, minW: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let width = prefix;
  let barStart = 0;
  events.forEach((e, i) => {
    if (bars.has(i)) barStart = cur.length;
    const w = eventWidth(e.beats, minW);
    if (width + w > maxWidth && cur.length > 0) {
      // Break at the start of the current bar when possible.
      if (barStart > 0) {
        out.push(cur.slice(0, barStart));
        cur = cur.slice(barStart);
      } else {
        out.push(cur);
        cur = [];
      }
      width = prefix + cur.reduce((a, j) => a + eventWidth(events[j].beats, minW), 0);
      barStart = 0;
    }
    cur.push(i);
    width += w;
  });
  if (cur.length) out.push(cur);
  return out;
}

export function StaffView(props: StaffProps) {
  const { events, keySig, beatsPerBar = 4, cursor = null, marks, ghost, labels, showFingering, restsOnIdleStaff, bars = true } = props;
  const { staves, grand } = chooseClef(events, props.clef);
  const minW = labels?.some(Boolean) ? 78 : 0;
  const barSet = bars ? barStartIndices(events.map((e) => e.beats), beatsPerBar) : new Set([0]);
  const accs = displayedAccidentals(events, keySig, barSet);
  const sig = keySignaturePositions(keySig, 'treble');
  const prefix = LEFT + 40 + sig.length * 11 + 14;
  const maxW = props.maxSystemWidth ?? 640;
  const groups = systems(events, barSet, maxW, prefix, minW);
  const systemHeight = TOP_PAD + (grand ? 8 * S + STAFF_GAP : 4 * S) + 58;

  const svgs = groups.map((idxs, sysIndex) => {
    const width = Math.max(prefix + idxs.reduce((a, i) => a + eventWidth(events[i].beats, minW), 0) + 16, 140);
    const xs: number[] = [];
    let x = prefix;
    for (const i of idxs) {
      xs.push(x + 12);
      x += eventWidth(events[i].beats, minW);
    }
    const lastIndex = idxs[idxs.length - 1];
    const isFinal = lastIndex === events.length - 1;
    return (
      <svg
        key={sysIndex}
        className="staff-svg"
        viewBox={`0 0 ${width} ${systemHeight}`}
        style={{ maxWidth: `${width * 1.5}px` }}
        role="img"
        aria-label={props.ariaLabel ?? 'Music notation'}
      >
        {staves.map((st) => (
          <g key={st}>
            {[0, 2, 4, 6, 8].map((p) => (
              <line key={p} x1={LEFT} x2={width - 4} y1={yOf(p, st, grand)} y2={yOf(p, st, grand)} className="staff-line" />
            ))}
            <text
              x={LEFT + 4}
              y={st === 'treble' ? yOf(2, st, grand) : yOf(6, st, grand)}
              className="music-glyph"
              fontSize={st === 'treble' ? 46 : 40}
            >
              {st === 'treble' ? '\u{1D11E}' : '\u{1D122}'}
            </text>
            {keySignaturePositions(keySig, st).map((k, i) => (
              <text key={i} x={LEFT + 40 + i * 11} y={yOf(k.position, st, grand)} className="music-glyph acc" fontSize={24} dominantBaseline="central">
                {accidentalSymbol(k.acc)}
              </text>
            ))}
          </g>
        ))}
        {grand ? <line x1={LEFT} x2={LEFT} y1={yOf(8, 'treble', true)} y2={yOf(0, 'bass', true)} className="bar-line" /> : null}

        {idxs.map((i, j) => {
          const e = events[i];
          const cx = xs[j];
          const mark = marks?.[i] ?? null;
          const isCursor = cursor === i;
          const cls = `note ${isCursor ? 'cursor' : ''} ${mark ? `mark-${mark}` : ''}`;
          const out: ReactNode[] = [];
          if (bars && barSet.has(i) && j > 0) {
            out.push(
              <line
                key="bar"
                x1={cx - 16}
                x2={cx - 16}
                y1={yOf(8, staves[0], grand)}
                y2={yOf(0, staves[staves.length - 1], grand)}
                className="bar-line"
              />,
            );
          }
          if (isCursor) {
            out.push(
              <rect
                key="cur"
                x={cx - 14}
                y={TOP_PAD - 30}
                width={28}
                height={(grand ? 8 * S + STAFF_GAP : 4 * S) + 60}
                rx={6}
                className="cursor-band"
              />,
            );
          }
          for (const st of staves) {
            const onStaff = e.notes
              .map((n, k) => ({ n, k, acc: accs[i][k], finger: e.fingers?.[k] ?? null }))
              .filter(({ n, k }) => (staves.length === 1 ? true : staffFor(n, e.staves?.[k]) === st));
            if (onStaff.length === 0) {
              if (e.notes.length === 0 || (restsOnIdleStaff && grand))
                out.push(restGlyph(e.beats, cx, st, grand, `rest-${st}`));
              continue;
            }
            out.push(
              <ChordGlyph
                key={`chord-${st}`}
                x={cx}
                staff={st}
                grand={grand}
                notes={onStaff}
                beats={e.beats}
                className={cls}
                showFingering={!!showFingering}
              />,
            );
          }
          if (ghost && ghost.eventIndex === i) {
            for (const g of ghost.notes) {
              const st = staves.length === 1 ? staves[0] : staffFor(g);
              const pos = staffPosition(g, st);
              const y = yOf(pos, st, grand);
              out.push(
                <g key={`ghost-${midiOf(g)}`} className="ghost">
                  {ledgerLines(pos).map((p) => (
                    <line key={p} x1={cx + 10} x2={cx + 34} y1={yOf(p, st, grand)} y2={yOf(p, st, grand)} className="ledger" />
                  ))}
                  <ellipse cx={cx + 22} cy={y} rx={6.2} ry={4.4} transform={`rotate(-20 ${cx + 22} ${y})`} />
                </g>,
              );
            }
          }
          if (mark && MARK_SYMBOL[mark]) {
            out.push(
              <text key="mark" x={cx} y={TOP_PAD - 34} className={`mark-symbol mark-${mark}`} textAnchor="middle">
                {MARK_SYMBOL[mark]}
              </text>,
            );
          }
          if (labels?.[i]) {
            out.push(
              <text key="label" x={cx} y={systemHeight - 8} className="staff-label" textAnchor="middle">
                {labels[i]}
              </text>,
            );
          }
          return <Fragment key={i}>{out}</Fragment>;
        })}
        {isFinal && bars ? (
          <>
            <line x1={width - 9} x2={width - 9} y1={yOf(8, staves[0], grand)} y2={yOf(0, staves[staves.length - 1], grand)} className="bar-line" />
            <line x1={width - 5} x2={width - 5} y1={yOf(8, staves[0], grand)} y2={yOf(0, staves[staves.length - 1], grand)} className="bar-line thick" />
          </>
        ) : null}
      </svg>
    );
  });

  return <div className="staff">{svgs}</div>;
}

interface ChordNote {
  n: Spelled;
  k: number;
  acc: Accidental | null;
  finger: number | null;
}

function ChordGlyph(props: {
  x: number;
  staff: StaffName;
  grand: boolean;
  notes: ChordNote[];
  beats: number;
  className: string;
  showFingering: boolean;
}) {
  const { x, staff, grand, beats, className } = props;
  const notes = [...props.notes].map((cn) => ({ ...cn, pos: staffPosition(cn.n, staff) })).sort((a, b) => a.pos - b.pos);
  const lowest = notes[0].pos;
  const highest = notes[notes.length - 1].pos;
  // Stem away from the middle line.
  const stemUp = 4 - lowest > highest - 4;
  const hollow = beats >= 2;
  const stemless = beats >= 4;
  const dotted = beats === 3;
  // Seconds: alternate noteheads to the other side of the stem.
  const offsets = notes.map(() => 0);
  for (let i = 1; i < notes.length; i++) {
    if (notes[i].pos - notes[i - 1].pos === 1 && offsets[i - 1] === 0) offsets[i] = stemUp ? 12 : -12;
  }
  const ledgerSet = new Set(notes.flatMap((n) => ledgerLines(n.pos)));
  const stemX = stemUp ? x + 5.6 : x - 5.6;
  const yTop = yOf(highest, staff, grand);
  const yBottom = yOf(lowest, staff, grand);
  const stemEnd = stemUp ? yTop - 3.4 * S : yBottom + 3.4 * S;
  const ledgerLeft = Math.min(0, ...offsets) - 10;
  const ledgerRight = Math.max(0, ...offsets) + 10;
  return (
    <g className={className}>
      {[...ledgerSet].map((p) => (
        <line key={`l${p}`} x1={x + ledgerLeft} x2={x + ledgerRight} y1={yOf(p, staff, grand)} y2={yOf(p, staff, grand)} className="ledger" />
      ))}
      {notes.map((cn, i) => {
        const cy = yOf(cn.pos, staff, grand);
        const cx = x + offsets[i];
        return (
          <g key={i}>
            {cn.acc !== null ? (
              <text x={x - 14 - (i % 2) * 8} y={cy} className="music-glyph acc" fontSize={22} textAnchor="middle" dominantBaseline="central">
                {cn.acc === 0 ? '♮' : accidentalSymbol(cn.acc)}
              </text>
            ) : null}
            <ellipse
              cx={cx}
              cy={cy}
              rx={6.2}
              ry={4.4}
              transform={`rotate(-20 ${cx} ${cy})`}
              className={hollow ? 'head hollow' : 'head'}
            />
            {dotted ? <circle cx={cx + 11} cy={cn.pos % 2 === 0 ? cy - 3 : cy} r={1.8} className="glyph" /> : null}
          </g>
        );
      })}
      {!stemless ? <line x1={stemX} x2={stemX} y1={stemUp ? yBottom : yTop} y2={stemEnd} className="stem" /> : null}
      {beats === 0.5 ? (
        <path
          d={stemUp ? `M${stemX} ${stemEnd} q 2 9 10 14 q -4 -6 -10 -8` : `M${stemX} ${stemEnd} q 2 -9 10 -14 q -4 6 -10 8`}
          className="flag"
        />
      ) : null}
      {props.showFingering
        ? notes.map((cn, i) =>
            cn.finger ? (
              <text
                key={`f${i}`}
                x={x}
                y={staff === 'bass' && grand ? yOf(Math.min(lowest, 0), staff, grand) + 18 + i * 12 : yOf(Math.max(highest, 8), staff, grand) - 16 - i * 12}
                className="finger"
                textAnchor="middle"
              >
                {cn.finger}
              </text>
            ) : null,
          )
        : null}
    </g>
  );
}
