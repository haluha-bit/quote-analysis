'use strict';

/* ================================================================
   quoteNormalizeService.js
   职责：组织 prompt，调用 aiService，解析 AI 返回的 JSON。
   单次调用同时提取 header 字段（7个）和 items 明细数组。
   不负责文件读取，不负责文件类型判断。
================================================================ */

const { chat } = require('./aiService');

const SYSTEM_PROMPT = `\
你是专业的采购报价单结构化提取助手。供应商格式各不相同，你需要语义理解内容，提取标准字段，返回 JSON。找不到的字段填 ""，找不到明细行则 items 为 []。

返回的 JSON 必须包含以下完整结构（所有键必须存在）：

{
  "vendorName":     "供应商/卖方公司全名。寻找：供应商、供方、Supplier、Vendor、公司名称、From 等标识。",
  "quoteNo":        "报价单编号。寻找：报价单号、Quotation No.、Quote No.、Ref No.、SQ- 开头等。",
  "quoteDate":      "报价日期，格式 YYYY-MM-DD。找不到则 \"\"。",
  "currency":       "货币代码。¥/RMB/人民币→CNY，$→USD，€→EUR，£→GBP。无法判断则 \"\"。",
  "paymentTerms":   "付款方式/付款条件。寻找：Payment Terms、T/T、款到发货等。找不到则 \"\"。",
  "deliveryMethod": "交货/运输方式。寻找：Delivery、FOB、CIF、DDP、快递等。找不到则 \"\"。",
  "validity":       "报价有效期。寻找：Validity、Valid Until、有效期等。找不到则 \"\"。",
  "items": [
    {
      "itemNo":      "行号/序号（如 1、2、01）；找不到则 \"\"",
      "model":       "型号/规格/料号/货号/Part No.；找不到则 \"\"",
      "description": "品名/名称/物料描述；找不到则 \"\"",
      "qty":         "数量，只保留数字；找不到则 \"\"",
      "unit":        "单位（个/台/套/pcs/set 等）；找不到则 \"\"",
      "unitPrice":   "单价，只保留数字和小数点，去掉货币符号和千分号；找不到则 \"\"",
      "amount":      "小计金额，只保留数字和小数点，去掉货币符号和千分号；找不到则 \"\""
    }
  ]
}

items 提取规则：
- 只提取报价明细表格中的正式货品/服务行
- 合计行（Total/合计/总计）、税额行（VAT/税/Tax）、小计行（Subtotal）不作为 item
- 不要把供应商名称、客户名、联系方式等头部信息当成 item
- 每个 item 全部 7 个字段必须存在，找不到的填 ""
- unitPrice / amount 示例："¥1,234.56" → "1234.56"

输出要求：
1. 只返回 JSON 对象，禁止 markdown 代码块，禁止任何说明文字
2. quoteDate 统一 YYYY-MM-DD（例：09.06.2026 → 2026-06-09）
3. vendorName 取发出报价的供应商，不要取买方名称
4. 所有字符串字段找不到时返回 ""，items 找不到时返回 []`;

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
 * 将 PDF 原始文本交给 AI 归一化为结构化报价字段 + 明细行。
 * 总是 resolve，AI 失败时返回全空字段和空 items。
 *
 * @param {string} rawText  pdf-parse 提取的原始文本
 * @returns {Promise<object>}  header 字段 + items 数组
 */
async function normalize(rawText) {
  if (!rawText || !rawText.trim()) return { ...EMPTY_FIELDS, items: [] };

  try {
    const text = rawText.length > 8000
      ? rawText.slice(0, 8000) + '\n[文本已截断]'
      : rawText;

    const reply  = await chat(SYSTEM_PROMPT, `请从以下报价单原始文本中提取字段和明细行：\n\n${text}`);
    const parsed = _parseJson(reply);
    if (!parsed) throw new Error('AI 返回内容无法解析为 JSON: ' + reply.slice(0, 120));

    return {
      vendorName:     _str(parsed.vendorName),
      quoteNo:        _str(parsed.quoteNo),
      quoteDate:      _str(parsed.quoteDate),
      currency:       _str(parsed.currency),
      paymentTerms:   _str(parsed.paymentTerms),
      deliveryMethod: _str(parsed.deliveryMethod),
      validity:       _str(parsed.validity),
      items:          _items(parsed.items),
    };
  } catch (err) {
    console.error('[quoteNormalize] 失败:', err.message);
    return { ...EMPTY_FIELDS, items: [] };
  }
}

/* ── helpers ──────────────────────────────────────────────────── */

function _str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 验证并规范化 items 数组，确保每项都有 7 个字符串字段。
 */
function _items(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => ({
    itemNo:      _str(item?.itemNo),
    model:       _str(item?.model),
    description: _str(item?.description),
    qty:         _str(item?.qty),
    unit:        _str(item?.unit),
    unitPrice:   _str(item?.unitPrice),
    amount:      _str(item?.amount),
  }));
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

  // 2. 提取 markdown 代码块：```json ... ``` 或 ``` ... ```
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
