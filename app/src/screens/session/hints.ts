import type { GuidedItem } from '../../engine/targets';
import { pitchNameWords, spelledText } from '../../music/pitch';

/** Hints progress from a landmark reminder, to naming the answer, to revealing keys. */
export function hintText(item: GuidedItem, level: number): string | null {
  if (level <= 0) return null;
  const chord = item.notes.length > 1 || item.policy.kind === 'chordName';
  if (level === 1) {
    if (item.choices) return 'Major sounds brighter; minor has a lower, darker third.';
    if (item.policy.kind === 'chordName') return 'Stack every other letter from the root: root, third, fifth. Check the third’s distance.';
    if (item.prompt) return 'Use the black-key groups: C sits just left of each group of two.';
    if (item.clef === 'bass')
      return 'Bass clef: the dots surround F3 (fourth line); middle C sits on a ledger line above. Count steps from there.';
    if (chord) return 'Read from the lowest note up; each line-to-line skip is a third.';
    return 'Treble clef: the curl circles G4 (second line); middle C sits on a ledger line below. Count steps from there.';
  }
  if (level === 2) {
    if (item.choices) return `It was ${item.choices.find((c) => c.correct)?.label.toLowerCase()}.`;
    if (item.policy.kind === 'chordName') return `The chord tones are ${item.notes.map(pitchNameWords).join(', ')}.`;
    if (item.policy.kind === 'pitchClass') return `The note is ${pitchNameWords(item.notes[0])} (any octave).`;
    return chord ? `The notes are ${item.notes.map(spelledText).join(', ')}.` : `The note is ${spelledText(item.notes[0])}.`;
  }
  return 'The target keys are shown on the keyboard. This item is recorded as assisted.';
}
