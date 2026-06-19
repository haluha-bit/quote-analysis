/* ================================================================
   Logger — Audit Trail (reads from server; writes handled server-side)
================================================================ */

import { authService } from '../services/authService.js';
import { buildLogRow }  from '../ui/components.js';

/** No-op: server routes handle logging internally */
async function log() {}

/** Render log table into #log-tbody */
async function renderLogs() {
  const tbody   = document.getElementById('log-tbody');
  const countEl = document.getElementById('log-count');
  if (!tbody) return;

  let logs = [];
  try { logs = await authService.getLogs(); } catch { logs = []; }

  tbody.innerHTML = '';
  if (logs.length === 0) {
    tbody.innerHTML = '<tr class="table-empty"><td colspan="4">暂无操作记录</td></tr>';
  } else {
    logs.forEach(l => tbody.appendChild(buildLogRow(l)));
  }
  if (countEl) countEl.textContent = `共 ${logs.length} 条记录`;
}

export const logger = { log, renderLogs };
