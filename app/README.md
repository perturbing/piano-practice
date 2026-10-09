# Piano Practice — beginner piano web app

A fully client-side web app that connects to a MIDI keyboard (USB or Bluetooth) and helps a
beginner practise **reading notation** and **understanding harmony**, with scales, arpeggios,
rhythm and a ready-made **Daily trainer**. There is **no server**: everything is stored in the
browser (IndexedDB) and moves between devices via versioned JSON export/import.

The product spec is `../design/piano-learning-app-design.md` (v0.3).

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest unit tests (theory, MIDI/BLE parsing, evaluators, routine, data)
npm run build      # static build in dist/ — host anywhere (hash routing, relative base)
```

**Without a keyboard:** open `http://localhost:5173/?virtual=1` to select the on-screen keyboard.
Tap keys (multi-touch works), or use the computer keyboard: `A S D F G H J K L ;` are white keys,
`W E T Y U O P` black keys, `Z`/`X` shift the octave and `Space` is the sustain pedal. Every
screen and the full practice loop work this way; timing with on-screen input is marked approximate.

## On an Android tablet

Web MIDI and Web Bluetooth only work on a **secure page** (`https://` or `localhost`), so
`http://<pc-ip>:5173` over Wi-Fi will open the app but cannot reach the keyboard. Either:

- **USB debugging + port forwarding** (quickest while developing): enable developer options and USB
  debugging on the tablet, connect it, then on the computer run
  `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173` in Chrome on the tablet; or
- **GitHub Pages**: push to `main` — `.github/workflows/deploy.yml` tests, builds and publishes
  `app/dist` (enable Pages → “GitHub Actions” in the repo settings). Open the https URL in Chrome.

Then **Add to Home screen** for a full-screen app (`manifest.webmanifest`). The screen is kept
awake with the Screen Wake Lock API — whenever the app is open by default, or only while
practising (Devices → Screen). Android releases the lock when you switch apps; it is re-acquired
when you come back.

**Connecting the piano on Android**

| Route | How |
|---|---|
| Bluetooth MIDI (recommended) | Devices → Bluetooth MIDI → *Directly from this browser* → **Find Bluetooth MIDI keyboard**. Don’t pair it in Android’s Bluetooth settings first, and close other music apps — a BLE-MIDI device accepts one connection. Chrome on Android does **not** expose Bluetooth MIDI keyboards to Web MIDI by itself, which is why the app speaks BLE-MIDI directly over Web Bluetooth. |
| USB | USB-C OTG adapter/cable → Devices → USB MIDI → **Allow MIDI access** → pick the keyboard. |

After connecting, play and release one note (and a chord) to pass the input test; only then is the
input **Ready**. If Bluetooth drops, the app pauses, reconnects automatically, and asks for a test
note again before continuing with a fresh count-in.

## Browser support

| Browser | Web MIDI (USB / OS Bluetooth) | Direct Bluetooth MIDI |
|---|---|---|
| Chrome / Edge on Android | ✅ | ✅ |
| Chrome / Edge desktop (Windows, macOS, ChromeOS) | ✅ | ✅ |
| Chrome / Chromium on Linux | ✅ | ⚠️ enable `chrome://flags/#enable-web-bluetooth` |
| Firefox desktop | ✅ (asks for an add-on permission) | ❌ |
| Safari / any iOS browser | ❌ | ❌ |

On desktops Bluetooth can also go through the operating system (macOS Audio MIDI Setup →
Configure Bluetooth; Windows MIDI Services) or a BLE-to-USB MIDI receiver; those appear as normal
Web MIDI inputs (Devices → Bluetooth MIDI → *Through the system / a receiver*).

## What’s in it

- **Learn** — 13 short lessons across the spec’s six stages (landmarks, pulse, clefs, steps and
  skips, semitones, five-note patterns, major scale, triads, major/minor, inversions, I–IV–V–I,
  arpeggios, key signatures), each *Understand → Observe → Try with help → Recall → Apply*.
  Status is Not started / Practising / Demonstrated, with the evidence on demand.
- **Daily trainer** — one Start button runs a prepared 5/10/15-minute routine (settle in,
  movement focus, steady speed, apply in a key, + coordination at 15 min) with automatic count-ins
  and reset breaks; Pause/Slower/Skip always there; Resume restores the same routine; separate
  levels per skill track; “Try +2 BPM” and “next level” offers only after qualifying evidence and
  only if you accept.
