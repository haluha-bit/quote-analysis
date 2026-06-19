/* ================================================================
   Auth Module — login UI, session display, logout wiring
   Business logic (API calls, session storage) lives in authService.
================================================================ */

import { authService } from '../services/authService.js';
import { showToast }   from '../ui/notifications.js';

/** Convenience re-export so other UI modules can read the session
 *  without importing from the service layer directly. */
export const getSession   = () => authService.getSession();
export const clearSession = () => authService.clearSession();

/** Initialize auth UI.
 *  Returns a Promise that resolves with the Session when authenticated.
 *  Resolves immediately if a valid session already exists. */
export function initAuth() {
  const loginScreen = document.getElementById('screen-login');
  const appScreen   = document.getElementById('screen-app');
  const form        = document.getElementById('form-login');
  const inputName   = document.getElementById('input-name');
  const inputPass   = document.getElementById('input-password');
  const inputRemem  = document.getElementById('input-remember');
  const btnLogout   = document.getElementById('btn-logout');

  function _showApp(session) {
    loginScreen.classList.remove('active');
    loginScreen.style.display = 'none';
    appScreen.style.display   = 'flex';
    requestAnimationFrame(() => appScreen.classList.add('active'));

    const avatarEl = document.getElementById('user-avatar');
    const nameEl   = document.getElementById('user-name');
    if (avatarEl) avatarEl.textContent = session.name.charAt(0).toUpperCase();
    if (nameEl)   nameEl.textContent   = session.name;
  }

  function _showLogin() {
    appScreen.classList.remove('active');
    appScreen.style.display   = 'none';
    loginScreen.style.display = 'flex';
    requestAnimationFrame(() => loginScreen.classList.add('active'));
    if (inputPass) inputPass.value = '';
  }

  // Restore remembered session
  const existing = authService.getSession();
  if (existing) {
    _showApp(existing);

    btnLogout?.addEventListener('click', async () => {
      await authService.logout(authService.getSession());
      _showLogin();
      window.location.reload();
    });

    return Promise.resolve(existing);
  }

  // Pre-fill name if remembered
  const savedName = localStorage.getItem('qas_last_name');
  if (savedName && inputName) {
    inputName.value = savedName;
    if (inputRemem) inputRemem.checked = true;
  }

  return new Promise(resolve => {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '登录中...'; }

      const result = await authService.login(inputName.value, inputPass.value, inputRemem?.checked);

      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '登录'; }

      if (!result.ok) { showToast(result.error, 'error'); return; }

      if (inputRemem?.checked) localStorage.setItem('qas_last_name', result.session.name);
      _showApp(result.session);

      btnLogout?.addEventListener('click', async () => {
        await authService.logout(authService.getSession());
        _showLogin();
        window.location.reload();
      });

      resolve(result.session);
    });
  });
}
