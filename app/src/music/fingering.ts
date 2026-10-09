import { type Key, keyId } from './keys';

// Suggested fingerings are instructional annotations only and are authored per
// key: a C-major fingering is never transposed mechanically into other keys.
// Everything here is a draft pending review by a piano educator (spec §5, §9).

export const FINGERING_PROVENANCE = 'Suggested fingering — draft, pending educator review. MIDI cannot check fingers.';

type HandFingers = { right: number[]; left: number[] };

// One octave ascending (8 notes); descending reverses the list.
const SCALE_C_TYPE: HandFingers = { right: [1, 2, 3, 1, 2, 3, 4, 5], left: [5, 4, 3, 2, 1, 3, 2, 1] };
const SCALE_F_MAJOR: HandFingers = { right: [1, 2, 3, 4, 1, 2, 3, 4], left: [5, 4, 3, 2, 1, 3, 2, 1] };

const SCALE_FINGERING: Record<string, HandFingers> = {
  'C-major': SCALE_C_TYPE,
  'G-major': SCALE_C_TYPE,
  'D-major': SCALE_C_TYPE,
  'A-major': SCALE_C_TYPE,
  'E-major': SCALE_C_TYPE,
  'F-major': SCALE_F_MAJOR,
  'A-minor': SCALE_C_TYPE,
  'E-minor': SCALE_C_TYPE,
  'D-minor': SCALE_C_TYPE,
};

// Tonic arpeggio, one octave ascending: 1-3-5-8.
const ARP_WHITE_ROOT: HandFingers = { right: [1, 2, 3, 5], left: [5, 4, 2, 1] };
const ARPEGGIO_FINGERING: Record<string, HandFingers> = {
  'C-major': ARP_WHITE_ROOT,
  'G-major': ARP_WHITE_ROOT,
  'F-major': ARP_WHITE_ROOT,
  'A-minor': ARP_WHITE_ROOT,
  'D-minor': ARP_WHITE_ROOT,
  'E-minor': ARP_WHITE_ROOT,
};

/** Ascending one-octave scale fingering for a key and hand, if authored. */
export function scaleFingering(key: Key, hand: 'right' | 'left'): number[] | null {
  return SCALE_FINGERING[keyId(key)]?.[hand] ?? null;
}

/** Ascending tonic-arpeggio fingering (4 notes), if authored. */
export function arpeggioFingering(key: Key, hand: 'right' | 'left'): number[] | null {
  return ARPEGGIO_FINGERING[keyId(key)]?.[hand] ?? null;
}

/**
 * Five-finger position: one finger per degree, which holds in any key because
 * the hand does not cross. Degree offsets are relative to the position's first note.
 */
export function fivePositionFinger(offset: number, hand: 'right' | 'left'): number | null {
  if (offset < 0 || offset > 4) return null;
  return hand === 'right' ? offset + 1 : 5 - offset;
}
