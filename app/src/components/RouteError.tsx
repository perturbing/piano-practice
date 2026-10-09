import { useRouteError } from 'react-router-dom';

/** Shown instead of the router's raw error page. Saved work is in IndexedDB, so reloading is safe. */
export function RouteError() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="screen stack" style={{ maxWidth: 640 }}>
      <h1>Something went wrong</h1>
      <p>Your saved sessions and settings are safe. Reloading usually fixes this.</p>
      <div className="row">
        <button className="primary big" onClick={() => location.reload()}>
          Reload
        </button>
        <button onClick={() => (location.href = location.pathname + '#/learn')}>Go to Learn</button>
      </div>
      <details className="small muted">
        <summary>Details</summary>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{error instanceof Error && error.stack ? error.stack : message}</pre>
      </details>
    </main>
  );
}
