/* ================================================================
   Reusable UI Component Builders
================================================================ */

/** Format currency */
export function formatCurrency(amount, currency = 'CNY') {
  if (amount == null || isNaN(amount)) return '—';
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(amount);
}

/** Format date string to locale */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** Format ISO timestamp */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

/** File type icon emoji */
export function fileIcon(fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  const MAP = { pdf: '📄', xlsx: '📊', xls: '📊', docx: '📝', doc: '📝' };
  return MAP[ext] ?? '📎';
}

/** File size display */
export function formatSize(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Build a KPI card DOM element */
export function buildKPICard({ label, value, trend, trendClass = 'kpi-neutral' }) {
  const card = document.createElement('div');
  card.className = 'card kpi-card';
  card.innerHTML = `
    <p class="kpi-label">${label}</p>
    <p class="kpi-value">${value ?? '—'}</p>
    <p class="kpi-trend ${trendClass}">${trend ?? ''}</p>
  `;
  return card;
}

/** Build a table row for the overview table */
export function buildQuoteRow(quote) {
  const tr = document.createElement('tr');
  tr.dataset.id = quote.id;
  tr.innerHTML = `
    <td>${quote.quote_id  || '—'}</td>
    <td>${quote.supplier  || '—'}</td>
    <td>${(quote.equipment ?? []).join(', ') || '—'}</td>
    <td>${quote.line_name || '—'}</td>
    <td>${formatDate(quote.quote_date)}</td>
    <td>${quote.delivery_time || '—'}</td>
    <td>${formatCurrency(quote.total_amount, quote.currency)}</td>
    <td>${quote.created_by || '—'}</td>
    <td>
      <button class="btn btn-ghost btn-sm btn-delete" data-id="${quote.id}">删除</button>
    </td>
  `;
  return tr;
}

/** Build a log row */
export function buildLogRow(log) {
  const ACTION_LABELS = {
    upload: '上传报价',
    delete: '删除报价',
    login:  '登录系统',
    logout: '退出系统',
    add_line: '新增产线',
    edit_line: '编辑产线',
  };
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${formatTimestamp(log.ts)}</td>
    <td>${log.user || '—'}</td>
    <td>${ACTION_LABELS[log.action] ?? log.action}</td>
    <td>${log.detail || '—'}</td>
  `;
  return tr;
}

/** Build a line config list item */
export function buildLineConfigItem(line, onEdit, onDelete) {
  const div = document.createElement('div');
  div.className = 'line-config-item';
  div.innerHTML = `
    <div class="line-config-header">
      <span class="line-config-name">${line.name}</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm btn-edit-line" data-id="${line.id}">编辑</button>
        <button class="btn btn-ghost btn-sm btn-delete-line" data-id="${line.id}" style="color:var(--red)">删除</button>
      </div>
    </div>
    <div class="line-chips">
      ${line.equipment.map(e => `<span class="line-chip">${e}</span>`).join('')}
    </div>
  `;
  div.querySelector('.btn-edit-line').addEventListener('click', () => onEdit(line));
  div.querySelector('.btn-delete-line').addEventListener('click', () => onDelete(line));
  return div;
}
