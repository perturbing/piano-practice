import { create } from 'zustand';
import type { Attempt } from '../data/schema';
import { listAttempts } from '../data/repositories/attempts';

/** Cached attempt list for derived views (Learn status, Progress). */
interface AttemptsState {
  attempts: Attempt[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useAttemptsStore = create<AttemptsState>((set) => ({
  attempts: [],
  loaded: false,
  refresh: async () => set({ attempts: await listAttempts(), loaded: true }),
}));
