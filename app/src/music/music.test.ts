import { describe, expect, it } from 'vitest';
import { defaultSpelling, midiOf, parseSpelled, spelledText, spellWithLetter } from './pitch';
import {
  allKeys,
  circleOfFifthsOrder,
  degreeNote,
  keyId,
  keySignature,
  keySignatureCount,
  parseKeyId,
  scalePitchNames,
} from './keys';
import { diatonicTriad, identifyChord, romanNumeral, triadPitchNames, voiceProgression, voiceTriad } from './chords';
import { intervalName, semitoneName } from './intervals';
import {
  arpeggioPattern,
  coordinationPattern,
  fingerPattern,
  positionChangePattern,
  pulsePattern,
  readingStudy,
  scalePattern,
  SKILL_TRACKS,
  trackPattern,
} from './patterns';
import { displayedAccidentals, barStartIndices, keySignaturePositions, ledgerLines, staffPosition } from './staffLayout';
import { totalBeats } from './score';
import { pitchNameText } from './pitch';

const k = (id: string) => parseKeyId(id)!;
const names = (id: string) => scalePitchNames(k(id)).map(pitchNameText).join(' ');
const sp = (t: string) => parseSpelled(t)!;

describe('pitch', () => {
  it('maps scientific pitch to MIDI with middle C = 60', () => {
    expect(midiOf(sp('C4'))).toBe(60);
    expect(midiOf(sp('A4'))).toBe(69);
    expect(midiOf(sp('B#3'))).toBe(60);
    expect(midiOf(sp('Cb4'))).toBe(59);
  });
  it('keeps spelling separate from sounding pitch', () => {
    expect(midiOf(sp('C#4'))).toBe(midiOf(sp('Db4')));
    expect(spelledText(sp('C#4'))).not.toBe(spelledText(sp('Db4')));
    expect(spelledText(defaultSpelling(61, true))).toBe('D♭4');
    expect(spelledText(spellWithLetter(60, 'B')!)).toBe('B♯3');
  });
});

describe('keys', () => {
  it('supports all 12 tonic roots in both tonalities', () => {
    const pcs = (t: 'major' | 'minor') =>
      new Set(allKeys().filter((x) => x.tonality === t).map((x) => midiOf({ ...x.tonic, octave: 4 }) % 12));
    expect(pcs('major').size).toBe(12);
    expect(pcs('minor').size).toBe(12);
  });
  it('spells scales with one letter per degree', () => {
    expect(names('C-major')).toBe('C D E F G A B');
    expect(names('D-major')).toBe('D E F♯ G A B C♯');
    expect(names('F-major')).toBe('F G A B♭ C D E');
    expect(names('C-minor')).toBe('C D E♭ F G A♭ B♭');
    expect(names('F#-major')).toBe('F♯ G♯ A♯ B C♯ D♯ E♯');
    expect(names('Gb-major')).toBe('G♭ A♭ B♭ C♭ D♭ E♭ F');
  });
  it('computes key signatures', () => {
    expect(keySignatureCount(k('G-major'))).toBe(1);
    expect(keySignatureCount(k('A-minor'))).toBe(0);
    expect(keySignatureCount(k('C-minor'))).toBe(-3);
    expect(keySignature(k('F-major')).map(pitchNameText)).toEqual(['B♭']);
    expect(keySignature(k('D-major')).map(pitchNameText)).toEqual(['F♯', 'C♯']);
  });
  it('round-trips key ids', () => {
    for (const key of allKeys()) expect(parseKeyId(keyId(key))).toEqual(key);
  });
  it('orders keys clockwise around the circle of fifths', () => {
    const order = circleOfFifthsOrder(['F-major', 'C-major', 'D-major', 'Bb-major', 'G-major'].map(k)).map(keyId);
    expect(order).toEqual(['C-major', 'G-major', 'D-major', 'Bb-major', 'F-major']);
  });
  it('places degrees across octaves from the tonic', () => {
    expect(spelledText(degreeNote(k('G-major'), 1, 4))).toBe('G4');
    expect(spelledText(degreeNote(k('G-major'), 4, 4))).toBe('C5');
    expect(spelledText(degreeNote(k('G-major'), 7, 4))).toBe('F♯5');
    expect(spelledText(degreeNote(k('G-major'), 0, 4))).toBe('F♯4');
  });
});

