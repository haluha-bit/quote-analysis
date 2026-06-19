/* ================================================================
   Overview — Quote List, KPIs, Filters, Double-Click to View
================================================================ */

import { quoteService } from '../services/quoteService.js';
import { lineService }  from '../services/lineService.js';
import { fileService }  from '../services/fileService.js';
import { buildQuoteRow, formatCurrency } from '../ui/components.js';
import { showToast, showConfirm }        from '../ui/notifications.js';
import { getSession }                    from './auth.js';

let _allQuotes = [];

/** Render KPI summary cards */
function renderKPIs(quotes) {
  const total     = quotes.length;
  const amount    = quotes.reduce((s, q) => s + (q.total_amount || 0), 0);
  const suppliers = new Set(quotes.map(q => q.supplier).filter(Boolean)).size;

  const latest = quotes[0]
    ? new Date(quotes[0].created_at).toLocaleDateString('zh-CN')
    : '—';

  _set('kpi-total',     total || '—');
  _set('kpi-suppliers', suppliers || '—');
  _set('kpi-amount',    total ? formatCurrency(amount) : '—');
  _set('kpi-latest',    latest);

  const thisMonth = quotes.filter(q => {
    const d = new Date(q.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  _set('kpi-total-trend', `本月新增 ${thisMonth} 条`);
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

/** Render table rows */
function renderTable(quotes) {
  const tbody = document.getElementById('overview-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (quotes.length === 0) {
    tbody.innerHTML = '<tr class="table-empty"><td colspan="9">暂无报价数据，请先上传文件</td></tr>';
    return;
  }

  quotes.forEach(q => {
    const row = buildQuoteRow(q);

    row.addEventListener('dblclick', () => _openFile(q));

    row.querySelector('.btn-delete')?.addEventListener('click', async e => {
      e.stopPropagation();
      const ok = await showConfirm('确认删除', `确定要删除报价「${q.quote_id || q.supplier}」吗？此操作不可恢复。`);
      if (!ok) return;
      await quoteService.remove(q.id);
      showToast('报价已删除', 'success');
      await refreshOverview();
    });

    tbody.appendChild(row);
  });
}

/** Populate filter dropdowns */
async function populateFilters() {
  const supplierSel = document.getElementById('filter-supplier');
  const lineSel     = document.getElementById('filter-line');
  const equipSel    = document.getElementById('filter-equipment');

  const [suppliers, lines] = await Promise.all([
    quoteService.getSuppliers(),
    lineService.getAll(),
  ]);

  suppliers.forEach(s => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = s;
    supplierSel?.appendChild(opt);
  });

  lines.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    lineSel?.appendChild(opt);
  });

  const allEquip = [...new Set(lines.flatMap(l => l.equipment))].sort();
  allEquip.forEach(eq => {
    const opt = document.createElement('option');
    opt.value = opt.textContent = eq;
    equipSel?.appendChild(opt);
  });
}

/** Apply current filter values and re-render */
async function applyFilters() {
  const supplier  = document.getElementById('filter-supplier')?.value  || '';
  const lineId    = document.getElementById('filter-line')?.value      || '';
  const equipment = document.getElementById('filter-equipment')?.value || '';

  const filtered = await quoteService.filter({
    supplier:  supplier  || undefined,
    lineId:    lineId    || undefined,
    equipment: equipment || undefined,
  });
  renderTable(filtered);
}

/** Open original file from server */
function _openFile(quote) {
  if (!quote.file_id) { showToast('该报价未保存原文件', 'info'); return; }
  window.open(fileService.url(quote.file_id), '_blank');
}

/** Full refresh: reload data, re-render everything */
export async function refreshOverview() {
  _allQuotes = await quoteService.getAll();
  renderKPIs(_allQuotes);
  renderTable(_allQuotes);
}

/** Initialize overview view */
export async function initOverview() {
  await populateFilters();
  await refreshOverview();

  document.getElementById('filter-supplier')?.addEventListener('change', applyFilters);
  document.getElementById('filter-line')?.addEventListener('change', applyFilters);
  document.getElementById('filter-equipment')?.addEventListener('change', applyFilters);
  document.getElementById('btn-clear-filters')?.addEventListener('click', async () => {
    ['filter-supplier','filter-line','filter-equipment'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    await refreshOverview();
  });
}
