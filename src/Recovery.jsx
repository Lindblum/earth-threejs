import { Component } from 'react';

// When the app stops (an error React can't render past, or the graphics card
// dropping its context, as a headset's browser may on leaving XR): a plain
// page saying so, with a Reload button, rather than a black screen with no
// way out. What went wrong is kept, and shown in Options the next time (see
// takeLastError), so it can be looked into.

const LAST_ERROR_KEY = 'earth.lastError';

/** Keeps `message` for the next visit; `stopped`: the app stopped for it (else it carried on). */
export function rememberError(message, stopped = true) {
  try {
    localStorage.setItem(LAST_ERROR_KEY, JSON.stringify({ message: String(message).slice(0, 300), stopped, at: new Date().toISOString() }));
  } catch {
    // (not kept)
  }
}

/** What went wrong last time, as a line for Options, once (then forgotten), or null. */
export function takeLastError() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_ERROR_KEY));
    localStorage.removeItem(LAST_ERROR_KEY);
    if (!saved?.message) return null;
    return `${saved.stopped ? 'Last time the app stopped' : 'Last time, an error'}: ${saved.message}`;
  } catch {
    return null;
  }
}

// errors nothing caught (the app may have carried on): kept too
window.addEventListener('error', (e) => rememberError(e.message || e.error, false));
window.addEventListener('unhandledrejection', (e) => rememberError(e.reason?.message ?? e.reason, false));

/** The page shown when the app has stopped: `message`, and a Reload button. */
export function Stopped({ message }) {
  return (
    <div className="stopped" role="alert">
      <h1>Earth stopped</h1>
      <p>{message}</p>
      <button type="button" className="menu-btn" onClick={() => location.reload()}>
        Reload
      </button>
    </div>
  );
}

/** Around the app: an error rendering it shows Stopped. */
export class Recovery extends Component {
  state = { message: null };
  static getDerivedStateFromError(error) {
    return { message: error?.message ?? String(error) };
  }
  componentDidCatch(error) {
    console.error('[earth] stopped:', error);
    rememberError(error?.message ?? error);
  }
  render() {
    return this.state.message ? <Stopped message={this.state.message} /> : this.props.children;
  }
}
