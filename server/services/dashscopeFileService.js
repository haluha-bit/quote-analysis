'use strict';

/* ================================================================
   dashscopeFileService.js
   职责：将 PDF 文件上传到 DashScope /files 接口，供 qwen-long 原生解析。
   使用 Node 22 内置 fetch / FormData / Blob，无额外依赖。
================================================================ */

const fs   = require('fs');
const path = require('path');

const UPLOAD_TIMEOUT_MS = 30_000;

function _baseUrl() {
  return (process.env.DASHSCOPE_BASE_URL ||
    'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
}

/**
 * 上传本地 PDF 到 DashScope 文件服务，返回 file_id。
 * @param {string} filePath     服务器上的文件绝对路径
 * @param {string} originalName 原始文件名（供 DashScope 记录，不影响解析）
 * @returns {Promise<string>}   file_id，如 "file-xxxxxxxxxxxx"
 */
async function uploadFile(filePath, originalName) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');

  const buffer = fs.readFileSync(filePath);
  const blob   = new Blob([buffer], { type: 'application/pdf' });
  const form   = new FormData();
  form.append('purpose', 'file-extract');
  form.append('file', blob, originalName || path.basename(filePath));

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${_baseUrl()}/files`, {
      method:  'POST',
      signal:  controller.signal,
      headers: { 'Authorization': `Bearer ${apiKey}` },
      // 不设 Content-Type，让 fetch 自动附加 multipart boundary
      body: form,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('DashScope 文件上传超时（30s）');
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`DashScope 文件上传失败 HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  console.log(`[dashscopeFile] 上传成功 file_id=${data.id} filename=${data.filename}`);
  return data.id;
}

/**
 * 删除 DashScope 上的文件（解析完毕后清理，不抛出异常）。
 * @param {string} fileId
 */
async function deleteFile(fileId) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || !fileId) return;

  try {
    const res = await fetch(`${_baseUrl()}/files/${fileId}`, {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (res.ok) console.log(`[dashscopeFile] 已删除 file_id=${fileId}`);
    else        console.warn(`[dashscopeFile] 删除失败 ${fileId} HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[dashscopeFile] 删除异常 ${fileId}:`, err.message);
  }
}

module.exports = { uploadFile, deleteFile };
