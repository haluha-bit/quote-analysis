/* ================================================================
   extractor.js — Rule-Based Quote File Parser

   Public API:  parseFile(file) → Promise<Quote | ErrorResult>

   Pure functions only. No DOM writes. No UI side effects.
   Supports: PDF (.pdf) | Excel (.xlsx .xls) | Word (.docx .doc)

   ── Example Input ─────────────────────────────────────────────
   const result = await parseFile(file);   // file from <input> or drag

   ── Example Output (success) ──────────────────────────────────
   {
     id:            "a3f2c1d4-...",
     supplier:      "ABC机械设备有限公司",
     delivery_time: "45天",
     quote_date:    "2024-01-15",
     quote_id:      "QT-2024-001",
     total_amount:  110000,
     currency:      "CNY",
     items: [
       { name:"打Pin机", qty:1, unit_price:50000, total:50000, type:"hardware" },
       { name:"调试费",  qty:1, unit_price:10000, total:10000, type:"labor"    }
     ],
     raw_text: "报价单\n供应商：ABC机械设备有限公司\n..."
   }

   ── Example Output (failure) ──────────────────────────────────
   { success: false, error: "文件解析失败：PDF 格式损坏" }

================================================================ */


/* ================================================================
   SECTION 1 — JSDoc Types
================================================================ */

/**
 * @typedef {"hardware"|"labor"|"other"} ItemType
 *
 * @typedef {Object} QuoteItem
 * @property {string}   name
 * @property {number}   qty
 * @property {number}   unit_price
 * @property {number}   total
 * @property {ItemType} type
 *
 * @typedef {Object} Quote
 * @property {string}      id
 * @property {string}      supplier
 * @property {string}      delivery_time
 * @property {string}      quote_date        YYYY-MM-DD
 * @property {string}      quote_id
 * @property {number}      total_amount
 * @property {"CNY"}       currency
 * @property {QuoteItem[]} items
 * @property {string}      raw_text
 *
 * @typedef {Object} ErrorResult
 * @property {false}  success
 * @property {string} error
 */


/* ================================================================
   SECTION 2 — Utilities
================================================================ */

