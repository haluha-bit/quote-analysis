'use strict';

/* ================================================================
   quoteNormalizeService.js
   职责：组织 prompt，把 PDF 原始文本交给 aiService，
         解析 AI 返回的 JSON，确保字段完整。
   不负责文件读取，不负责文件类型判断。
================================================================ */

const { chat } = require('./aiService');

const SYSTEM_PROMPT = `\
你是一个专业的采购报价单结构化提取助手。

不同供应商的报价单格式差异很大，字段名称、位置和表格结构都可能不同。
你的任务是根据语义理解，从报价单原始文本中提取指定字段，返回标准 JSON。
找不到的字段请返回空字符串，不要猜测或补全。

只提取以下 7 个字段：
{
  "vendorName":     "供应商/卖方公司全名（寻找：供应商、供方、制造商、公司名称、Supplier、Vendor、From 等）",
  "quoteNo":        "报价单号/编号（寻找：报价单号、报价编号、Quotation No.、Quote No.、Ref No.、询价单号等）",
  "quoteDate":      "报价日期，统一转为 YYYY-MM-DD 格式，找不到则返回空字符串",
  "currency":       "货币代码：CNY、USD、EUR 或 GBP。根据符号推断（¥/RMB/人民币→CNY，$→USD，€→EUR，£→GBP），无法判断则返回空字符串",
  "paymentTerms":   "付款方式/付款条件（寻找：付款方式、付款条件、Payment Terms、T/T 等），找不到则返回空字符串",
  "deliveryMethod": "交货方式/运输方式（寻找：交货方式、运输方式、Delivery、FOB、CIF、DDP 等），找不到则返回空字符串",
  "validity":       "报价有效期（寻找：有效期、报价有效期、Validity、Valid Until 等），找不到则返回空字符串"
}

严格要求：
1. 只返回 JSON 对象，不输出任何其他内容，不使用 markdown 代码块，不加说明
2. 7 个字段必须全部存在，找不到的字段值必须为 ""（空字符串）
3. 所有字段值必须是字符串类型，不允许 null 或其他类型
4. quoteDate 统一转换为 YYYY-MM-DD 格式（例：09.06.2026 → 2026-06-09）
5. vendorName 优先取发出报价的供应商名称，不要取买方名称`;

const EMPTY_FIELDS = Object.freeze({
  vendorName:     '',
  quoteNo:        '',
  quoteDate:      '',
  currency:       '',
  paymentTerms:   '',
  deliveryMethod: '',
  validity:       '',
});

/**
 * 将 PDF 原始文本交给 AI 归一化为结构化报价字段。
 * 总是 resolve，AI 失败时返回全空字段。
 *
 * @param {string} rawText  pdf-parse 提取的原始文本
 * @returns {Promise<object>}  7 个字段的对象
 */
async function normalize(rawText) {
  if (!rawText || !rawText.trim()) return { ...EMPTY_FIELDS };

  try {
    const text = rawText.length > 8000
      ? rawText.slice(0, 8000) + '\n[文本已截断]'
      : rawText;

    const reply  = await chat(SYSTEM_PROMPT, `请从以下报价单原始文本中提取字段：\n\n${text}`);
    const parsed = _parseJson(reply);
    if (!parsed) throw new Error('AI 返回内容无法解析为 JSON: ' + reply.slice(0, 100));

    return {
      vendorName:     _str(parsed.vendorName),
      quoteNo:        _str(parsed.quoteNo),
      quoteDate:      _str(parsed.quoteDate),
      currency:       _str(parsed.currency),
      paymentTerms:   _str(parsed.paymentTerms),
      deliveryMethod: _str(parsed.deliveryMethod),
      validity:       _str(parsed.validity),
    };
  } catch (err) {
    console.error('[quoteNormalize] 失败:', err.message);
    return { ...EMPTY_FIELDS };
  }
}

function _str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 从 AI 回复中提取 JSON 对象。
 * 依次尝试：直接 parse → markdown 代码块提取 → 首尾花括号截取。
 * 任何路径失败则返回 null（不抛出）。
 */
function _parseJson(text) {
  if (!text) return null;

  // 1. 直接 parse（AI 返回纯 JSON 时最快）
  try { return JSON.parse(text.trim()); } catch (_) {}

  // 2. 提取 markdown 代码块内容：```json ... ``` 或 ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (_) {}
  }

  // 3. 截取第一个 { 到最后一个 }
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }

  return null;
}

module.exports = { normalize, EMPTY_FIELDS };
