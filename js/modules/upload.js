/* ================================================================
   upload.js — Complete Upload → Parse → Confirm → Store Pipeline

   Flow:
     1. User drops / selects files  →  addFiles()
     2. File queued, status = pending
     3. _selectFile(idx)            →  _parseFile()  [calls extractor]
     4. parseFile() returns Quote   →  fill form, status = ready
     5. User edits fields           →  form is source-of-truth
     6. "确认导入" clicked          →  _handleConfirm()
         → validate form
         → merge form + tags + file_name + extractor items
         → fileService.upload()   [stores file on server]
         → quoteService.create()  [writes DB + logs internally]
         → status = done
         → refreshOverview + refreshAnalysisSelects
================================================================ */

import { parseFile }                    from './extractor.js';
import { quoteService }                 from '../services/quoteService.js';
import { fileService }                  from '../services/fileService.js';
import { supplierService }              from '../services/supplierService.js';
import { templateService }              from '../services/templateService.js';
import { getSession }                   from './auth.js';
import { getSelectedTags, resetTags }   from './classifier.js';
import { refreshOverview }              from './overview.js';
import { refreshAnalysisSelects }       from './analysis.js';
import { formatSize, fileIcon }         from '../ui/components.js';
import { showToast }                    from '../ui/notifications.js';

/* ================================================================
   Constants
================================================================ */

const ACCEPTED_EXTS = ['.pdf', '.xlsx', '.xls', '.docx', '.doc'];

const STATUS_BADGE = {
  pending: `<span class="badge badge-gray">待处理</span>`,
  parsing: `<span class="badge badge-blue" style="display:inline-flex;align-items:center;gap:4px">
              <span class="spinner" style="width:12px;height:12px;border-width:1.5px;flex-shrink:0"></span>解析中
            </span>`,
  ready:   `<span class="badge badge-green">待确认</span>`,
  done:    `<span class="badge badge-green">✓ 已导入</span>`,
  error:   `<span class="badge badge-red">解析失败</span>`,
};

const FIELD_MAP = [
  { id: 'field-supplier',   key: 'supplier',      label: '供应商',   confId: 'conf-supplier'   },
  { id: 'field-quote-id',   key: 'quote_id',      label: '报价单号', confId: 'conf-quote-id'   },
  { id: 'field-quote-date', key: 'quote_date',    label: '报价日期', confId: 'conf-quote-date' },
  { id: 'field-amount',     key: 'total_amount',  label: '报价金额', confId: 'conf-amount'     },
  { id: 'field-delivery',   key: 'delivery_time', label: '交期',     confId: 'conf-delivery'   },
  { id: 'field-notes',      key: 'notes',         label: '备注'                               },
];

/* ================================================================
   Module State
================================================================ */

let _queue            = [];
let _activeIdx        = -1;
let _lastExtracted    = null;  // Quote object from extractor, kept for template learning

/* ================================================================
   File Acceptance
================================================================ */

function _isAccepted(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  return ACCEPTED_EXTS.includes(ext);
}

function _isDuplicate(file) {
  return _queue.some(q => q.file.name === file.name && q.file.size === file.size);
}

/* ================================================================
   Add Files
================================================================ */

export function addFiles(fileList) {
  let added = 0;
  let rejected = 0;

  for (const file of fileList) {
    if (!_isAccepted(file)) { rejected++; continue; }
    if (_isDuplicate(file))  continue;
    _queue.push({ file, status: 'pending', quote: null, errorMsg: '' });
    added++;
  }

  if (rejected > 0) {
    showToast(`${rejected} 个文件不支持（仅接受 PDF / Excel / Word）`, 'error');
  }

  _renderQueue();

  if (_activeIdx === -1 && added > 0) {
    _selectFile(_queue.length - added);
  }
}

/* ================================================================
   Queue Rendering
================================================================ */

