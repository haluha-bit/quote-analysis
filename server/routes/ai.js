'use strict';

/* ================================================================
   GET /api/ai/status — AI 在线状态探针
   返回 green / yellow / red 三档状态，不暴露 API Key。
================================================================ */

const express = require('express');
const router  = express.Router();
const { requireUser } = require('../middleware/auth');
const { chat }        = require('../services/aiService');

const PING_TIMEOUT_MS = 5_000;
const MODEL           = process.env.AI_MODEL || 'qwen-plus';

router.get('/status', requireUser, async (req, res) => {
  const now    = new Date().toISOString();
  const apiKey = process.env.DASHSCOPE_API_KEY;

  // ---- 红灯：Key 未配置 ----
  if (!apiKey) {
    console.log('[aiStatus] red: missing key');
    return res.json({
      status:        'red',
      label:         'AI 未配置',
      model:         MODEL,
      lastCheckedAt: now,
      lastError:     'DASHSCOPE_API_KEY 未配置',
    });
  }

  // ---- 发起轻量 Ping 请求（5s 超时） ----
  console.log('[aiStatus] checking...');
  try {
    await Promise.race([
      chat('你是状态检测助手，只返回 JSON。', '请只返回 JSON：{"ai_status":"ok"}'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('状态检测超时（5s）')), PING_TIMEOUT_MS)
      ),
    ]);

    // 绿灯：响应成功（内容不重要，有回复即在线）
    console.log('[aiStatus] green');
    return res.json({
      status:        'green',
      label:         'AI 在线',
      model:         MODEL,
      lastCheckedAt: now,
      lastError:     '',
    });
  } catch (err) {
    const msg = err.message || '未知错误';
    console.log('[aiStatus] yellow:', msg);
    return res.json({
      status:        'yellow',
      label:         'AI 异常',
      model:         MODEL,
      lastCheckedAt: now,
      lastError:     msg,
    });
  }
});

module.exports = router;
