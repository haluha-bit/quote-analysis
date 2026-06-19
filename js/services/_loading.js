/* ================================================================
   Loading State Manager
   Tracks in-flight async operations by key.
   UI can subscribe to react when any key starts/ends.
================================================================ */

const _state = new Map();
const _subs  = new Set();

export const loading = {
  start(key) { _state.set(key, true);  _subs.forEach(fn => fn(key, true));  },
  end(key)   { _state.set(key, false); _subs.forEach(fn => fn(key, false)); },
  isLoading(key)  { return _state.get(key) ?? false; },
  anyLoading()    { return [..._state.values()].some(Boolean); },
  /** Subscribe to loading changes. Returns an unsubscribe function. */
  subscribe(fn)   { _subs.add(fn); return () => _subs.delete(fn); },
};