function _renderQueue() {
  const queueCard = document.getElementById('file-queue');
  const listEl    = document.getElementById('file-list');
  const countEl   = document.getElementById('file-count');
  if (!queueCard || !listEl) return;

  if (_queue.length === 0) {
    queueCard.style.display = 'none';
    return;
  }

  queueCard.style.display = 'block';
  if (countEl) countEl.textContent = _queue.length;

  listEl.innerHTML = '';
  _queue.forEach((entry, idx) => {
    const item = document.createElement('div');
    item.className = 'file-item' + (idx === _activeIdx ? ' active' : '');
    item.dataset.idx = idx;
    item.innerHTML = `
      <span class="file-item-icon">${fileIcon(entry.file.name)}</span>
      <span class="file-item-name" title="${entry.file.name}">${entry.file.name}</span>
      <span class="file-item-size">${formatSize(entry.file.size)}</span>
      <span class="file-item-status" id="badge-${idx}">${STATUS_BADGE[entry.status]}</span>
      <button class="file-item-delete" type="button" title="删除">×</button>
    `;
    item.addEventListener('click', () => _selectFile(idx));
    item.querySelector('.file-item-delete').addEventListener('click', e => {
      e.stopPropagation();
      _removeFile(idx);
    });
    listEl.appendChild(item);
  });
}

function _patchBadge(idx) {
  const el = document.getElementById(`badge-${idx}`);
  if (el) el.innerHTML = STATUS_BADGE[_queue[idx].status];
}

function _removeFile(idx) {
  _queue.splice(idx, 1);
  if (_activeIdx === idx) {
    _activeIdx = -1;
    _hidePanel();
    resetTags();
    if (_queue.length > 0) _selectFile(Math.min(idx, _queue.length - 1));
  } else if (_activeIdx > idx) {
    _activeIdx--;
  }
  _renderQueue();
}

/* ================================================================
   File Selection & Auto-Parse
================================================================ */

