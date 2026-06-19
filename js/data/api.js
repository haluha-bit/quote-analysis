/* ================================================================
   API Client — thin fetch wrapper for the QAS backend
   Automatically injects X-User header from localStorage session.
================================================================ */

const SESSION_KEY = 'qas_session';

/** Resolve base URL: relative when served by Express, absolute for dev */
const API_BASE = (() => {
  const { protocol, hostname, port } = window.location;
  return port === '3001' ? '/api' : `${protocol}//${hostname}:3001/api`;
})();

function _sessionName() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw).name : null;
  } catch { return null; }
}

async function _fetch(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const name   = _sessionName();

  const headers = {
    ...(!isForm ? { 'Content-Type': 'application/json' } : {}),
    // URL-encode so non-ASCII usernames (e.g. Chinese) pass the ISO-8859-1 header constraint
    ...(name ? { 'X-User': encodeURIComponent(name) } : {}),
    ...(options.headers ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: isForm
      ? options.body
      : options.body != null ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get:    path         => _fetch(path),
  post:   (path, body) => _fetch(path, { method: 'POST',   body }),
  put:    (path, body) => _fetch(path, { method: 'PUT',    body }),
  delete: path         => _fetch(path, { method: 'DELETE' }),
  upload: (path, form) => _fetch(path, { method: 'POST',   body: form }),

  /** Build a full file URL for opening in a new tab */
  fileUrl: id => `${API_BASE}/files/${id}`,
};
