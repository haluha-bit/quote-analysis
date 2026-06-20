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
               示例："浙江田中精机 人民币账户 /RMB Account" → "浙江田中精机"
               不取买方/购方名称

quoteNo        报价单编号，取标识后面的编号值本身（不含标识）
               ✅ 识别以下任意标识（冒号、空格等分隔符后的值就是编号）：
                  Ref: / Ref / Ref No. / Reference / Reference No.
                  Quote No. / Quotation No. / Quotation / Q No.
                  报价单号 / 报价编号 / 编号 / SQ-
               示例（必须遵守）：
                  "Ref: Q2606110"         → quoteNo = "Q2606110"
                  "Quote No.: SQ-2024001" → quoteNo = "SQ-2024001"
                  "Quotation No. QT-0089" → quoteNo = "QT-0089"
               找不到填 ""

quoteDate      报价日期，统一转 YYYY-MM-DD
               ✅ 识别标识：Date: / Date / Quotation Date / 报价日期 / 日期
               · 2026/6/17      → "2026-06-17"
               · 2026.6.17      → "2026-06-17"
               · 2026-6-17      → "2026-06-17"
               · 2026年6月17日  → "2026-06-17"
               · 17.06.2026（欧式 DD.MM.YYYY）→ "2026-06-17"
               找不到或无法解析填 ""

currency       货币代码（¥/RMB/人民币 → CNY；$ → USD；€ → EUR；£ → GBP）；判断不了填 ""

paymentTerms   付款方式（Payment Terms / T/T / 款到发货 / 付款条件 / 月结N天）；找不到填 ""

deliveryMethod 交货/运输方式（Delivery / FOB / CIF / DDP / 快递 / 交货期 / 交货方式）；找不到填 ""

validity       报价有效期（Validity / Valid Until / 有效期）；找不到填 ""

totalAmount    含税总价
               优先级：
               1. 文中有"含税合计 / 含税总价 / Total（含税）/ incl.VAT total"明确标注 → 提取该数值
               2. 文中注明"含X%税"且 items 每行都有 amount → 将 items.amount 累加后填入
               3. 其余情况填 ""
               · 只保留数字和小数点，去掉货币符号和千分号
               · 严禁从页脚、备注、签字区取任何数值

═══ items 提取规则 ═══

items 只来自报价明细表（含 Description/Quantity/Unit Price/Total Price/品名/数量/单价/金额 等列表头的表格）

✅ 必须提取：
  · 货品行 — 有品名或型号，有数量或单价
  · 零件/原材料行
  · 服务项目行（加工费、安装费、服务费等）

❌ 严格禁止提取（以下内容完全忽略，绝对不能进入 items）：
  · 汇总行：Total / Grand Total / Subtotal / 合计 / 总计 / 小计
  · 税额行：VAT / Tax / 增值税 / 税率
  · 运费行：Shipping / Freight / Delivery charge / 运费 / 运输费 / 快递费
  · 签字/审批区：经办人 / 业务部 / 审核 / 批准 / 客户签字 / 制单
                 Prepare / Prepared by / Audit / Approval / Authorized / Customer sign
  · 条款文字：交货期 / 付款条件 / 有效期 / 备注 / 注：
              Payment Terms / Delivery / Validity / Note / Remark
  · 公司落款：地址 / 电话 / 传真 / 银行账户 / 页脚
  · 列标题行：Description / Qty / Unit Price 等字段名单独成行
  · 空行 / 无意义短文本

═══ items 每行字段规则 ═══