async function _selectFile(idx) {
  if (idx < 0 || idx >= _queue.length) return;

  _activeIdx = idx;

  document.querySelectorAll('.file-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });

  const entry = _queue[idx];

  switch (entry.status) {
    case 'pending':
      _showPanel();
      await _parseFile(idx);
      break;
    case 'parsing':
      _showPanel();
      _setStatusLabel('提取中...', 'processing');
      break;
    case 'ready':
      _showPanel();
      _fillForm(entry.quote);
      _setStatusLabel('提取完成', 'done');
      break;
    case 'done':
      _showPanel();
      _fillForm(entry.quote);
      _setStatusLabel('已导入', 'done');
      break;
    case 'error':
      _showPanel();
      _setStatusLabel('解析失败 — 可手动填写后导入', 'error');
      if (entry.quote) _fillForm(entry.quote);
      break;
  }
}

/* ================================================================
   Parsing
================================================================ */

async function _parseFile(idx) {
  const entry   = _queue[idx];
  entry.status  = 'parsing';
  _patchBadge(idx);
  _setStatusLabel('提取中...', 'processing');

  const result = await parseFile(entry.file);

  if (result.success === false) {
    entry.status   = 'error';
    entry.errorMsg = result.error;
    _patchBadge(idx);
    _setStatusLabel('解析失败', 'error');
    showToast(`「${entry.file.name}」解析失败：${result.error}`, 'error');
    return;
  }

  entry.quote  = result;
  entry.status = 'ready';
  _patchBadge(idx);
  _setStatusLabel('提取完成', 'done');
  _fillForm(result);
}

/* ================================================================
   Extract Panel UI
================================================================ */

function _showPanel() {
  const placeholder = document.getElementById('extract-placeholder');
  const form        = document.getElementById('extract-form');
  if (placeholder) placeholder.style.display = 'none';
  if (form)        form.style.display = 'block';
}

function _hidePanel() {
  const placeholder = document.getElementById('extract-placeholder');
  const form        = document.getElementById('extract-form');
  if (placeholder) placeholder.style.display = 'flex';
  if (form)        form.style.display = 'none';
  _clearConfBadges();
  _lastExtracted = null;
}

function _setStatusLabel(text, type) {
  const el = document.getElementById('extract-status');
  if (!el) return;
  el.textContent = text;
  el.className   = `status-badge ${type}`;
}

const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', EUR: '€', GBP: '£' };

/**
 * Set the confidence badge next to a field label.
 * @param {string} badgeId  element id
 * @param {number} score    0–1
 * @param {string} source   human-readable extraction source
 */
function _setConfBadge(badgeId, score, source) {
  const el = document.getElementById(badgeId);
  if (!el) return;
  let tier, label;
  if (score >= 0.80)      { tier = 'high'; label = '高'; }
  else if (score >= 0.50) { tier = 'mid';  label = '中'; }
  else if (score > 0)     { tier = 'low';  label = '低'; }
  else                    { tier = 'none'; label = '人工'; }
  el.className  = `conf-badge conf-${tier}`;
  el.textContent = label;
  el.title = source ? `来源：${source}` : '未提取，请手动填写';
}

function _clearConfBadges() {
  for (const { confId } of FIELD_MAP) {
    if (!confId) continue;
    _setConfBadge(confId, 0, '');
  }
}

function _fillForm(quote) {
  if (!quote) return;
  _lastExtracted = quote;

  const sym = CURRENCY_SYMBOL[quote.currency] ?? '¥';
  const fmt = n => `${sym}${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const conf = quote._confidence ?? {};

  for (const { id, key, confId } of FIELD_MAP) {
    const el = document.getElementById(id);
    if (!el) continue;
    const val = quote[key];
    if (key === 'total_amount') {
      const n = parseFloat(val);
      el.value = (n > 0) ? fmt(n) : '';
    } else {
      el.value = (val != null && val !== 0) ? String(val) : '';
    }
    if (confId && conf[key]) {
      _setConfBadge(confId, conf[key].score, conf[key].source);
    } else if (confId) {
      _setConfBadge(confId, 0, '');
    }
  }

  // Items inline section
  const itemsSection = document.getElementById('items-section');
  const itemsWrap    = document.getElementById('items-table-wrap');
  const itemsCnt     = document.getElementById('items-count');
  const items = quote.items ?? [];
  if (itemsSection && itemsWrap) {
    if (items.length > 0) {
      itemsSection.style.display = '';
      if (itemsCnt) itemsCnt.textContent = `${items.length} 项`;
      itemsWrap.innerHTML = `
        <table class="items-table">
          <thead><tr><th>名称</th><th>数量</th><th>单价</th><th>金额</th></tr></thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td>${it.name || '-'}</td>
                <td>${it.qty || 1}</td>
                <td>${it.unit_price ? fmt(it.unit_price) : '-'}</td>
                <td>${it.total ? fmt(it.total) : '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    } else {
      itemsSection.style.display = 'none';
    }
  }
}

/**
 * Load saved template for a supplier and backfill empty low-confidence fields.
 * @param {string} supplierName
 */
async function _applyTemplate(supplierName) {
  if (!supplierName) return;
  const tpl = await templateService.get(supplierName);
  if (!tpl) return;

  const deliveryEl = document.getElementById('field-delivery');
  if (deliveryEl && !deliveryEl.value.trim() && tpl.delivery_time) {
    deliveryEl.value = tpl.delivery_time;
    _setConfBadge('conf-delivery', 0.70, '模板记忆');
  }
}

/**
 * After a successful import, persist any user-corrected low-confidence fields
 * as a template for the supplier, so the next PDF auto-fills them.
 */
async function _learnTemplate(saved) {
  if (!saved.supplier) return;
  const orig = _lastExtracted;
  const learned = {};

  // Learn delivery_time when extractor missed it but user filled it
  if (saved.delivery_time && !orig?.delivery_time) {
    learned.delivery_time = saved.delivery_time;
  }

  if (Object.keys(learned).length > 0) {
    await templateService.save(saved.supplier, learned);
  }
}

