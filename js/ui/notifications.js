/* ================================================================
   Notifications — Toast & Confirm Modal
================================================================ */

const TOAST_DURATION = 7000;

/** Show a toast message
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const textEl = document.createElement('span');
  textEl.className = 'toast-text';
  textEl.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', '关闭');

  toast.appendChild(textEl);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed || !toast.isConnected) return;
    dismissed = true;
    // Slide out + fade — no CSS animation dependency
    toast.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(calc(100% + 20px))';
    setTimeout(() => toast.remove(), 240);
  };

  closeBtn.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
  setTimeout(dismiss, TOAST_DURATION);
}

/** Show a confirm modal before destructive actions
 * @param {string} title
 * @param {string} message
 * @returns {Promise<boolean>} true if confirmed
 */
export function showConfirm(title, message) {
  return new Promise(resolve => {
    const overlay  = document.getElementById('modal-confirm');
    const titleEl  = document.getElementById('modal-title');
    const msgEl    = document.getElementById('modal-message');
    const btnOk    = document.getElementById('modal-confirm-btn');
    const btnCancel= document.getElementById('modal-cancel');

    if (!overlay) { resolve(false); return; }

    titleEl.textContent = title;
    msgEl.textContent   = message;
    overlay.style.display = 'flex';

    const cleanup = (result) => {
      overlay.style.display = 'none';
      btnOk.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      resolve(result);
    };

    const onConfirm = () => cleanup(true);
    const onCancel  = () => cleanup(false);

    btnOk.addEventListener('click', onConfirm,   { once: true });
    btnCancel.addEventListener('click', onCancel, { once: true });
  });
}
