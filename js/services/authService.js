/* ================================================================
   Auth Service — session management + server auth + audit logs
   Single source of truth for credentials and session storage.
================================================================ */

import { api }     from '../data/api.js';
import { loading } from './_loading.js';

const SESSION_KEY  = 'qas_session';
const DEFAULT_PASS = '123';

export const authService = {
  /* ── Session ─────────────────────────────────────────────── */

  getSession() {
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  },

  saveSession(name, remember) {
    const session = { name, loginAt: new Date().toISOString() };
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },

  clearSession() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  },

  /* ── Auth ────────────────────────────────────────────────── */

  /** Validate credentials, notify server, persist session.
   *  Returns { ok: true, session } or { ok: false, error: string }. */
  async login(name, password, remember = false) {
    const trimmed = name.trim();
    if (!trimmed)               return { ok: false, error: '请输入姓名' };
    if (password !== DEFAULT_PASS) return { ok: false, error: '密码错误' };

    loading.start('auth.login');
    try {
      await api.post('/auth/login', { name: trimmed, password });
    } catch {
      return { ok: false, error: '无法连接到服务器，请确认后端已启动' };
    } finally {
      loading.end('auth.login');
    }

    const session = this.saveSession(trimmed, remember);
    return { ok: true, session };
  },

  /** Clear session and notify server (fire-and-forget). */
  async logout(session) {
    if (session?.name) api.post('/auth/logout', {}).catch(() => {});
    this.clearSession();
  },

  /* ── Audit Logs ──────────────────────────────────────────── */

  async getLogs() {
    loading.start('logs.getAll');
    try {
      return await api.get('/logs');
    } catch (err) {
      throw new Error(`加载操作日志失败：${err.message}`);
    } finally {
      loading.end('logs.getAll');
    }
  },
};
