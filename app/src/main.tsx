import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import '@fontsource/noto-music/music.css';
import './styles.css';
import { router } from './routes';
import { useSettingsStore } from './state/settingsStore';
import { onInput, restoreSavedInput, selectVirtual } from './midi/inputManager';
import { ensureAudio, learnerAllOff, learnerNoteOff, learnerNoteOn, learnerSustainChange } from './audio/audioEngine';

async function bootstrap() {
  await useSettingsStore.getState().load();
  const settings = useSettingsStore.getState().settings;

  // Learner monitoring through the app piano. A digital piano uses its own
  // sound instead, so notes are never doubled.
  onInput(({ changes }) => {
    if (useSettingsStore.getState().settings.soundMode !== 'app') return;
    for (const c of changes) {
      if (c.kind === 'attack') learnerNoteOn(c.note, c.velocity);
      else if (c.kind === 'release') learnerNoteOff(c.note);
      else if (c.kind === 'sustain') learnerSustainChange(c.on);
      else if (c.kind === 'reset') learnerAllOff();
    }
  });

  // Browsers only start audio after a user gesture.
  const unlock = () => void ensureAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // ?virtual=1 selects the on-screen keyboard (development without hardware).
  const params = new URLSearchParams(window.location.search);
  if (params.get('virtual') === '1') selectVirtual();
  else void restoreSavedInput(settings.input);

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>,
  );
}

void bootstrap();
