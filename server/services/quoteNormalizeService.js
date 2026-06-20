'use strict';

/* ================================================================
   quoteNormalizeService.js
   职责：组织 prompt，调用 aiService，解析并清洗 AI 返回的 JSON。
   单次调用同时提取 header 字段（7个）和 items 明细数组。
================================================================ */

const { chat } = require('./aiService');

/* ── prompt ───────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `\
你是专业的采购报价单结构化提取助手。你的任务是从 PDF 文本中精确提取字段，返回标准 JSON。字段未找到时填 ""，无明细时 items 为 []。

═══ 输出结构（所有键必须存在）═══

{
  "vendorName":     "供应商/卖方公司全名",
  "quoteNo":        "报价单编号",
  "quoteDate":      "YYYY-MM-DD 格式日期，未找到则 \"\"",
  "currency":       "CNY / USD / EUR / GBP，未找到则 \"\"",
  "paymentTerms":   "付款方式，未找到则 \"\"",
  "deliveryMethod": "交货/运输方式，未找到则 \"\"",
  "validity":       "报价有效期，未找到则 \"\"",
  "items": [
    {
      "itemNo":      "行号/序号（1、2、01 等），未找到则 \"\"",
      "model":       "型号/规格/料号/货号/Part No.，未找到则 \"\"",
      "description": "品名/名称/物料描述，未找到则 \"\"",
      "qty":         "数量，只保留数字，未找到则 \"\"",
      "unit":        "单位（个/台/套/pcs/set 等），未找到则 \"\"",
      "unitPrice":   "单价，只保留数字和小数点，未找到则 \"\"",
      "amount":      "小计金额，只保留数字和小数点，未找到则 \"\""
    }
  ]
}

═══ Header 字段提取规则 ═══

vendorName：优先取发出报价的供应商一方，不取买方名称
quoteDate：统一转换为 YYYY-MM-DD（例：09.06.2026 → 2026-06-09）
currency：根据货币符号推断（¥/RMB/人民币→CNY，$→USD，€→EUR，£→GBP）
寻找标识：供应商/Supplier/Vendor/From/公司名称，报价单号/Quote No./Ref No.，Payment Terms，Delivery/FOB/CIF，Validity/有效期

═══ items 提取规则 ═══

✅ 提取：表格中的正式货品行、零件行、服务项目行（每行必须有品名或型号）

❌ 严禁提取（即使出现在表格中也必须跳过）：
  · 合计/小计/总计行（Total / Subtotal / Grand Total / 合计 / 总计 / 小计）
  · 税额行（VAT / Tax / 增值税 / 税率）
  · 运费/快递行（运费 / 快递费 / Shipping / Freight / Delivery charge）
  · 表格列标题行（Description / Material / Part No. / Qty / Unit Price 等字段名）
  · 备注行、说明行、公司信息行、空白行

═══ 字段格式 ═══

qty / unitPrice / amount：只保留数字和小数点，去掉货币符号和千分号
示例："¥1,234.56" → "1234.56"，"2桶" → "2"（桶归入 unit）
所有字段必须是字符串，不允许数字/null/数组
不允许猜测或补全缺失字段——找不到就填 ""

═══ 输出格式 ═══

只输出 JSON 对象
禁止 markdown 代码块（如 \`\`\`json）
禁止任何说明文字、前缀、后缀`;

/* ── exclusion filter ─────────────────────────────────────────── */

// 英文用单词边界匹配，避免误判 SYNTAX / CATALYST 等型号
const EN_EXCLUDE = /\b(total|subtotal|vat|tax|shipping|freight)\b/i;
// 中文直接子串匹配（中文无单词边界）
const ZH_EXCLUDE = ['合计', '总计', '小计', '税', '运费', '运输费', '快递费'];

/**
 * 过滤不属于明细行的 item（合计/税/运费/列标题/空行）。
 * 只检查 description 字段，避免在 model 编号中产生误判。
 */
function _filterItems(items) {
  return items.filter(item => {
    // 过滤：model 和 description 都为空
    if (!item.model && !item.description) return false;

    const desc = (item.description || '').toLowerCase();

    // 过滤：description 命中英文排除词
    if (EN_EXCLUDE.test(desc)) return false;

    // 过滤：description 命中中文排除词
    if (ZH_EXCLUDE.some(kw => desc.includes(kw))) return false;

    return true;
  });
}

/* ── field normalizers ───────────────────────────────────────── */

function _str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * 验证、规范化并过滤 items 数组。
 * 确保每项都有 7 个字符串字段，过滤掉合计/税/运费等非明细行。
 */
function _items(arr) {
  if (!Array.isArray(arr)) return [];

  const normalized = arr.map(item => ({
    itemNo:      _str(item?.itemNo),
    model:       _str(item?.model),
    description: _str(item?.description),
    qty:         _str(item?.qty),
    unit:        _str(item?.unit),
    unitPrice:   _str(item?.unitPrice),
    amount:      _str(item?.amount),
  }));

  return _filterItems(normalized);
}

/* ── JSON extraction ──────────────────────────────────────────── */

/**
 * 从 AI 回复中提取 JSON 对象。
 * 依次尝试：直接 parse → markdown 代码块提取 → 首尾花括号截取。
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

/* ── empty fallback ───────────────────────────────────────────── */

const EMPTY_FIELDS = Object.freeze({
  vendorName:     '',
  quoteNo:        '',
  quoteDate:      '',
  currency:       '',
  paymentTerms:   '',
  deliveryMethod: '',
  validity:       '',
});

function _emptyResult() {
  return { ...EMPTY_FIELDS, items: [] };
}

/* ── main export ──────────────────────────────────────────────── */

/**
 * 将 PDF 原始文本交给 AI 归一化为结构化报价字段 + 明细行。
 * 总是 resolve，任何失败都返回空字段和空 items。
 *
 * @param {string} rawText  pdf-parse 提取的原始文本
 * @returns {Promise<object>}  { vendorName, ..., items: [...] }
 */
async function normalize(rawText) {
  if (!rawText || !rawText.trim()) return _emptyResult();

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
    return _emptyResult();
  }
}

module.exports = { normalize, EMPTY_FIELDS };
