import { useEffect, useState } from 'react';

export type WakeLockStatus = 'off' | 'active' | 'unsupported' | 'refused';

/**
 * Keeps the screen awake while `active` is true, using the Screen Wake Lock
 * API. The browser releases the lock whenever the page is hidden (app switch,
 * tablet locked), so it is re-requested when the page becomes visible again.
 */
export function useWakeLock(active: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>('off');
  useEffect(() => {
    if (!active) {
      setStatus('off');
      return;
    }
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setStatus('unsupported');
      return;
    }

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) {
          await sentinel.release();
          return;
        }
        lock = sentinel;
        setStatus('active');
        sentinel.addEventListener('release', () => {
          if (lock === sentinel) lock = null;
        });
      } catch {
        // Refused by the platform (battery saver, not visible yet).
        if (!cancelled) setStatus('refused');
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !lock) void acquire();
    };
    // Some browsers refuse until the first interaction; retry then.
    const onFirstInput = () => {
      if (!lock) void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pointerdown', onFirstInput);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pointerdown', onFirstInput);
      void lock?.release();
      lock = null;
    };
  }, [active]);
  return status;
}
