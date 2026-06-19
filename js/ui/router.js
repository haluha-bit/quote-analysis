/* ================================================================
   Router — View Management
================================================================ */

const VIEWS = ['upload', 'overview', 'analysis', 'settings'];

const VIEW_TITLES = {
  upload:   '上传报价',
  overview: '报价总览',
  analysis: '分析中心',
  settings: '系统设置',
};

let _currentView = null;
let _onNavigate  = null;

/** Navigate to a view by id */
export function navigateTo(viewId) {
  if (!VIEWS.includes(viewId)) return;
  if (_currentView === viewId)  return;

  // Hide all views
  VIEWS.forEach(id => {
    const el = document.getElementById(`view-${id}`);
    if (el) {
      el.classList.remove('active');
      el.style.display = 'none';
    }
  });

  // Show target — clear inline display so CSS .view.active { display:flex } takes effect
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.style.display = '';
    requestAnimationFrame(() => target.classList.add('active'));
  }

  // Update bottom nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });

  // Update header title
  const titleEl = document.getElementById('header-title');
  if (titleEl) titleEl.textContent = VIEW_TITLES[viewId] ?? viewId;

  _currentView = viewId;
  _onNavigate?.(viewId);
}

/** Register a callback for view changes */
export function onNavigate(fn) {
  _onNavigate = fn;
}

/** Return currently active view id */
export function currentView() {
  return _currentView;
}

/** Wire bottom nav click handlers */
export function initRouter() {
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  });

  // Default view
  navigateTo('upload');
}
