/* ================================================================
   Auth Routes — /api/auth
================================================================ */

const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

const DEFAULT_PASSWORD = '123';

function now() { return new Date().toISOString(); }

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { name, password } = req.body ?? {};

  if (!name?.trim())           return res.status(400).json({ error: '请输入姓名' });
  if (password !== DEFAULT_PASSWORD) return res.status(401).json({ error: '密码错误' });

  const db   = getDB();
  const user = name.trim();

  db.prepare(`INSERT OR IGNORE INTO users (name, created_at) VALUES (?, ?)`).run(user, now());
  db.prepare(`INSERT INTO logs (action, user, detail, ts) VALUES ('login', ?, '', ?)`).run(user, now());

  res.json({ name: user });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const user = req.headers['x-user'] || 'anonymous';
  getDB().prepare(`INSERT INTO logs (action, user, detail, ts) VALUES ('logout', ?, '', ?)`).run(user, now());
  res.json({ ok: true });
});

// GET /api/auth/me  — lightweight session check
router.get('/me', (req, res) => {
  const user = req.headers['x-user'];
  res.json({ user: user ?? null });
});

module.exports = router;
