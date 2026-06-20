'use strict';

/* ================================================================
   quoteNormalizeService.js
   职责：组织 prompt，调用 aiService，解析并清洗 AI 返回的 JSON。
   单次调用同时提取 header 字段（7个）和 items 明细数组。
================================================================ */

const { chat } = require('./aiService');

/* ── prompt ───────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `\
你是专业的采购报价单 JSON 提取助手。从 PDF 原始文本中精确提取字段，只返回 JSON，不输出任何其他内容。

═══ 输出结构（所有键必须存在，不得增删）═══

{
  "vendorName":     "",
  "quoteNo":        "",
  "quoteDate":      "",
  "currency":       "",
  "paymentTerms":   "",
  "deliveryMethod": "",
  "validity":       "",
  "totalAmount":    "",
  "items": []
}

═══ Header 字段规则 ═══

vendorName     出具本报价单的供应商/卖方公司全称
               ✅ 正确来源：报价单抬头 Supplier / Vendor / From / 公司名称 / 供方
               ❌ 严格禁止：vendorName 中不得包含任何银行或联系信息
                  · 人民币账户 / RMB Account / 美元账户 / USD Account
                  · Bank Name / Account Name / Account Number / Bank Address / Swift Code
                  · Tel / 电话 / 传真 / 地址 / 联系人
                  遇到以上关键词，必须在该词出现位置截断，只取前面的公司名称本体
               示例（必须严格遵守）：
                  输入："浙江田中精机股份有限公司 人民币账户 /RMB Account ..."
                  输出：vendorName = "浙江田中精机股份有限公司"   ← 只取公司名
               不取买方/购方名称

quoteNo        报价单编号（Quote No. / Quotation No. / Ref No. / SQ- / 报价单号 / 报价编号）
               找不到填 ""

quoteDate      报价日期，统一转 YYYY-MM-DD 格式
               · "2026.6.9" → "2026-06-09"
               · "09.06.2026"（欧式 DD.MM.YYYY）→ "2026-06-09"
               · "2026/6/9" → "2026-06-09"
               · "2026年6月9日" → "2026-06-09"
               找不到填 ""

currency       货币代码（¥/RMB/人民币 → CNY；$ → USD；€ → EUR；£ → GBP）；判断不了填 ""

paymentTerms   付款方式（Payment Terms / T/T / 款到发货 / 付款条件）；找不到填 ""

deliveryMethod 交货/运输方式（Delivery / FOB / CIF / DDP / 快递 / 交货方式）；找不到填 ""

validity       报价有效期（Validity / Valid Until / 有效期）；找不到填 ""

totalAmount    含税总价
               · 仅在文本中有明确"含税"标注时提取（含税 / 含增值税 / incl. VAT / incl. tax / tax included）
               · 只保留数字和小数点，去掉货币符号和千分号
               · 无法确认是否含税，或找不到总价，填 ""
               示例："Total price 含13%税：¥410.00" → "410.00"

═══ items 提取规则 ═══

✅ 必须提取（每一行都不能漏）：
  · 货品行 — 有品名或型号，且有数量或单价
  · 零件/原材料行
  · 服务项目行（加工费、安装费、服务费等）

❌ 严格禁止提取（即使在表格中也必须跳过）：
  · 合计行：Total / Grand Total / Subtotal / 合计 / 总计 / 小计
  · 税额行：VAT / Tax / 增值税 / 税率
  · 运费行：Shipping / Freight / Delivery charge / 运费 / 运输费 / 快递费
  · 列标题行：Description / Material / Part No. / Qty / Unit Price 等字段名单独成行
  · 公司信息行 / 联系方式行 / 备注行 / 空行

═══ items 每行字段规则 ═══

每个 item 必须包含以下 7 个字段，找不到填 "":

  itemNo      行号/序号（1、2、01 等）
  model       型号/规格/料号/货号/Part No.
  description 品名/名称/物料描述
  qty         数量（只保留数字，不含单位）
  unit        单位（个/台/套/pcs/set/桶 等）
  unitPrice   单价（只保留数字和小数点，去掉货币符号和千分号）
  amount      小计金额（只保留数字和小数点，去掉货币符号和千分号）

⚠️ 列分离示例（常见错误场景必须正确处理）：

  PDF 文本              qty     unit    unitPrice   amount
  ─────────────────────────────────────────────────────
  "2桶 ¥5,000.00"  →   "2"     "桶"    "5000.00"   （根据上下文推断）
  "10 pcs $12.50"  →   "10"    "pcs"   "12.50"     （根据上下文推断）
  "¥1,234.56"      →   unitPrice = "1234.56"（去掉 ¥ 和千分号）
  "3天"             →   qty="3" unit="天"

═══ 输出格式 ═══

  · 只输出 JSON 对象，不输出任何其他内容
  · 禁止 markdown 代码块（\`\`\`json ... \`\`\`）
  · 禁止在 JSON 前后添加说明、注释、前缀
  · 所有字段值必须是字符串，不允许数字/null/数组/嵌套对象
  · items 无明细行时输出 []`;

/* ── vendorName cleanup ───────────────────────────────────────── */

