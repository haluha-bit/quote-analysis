/* ================================================================
   upload.js — Upload → Server AI Parse → Review → Confirm → Store

   Flow:
     1. User drops / selects files  → addFiles()
     2. File queued, status = pending
     3. _selectFile(idx)            → _parseFile()
     4. _parseFile() → fileService.upload() → server AI normalize
        → entry.fileId + entry.normalized stored
        → _fillForm(normalized): fill header fields + editable items table
     5. User reviews & edits all fields and items
     6. "确认入库" clicked          → _handleConfirm()
         → _readForm() + _editItems (no re-upload)
         → quoteService.create()   [DB write]
         → status = done
================================================================ */

import { quoteService }                from '../services/quoteService.js';
import { fileService }                 from '../services/fileService.js';
import { supplierService }             from '../services/supplierService.js';
import { templateService }             from '../services/templateService.js';
import { getSession }                  from './auth.js';
import { getSelectedTags, resetTags }  from './classifier.js';
import { refreshOverview }             from './overview.js';
import { refreshAnalysisSelects }      from './analysis.js';
import { formatSize, fileIcon }        from '../ui/components.js';
import { showToast }                   from '../ui/notifications.js';

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
  done:    `<span class="badge badge-green">✓ 已入库</span>`,
  error:   `<span class="badge badge-red">解析失败</span>`,
};

/* ================================================================
   Module State
================================================================ */

let _queue         = [];
let _activeIdx     = -1;
let _lastExtracted = null;  // normalized object, kept for template learning
let _editItems     = [];    // live-editable copy of items

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
  let added = 0, rejected = 0;
  for (const file of fileList) {
    if (!_isAccepted(file)) { rejected++; continue; }
    if (_isDuplicate(file))  continue;
    _queue.push({ file, status: 'pending', fileId: null, normalized: null, errorMsg: '' });
    added++;
  }
  if (rejected > 0) showToast(`${rejected} 个文件不支持（仅接受 PDF / Excel / Word）`, 'error');
  _renderQueue();
  if (_activeIdx === -1 && added > 0) _selectFile(_queue.length - added);
}

/* ================================================================
   Queue Rendering
================================================================ */

function _renderQueue() {
  const queueCard = document.getElementById('file-queue');
  const listEl    = document.getElementById('file-list');
  const countEl   = document.getElementById('file-count');
  if (!queueCard || !listEl) return;
  if (_queue.length === 0) { queueCard.style.display = 'none'; return; }
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
   File Selection
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
      _setStatusLabel('上传并解析中...', 'processing');
      break;
    case 'ready':
      _showPanel();
      _fillForm(entry.normalized ?? {});
      _setStatusLabel('解析完成，请确认', 'done');
      break;
    case 'done':
      _showPanel();
      _fillForm(entry.normalized ?? {});
      _setStatusLabel('已入库', 'done');
      break;
    case 'error':
      _showPanel();
      _setStatusLabel('解析失败 — 可手动填写后导入', 'error');
      _fillForm({});
      break;
  }
}

/* ================================================================
   Parsing — upload to server, receive AI-normalized fields
================================================================ */

async function _parseFile(idx) {
  const entry  = _queue[idx];
  entry.status = 'parsing';
  _patchBadge(idx);
  _setStatusLabel('上传并解析中...', 'processing');

  try {
    const { file_id, normalized } = await fileService.upload(entry.file);
    entry.fileId     = file_id;
    entry.normalized = normalized ?? {};
    entry.status     = 'ready';
    _patchBadge(idx);
    _setStatusLabel('解析完成，请确认', 'done');
    _fillForm(entry.normalized);
  } catch (err) {
    entry.status   = 'error';
    entry.errorMsg = err.message;
    _patchBadge(idx);
    _setStatusLabel('解析失败 — 可手动填写后导入', 'error');
    _fillForm({});
    showToast(`「${entry.file.name}」上传失败：${err.message}`, 'error');
  }
}