每个 item 必须包含以下 7 个字段，找不到填 "":

  itemNo      行号/序号（1、2、01 等）
  model       型号/规格/料号/货号/Part No.
  description 品名/名称/物料描述

              ⚠️ Description 含序号时拆分（序号→itemNo，品名→description）：
                 "1. 齿轮泵" → itemNo="1",  description="齿轮泵"
                 "2. 安全阀" → itemNo="2",  description="安全阀"
                 "1) 减速机" → itemNo="1",  description="减速机"

  qty         数量（只保留数字，不含单位）
  unit        单位（个/台/套/pcs/set/桶 等）

              ⚠️ 数量含单位时拆分：
                 "1个"   → qty="1",  unit="个"
                 "1套"   → qty="1",  unit="套"
                 "10pcs" → qty="10", unit="pcs"
                 "5 台"  → qty="5",  unit="台"

  unitPrice   单价（只保留数字和小数点，去掉货币符号和千分号）
              "5,500.00" → "5500.00"    "¥4,800" → "4800"

  amount      小计金额（只保留数字和小数点，去掉货币符号和千分号）

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

  // Reject template placeholders: tt.mm.jjjj / dd.mm.yyyy / mm/dd/yyyy etc.
  if (/^[a-zA-Z]{2}[./][a-zA-Z]{2}[./][a-zA-Z]{4}$/.test(str)) return '';

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // YYYY-M-D (single digit month/day)
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // YYYY.MM.DD  YYYY/MM/DD  YYYY年MM月DD日
  m = str.match(/^(\d{4})[./年](\d{1,2})[./月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // DD.MM.YYYY or DD/MM/YYYY (欧式，日在前)
  m = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  return str; // 无法识别，原样返回
}

/* ── exclusion filter ─────────────────────────────────────────── */

// 汇总/税/运费 — 英文用单词边界防止误杀型号编码中的子串
const EN_EXCLUDE = /\b(total|subtotal|grand\s+total|vat|tax|shipping|freight|delivery\s+charge)\b/i;
// 汇总/税/运费 — 中文
const ZH_EXCLUDE = ['合计', '总计', '小计', '税', '运费', '运输费', '快递费'];

// 签字/审批/页脚/条款关键词 — 出现即整行排除
const EN_FOOTER = /\b(prepare[sd]?|audit|approval|authorized|authorised|customer\s*sign|remark|note)\b/i;
const ZH_FOOTER = ['经办人', '业务部', '审核', '批准', '客户签字', '制单', '经手人'];

/**
 * 过滤不属于明细行的 item（汇总/税/运费/签字区/页脚/条款/空行）。
 * description + model 合并检查，防止把签字区文字误当型号。
 */
function _filterItems(items) {
  return items.filter(item => {
    if (!item.model && !item.description) return false;

    const desc    = (item.description || '').toLowerCase();
    const combined = ((item.description || '') + ' ' + (item.model || '')).toLowerCase();

    // 汇总/税/运费（只查 description，避免误杀型号如 TOTAL-CONNECTOR）
    if (EN_EXCLUDE.test(desc))                     return false;
    if (ZH_EXCLUDE.some(kw => desc.includes(kw))) return false;

    // 签字/审批/页脚（查 description + model 合并串）
    if (EN_FOOTER.test(combined))                     return false;
    if (ZH_FOOTER.some(kw => combined.includes(kw))) return false;

    // 兜底：qty/unitPrice/amount 全空 → 不是有效产品行（页脚/签名/备注无价格）
    if (!item.qty && !item.unitPrice && !item.amount) return false;

    return true;
  });
}

/* ── totalAmount derivation ───────────────────────────────────── */

/**
 * 确定最终 totalAmount。
 * 优先用 AI 提取值；其次当所有 item 都有有效 amount 时自动求和；否则返回 ""。
 */
function _calcTotalAmount(aiTotal, items) {
  if (aiTotal) return aiTotal;
  if (items.length === 0) return '';

  const nums = items.map(it => parseFloat(it.amount));
  if (nums.some(isNaN)) return '';          // 有缺失值则不求和，避免低估

  const sum = nums.reduce((a, b) => a + b, 0);
  return sum.toFixed(2);
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

/* ── shared post-processing ───────────────────────────────────── */

/**
 * AI 回复文本 → 归一化的 NormalizedQuote 对象。
 * normalize() 和 normalizeFromFileId() 共用此逻辑。
 */
function _processReply(reply, logTag) {
  const parsed = _parseJson(reply);
  if (!parsed) throw new Error('AI 返回内容无法解析为 JSON: ' + reply.slice(0, 120));

  const items       = _items(parsed.items);
  const aiTotal     = _cleanNumber(_str(parsed.totalAmount));
  const totalAmount = _calcTotalAmount(aiTotal, items);

  const result = {
    vendorName:     _cleanVendorName(_str(parsed.vendorName)),
    quoteNo:        _str(parsed.quoteNo),
    quoteDate:      _normalizeDate(_str(parsed.quoteDate)),
    currency:       _str(parsed.currency),
    paymentTerms:   _str(parsed.paymentTerms),
    deliveryMethod: _str(parsed.deliveryMethod),
    validity:       _str(parsed.validity),
    totalAmount,
    items,
  };

  const preview = items.slice(0, 3)
    .map(it => `[${it.itemNo}]${it.description || it.model} qty=${it.qty}${it.unit} price=${it.unitPrice}`)
    .join(' | ');
  console.log(
    `[quoteNormalize/${logTag}] vendor="${result.vendorName}" no="${result.quoteNo}"` +
    ` date="${result.quoteDate}" amount="${result.totalAmount}" items=${items.length}` +
    (items.length ? `\n  前3行: ${preview}` : '')
  );

  return result;
}

/* ── main export ──────────────────────────────────────────────── */

/**
 * 将 PDF 原始文本交给 AI 归一化（原有方案，pdf-parse 提取文本后调用）。
 */
async function normalize(rawText) {
  if (!rawText || !rawText.trim()) return _emptyResult();

  try {
    const text  = rawText.length > 8000 ? rawText.slice(0, 8000) + '\n[文本已截断]' : rawText;
    const reply = await chat(SYSTEM_PROMPT, `请从以下报价单原始文本中提取字段和明细行：\n\n${text}`);
    return _processReply(reply, 'text');
  } catch (err) {
    console.error('[quoteNormalize/text] 失败:', err.message);
    return _emptyResult();
  }
}

/**
 * 用 DashScope file_id 让 qwen-long 原生读取 PDF 并归一化。
 * 比文本提取方案更能保留表格结构。
 *
 * @param {string} fileId  dashscopeFileService.uploadFile() 返回的 file_id
 */
async function normalizeFromFileId(fileId) {
  if (!fileId) return _emptyResult();

  try {
    const userMsg = `fileid://${fileId}\n\n请从上述报价单 PDF 中提取字段和明细行，严格按照系统提示中的 JSON 格式输出。`;
    // qwen-long 支持原生 PDF 解析；60s 超时（文件解析比纯文本慢）
    const reply = await chat(SYSTEM_PROMPT, userMsg, 'qwen-long', 60_000);
    return _processReply(reply, 'file');
  } catch (err) {
    console.error('[quoteNormalize/file] 失败:', err.message);
    return _emptyResult();
  }
}

module.exports = { normalize, normalizeFromFileId, EMPTY_FIELDS };
