import { create } from 'zustand';
import type { ExerciseSpec } from '../engine/exercise';
import { usePracticeStore } from './practiceStore';

/** Where the focused practice screen returns to, and what "Continue" means. */
interface SessionRoute {
  returnTo: string;
  next: { label: string; to: string } | null;
  set: (p: Partial<SessionRoute>) => void;
}

export const useSessionRoute = create<SessionRoute>((set) => ({
  returnTo: '/',
  next: null,
  set: (p) => set(p),
}));

export function launchSession(
  spec: ExerciseSpec,
  navigate: (to: string) => void,
  route: { returnTo: string; next?: { label: string; to: string } | null },
): void {
  useSessionRoute.getState().set({ returnTo: route.returnTo, next: route.next ?? null });
  void usePracticeStore.getState().start(spec);
  navigate('/session');
}
