/* ================================================================
   Analysis Module — Cross-Period Compare & Cost Breakdown
================================================================ */

import { quoteService }               from '../services/quoteService.js';
import { formatCurrency, formatDate } from '../ui/components.js';
import { showToast }                  from '../ui/notifications.js';

/* ================================================================
   CROSS-PERIOD COMPARISON
================================================================ */

export function calcDifference(amountA, amountB) {
  const diff = amountB - amountA;
  const pct  = amountA !== 0 ? ((diff / amountA) * 100).toFixed(2) : null;
  return { diff, pct };
}

export function compareQuotes(quoteA, quoteB) {
  // Items use { name, total } from extractor — not { label, amount }
  const mapA = new Map((quoteA.items ?? []).map(i => [i.name, i]));
  const mapB = new Map((quoteB.items ?? []).map(i => [i.name, i]));

  const allLabels = new Set([...mapA.keys(), ...mapB.keys()]);
  const rows = [];

  for (const label of allLabels) {
    const a    = mapA.get(label);
    const b    = mapB.get(label);
    const amtA = a?.total ?? 0;
    const amtB = b?.total ?? 0;
    const diff = amtB - amtA;

    rows.push({
      label,
      amountA: amtA,
      amountB: amtB,
      diff,
      status: !a ? 'new' : diff > 0 ? 'increased' : diff < 0 ? 'decreased' : 'same',
    });
  }

  const totalA = quoteA.total_amount;
  const totalB = quoteB.total_amount;
  const { pct } = calcDifference(totalA, totalB);

  return { rows, totalA, totalB, totalDiff: totalB - totalA, pct };
}

async function runCompare() {
  const idA = document.getElementById('compare-select-a')?.value;
  const idB = document.getElementById('compare-select-b')?.value;

  if (!idA || !idB) { showToast('请选择两份报价', 'error'); return; }
  if (idA === idB)  { showToast('请选择不同的两份报价', 'error'); return; }

  const [qA, qB] = await Promise.all([
    quoteService.getById(idA),
    quoteService.getById(idB),
  ]);
  const result = compareQuotes(qA, qB);

  const pctStr  = result.pct !== null ? `${result.pct > 0 ? '+' : ''}${result.pct}%` : '—';
  const diffStr = formatCurrency(result.totalDiff);

  _set('compare-pct',      pctStr);
  _set('compare-diff',     diffStr);
  _set('compare-new-items', result.rows.filter(r => r.status === 'new').length);

  const pctEl = document.getElementById('compare-pct');
  if (pctEl) pctEl.className = `kpi-value ${result.totalDiff > 0 ? 'kpi-negative' : 'kpi-positive'}`;

  const trendEl = document.getElementById('compare-pct-trend');
  if (trendEl) trendEl.textContent = `${formatDate(qA.quote_date)} → ${formatDate(qB.quote_date)}`;

  const tbody = document.getElementById('compare-tbody');
  if (tbody) {
    tbody.innerHTML = '';
    result.rows.forEach(row => {
      const tr = document.createElement('tr');
      const statusLabels = { new: '新增项', increased: '涨价', decreased: '降价', same: '不变' };
      tr.innerHTML = `
        <td>${row.label}</td>
        <td>${row.amountA ? formatCurrency(row.amountA) : '—'}</td>
        <td>${row.amountB ? formatCurrency(row.amountB) : '—'}</td>
        <td class="${row.diff > 0 ? 'increased' : row.diff < 0 ? 'decreased' : ''}">${row.diff !== 0 ? formatCurrency(row.diff) : '—'}</td>
        <td class="${row.status === 'new' ? 'new-item' : row.status === 'increased' ? 'increased' : row.status === 'decreased' ? 'decreased' : ''}">${statusLabels[row.status]}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('compare-result').style.display = 'block';
}

/* ================================================================
   COST BREAKDOWN
================================================================ */

async function runCostAnalysis() {
  const id = document.getElementById('cost-select-quote')?.value;
  if (!id) { showToast('请选择报价', 'error'); return; }

  const quote = await quoteService.getById(id);
  const items = quote.items ?? [];
  const total = quote.total_amount || 1;

  const groups = { labor: 0, hardware: 0, other: 0 };

  items.forEach(item => {
    // Use the type field pre-computed by the extractor's classifyItem()
    const amount = item.total || 0;
    if      (item.type === 'labor')    groups.labor    += amount;
    else if (item.type === 'hardware') groups.hardware += amount;
    else                               groups.other    += amount;
  });

  const pct = v => `占比 ${((v / total) * 100).toFixed(1)}%`;

  _set('cost-labor',        formatCurrency(groups.labor));
  _set('cost-labor-pct',    pct(groups.labor));
  _set('cost-hardware',     formatCurrency(groups.hardware));
  _set('cost-hardware-pct', pct(groups.hardware));
  _set('cost-other',        formatCurrency(groups.other));
  _set('cost-other-pct',    pct(groups.other));

  const tbody = document.getElementById('cost-tbody');
  if (tbody) {
    tbody.innerHTML = '';
    items.forEach(item => {
      const amount = item.total || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.name || '—'}</td>
        <td>${formatCurrency(amount)}</td>
        <td>${((amount / total) * 100).toFixed(1)}%</td>
        <td>${item.qty != null ? `${item.qty} × ${formatCurrency(item.unit_price || 0)}` : '—'}</td>
      `;
      tbody.appendChild(tr);
    });
    if (items.length === 0) {
      tbody.innerHTML = '<tr class="table-empty"><td colspan="4">文件中未提取到成本分项数据</td></tr>';
    }
  }

  document.getElementById('cost-result').style.display = 'block';
}

async function populateQuoteSelects() {
  const quotes  = await quoteService.getAll();
  const selects = ['compare-select-a', 'compare-select-b', 'cost-select-quote'];

  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">请选择报价</option>';
    quotes.forEach(q => {
      const opt = document.createElement('option');
      opt.value       = q.id;
      opt.textContent = `${q.supplier || '—'} | ${q.quote_id || '—'} | ${q.quote_date || '—'}`;
      el.appendChild(opt);
    });
  });
}

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function initTabs() {
  document.querySelectorAll('.pill-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pill-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
      const panel = document.getElementById(`tab-${tab.dataset.tab}`);
      if (panel) panel.style.display = 'block';
    });
  });
}

export async function initAnalysis() {
  initTabs();
  await populateQuoteSelects();

  document.getElementById('btn-compare')?.addEventListener('click', runCompare);
  document.getElementById('btn-analyze-cost')?.addEventListener('click', runCostAnalysis);
}

export async function refreshAnalysisSelects() {
  await populateQuoteSelects();
}
