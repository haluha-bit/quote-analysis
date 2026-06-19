/* ================================================================
   Suppliers Routes — /api/suppliers
================================================================ */

const express = require('express');
const router  = express.Router();
const { getDB }       = require('../db');
const { requireUser } = require('../middleware/auth');
const { v4: uuid }    = require('uuid');

function now() { return new Date().toISOString(); }

// GET /api/suppliers
router.get('/', requireUser, (req, res) => {
  const rows = getDB()
    .prepare('SELECT * FROM suppliers ORDER BY name ASC')
    .all();
  res.json(rows);
});

// POST /api/suppliers  — idempotent: returns existing record if name already exists
router.post('/', requireUser, (req, res) => {
  const db   = getDB();
  const name = (req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: '供应商名称不能为空' });

  const existing = db.prepare('SELECT * FROM suppliers WHERE name = ?').get(name);
  if (existing) return res.status(200).json({ ...existing, existed: true });

  const id = uuid();
  const ts = now();
  db.prepare('INSERT INTO suppliers (id, name, created_at) VALUES (?, ?, ?)')
    .run(id, name, ts);

  res.status(201).json({ id, name, created_at: ts, existed: false });
});

module.exports = router;
