'use strict';

/* ================================================================
   aiService.js — 阿里云百炼 API 统一调用入口
   所有 AI 调用必须经过此文件，业务文件不得直接写模型 SDK 调用。

   使用 OpenAI 兼容接口（DashScope）：
     POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions

   必填环境变量：
     DASHSCOPE_API_KEY   阿里云百炼 API Key（禁止硬编码）

   可选环境变量：
     DASHSCOPE_BASE_URL  覆盖 API 基础地址
     AI_MODEL            模型名称（默认 qwen-plus）

   常用模型：qwen-turbo / qwen-plus / qwen-max / qwen-max-latest
================================================================ */

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_MODEL    = 'qwen-plus';
const TIMEOUT_MS       = 30_000;

/**
 * 调用百炼 Chat Completions 接口。
 * 使用 Node 18+ 内置 fetch + AbortController 实现 30 秒超时。
 *
 * @param {string} systemPrompt  系统提示词
 * @param {string} userMessage   用户消息
 * @returns {Promise<string>}    AI 返回的文本内容
 * @throws {Error}  Key 未配置 / 超时 / 网络错误 / 非 200 响应
 */
async function chat(systemPrompt, userMessage) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY 未配置');

  const baseUrl = (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const model   = process.env.AI_MODEL || DEFAULT_MODEL;
  const url     = `${baseUrl}/chat/completions`;

  console.log(`[aiService] → ${model} @ ${url}`);

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      signal:  controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage  },
        ],
        max_tokens:  512,
        temperature: 0,
      }),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('百炼 API 请求超时（30s）');
    throw err;
  }
  clearTimeout(timer);

  console.log(`[aiService] ← HTTP ${response.status}`);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`百炼 API 错误 ${response.status}: ${body.slice(0, 300)}`);
  }

  const data    = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('百炼 API 响应格式异常');
  return content;
}

module.exports = { chat };