function uuid() {
  return crypto.randomUUID?.() ??
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Strip currency symbols, commas, spaces — return float.
 * @param {any} raw
 * @returns {number}
 */
function cleanNumber(raw) {
  if (raw == null || raw === '') return 0;
  const s = String(raw).replace(/[,，\s¥￥$€£]/g, '').trim();
  return parseFloat(s) || 0;
}

/**
 * Normalize any recognized date string to YYYY-MM-DD.
 * Handles: YYYY-MM-DD | YYYY/MM/DD | YYYY.MM.DD | DD.MM.YYYY | DD/MM/YYYY
 * @param {string} str
 * @returns {string}
 */
function normalizeDate(str) {
  if (!str) return '';
  str = str.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // YYYY-M-D  (single-digit month or day — avoid new Date() timezone shift)
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // YYYY/MM/DD  or  YYYY.MM.DD
  m = str.match(/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;

  // DD.MM.YYYY  (dot separator — European format, day always first)
  m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;

  // DD/MM/YYYY or MM/DD/YYYY (slash separator) — disambiguate by segment value:
  // if the second segment > 12 it must be a day → first is month (MM/DD/YYYY)
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    if (parseInt(b, 10) > 12)
      return `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;  // MM/DD/YYYY
    return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;    // DD/MM/YYYY
  }

  // Last resort: JS Date
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return str;
}

/**
 * Classify an item by its name.
 * @param {string} name
 * @returns {ItemType}
 */
function classifyItem(name) {
  if (!name) return 'other';
  const lower = name.toLowerCase();

  const LABOR = [
    '人工', '劳务', '工时', '工费', '人员', '工资',
    '安装', '调试', '培训', '维修', '服务',
    'labor', 'labour', 'manpower', 'installation',
    'commissioning', 'training', 'service',
  ];
  const HARDWARE = [
    '硬件', '材料', '物料', '零件', '部件', '配件',
    '设备', '机器', '模具', '元件', '芯片', '传感',
    'hardware', 'material', 'part', 'component',
    'equipment', 'module', 'sensor', 'board',
  ];

  if (LABOR.some(k => lower.includes(k)))    return 'labor';
  if (HARDWARE.some(k => lower.includes(k))) return 'hardware';
  return 'other';
}


/* ================================================================
   SECTION 3 — Field Extractors  (work on raw text string)
================================================================ */

/**
 * Try a list of regex patterns; return first capture group match.
 * @param {string}   text
 * @param {RegExp[]} patterns
 * @returns {string}
 */
function tryPatterns(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

/**
 * Last-resort supplier: scan the document header (before any "Customer name" line)
 * for a company-like name. Handles quotations where the supplier appears in the
 * letterhead without an explicit label.
 * @param {string} text @returns {string}
 */
function extractSupplierFallback(text) {
  // Limit search to text before the customer-name field starts
  const custIdx = text.search(
    /customer\s*name\s*[：:\s]|客户名称\s*[：:\s]|买方\s*[：:]|\bTo\s*[：:]\s*\S/i
  );
  const header  = custIdx > 20 ? text.slice(0, custIdx) : text.slice(0, 600);

  // Chinese company suffix — require specific type to avoid matching pronouns like "贵公司"/"我们公司"
  const zh = header.match(/([^\n,，:：\t\r]{2,30}(?:有限公司|有限责任公司|股份有限公司|商贸公司|贸易公司|科技公司|自动化公司|机械公司|技术公司|设备公司|电子公司|材料公司|制造公司|工业公司|建设公司|服务公司|发展公司|信息公司|集团公司))/);
  if (zh?.[1]) return zh[1].trim();

  // English company suffix (capital-letter start, avoids matching mid-sentence)
  const en = header.match(/([A-Z][A-Za-z\s\(\)&\-]{4,60}(?:Co\.\s*,?\s*Ltd\.?|Technology\s+Co|Industrial\s+Co|Systems?\s+Co|Co\.,\s*Ltd))/);
  if (en?.[1]) return en[1].trim();

  return '';
}

/** @param {string} text @returns {string} */
function extractSupplier(text) {
  return tryPatterns(text, [
    // Chinese — specific label first, colon required; ,? absorbs CSV column separator
    /供\s*应\s*商\s*名\s*称\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /供\s*应\s*商\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /供\s*方\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /甲\s*方\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /制\s*造\s*商\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    // "公司名称：" often appears in the supplier's bank-info footer
    /公\s*司\s*名\s*称\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    // Chinese — pure CSV label-only cell (no colon), value in next cell
    /供\s*应\s*商\s*名\s*称\s*,\s*([^\n,，\t\r]{2,40})/i,
    /供\s*应\s*商\s*,\s*([^\n,，\t\r]{2,40})/i,
    // English — more-specific labels first so "Supplier Name" beats "Supplier"
    /Supplier\s+Name\s*[：:,]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /Vendor\s+Name\s*[：:,]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /Supplier\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /Vendor\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    // English — CSV-only (no colon, comma is the separator)
    /Supplier\s*,\s*([^\n,，\t\r]{2,40})/i,
    /Vendor\s*,\s*([^\n,，\t\r]{2,40})/i,
    /Manufacturer\s*[：:,]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /Sold\s+By\s*[：:,]\s*,?\s*([^\n,，\t\r]{2,40})/i,
    /From\s*[：:]\s*,?\s*([^\n,，\t\r]{2,40})/i,
  ]) || extractSupplierFallback(text);
}

/** @param {string} text @returns {string} */
function extractDeliveryTime(text) {
  return tryPatterns(text, [
    /交\s*期\s*[：:]\s*([^\n,，\t\r]{1,30})/i,
    /交\s*货\s*期?\s*[：:]\s*([^\n,，\t\r]{1,30})/i,
    /货\s*期\s*[：:]\s*([^\n,，\t\r]{1,30})/i,
    /Lead\s*Time\s*[：:]\s*([^\n,，\t\r]{1,30})/i,
    /Delivery\s*(?:Time|Date|Period)?\s*[：:]\s*([^\n,，\t\r]{1,30})/i,
    /Leadtime\s*[：:]\s*([^\n,，\t\r]{1,30})/i,
  ]);
}

/** @param {string} text @returns {string} */
function extractQuoteDate(text) {
  // Prefer: date near date-related keyword
  const fromKeyword = tryPatterns(text, [
    /(?:报价日期|报价时间)\s*[：:\s]\s*(\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2})/i,
    /(?:Quote\s*Date|Date\s*of\s*Quote|Quotation\s*Date)\s*[：:\s]\s*(\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2})/i,
    /(?:日期|Date)\s*[：:\s]\s*(\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2})/i,
    // "Quotation Number/Date : SQ20260615001 2026-6-15" — case-insensitive, YYYY or DD.MM.YYYY
    /Quotation\s*(?:Number|No\.?)\s*[\/]?\s*Date\s*[：:]\s*[A-Za-z]\S*\s+(\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2})/i,
    /Quotation\s*(?:Number|No\.?)\s*[\/]?\s*Date\s*[：:]\s*[A-Za-z]\S*\s+(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4})/i,
    /(?:报价日期|报价时间)\s*[：:\s]\s*(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4})/i,
    /(?:Date)\s*[：:\s]\s*(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4})/i,
  ]);
  if (fromKeyword) return normalizeDate(fromKeyword);

  // Fallback: any YYYY-style date
  const m1 = text.match(/\b(\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2})\b/);
  if (m1) return normalizeDate(m1[1]);
  const m2 = text.match(/\b(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4})\b/);
  if (m2) return normalizeDate(m2[1]);

  return '';
}

/** @param {string} text @returns {string} */
function extractQuoteId(text) {
  return tryPatterns(text, [
    // Chinese — colon required; ,? absorbs CSV column separator
    /报\s*价\s*单\s*号\s*[：:]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    // "Quotation Number/Date : SQ20260615001" — case-insensitive, allow newline before value
    /Quotation\s*(?:Number|No\.?)\s*[\/]?\s*Date\s*[：:]\s*([A-Za-z][A-Za-z0-9\-_\/\.]*\d[A-Za-z0-9\-_\/\.]*)/i,
    /报\s*价\s*编\s*号\s*[：:]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /单\s*号\s*[：:]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    // Chinese — CSV label-only cell (no colon)
    /报\s*价\s*单\s*号\s*,\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    // English — more specific labels first
    /Quotation\s*Number\s*[：:,]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /Quotation\s*No\.?\s*[：:,]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /Quote\s*Number\s*[：:,]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /Quote\s*No\.?\s*[：:,]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /Quote\s*ID\s*[：:,]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /RFQ\s*(?:No\.?|#|Number)?\s*[：:,]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /Ref(?:erence)?\s*No\.?\s*[：:,]\s*,?\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    // bare "Ref :" label without "No." (e.g. LPMS format "Ref : Q2606110")
    /\bRef\.?\s*[：:\s]\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    // English — CSV-only (comma is separator, no colon in label cell)
    /Quotation\s*Number\s*,\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /Quote\s*No\.?\s*,\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
    /RFQ\s*No\.?\s*,\s*([A-Za-z0-9\-_\/\.]{3,40})/i,
  ]);
}

/**
 * Extract total amount from raw text as a fallback when no items are parsed.
 * Collects all keyword-anchored amounts and returns the largest one, since
 * the grand total is typically the biggest number on a summary line.
 * Handles both same-cell ("合计：98000") and CSV ("合计,,,98000") formats.
 * @param {string} text @returns {number}
 */
function extractTotalAmount(text) {
  const candidates = [
    /合\s*计\s*[：:\s]*([\d,，]+\.?\d*)/i,
    /总\s*(?:金\s*)?额\s*[：:\s]*([\d,，]+\.?\d*)/i,
    /应付\s*(?:金额)?\s*[：:\s]*([\d,，]+\.?\d*)/i,
    /Grand\s*Total\s*[：:\s$£¥￥]*([\d,，]+\.?\d*)/i,
    /Total\s*Amount\s*[：:\s$£¥￥]*([\d,，]+\.?\d*)/i,
    /Total\s*[：:\s$£¥￥]*([\d,，]+\.?\d*)/i,
    /Amount\s*Due\s*[：:\s$£¥￥]*([\d,，]+\.?\d*)/i,
    /RMB\s*([\d,，]+\.?\d*)/i,
    /[¥￥]\s*([\d,，]{4,}\.?\d*)/,
    // number before CNY (e.g. ARBURG "133,000.00 CNY")
    /([\d,，]{4,}\.?\d*)\s*CNY\b/i,
    // VAT-inclusive total (e.g. "Total value with VAT : ¥25,653.83")
    /Total\s+value\s+with\s+VAT\s*[：:\s¥￥£$]*([\d,，]+\.?\d*)/i,
    /含税\s*合计\s*[：:\s]*([\d,，]+\.?\d*)/i,
    /含税\s*总[价额]\s*[：:\s]*([\d,，]+\.?\d*)/i,
  ];

  const found = [];
  for (const re of candidates) {
    // matchAll to catch every occurrence (e.g. multiple Grand Total lines)
    for (const m of (text.matchAll(new RegExp(re.source, re.flags + 'g')) ?? [])) {
      if (m[1]) {
        const v = cleanNumber(m[1]);
        if (v > 0) found.push(v);
      }
    }
  }
  // Grand total is typically the largest among all matched summary amounts
  return found.length > 0 ? Math.max(...found) : 0;
}

/* ================================================================
   SECTION 3b — Confidence Scoring
   Each function returns { score: 0–1, source: string }
================================================================ */

const _SUPPLIER_EXPLICIT = [
  /供\s*应\s*商[^：:\n]{0,5}[：:]/i, /供\s*方\s*[：:]/i, /甲\s*方\s*[：:]/i,
  /制\s*造\s*商\s*[：:]/i, /公\s*司\s*名\s*称\s*[：:]/i,
  /Supplier\s*[：:,]/i, /Vendor\s*[：:,]/i, /Manufacturer\s*[：:,]/i,
  /Sold\s+By\s*[：:,]/i, /From\s*[：:]/i,
];

function _confSupplier(text, value) {
  if (!value) return { score: 0, source: '' };
  if (_SUPPLIER_EXPLICIT.some(re => re.test(text))) return { score: 0.88, source: '明确标注' };
  return { score: 0.58, source: '公司名识别' };
}

function _confQuoteId(value, fromText) {
  if (!value) return { score: 0, source: '' };
  return fromText
    ? { score: 0.88, source: '单据标注' }
    : { score: 0.60, source: '文件名' };
}

const _DATE_KEYWORD = [
  /报价日期|报价时间/i,
  /Quote\s*Date|Quotation\s*Date|Date\s*of\s*Quote/i,
  /Quotation\s*(?:Number|No\.?)[^:\n]*Date/i,
];

function _confQuoteDate(text, value) {
  if (!value) return { score: 0, source: '' };
  if (_DATE_KEYWORD.some(re => re.test(text))) return { score: 0.92, source: '日期字段' };
  return { score: 0.65, source: '日期识别' };
}

function _confTotal(textTotal, itemsTotal, finalTotal) {
  if (!finalTotal) return { score: 0, source: '' };
  if (textTotal > 0) return { score: 0.92, source: '金额标注' };
  return { score: 0.72, source: '明细合计' };
}

function _confDelivery(value) {
  if (!value) return { score: 0, source: '' };
  return { score: 0.78, source: '交期字段' };
}

/** @param {string} text @returns {string} */
function extractCurrency(text) {
  if (/[¥￥]|CNY|RMB|人民币/.test(text)) return 'CNY';
  if (/USD|\$/.test(text))               return 'USD';
  if (/EUR|€/.test(text))               return 'EUR';
  return 'CNY';
}


/* ================================================================
   SECTION 4 — Items Extraction
================================================================ */

/** Column header synonyms — order = priority (first match wins) */
const COL_HEADERS = {
  name:       ['名称', '品名', '物料', '设备名', '项目', '描述', 'name', 'description', 'item', 'part'],
  qty:        ['数量', '台数', '件数', 'qty', 'quantity', 'count', 'pcs', 'ea'],
  unit_price: ['单价', '单位价格', '报价单价', '含税单价', 'unit price', 'unit_price', 'price'],
  total:      ['含税金额', '含税总价', '含税价', '金额', '总价', '小计', '总额', '合计金额', '价格合计', 'total', 'amount', 'subtotal'],
};

/**
 * Find the column index in a header row that best matches a field.
 * @param {any[]} headerRow
 * @param {string[]} fieldKeys  ordered by priority
 * @returns {number}  -1 if not found
 */
function findColIndex(headerRow, fieldKeys) {
  for (const key of fieldKeys) {
    const idx = headerRow.findIndex(h =>
      String(h ?? '').toLowerCase().includes(key.toLowerCase())
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse items from an array-of-arrays (output of SheetJS sheet_to_json {header:1}).
 * Finds the header row automatically.
 * @param {any[][]} rows
 * @returns {QuoteItem[]}
 */
function parseItemsFromRows(rows) {
  if (!rows || rows.length < 2) return [];

  // Find header row: must have name column + at least one numeric column keyword
  let headerIdx = -1;
  let colMap = { name: -1, qty: -1, unit_price: -1, total: -1 };

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const tentativeName = findColIndex(row, COL_HEADERS.name);
    const tentativeNum  = findColIndex(row, [...COL_HEADERS.qty, ...COL_HEADERS.unit_price, ...COL_HEADERS.total]);

    if (tentativeName !== -1 && tentativeNum !== -1) {
      colMap.name       = tentativeName;
      colMap.qty        = findColIndex(row, COL_HEADERS.qty);
      colMap.unit_price = findColIndex(row, COL_HEADERS.unit_price);
      colMap.total      = findColIndex(row, COL_HEADERS.total);
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1 || colMap.name === -1) return [];

  const items = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === '' || c == null)) continue;

    const rawName = String(row[colMap.name] ?? '').trim();
    if (!rawName) continue;
    if (/^合计|^小计|^total|^grand|^subtotal/i.test(rawName)) break;
    if (/^\d+$/.test(rawName)) continue;   // sequence number cell

    const qty        = colMap.qty        >= 0 ? cleanNumber(row[colMap.qty])        : 1;
    const unit_price = colMap.unit_price >= 0 ? cleanNumber(row[colMap.unit_price]) : 0;
    const rawTotal   = colMap.total      >= 0 ? cleanNumber(row[colMap.total])      : 0;
    const total      = rawTotal || (qty * unit_price);

    items.push({
      name:       rawName,
      qty:        qty || 1,
      unit_price,
      total,
      type:       classifyItem(rawName),
    });
  }

  return items;
}

/**
 * Parse items from flat text (PDF / Word) using positional heuristics.
 * Strategy: locate a header line, then parse tabular lines below it.
 * @param {string} text
 * @returns {QuoteItem[]}
 */
function parseItemsFromText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const NAME_KWS = ['名称', '品名', '项目', '物料', '材料', 'name', 'item', 'description', 'material'];
  const NUM_KWS  = ['数量', 'qty', '单价', 'price', '金额', 'total', 'amount', 'sales'];

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (NAME_KWS.some(k => lower.includes(k)) && NUM_KWS.some(k => lower.includes(k))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return [];

  const items = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    if (/^合计|^小计|^总\s*[计价]|^Total|^Grand|^Amount\s*Due|^VAT|^税/i.test(rawLine)) break;

    // Strip leading sequence number so it doesn't block name extraction
    let line = rawLine.replace(/^\d+\s+/, '');
    if (!line) continue;

    // Skip a leading part-number / model-number token (e.g. "C035565-00", "SEN-2A-X")
    // so the actual description that follows becomes the item name.
    // Only strip when the token contains a digit (distinguishes codes from short names)
    // and is immediately followed by Chinese or alphabetic text.
    line = line.replace(/^([A-Za-z][A-Za-z0-9\-_\/\.]*\d[A-Za-z0-9\-_\/\.]*)\s+(?=[一-龥一-鿿a-zA-Z])/, '');

    // ¥-prefixed amounts are the most reliable price signals
    const currencyAmounts = [...line.matchAll(/[¥￥]([\d,，]+\.?\d*)/g)]
      .map(m => cleanNumber(m[1])).filter(n => n > 0);

    // All positive numbers (fallback)
    const allNums = [...line.matchAll(/[\d,，]+\.?\d*/g)]
      .map(m => cleanNumber(m[0])).filter(n => n > 0);
    if (allNums.length < 2 && currencyAmounts.length < 1) continue;

    // Name: text before the first digit or currency char
    const firstNumPos = line.search(/[\d¥￥]/);
    const namePart = firstNumPos > 0
      ? line.slice(0, firstNumPos).replace(/[^一-龥a-zA-Z0-9\s\-_\/\(\)·]/g, '').trim()
      : '';
    if (!namePart || namePart.length < 2) continue;
    if (/^\d+$/.test(namePart)) continue;

    let qty, unit_price, total;

    if (currencyAmounts.length >= 2) {
      unit_price = currencyAmounts[currencyAmounts.length - 2];
      total      = currencyAmounts[currencyAmounts.length - 1];
      // Qty: look before the first ¥ sign, after stripping formula chains (e.g. 8*3*1)
      const firstCurrPos = Math.max(line.indexOf('¥'), line.indexOf('￥'));
      const preAmt = firstCurrPos > 0 ? line.slice(0, firstCurrPos) : line;
      const preNoFormulas = preAmt.replace(/\d+(?:[*×\/]\d+)+/g, '');
      const qtyNums = [...preNoFormulas.matchAll(/\b(\d{1,4})\b/g)]
        .map(m => parseInt(m[1])).filter(n => n > 0);
      qty = qtyNums[qtyNums.length - 1] || 1;
    } else {
      // No ¥ prefix — position heuristic
      qty        = (allNums[0] <= 9999 && Number.isInteger(allNums[0])) ? allNums[0] : 1;
      unit_price = allNums.length >= 3 ? allNums[allNums.length - 2] : allNums[0];
      total      = allNums[allNums.length - 1];
    }

    items.push({
      name:       namePart,
      qty:        qty || 1,
      unit_price: unit_price || 0,
      total:      total || (qty || 1) * (unit_price || 0),
      type:       classifyItem(namePart),
    });
  }

  return items;
}


/* ================================================================
   SECTION 5 — File-Type Parsers
================================================================ */

/** Configure pdf.js worker (idempotent) */
function ensurePDFWorker() {
  if (typeof pdfjsLib === 'undefined') return;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}

/**
 * Extract text from a PDF file, preserving line structure via y-position grouping.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function textFromPDF(file) {
  if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js 未加载，请检查 CDN 连接');

  ensurePDFWorker();

  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  let fullText = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group text items by y-position (rounded to 4px grid) to restore line breaks
    const byY = new Map();
    for (const item of content.items) {
      const y = Math.round(item.transform[5] / 4) * 4;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item.str);
    }

    // Sort descending (higher y = top of page in PDF coordinate space)
    const sorted = [...byY.entries()].sort((a, b) => b[0] - a[0]);
    fullText += sorted.map(([, tokens]) => tokens.join(' ')).join('\n') + '\n\n';
  }

  return fullText;
}

/**
 * Score a sheet's rows for likelihood of containing an item table.
 * @param {any[][]} rows
 * @returns {number}
 */
function scoreSheetForItems(rows) {
  let score = 0;
  for (const row of rows.slice(0, 25)) {
    const lower = row.map(c => String(c ?? '').toLowerCase()).join(' ');
    if (COL_HEADERS.name.some(k => lower.includes(k)))       score += 3;
    if (COL_HEADERS.qty.some(k => lower.includes(k)))        score += 2;
    if (COL_HEADERS.unit_price.some(k => lower.includes(k))) score += 2;
    if (COL_HEADERS.total.some(k => lower.includes(k)))      score += 2;
  }
  return score;
}

/**
 * Extract text and best-candidate item rows from an Excel file.
 * Evaluates all sheets and selects the one most likely to have item data.
 * @param {File} file
 * @returns {Promise<{text: string, rows: any[][]}>}
 */
async function dataFromExcel(file) {
  if (typeof XLSX === 'undefined') throw new Error('SheetJS 未加载，请检查 CDN 连接');

  const buffer = await file.arrayBuffer();
  const wb     = XLSX.read(buffer, { type: 'array', cellDates: true, cellText: false });

  let combinedText = '';
  let bestRows     = [];
  let bestScore    = 0;

  for (const sheetName of wb.SheetNames) {
    const ws  = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    combinedText += csv + '\n';

    const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const score = scoreSheetForItems(rows);
    if (score > bestScore) { bestScore = score; bestRows = rows; }
  }

  return { text: combinedText, rows: bestRows };
}

/**
 * Load mammoth.js on demand and extract raw text from a Word file.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function textFromWord(file) {
  if (typeof mammoth === 'undefined') {
    await new Promise((resolve, reject) => {
      // Use loadMammoth helper if available (set up in index.html), else inject directly
      if (typeof window.loadMammoth === 'function') {
        window.loadMammoth(resolve);
      } else {
        const s  = document.createElement('script');
        s.src    = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
        s.onload  = resolve;
        s.onerror = () => reject(new Error('mammoth.js 加载失败，请检查网络连接'));
        document.head.appendChild(s);
      }
    });
  }

  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}


/* ================================================================
   SECTION 6 — Public API
================================================================ */

const SUPPORTED_EXTENSIONS = ['pdf', 'xlsx', 'xls', 'docx', 'doc'];

/**
 * Assemble a Quote object from extracted field values.
 * @param {object}  fields
 * @param {string}  rawText
 * @returns {Quote}
 */
function buildQuote(fields, rawText) {
  return {
    id:            uuid(),
    supplier:      fields.supplier      ?? '',
    delivery_time: fields.delivery_time ?? '',
    quote_date:    fields.quote_date    ?? '',
    quote_id:      fields.quote_id      ?? '',
    total_amount:  fields.total_amount  ?? 0,
    currency:      fields.currency      ?? 'CNY',
    items:         fields.items         ?? [],
    raw_text:      rawText,
  };
}

/**
 * Parse a File object and return a structured Quote.
 *
 * On success: returns a Quote object (no `success` field).
 * On failure: returns { success: false, error: string }.
 *
 * Usage:
 *   const result = await parseFile(file);
 *   if (result.success === false) { handleError(result.error); return; }
 *   // result is a Quote
 *
 * @param {File} file
 * @returns {Promise<Quote | ErrorResult>}
 */
function _quoteIdFromFilename(filename) {
  const stem = (filename || '').replace(/\.[^.]+$/, '');
  // Match letter-prefix + 6+ digits optionally followed by -/./digit suffix
  // Use [^A-Za-z] boundary instead of \b so _ separators work too
  const m = stem.match(/(?:^|[^A-Za-z])([A-Za-z]{1,6}\d{6,}(?:[-\/\.]\d+)?)/);
  return m ? m[1] : '';
}

export async function parseFile(file) {
  // ── Guard: no file
  if (!file || !(file instanceof File)) {
    return { success: false, error: '未提供有效文件对象' };
  }

  // ── Guard: unsupported extension
  const ext = file.name.split('.').pop().toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return { success: false, error: `不支持的文件格式：.${ext}。请上传 PDF、Excel 或 Word 文件` };
  }

  // ── Guard: empty file
  if (file.size === 0) {
    return { success: false, error: `文件「${file.name}」为空，无法解析` };
  }

  try {
    let rawText = '';
    let items   = [];

    // ── Step 1: extract text (and rows for Excel)
    if (ext === 'pdf') {
      rawText = await textFromPDF(file);
      items   = parseItemsFromText(rawText);

    } else if (ext === 'xlsx' || ext === 'xls') {
      const { text, rows } = await dataFromExcel(file);
      rawText = text;
      // Prefer row-based parsing for Excel; fall back to text heuristics
      items = parseItemsFromRows(rows);
      if (items.length === 0) items = parseItemsFromText(rawText);

    } else if (ext === 'docx' || ext === 'doc') {
      rawText = await textFromWord(file);
      items   = parseItemsFromText(rawText);
    }

    // ── Step 2: guard against completely empty parse
    if (!rawText.trim()) {
      return { success: false, error: `文件「${file.name}」无法提取文本内容，可能是扫描件或加密文件` };
    }

    console.debug('[Extractor] parsed items:', items);

    // ── Step 3: extract fields from raw text
    const itemsTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);
    const textTotal  = extractTotalAmount(rawText);
    const total_amount = textTotal > 0 && itemsTotal > 0
      ? Math.max(textTotal, itemsTotal)
      : textTotal || itemsTotal;

    const quoteIdFromText = extractQuoteId(rawText);
    const quoteIdFromName = quoteIdFromText ? '' : _quoteIdFromFilename(file.name);

    const supplier      = extractSupplier(rawText);
    const delivery_time = extractDeliveryTime(rawText);
    const quote_date    = extractQuoteDate(rawText);
    const quote_id      = quoteIdFromText || quoteIdFromName;

    const fields = {
      supplier, delivery_time, quote_date, quote_id,
      total_amount, currency: extractCurrency(rawText), items,
    };

    const quote = buildQuote(fields, rawText);

    // Attach confidence metadata (used by UI for badge display)
    quote._confidence = {
      supplier:      _confSupplier(rawText, supplier),
      quote_id:      _confQuoteId(quote_id, !!quoteIdFromText),
      quote_date:    _confQuoteDate(rawText, quote_date),
      total_amount:  _confTotal(textTotal, itemsTotal, total_amount),
      delivery_time: _confDelivery(delivery_time),
    };

    return quote;

  } catch (err) {
    console.error('[Extractor] Parse failed:', file.name, err);

    const friendlyMessages = {
      'pdf.js': 'PDF 解析失败，文件可能已损坏或被加密',
      'SheetJS': 'Excel 解析失败，请确认文件未损坏',
      'mammoth': 'Word 解析失败，仅支持 .docx 格式',
    };

    const knownKey = Object.keys(friendlyMessages).find(k => err.message?.includes(k));
    const errorMsg = knownKey
      ? friendlyMessages[knownKey]
      : (err.message || '未知错误，请检查文件格式后重试');

    return { success: false, error: errorMsg };
  }
}