describe('chords', () => {
  it('builds triads with the right spelling', () => {
    expect(triadPitchNames({ root: { letter: 'C', acc: 0 }, quality: 'minor' }).map(pitchNameText)).toEqual([
      'C',
      'E♭',
      'G',
    ]);
    expect(triadPitchNames(diatonicTriad(k('G-major'), 5)).map(pitchNameText)).toEqual(['D', 'F♯', 'A']);
    expect(diatonicTriad(k('A-minor'), 5).quality).toBe('major'); // harmonic-minor dominant
    expect(romanNumeral(7, diatonicTriad(k('C-major'), 7).quality)).toBe('vii°');
  });
  it('voices inversions with the requested bass', () => {
    const c = { root: { letter: 'C' as const, acc: 0 as const }, quality: 'major' as const };
    expect(voiceTriad(c, 1, 4).map(spelledText)).toEqual(['E4', 'G4', 'C5']);
    expect(voiceTriad(c, 2, 4).map(spelledText)).toEqual(['G4', 'C5', 'E5']);
  });
  it('voices I-IV-V-I in C with smooth movement', () => {
    const v = voiceProgression(k('C-major'), [1, 4, 5, 1], 4).map((c) => c.map(spelledText).join('-'));
    expect(v).toEqual(['C4-E4-G4', 'C4-F4-A4', 'B3-D4-G4', 'C4-E4-G4']);
  });
  it('identifies triads and inversions from the bass', () => {
    const id = identifyChord([64, 67, 72], k('C-major'));
    expect(id.candidates).toHaveLength(1);
    expect(pitchNameText(id.candidates[0].triad.root)).toBe('C');
    expect(id.candidates[0].inversion).toBe(1);
    expect(id.candidates[0].roman).toBe('I');
  });
  it('lists every reading for symmetric chords and names nothing for incomplete sets', () => {
    expect(identifyChord([60, 64, 68]).candidates).toHaveLength(3);
    expect(identifyChord([60, 64]).candidates).toHaveLength(0);
    expect(identifyChord([60, 64]).interval?.semitones).toBe(4);
    expect(identifyChord([60, 62, 64, 65]).candidates).toHaveLength(0);
  });
  it('spells played notes in the key context', () => {
    const id = identifyChord([60, 63, 67], k('C-minor'));
    expect(id.notes.map(spelledText)).toEqual(['C4', 'E♭4', 'G4']);
  });
});

describe('intervals', () => {
  it('names spelled intervals', () => {
    expect(intervalName(sp('C4'), sp('E4'))).toBe('major 3rd');
    expect(intervalName(sp('C4'), sp('Eb4'))).toBe('minor 3rd');
    expect(intervalName(sp('C4'), sp('D#4'))).toBe('augmented 2nd');
    expect(intervalName(sp('C4'), sp('G4'))).toBe('perfect 5th');
    expect(intervalName(sp('C4'), sp('C5'))).toBe('perfect octave');
    expect(intervalName(sp('C4'), sp('D5'))).toBe('major 2nd + 1 octave');
    expect(intervalName(sp('E4'), sp('C4'))).toBe('major 3rd');
  });
  it('names unspelled distances', () => {
    expect(semitoneName(1)).toBe('semitone (minor 2nd)');
    expect(semitoneName(7)).toBe('perfect 5th');
  });
});

