'use strict';

/* ================================================================
   fileNormalizeService.js
   职责：根据文件类型决定归一化策略，返回固定结构的 normalized 对象。

   PDF  → pdfTextExtractService → quoteNormalizeService
   其他 → 直接返回空 normalized（不做任何解析尝试）

   始终 resolve，不抛出异常，始终返回完整固定结构。
================================================================ */

const path = require('path');
const { extractText }                    = require('./pdfTextExtractService');
const { normalize, normalizeFromFileId } = require('./quoteNormalizeService');
const { uploadFile, deleteFile }         = require('./dashscopeFileService');

/**
 * 固定 normalized 空结构工厂（每次返回新对象）。
 * @returns {NormalizedQuote}
 */
function emptyNormalized() {
  return {
    vendorName:     '',
    quoteNo:        '',
    quoteDate:      '',
    currency:       '',
    paymentTerms:   '',
    deliveryMethod: '',
    validity:       '',
    totalAmount:    '',
    items:          [],
  };
}

/**
 * 归一化上传的文件。
 * PDF：提取文本 → AI 归一化；其他类型：直接返回空结构。
 * 任何步骤失败都不影响上传成功，始终返回完整 normalized 结构。
 *
 * @param {string} filePath  服务器上的文件绝对路径
 * @param {string} filename  原始文件名（用于判断扩展名）
 * @returns {Promise<NormalizedQuote>}
 */
async function normalizeUpload(filePath, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.pdf') return emptyNormalized();

  // ── 方案A：DashScope 文件接口（qwen-long 原生读取 PDF，保留表格结构）──
  let fileId = null;
  try {
    console.log('[fileNormalize] 尝试 DashScope 文件接口 →', filename);
    fileId         = await uploadFile(filePath, filename);
    const aiFields = await normalizeFromFileId(fileId);
    return { ...aiFields };
  } catch (err) {
    console.warn('[fileNormalize] 文件接口失败，回退文本解析:', err.message);
  } finally {
    if (fileId) deleteFile(fileId);   // 异步清理，不阻塞返回
  }

  // ── 方案B（回退）：pdf-parse 提取文本 → qwen-plus ──
  try {
    const rawText = await extractText(filePath);
    if (!rawText.trim()) {
      console.warn('[fileNormalize] PDF 文本为空（扫描件或加密）:', filename);
      return emptyNormalized();
    }
    const aiFields = await normalize(rawText);
    return { ...aiFields };
  } catch (err) {
    console.error('[fileNormalize] 回退也失败:', filename, err.message);
    return emptyNormalized();
  }
}

module.exports = { normalizeUpload, emptyNormalized };
