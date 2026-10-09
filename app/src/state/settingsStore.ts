import { create } from 'zustand';
import { defaultSettings, type Settings } from '../data/schema';
import { loadSettings, saveSettings } from '../data/repositories/settings';
import { setVisualOnly, setVolume } from '../audio/audioEngine';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

function applySound(s: Settings) {
  setVolume(s.volume, s.muted);
  setVisualOnly(s.soundMode === 'visual');
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: defaultSettings(),
  loaded: false,
  load: async () => {
    const settings = await loadSettings();
    applySound(settings);
    set({ settings, loaded: true });
  },
  update: async (patch) => {
    const settings = { ...get().settings, ...patch };
    applySound(settings);
    set({ settings });
    await saveSettings(settings);
  },
}));