describe('patterns', () => {
  const midis = (p: { events: { notes: { letter: string }[] }[] }) =>
    (p.events as { notes: Parameters<typeof midiOf>[0][] }[]).flatMap((e) => e.notes.map(midiOf));
  it('C major tonic arpeggio is 60-64-67-72-67-64-60 with one top C', () => {
    const p = arpeggioPattern({ key: k('C-major'), hand: 'right' });
    expect(midis(p)).toEqual([60, 64, 67, 72, 67, 64, 60]);
  });
  it('arpeggios change with the key, including V-chord arpeggios', () => {
    expect(midis(arpeggioPattern({ key: k('D-major'), hand: 'right' }))).toEqual([62, 66, 69, 74, 69, 66, 62]);
    expect(midis(arpeggioPattern({ key: k('C-minor'), hand: 'right' }))).toEqual([60, 63, 67, 72, 67, 63, 60]);
    const v = arpeggioPattern({ key: k('G-major'), hand: 'right' }, 5, 'up');
    expect(v.events.filter((e) => e.notes.length).map((e) => spelledText(e.notes[0]))).toEqual([
      'D5',
      'F♯5',
      'A5',
      'D6',
    ]);
  });
  it('C five-note pattern has the spec fingering for each hand', () => {
    const rh = fingerPattern({ key: k('C-major'), hand: 'right' }, 1);
    expect(midis(rh)).toEqual([60, 62, 64, 65, 67, 65, 64, 62, 60]);
    expect(rh.events.flatMap((e) => e.fingers ?? [])).toEqual([1, 2, 3, 4, 5, 4, 3, 2, 1]);
    const lh = fingerPattern({ key: k('C-major'), hand: 'left' }, 1);
    expect(lh.events[0].fingers).toEqual([5]);
  });
  it('does not invent fingering for keys without authored tables', () => {
    const p = scalePattern({ key: k('Db-major'), hand: 'right' });
    expect(p.events.every((e) => !e.fingers)).toBe(true);
    const c = scalePattern({ key: k('C-major'), hand: 'right' });
    expect(c.events.slice(0, 8).map((e) => e.fingers?.[0])).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });
  it('every track and level fills whole bars', () => {
    for (const track of SKILL_TRACKS)
      for (let level = 1; level <= 4; level++)
        for (const ex of [0, 1]) {
          const p = trackPattern(track, k('G-major'), 'right', level, ex);
          expect(totalBeats(p) % 4, `${track} L${level} ex${ex}`).toBe(0);
          expect(midis(p).length).toBeGreaterThan(3);
        }
  });
  it('pulse level 3 uses eighth notes', () => {
    expect(pulsePattern({ key: k('C-major'), hand: 'right' }, 3).events[0].beats).toBe(0.5);
  });
  it('coordination level 3 plays matching notes on both staves', () => {
    const p = coordinationPattern(k('C-major'), 3);
    expect(p.events[0].notes.map(spelledText)).toEqual(['C3', 'C4']);
    expect(p.events[0].staves).toEqual(['bass', 'treble']);
  });
  it('position change level 2 shifts position after a rest', () => {
    const p = positionChangePattern({ key: k('C-major'), hand: 'right' }, 2);
    expect(p.events[5].notes).toHaveLength(0);
  });
  it('reading studies are reproducible from their seed', () => {
    expect(readingStudy(k('C-major'), 'right', 42)).toEqual(readingStudy(k('C-major'), 'right', 42));
    expect(totalBeats(readingStudy(k('F-major'), 'left', 7))).toBe(8);
  });
});

describe('staff layout', () => {
  it('places landmarks', () => {
    expect(staffPosition(sp('E4'), 'treble')).toBe(0);
    expect(staffPosition(sp('C4'), 'treble')).toBe(-2);
    expect(staffPosition(sp('C4'), 'bass')).toBe(10);
    expect(staffPosition(sp('F3'), 'bass')).toBe(6);
    expect(ledgerLines(-2)).toEqual([-2]);
    expect(ledgerLines(-5)).toEqual([-2, -4]);
    expect(ledgerLines(12)).toEqual([10, 12]);
  });
  it('places key signatures', () => {
    expect(keySignaturePositions(k('G-major'), 'treble')).toEqual([{ acc: 1, position: 8 }]);
    expect(keySignaturePositions(k('F-major'), 'bass')).toEqual([{ acc: -1, position: 2 }]);
  });
  it('prints accidentals only where the key signature and bar do not imply them', () => {
    const ev = ['F#4', 'F4', 'F4', 'F#4', 'C#5'].map((t) => ({ notes: [sp(t)] }));
    const acc = displayedAccidentals(ev, k('G-major'), new Set([0, 3]));
    expect(acc.map((a) => a[0])).toEqual([null, 0, null, null, 1]);
  });
  it('finds bar starts', () => {
    expect([...barStartIndices([1, 1, 1, 1, 2, 2, 4], 4)]).toEqual([0, 4, 6]);
  });
});
