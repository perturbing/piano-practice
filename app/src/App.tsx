import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAppWakeLock } from './hooks/useAppWakeLock';
import { useComputerKeyboard } from './hooks/useComputerKeyboard';
import { DevicePill, SoundPill } from './components/StatusPill';
import { findInProgressAttempts, saveAttempt } from './data/repositories/attempts';
import type { Attempt } from './data/schema';
import { usePracticeStore } from './state/practiceStore';

// Crash recovery runs once per page load, never against the live attempt.
let recoveryChecked = false;

const NAV = [
  { to: '/learn', label: 'Learn', icon: '♪' },
  { to: '/daily', label: 'Daily', icon: '☀' },
  { to: '/practise', label: 'Practise', icon: '♫' },
  { to: '/explore', label: 'Explore', icon: '◎' },
  { to: '/progress', label: 'Progress', icon: '▤' },
  { to: '/devices', label: 'Devices', icon: '⌁' },
];

export function App() {
  useAppWakeLock(false);
  useComputerKeyboard();
  const location = useLocation();
  const [recoverable, setRecoverable] = useState<Attempt[]>([]);

  // Crash recovery: an attempt still in progress at launch means the app closed
  // mid-session. Keep it as a recovered partial record; never continue a timed test.
  useEffect(() => {
    if (recoveryChecked) return;
    recoveryChecked = true;
    void findInProgressAttempts().then((all) => setRecoverable(all.filter((a) => a.id !== usePracticeStore.getState().attempt?.id)));
  }, []);

  const keepRecovered = async () => {
    for (const a of recoverable) await saveAttempt({ ...a, status: 'recovered', endedAt: a.endedAt ?? new Date().toISOString() });
    setRecoverable([]);
  };

  // Block body: newer Chrome returns a Promise from scrollTo(), which React would
  // treat as an effect cleanup and crash on the next navigation.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <span className="brand">Piano</span>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="nav-icon" aria-hidden>
              {n.icon}
            </span>
            {n.label}
          </NavLink>
        ))}
        <span className="spacer" />
        <div className="side-status stack tight">
          <DevicePill />
          <SoundPill />
          <NavLink to="/data" className={({ isActive }) => (isActive ? 'active' : '')}>
            Your data
          </NavLink>
        </div>
      </nav>
      <Outlet />
      {recoverable.length > 0 ? (
        <div className="dialog-backdrop">
          <div className="dialog stack">
            <h2 style={{ marginTop: 0 }}>Interrupted session found</h2>
            <p className="muted">
              {recoverable.length === 1 ? `“${recoverable[0].title}” was` : `${recoverable.length} sessions were`} still in progress when the
              app last closed. Completed items are kept as a recovered partial record.
            </p>
            <button className="primary" onClick={() => void keepRecovered()}>
              Keep recovered record
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
