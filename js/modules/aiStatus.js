/* ================================================================
   aiStatus.js — AI 状态红绿灯（页面加载时探测一次）
================================================================ */

import { api } from '../data/api.js';

// 每种状态对应的圆点颜色
const DOT_COLOR = {
  green:  '#34c759',
  yellow: '#ff9500',
  red:    '#ff3b30',
};

function _render(data) {
  const el = document.getElementById('ai-status-indicator');
  if (!el) return;

  const dot   = DOT_COLOR[data.status] ?? DOT_COLOR.red;
  const time  = data.lastCheckedAt
    ? new Date(data.lastCheckedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
  const err   = (data.status !== 'green' && data.lastError)
    ? `<span class="ai-status-err" title="${data.lastError}">${data.lastError.slice(0, 50)}</span>`
    : '';

  el.innerHTML = `
    <span class="ai-dot" style="background:${dot}"></span>
    <span class="ai-status-lbl">${data.label || data.status}</span>
    ${data.model ? `<span class="ai-status-model">${data.model}</span>` : ''}
    ${time       ? `<span class="ai-status-time">${time}</span>`       : ''}
    ${err}
  `;
  el.dataset.status = data.status;

  // 上传区警告横幅
  const warn = document.getElementById('ai-status-warning');
  if (warn) warn.style.display = data.status !== 'green' ? '' : 'none';
}

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
}