- **Practise** — 10 families (note/interval/chord reading, chord building, scales, broken chords
  and arpeggios, progressions, rhythm, reading studies, listening), all 12 roots in major and
  minor, key rotation (listed / circle of fifths / shuffled), guided or timed, presets.
- **Explore** — free play with linked staff, keyboard, chord name, chord-tone roles, inversion and
  Roman numeral in a chosen key; hear-and-compare demos.
- **Progress** — per-skill evidence (no global “level”), demonstrated tempos with their conditions,
  specific difficulties, session history and detail.
- **Devices** — USB / Bluetooth (direct or via OS) / on-screen input, press/release/chord/pedal
  test, keyboard range check, sound (keyboard / app piano / visual only), wake lock.
- **Your data** — export all (JSON) / results (CSV), import with preview (identical records
  skipped, conflicts never overwritten), delete selected / all.

## Architecture

- `src/music/` — pure theory: spelling vs MIDI pitch, keys and signatures, chords and inversions,
  free-play identification, intervals, pattern generators (built from the key, never relabelled
  C major), authored per-key fingering (draft, pending educator review), staff layout.
- `src/midi/` — raw MIDI normalisation (running status, note-on velocity 0, sustain, all-notes-off),
  BLE-MIDI packet decoder (timestamps, running status, wrap), held-key tracker (pedal kept separate),
  input manager (Web MIDI, Web Bluetooth BLE-MIDI with auto-reconnect, virtual input).
- `src/audio/` — app piano synth, scheduled demos and metronome on the audio clock, and the
  performance-clock ↔ audio-clock mapping.
- `src/engine/` — UI-independent evaluators (guided: fresh attacks, 120 ms chord settle, extra
  notes block, release between items, hints; timed: per-target tolerance `min(200 ms, ¼ IOI)`,
  deterministic one-to-one matching, wrong pitch / timing / missed / extra kept separate, chord
  spread), progression heuristics, daily routine generator, evidence views.
- `src/data/` — zod schemas (every record has `schemaVersion`), IndexedDB with self-healing open,
  migration chain, export/import envelope with explicit units.
- `src/state/` — zustand stores: device, settings, practice session runtime, daily trainer.
- `src/screens/`, `src/components/` — SVG staff and keyboard renderers and the screens.

Each attempt stores the resolved targets, seed, settings, content/evaluator versions, input route,
timestamp source and every normalised MIDI event, so a score can be reproduced later.

## Provisional — check with real hardware and a teacher

Values marked as prototype parameters in the spec are implemented as such and stored with results:

1. **Bluetooth timing** — BLE packet timestamps are anchored to receive time. Compare a timed
   pattern over USB vs Bluetooth on your keyboard; there is no guessed latency correction.
2. **Tolerances** — standard ±200 ms or ¼ of the gap; a *forgiving* profile is selectable and saved
   with the result.
3. **Progression rules** — +2 BPM after two clean (≥95 %, no extras) attempts; untimed
   “demonstrated” at ≥90 % first-try in checks on two days; level offers after two fresh examples
   on two days.
4. **Fingering** — authored for C, G, D, A, E, F major and A, E, D minor scales and white-key
   arpeggios; other keys show no fingering rather than a transposed one.
5. **Curriculum** — the lesson sequence and texts are a draft for review with a piano educator.

## Hardware test checklist

1. USB: select the keyboard, press/release passes, chord and pedal tests pass.
2. Bluetooth direct (tablet): connect, play a fast arpeggio — no missing or doubled notes.
3. Same keyboard on USB *and* Bluetooth: only the selected input counts.
4. Switch the keyboard off mid-exercise: the session pauses, no stuck notes, completed items kept;
   switch on: auto-reconnect, test note, new count-in.
5. Keyboard with its own sound: “Use my keyboard’s sound” gives no doubled notes; a silent
   controller with “Use app piano” sounds right.
6. Range check: press lowest and highest keys, save; an exercise outside the range can’t start.
7. Export all → Delete all data → Import: everything restored.

Not yet implemented from the spec: optional placement check, tap-along latency estimate,
MusicXML/MIDI import (later scope), offline mode.
