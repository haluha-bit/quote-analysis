'use strict';

/* ================================================================
   pdfTextExtractService.js
   职责：仅负责从文本型 PDF 中提取原始文本，不做任何业务字段判断。
================================================================ */

const fs       = require('fs');
const pdfParse = require('pdf-parse');

/**
 * 从 PDF 文件中提取原始文本。
 * @param {string} filePath  文件绝对路径
 * @returns {Promise<string>}  原始文本（可能为空字符串）
 * @throws {Error}  pdf-parse 内部错误
 */
async function extractText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(buffer);
  return parsed.text ?? '';
}

module.exports = { extractText };