/* ================================================================
   Panel UI
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
  _lastExtracted = null;
  _editItems     = [];
}

function _setStatusLabel(text, type) {
  const el = document.getElementById('extract-status');
  if (!el) return;
  el.textContent = text;
  el.className   = `status-badge ${type}`;
}

/* ================================================================
   Fill Form from Normalized (AI-extracted)
================================================================ */

function _set(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _fillForm(normalized) {
  _lastExtracted = normalized;
  _editItems = Array.isArray(normalized.items)
    ? normalized.items.map(it => ({ ...it }))
    : [];

  _set('field-supplier',   normalized.vendorName);
  _set('field-quote-id',   normalized.quoteNo);
  _set('field-quote-date', normalized.quoteDate);
  _set('field-delivery',   normalized.deliveryMethod);
  _set('field-payment',    normalized.paymentTerms);
  _set('field-validity',   normalized.validity);
  _set('field-amount',     '');
  _set('field-notes',      '');

  _syncItemsSection();
  _reRenderItemsTable();
}

/* ================================================================
   Editable Items Table
================================================================ */

function _syncItemsSection() {
  const section = document.getElementById('items-section');
  if (section) section.style.display = _editItems.length > 0 ? '' : 'none';
  const cnt = document.getElementById('items-count');
  if (cnt) cnt.textContent = `${_editItems.length} 项`;
}

function _reRenderItemsTable() {
  const wrap = document.getElementById('items-table-wrap');
  if (!wrap) return;

  if (_editItems.length === 0) {
    wrap.innerHTML = '';
    return;
  }

  const rows = _editItems.map((it, i) => `
    <tr data-i="${i}">
      <td><input class="item-inp item-sm"   data-f="itemNo"      value="${_esc(it.itemNo)}"></td>
      <td><input class="item-inp"           data-f="model"       value="${_esc(it.model)}"></td>
      <td><input class="item-inp item-wide" data-f="description" value="${_esc(it.description)}"></td>
      <td><input class="item-inp item-num"  data-f="qty"         value="${_esc(it.qty)}"></td>
      <td><input class="item-inp item-sm"   data-f="unit"        value="${_esc(it.unit)}"></td>
      <td><input class="item-inp item-num"  data-f="unitPrice"   value="${_esc(it.unitPrice)}"></td>
      <td><input class="item-inp item-num"  data-f="amount"      value="${_esc(it.amount)}"></td>
      <td><button class="item-del-btn" type="button" data-i="${i}" title="删除此行">×</button></td>
    </tr>`).join('');

  wrap.innerHTML = `
    <div class="items-scroll">
      <table class="items-table items-editable">
        <thead><tr>
          <th style="width:36px">序</th>
          <th style="width:96px">型号</th>
          <th>品名</th>
          <th style="width:60px">数量</th>
          <th style="width:48px">单位</th>
          <th style="width:88px">单价</th>
          <th style="width:88px">金额</th>
          <th style="width:28px"></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <button type="button" class="btn btn-ghost btn-sm items-add-row" id="btn-add-item-row">＋ 新增行</button>`;

  // Delegate: sync input changes back to _editItems
  wrap.querySelector('tbody').addEventListener('input', e => {
    if (!e.target.matches('.item-inp')) return;
    const i = parseInt(e.target.closest('tr').dataset.i, 10);
    const f = e.target.dataset.f;
    if (_editItems[i] && f) _editItems[i][f] = e.target.value;
  });

  // Delegate: delete row
  wrap.querySelector('tbody').addEventListener('click', e => {
    const btn = e.target.closest('.item-del-btn');
    if (!btn) return;
    _editItems.splice(parseInt(btn.dataset.i, 10), 1);
    _syncItemsSection();
    _reRenderItemsTable();
  });

  // Add row
  document.getElementById('btn-add-item-row')?.addEventListener('click', () => {
    _editItems.push({ itemNo: '', model: '', description: '', qty: '', unit: '', unitPrice: '', amount: '' });
    _syncItemsSection();
    _reRenderItemsTable();
  });
}

/* ================================================================
   Template Autocomplete
================================================================ */

async function _applyTemplate(supplierName) {
  if (!supplierName) return;
  const tpl = await templateService.get(supplierName);
  if (!tpl) return;
  const el = document.getElementById('field-delivery');
  if (el && !el.value.trim() && tpl.delivery_time) el.value = tpl.delivery_time;
}

async function _learnTemplate(saved) {
  if (!saved.supplier) return;
  const orig    = _lastExtracted ?? {};
  const learned = {};
  if (saved.delivery_method && !orig.deliveryMethod) {
    learned.delivery_time = saved.delivery_method;
  }
  if (Object.keys(learned).length > 0) {
    await templateService.save(saved.supplier, learned);
  }
}

/* ================================================================
   Read Form
================================================================ */

function _readForm() {
  const get = id => (document.getElementById(id)?.value.trim() ?? '');
  return {
    supplier:        get('field-supplier'),
    quote_id:        get('field-quote-id'),
    quote_date:      get('field-quote-date'),
    delivery_method: get('field-delivery'),
    payment_terms:   get('field-payment'),
    validity:        get('field-validity'),
    notes:           get('field-notes'),
    total_amount: parseFloat(
      get('field-amount').replace(/[,，\s¥￥$€£]/g, '')
    ) || 0,
  };
}

/* ================================================================
   Confirm (入库)
================================================================ */

async function _handleConfirm() {
  const session = getSession();
  if (!session) { showToast('请先登录', 'error'); return; }

  const entry = _queue[_activeIdx];
  if (!entry)                     { showToast('请先选择一个文件', 'error'); return; }
  if (entry.status === 'parsing') { showToast('文件正在解析中，请稍候', 'info'); return; }
  if (entry.status === 'done')    { showToast('该文件已导入，无需重复提交', 'info'); return; }
  if (!entry.fileId)              { showToast('文件尚未上传，请稍候', 'error'); return; }

  const formData = _readForm();
  const tags     = getSelectedTags();

  const quoteData = {
    ...formData,
    file_id:   entry.fileId,
    file_name: entry.file.name,
    items:     _editItems,
    currency:  (entry.normalized ?? {}).currency || 'CNY',
    line_id:   tags.line?.id   ?? '',
    line_name: tags.line?.name ?? '',
    equipment: tags.equipment  ?? [],
    status:    'confirmed',
  };

  const btnConfirm = document.getElementById('btn-confirm');
  if (btnConfirm) { btnConfirm.disabled = true; btnConfirm.textContent = '入库中...'; }

  try {
    await quoteService.create(quoteData);

    entry.status = 'done';
    _patchBadge(_activeIdx);
    _setStatusLabel('已入库', 'done');

    showToast(`报价「${quoteData.quote_id || quoteData.supplier}」入库成功`, 'success');

    await _learnTemplate(quoteData);
    resetTags();
    await _refreshSupplierList();
    await refreshOverview();
    await refreshAnalysisSelects();

    const nextPending = _queue.findIndex((e, i) => i > _activeIdx && e.status === 'pending');
    if (nextPending !== -1) await _selectFile(nextPending);

  } catch (err) {
    console.error('[Upload] confirm failed:', err);
    showToast(err.message || '写入失败，请检查存储或重试', 'error');
  } finally {
    if (btnConfirm) { btnConfirm.disabled = false; btnConfirm.textContent = '确认入库'; }
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

  document.getElementById('field-supplier')
    ?.addEventListener('change', e => _applyTemplate(e.target.value.trim()));

  btnConfirm?.addEventListener('click', _handleConfirm);
  btnDiscard?.addEventListener('click', _handleDiscard);

  _refreshSupplierList();
}