function _readForm() {
  const data = {};
  for (const { id, key } of FIELD_MAP) {
    const el = document.getElementById(id);
    if (!el) continue;
    data[key] = el.value.trim();
  }
  data.total_amount = parseFloat(
    String(data.total_amount).replace(/[,，\s¥￥$€£]/g, '')
  ) || 0;
  return data;
}

/* ================================================================
   Validation
================================================================ */

function _validate(_formData) {
  return null;  // all fields optional
}

/* ================================================================
   Confirm Import
================================================================ */

async function _handleConfirm() {
  const session = getSession();
  if (!session) { showToast('请先登录', 'error'); return; }

  const entry = _queue[_activeIdx];
  if (!entry) { showToast('请先选择一个文件', 'error'); return; }

  if (entry.status === 'parsing') { showToast('文件正在解析中，请稍候', 'info'); return; }
  if (entry.status === 'done')    { showToast('该文件已导入，无需重复提交', 'info'); return; }

  const formData = _readForm();
  const errMsg   = _validate(formData);
  if (errMsg) { showToast(errMsg, 'error'); return; }

  const tags = getSelectedTags();
  const base = entry.quote ?? {};

  const quoteData = {
    ...base,
    ...formData,
    line_id:   tags.line?.id   ?? '',
    line_name: tags.line?.name ?? '',
    equipment: tags.equipment  ?? [],
    file_name: entry.file.name,
    items:     base.items ?? [],
    currency:  base.currency ?? 'CNY',
  };

  const btnConfirm = document.getElementById('btn-confirm');
  if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.textContent = '导入中...'; }

  try {
    quoteData.file_id = await fileService.upload(entry.file);
    await quoteService.create(quoteData);

    entry.status = 'done';
    _patchBadge(_activeIdx);
    _setStatusLabel('已导入', 'done');

    showToast(`报价「${quoteData.quote_id || quoteData.supplier}」导入成功`, 'success');

    await _learnTemplate(quoteData);
    resetTags();
    await _refreshSupplierList();
    await refreshOverview();
    await refreshAnalysisSelects();

    const nextIdx = _queue.findIndex((e, i) => i > _activeIdx && e.status === 'pending');
    if (nextIdx !== -1) await _selectFile(nextIdx);

  } catch (err) {
    console.error('[Upload] import failed:', err);
    showToast(err.message || '写入失败，请检查存储或重试', 'error');
  } finally {
    if (btnConfirm) { btnConfirm.disabled = false; btnConfirm.textContent = '确认导入'; }
  }
}

/* ================================================================
   Supplier Autocomplete
================================================================ */

async function _refreshSupplierList() {
  const datalist = document.getElementById('supplier-datalist');
  if (!datalist) return;
  try {
    const suppliers = await supplierService.getAll();
    datalist.innerHTML = suppliers
      .map(s => `<option value="${s.name.replace(/"/g, '&quot;')}">`)
      .join('');
  } catch {
    // non-critical — autocomplete just won't populate
  }
}

/* ================================================================
   Discard
================================================================ */

function _handleDiscard() {
  _activeIdx = -1;
  document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
  _hidePanel();
  resetTags();
}

/* ================================================================
   Init
================================================================ */

export function initUpload() {
  const zone       = document.getElementById('drop-zone');
  const input      = document.getElementById('input-file');
  const btnBrowse  = document.getElementById('btn-browse');
  const btnConfirm = document.getElementById('btn-confirm');
  const btnDiscard = document.getElementById('btn-discard');

  btnBrowse?.addEventListener('click', () => input?.click());

  input?.addEventListener('change', e => {
    addFiles(e.target.files);
    input.value = '';
  });

  zone?.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone?.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone?.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });

  // Load template defaults when user selects / types a known supplier
  document.getElementById('field-supplier')
    ?.addEventListener('change', e => _applyTemplate(e.target.value.trim()));

  btnConfirm?.addEventListener('click', _handleConfirm);
  btnDiscard?.addEventListener('click', _handleDiscard);

  _refreshSupplierList();
}
