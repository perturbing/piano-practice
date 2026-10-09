import { useState } from 'react';
import { useDeviceStore, readiness } from '../../state/deviceStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useAudioStore, ensureAudio, testSound } from '../../audio/audioEngine';
import {
  bluetoothSupported,
  connectBleMidi,
  forgetInput,
  reconnectBle,
  refreshInputs,
  requestWebMidi,
  selectVirtual,
  selectWebMidiInput,
  webMidiSupported,
} from '../../midi/inputManager';
import { ROUTE_LABELS, type InputRoute } from '../../midi/types';
import { Keyboard, keyboardWindow } from '../../components/Keyboard';
import { Pill } from '../../components/StatusPill';
import { midiText } from '../../music/pitch';

type Tab = 'usb' | 'bluetooth' | 'virtual';

const RANGE_PRESETS = [
  { label: '25 keys (C3–C5)', low: 48, high: 72 },
  { label: '37 keys (C3–C6)', low: 48, high: 84 },
  { label: '49 keys (C2–C6)', low: 36, high: 84 },
  { label: '61 keys (C2–C7)', low: 36, high: 96 },
  { label: '76 keys (E1–G7)', low: 28, high: 103 },
  { label: '88 keys (A0–C8)', low: 21, high: 108 },
];

function platform(): 'android' | 'mac' | 'windows' | 'linux' | 'other' {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

export function DevicesScreen() {
  const dev = useDeviceStore();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const audio = useAudioStore((s) => s.status);
  const os = platform();
  const [tab, setTab] = useState<Tab>(dev.selected?.source === 'virtual' ? 'virtual' : dev.route === 'usb' ? 'usb' : 'bluetooth');
  const [btRoute, setBtRoute] = useState<'direct' | 'os'>(os === 'android' || os === 'linux' ? 'direct' : 'os');
  const r = readiness(dev);

  const remember = (source: 'webmidi' | 'ble' | 'virtual', route: InputRoute) => {
    const sel = useDeviceStore.getState().selected;
    if (sel) void update({ input: { source, route, name: sel.name, id: sel.id } });
  };

  const pickWebMidi = (id: string, route: InputRoute) => {
    if (selectWebMidiInput(id, route)) remember('webmidi', route);
  };

  const win = keyboardWindow([...dev.held, ...(dev.rangeSeen ? [dev.rangeSeen.low, dev.rangeSeen.high] : [])], 48, 84, { low: 21, high: 108 });

  return (
    <main className="screen stack">
      <div className="topbar">
        <h1>Devices</h1>
        <Pill kind={r.state === 'ready' ? 'ok' : r.state === 'untested' ? 'accent' : 'warn'} dot>
          {r.label}
        </Pill>
      </div>

      {dev.selected ? (
        <div className="card row between">
          <div className="stack tight">
            <strong>{dev.selected.name}</strong>
            <span className="small muted">
              {ROUTE_LABELS[dev.route]} · {dev.connection}
            </span>
          </div>
          <div className="row">
            {dev.selected.source === 'ble' && dev.connection !== 'connected' ? <button onClick={() => void reconnectBle()}>Reconnect</button> : null}
            <button
              onClick={() => {
                forgetInput();
                void update({ input: null });
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      ) : null}

      <section className="card stack">
        <h2 style={{ margin: 0 }}>1 · Connect your keyboard</h2>
        <div className="segmented" role="tablist">
          {(['bluetooth', 'usb', 'virtual'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'usb' ? 'USB MIDI' : t === 'bluetooth' ? 'Bluetooth MIDI' : 'On-screen keyboard'}
            </button>
          ))}
        </div>

        {tab === 'bluetooth' ? (
          <div className="stack">
            <div className="segmented">
              <button className={btRoute === 'direct' ? 'on' : ''} onClick={() => setBtRoute('direct')}>
                Directly from this browser
              </button>
              <button className={btRoute === 'os' ? 'on' : ''} onClick={() => setBtRoute('os')}>
                Through the system / a receiver
              </button>
            </div>
            {btRoute === 'direct' ? (
              <div className="stack">
                <ol className="small">
                  <li>Switch on the keyboard (or its Bluetooth MIDI adapter) and make it discoverable.</li>
                  <li>
                    {os === 'android'
                      ? 'Don’t pair it in Android’s Bluetooth settings and close other music apps — a Bluetooth MIDI device accepts one connection at a time.'
                      : 'Make sure no other app or computer is connected to it — it accepts one connection at a time.'}
                  </li>
                  <li>Tap the button and choose the keyboard in the list.</li>
                </ol>
                {bluetoothSupported() ? (
                  <div>
                    <button className="primary big" onClick={() => void connectBleMidi().then((ok) => ok && remember('ble', 'bluetooth-direct'))}>
                      Find Bluetooth MIDI keyboard
                    </button>
                  </div>
                ) : (
                  <div className="banner">
                    This browser has no Web Bluetooth. Use Chrome or Edge
                    {os === 'linux' ? ' and enable chrome://flags/#enable-web-bluetooth' : ''}, or use the system route.
                  </div>
                )}
                {dev.bleError ? <div className="banner danger small">{dev.bleError}</div> : null}
                <p className="tiny muted">
                  The app talks Bluetooth LE MIDI directly. If the keyboard drops out it reconnects automatically and asks you to play a test note again.
                </p>
              </div>
            ) : (
              <div className="stack small">
                {os === 'mac' ? (
                  <p>macOS: open Audio MIDI Setup → Window → Show MIDI Studio → Configure Bluetooth (the Bluetooth icon), connect your keyboard, then pick it below.</p>
                ) : os === 'windows' ? (
                  <p>Windows: Bluetooth MIDI needs Windows MIDI Services (or a vendor driver) to expose the keyboard as a MIDI port. Then pick it below.</p>
                ) : os === 'android' ? (
                  <p>Android: Chrome can only see a Bluetooth keyboard here after another app (e.g. a “MIDI BLE Connect” app) has opened it. The direct route is usually simpler.</p>
                ) : (
                  <p>Linux: BlueZ must be built with MIDI support for the keyboard to appear as a MIDI port. The direct route is usually simpler.</p>
                )}
                <p>A BLE-to-USB MIDI receiver plugged into this device also appears below.</p>
                <WebMidiList onPick={pickWebMidi} routes={['bluetooth-os', 'ble-receiver']} />
                <p className="tiny muted">Pairing alone isn’t enough — the keyboard must appear in this list as a MIDI input, and pass the test below, before it’s Ready.</p>
              </div>
            )}
          </div>
        ) : null}

        {tab === 'usb' ? (
          <div className="stack small">
            <p>
              Connect the USB cable{os === 'android' ? ' (with a USB-C OTG adapter if needed)' : ''}. The keyboard should appear below after you allow
              MIDI access.
            </p>
            <WebMidiList onPick={pickWebMidi} routes={['usb']} />
          </div>
        ) : null}

        {tab === 'virtual' ? (
          <div className="stack small">
            <p>
              Use the on-screen keyboard (multi-touch) or a computer keyboard: A–; are white keys, W E T Y U O P are black keys, Z/X change octave, Space is
              the pedal. Timing with on-screen input is approximate.
            </p>
            <div>
              <button
                className="primary"
                onClick={() => {
                  selectVirtual();
                  remember('virtual', 'virtual');
                }}
              >
                Use on-screen keyboard
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>2 · Test</h2>
        {!dev.selected ? (
          <p className="muted">Connect an input first.</p>
        ) : (
          <>
            <ul className="checklist">
              <li>{dev.tested.press ? '✓' : '○'} Press a key</li>
              <li>{dev.tested.release ? '✓' : '○'} Release it</li>
              <li>{dev.tested.chord ? '✓' : '○'} Play a three-note chord</li>
              <li>{dev.tested.pedal ? '✓' : '○'} Press the sustain pedal (optional)</li>
            </ul>
            <div className="row">
              <span>
                Last note: <strong>{dev.lastNote ? `${midiText(dev.lastNote.note)} (velocity ${dev.lastNote.velocity})` : '—'}</strong>
              </span>
              {dev.sustain ? <Pill kind="purple">Pedal down</Pill> : null}
            </div>
            <Keyboard low={win.low} high={win.high} held={dev.held} pedal={dev.pedalSustained} playable={settings.range} />
            <p className="tiny muted">
              If the note shown isn’t the key you pressed, the keyboard’s transpose or octave shift is on — reset it on the keyboard. The app never
              compensates silently, because that would corrupt reading practice. Silence is normal: an idle keyboard stays Ready.
            </p>
          </>
        )}
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>3 · Keyboard range</h2>
        <p className="small">
          Current: <strong>{midiText(settings.range.low)}–{midiText(settings.range.high)}</strong>{' '}
          <Pill kind={settings.range.method === 'default' ? 'warn' : 'ok'}>{settings.range.method === 'default' ? 'not confirmed' : settings.range.method}</Pill>
        </p>
        <p className="small muted">Press your lowest key and your highest key, then save. Exercises that don’t fit are flagged instead of being moved.</p>
        <div className="row">
          <span className="small">
            Seen: {dev.rangeSeen ? `${midiText(dev.rangeSeen.low)} – ${midiText(dev.rangeSeen.high)}` : 'nothing yet'}
          </span>
          <button
            disabled={!dev.rangeSeen || dev.rangeSeen.high - dev.rangeSeen.low < 12}
            onClick={() => void update({ range: { low: dev.rangeSeen!.low, high: dev.rangeSeen!.high, method: 'checked', confirmedAt: new Date().toISOString() } })}
          >
            Save this range
          </button>
          <select
            aria-label="Choose keyboard size"
            value=""
            onChange={(e) => {
              const p = RANGE_PRESETS[Number(e.target.value)];
              if (p) void update({ range: { low: p.low, high: p.high, method: 'entered', confirmedAt: new Date().toISOString() } });
            }}
          >
            <option value="">…or choose the keyboard size</option>
            {RANGE_PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>4 · Sound</h2>
        <div className="segmented">
          {(
            [
              ['keyboard', 'Use my keyboard’s sound'],
              ['app', 'Use app piano'],
              ['visual', 'Visual only'],
            ] as const
          ).map(([m, label]) => (
            <button key={m} className={settings.soundMode === m ? 'on' : ''} onClick={() => void update({ soundMode: m })}>
              {label}
            </button>
          ))}
        </div>
        <p className="small muted">
          {settings.soundMode === 'keyboard'
            ? 'Your notes play from the keyboard itself; the app only plays demonstrations, the metronome and listening questions.'
            : settings.soundMode === 'app'
              ? 'For keyboards without their own sound. Turn the keyboard’s own sound down to avoid doubled notes.'
              : 'No sound at all; the beat is shown visually. Listening exercises are unavailable.'}
        </p>
        <div className="row">
          <label className="small" htmlFor="vol">
            Volume
          </label>
          <input id="vol" type="range" min={0} max={1} step={0.05} value={settings.volume} onChange={(e) => void update({ volume: Number(e.target.value) })} />
          <label className="check">
            <input type="checkbox" checked={settings.muted} onChange={(e) => void update({ muted: e.target.checked })} /> Mute
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.metronome} onChange={(e) => void update({ metronome: e.target.checked })} /> Metronome during timed play
          </label>
          <button onClick={() => void ensureAudio().then(testSound)} disabled={settings.soundMode === 'visual'}>
            Play test sound
          </button>
          <Pill kind={audio === 'running' ? 'ok' : 'warn'}>{audio === 'running' ? 'Sound engine on' : audio === 'unavailable' ? 'Sound unavailable' : 'Sound starts on first tap'}</Pill>
        </div>
      </section>

      <section className="card stack">
        <h2 style={{ margin: 0 }}>5 · Screen and display</h2>
        <div className="field">
          <span className="field-label">Keep the screen awake</span>
          <div className="segmented">
            {(
              [
                ['always', 'Whenever the app is open'],
                ['practice', 'Only while practising'],
                ['off', 'Off'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} className={settings.wakeLock === m ? 'on' : ''} onClick={() => void update({ wakeLock: m })}>
                {label}
              </button>
            ))}
          </div>
          {!('wakeLock' in navigator) ? <span className="small muted">This browser can’t keep the screen awake.</span> : null}
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.showNoteNames} onChange={(e) => void update({ showNoteNames: e.target.checked })} /> Show note names on
          every key (changes reading tasks; C keys are always labelled)
        </label>
        <div className="field">
          <span className="field-label">Open the app on</span>
          <div className="segmented">
            <button className={settings.startTab === 'learn' ? 'on' : ''} onClick={() => void update({ startTab: 'learn' })}>
              Learn
            </button>
            <button className={settings.startTab === 'daily' ? 'on' : ''} onClick={() => void update({ startTab: 'daily' })}>
              Daily trainer
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function WebMidiList({ onPick, routes }: { onPick: (id: string, route: InputRoute) => void; routes: InputRoute[] }) {
  const dev = useDeviceStore();
  const [route, setRoute] = useState<InputRoute>(routes[0]);
  if (!webMidiSupported())
    return <div className="banner">This browser has no Web MIDI. Use Chrome or Edge (desktop or Android).</div>;
  if (!window.isSecureContext)
    return <div className="banner">MIDI needs a secure page (https:// or localhost). Open the app from its https address.</div>;
  if (dev.webMidi !== 'granted')
    return (
      <div className="stack">
        {dev.webMidi === 'denied' ? (
          <div className="banner danger small">MIDI access was blocked. Allow it in the browser’s site settings (the icon left of the address), then retry.</div>
        ) : null}
        <div>
          <button className="primary" onClick={() => void requestWebMidi()} disabled={dev.webMidi === 'requesting'}>
            Allow MIDI access
          </button>
        </div>
      </div>
    );
  return (
    <div className="stack">
      {routes.length > 1 ? (
        <div className="segmented">
          {routes.map((r) => (
            <button key={r} className={route === r ? 'on' : ''} onClick={() => setRoute(r)}>
              {r === 'bluetooth-os' ? 'Bluetooth via system' : 'BLE-to-USB receiver'}
            </button>
          ))}
        </div>
      ) : null}
      {dev.inputs.length === 0 ? (
        <p className="muted">No MIDI inputs found. Check power, cable or Bluetooth setup, then refresh.</p>
      ) : (
        <div className="list">
          {dev.inputs.map((i) => {
            const selected = dev.selected?.source === 'webmidi' && dev.selected.id === i.id;
            return (
              <div key={i.id} className={`list-item ${selected ? 'current' : ''}`}>
                <div className="grow">
                  <strong>{i.name}</strong>
                  <div className="small muted">
                    {i.manufacturer || 'MIDI input'} · {i.state}
                  </div>
                </div>
                <button className={selected ? '' : 'primary'} disabled={selected || i.state !== 'connected'} onClick={() => onPick(i.id, route)}>
                  {selected ? 'Selected' : 'Use this'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div>
        <button className="small" onClick={refreshInputs}>
          Refresh inputs
        </button>
      </div>
      <p className="tiny muted">Only the selected input is used, so a keyboard visible over both USB and Bluetooth is never counted twice.</p>
    </div>
  );
}
