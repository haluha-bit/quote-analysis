/* ================================================================
   App Entry Point — Quote Analysis System
================================================================ */

import { initAuth }                      from './modules/auth.js';
import { initUpload }                    from './modules/upload.js';
import { initClassifier }                from './modules/classifier.js';
import { initOverview, refreshOverview } from './modules/overview.js';
import { initAnalysis, refreshAnalysisSelects } from './modules/analysis.js';
import { logger }                        from './modules/logger.js';
import { initRouter, onNavigate }        from './ui/router.js';

/* ---- pdf.js worker ---- */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ================================================================
   Bootstrap
================================================================ */
async function boot() {
  // Wait for login (resolves immediately if session exists)
  await initAuth();

  initRouter();    // wires bottom nav, defaults to upload view
  initUpload();    // drag/drop + parse + confirm pipeline

  await initClassifier();   // fetches lines from server, renders chips
  await initOverview();     // KPIs + table
  await initAnalysis();     // tab panels + quote selects

  onNavigate(async viewId => {
    if (viewId === 'overview')  await refreshOverview();
    if (viewId === 'analysis')  await refreshAnalysisSelects();
    if (viewId === 'settings')  await logger.renderLogs();
  });
}

boot().catch(err => console.error('[App] Boot failed:', err));