// 一旦在 vendorName 中出现这些词，截断到该词之前
const VENDOR_CONTAM = [
  '人民币账户', 'RMB Account', '美元账户', 'USD Account',
  'Bank Name', 'Account Name', 'Account Number', 'Bank Address',
  'Swift Code', 'SWIFT', 'Tel:', 'Tel：', '电话', '地址', '传真', 'Fax',
];

function _cleanVendorName(s) {
  if (!s) return '';
  let result = s.trim();
  for (const kw of VENDOR_CONTAM) {
    const idx = result.indexOf(kw);
    if (idx !== -1) result = result.slice(0, idx);
  }
  // 去掉结尾的空格、斜杠、竖线、逗号、句点
  return result.replace(/[\s/\\|,，。.]+$/, '').trim();
}

/* ── quoteDate normalization ──────────────────────────────────── */

function _normalizeDate(s) {
  if (!s) return '';
  const str = s.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // YYYY.MM.DD  YYYY/MM/DD  YYYY年MM月DD日
  let m = str.match(/^(\d{4})[.\s/年](\d{1,2})[.\s/月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // DD.MM.YYYY or DD/MM/YYYY (欧式，日在前)
  m = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  return str; // 无法识别，原样返回
}

/* ── exclusion filter ─────────────────────────────────────────── */

// 英文用单词边界，防止误杀 SYNTAX-100 / CATALYST 等型号中含的子串
const EN_EXCLUDE = /\b(total|subtotal|grand\s+total|vat|tax|shipping|freight|delivery\s+charge)\b/i;
// 中文子串匹配（无单词边界概念）
const ZH_EXCLUDE = ['合计', '总计', '小计', '税', '运费', '运输费', '快递费'];

/**
 * 过滤不属于明细行的 item（合计/税/运费/列标题/空行）。
 * 仅检查 description，避免在型号编码中产生误判。
 */
function _filterItems(items) {
  return items.filter(item => {
    // 过滤：model 和 description 均为空
    if (!item.model && !item.description) return false;

    const desc = (item.description || '').toLowerCase();

    if (EN_EXCLUDE.test(desc))                         return false;
    if (ZH_EXCLUDE.some(kw => desc.includes(kw)))     return false;

    return true;
  });
}

/* ── field normalizers ───────────────────────────────────────── */

function _str(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/**
 * 二次清洗数值字段：去掉货币符号、千分号、空格。
 * 即使 AI 没严格遵守 prompt，后处理也能修正。
 */
function _cleanNumber(s) {
  if (!s) return '';
  // 去掉货币符号和千分号，保留数字、小数点、负号
  return s.replace(/[¥$€£,\s]/g, '').trim();
}

/**
 * 验证、规范化并过滤 items 数组。
 * 流程：map（字段规范化）→ cleanNumber（数值二次清洗）→ filterItems（排除污染行）
 */
function _items(arr) {
  if (!Array.isArray(arr)) return [];

  const normalized = arr.map(item => ({
    itemNo:      _str(item?.itemNo),
    model:       _str(item?.model),
    description: _str(item?.description),
    qty:         _str(item?.qty),
    unit:        _str(item?.unit),
    unitPrice:   _cleanNumber(_str(item?.unitPrice)),
    amount:      _cleanNumber(_str(item?.amount)),
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

  try { return JSON.parse(text.trim()); } catch (_) {}

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()); } catch (_) {}
  }

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
  totalAmount:    '',
});

function _emptyResult() {
  return { ...EMPTY_FIELDS, items: [] };
}

/* ── main export ──────────────────────────────────────────────── */

/**
 * 将 PDF 原始文本交给 AI 归一化。总是 resolve，任何失败都返回空结构。
 *
 * @param {string} rawText  pdf-parse 提取的原始文本
 * @returns {Promise<{vendorName,quoteNo,quoteDate,currency,paymentTerms,deliveryMethod,validity,items}>}
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

    const result = {
      vendorName:     _cleanVendorName(_str(parsed.vendorName)),
      quoteNo:        _str(parsed.quoteNo),
      quoteDate:      _normalizeDate(_str(parsed.quoteDate)),
      currency:       _str(parsed.currency),
      paymentTerms:   _str(parsed.paymentTerms),
      deliveryMethod: _str(parsed.deliveryMethod),
      validity:       _str(parsed.validity),
      totalAmount:    _cleanNumber(_str(parsed.totalAmount)),
      items:          _items(parsed.items),
    };

    console.log(
      `[quoteNormalize] vendor="${result.vendorName}" no="${result.quoteNo}"` +
      ` date="${result.quoteDate}" amount="${result.totalAmount}" items=${result.items.length}`
    );

    return result;
  } catch (err) {
    console.error('[quoteNormalize] 失败:', err.message);
    return _emptyResult();
  }
}

module.exports = { normalize, EMPTY_FIELDS };
