/* ================================================================
   aiStatus.js — AI 状态红绿灯（页面加载时探测一次）
================================================================ */

import { api } from '../data/api.js';

const DOT_COLOR = {
  green:  '#34c759',
  yellow: '#ff9500',
  red:    '#ff3b30',
};

// 最近一次完整数据，供弹窗使用
let _lastData = null;

/* ---- 弹窗 ---- */
function _showPopover(anchorEl) {
  _closePopover();
  if (!_lastData || _lastData.status === 'green') return;

  const d   = _lastData;
  const dot = DOT_COLOR[d.status] ?? DOT_COLOR.red;
  const time = d.lastCheckedAt
    ? new Date(d.lastCheckedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  const pop = document.createElement('div');
  pop.id = 'ai-status-popover';
  pop.innerHTML = `
    <div class="ai-pop-row">
      <span class="ai-dot" style="background:${dot};width:10px;height:10px"></span>
      <strong>${d.label}</strong>
    </div>
    ${d.model    ? `<div class="ai-pop-line"><span class="ai-pop-key">模型</span>${d.model}</div>` : ''}
    ${time       ? `<div class="ai-pop-line"><span class="ai-pop-key">检测时间</span>${time}</div>` : ''}
    ${d.lastError? `<div class="ai-pop-line ai-pop-err"><span class="ai-pop-key">原因</span>${d.lastError}</div>` : ''}
  `;

  document.body.appendChild(pop);

  // 定位到状态灯正下方
  const rect = anchorEl.getBoundingClientRect();
  pop.style.top  = `${rect.bottom + 8 + window.scrollY}px`;
  pop.style.left = `${rect.left  + window.scrollX}px`;

  // 点击其他区域关闭
  setTimeout(() => document.addEventListener('click', _closePopover, { once: true }), 0);
}

function _closePopover() {
  document.getElementById('ai-status-popover')?.remove();
}

/* ---- 渲染 chip ---- */
function _render(data) {
  _lastData = data;
  const el = document.getElementById('ai-status-indicator');
  if (!el) return;

  const dot  = DOT_COLOR[data.status] ?? DOT_COLOR.red;
  const time = data.lastCheckedAt
    ? new Date(data.lastCheckedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';

  el.innerHTML = `
    <span class="ai-dot" style="background:${dot}"></span>
    <span class="ai-status-lbl">${data.label || data.status}</span>
    ${data.model ? `<span class="ai-status-model">${data.model}</span>` : ''}
    ${time       ? `<span class="ai-status-time">${time}</span>`        : ''}
  `;
  el.dataset.status = data.status;

  // 非绿灯时显示点击提示箭头
  el.style.cursor = data.status !== 'green' ? 'pointer' : 'default';

  // 上传区警告横幅
  const warn = document.getElementById('ai-status-warning');
  if (warn) warn.style.display = data.status !== 'green' ? '' : 'none';
}

/* ---- 公开接口 ---- */
export async function checkAIStatus() {
  try {
    const data = await api.get('/ai/status');
    _render(data);
    return data;
  } catch (err) {
    _render({
      status:        'red',
      label:         'AI 未上线',
      model:         '',
      lastCheckedAt: new Date().toISOString(),
      lastError:     err.message,
    });
  }
}

export function initAIStatus() {
  checkAIStatus();

  // 非绿灯时点击 chip 弹出详情
  const el = document.getElementById('ai-status-indicator');
  if (!el) return;
  el.addEventListener('click', () => {
    if (_lastData?.status !== 'green') _showPopover(el);
  });
}
