import { useSettingsStore } from '../state/settingsStore';
import { useWakeLock, type WakeLockStatus } from './useWakeLock';

/** Keeps the screen awake per settings: always, only on the practice screen, or never. */
export function useAppWakeLock(onPracticeScreen: boolean): WakeLockStatus {
  const mode = useSettingsStore((s) => s.settings.wakeLock);
  return useWakeLock(mode === 'always' || (mode === 'practice' && onPracticeScreen));
}
