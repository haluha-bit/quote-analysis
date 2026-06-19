/* ================================================================
   Templates Routes — /api/templates
   Stores per-supplier learned defaults (delivery_time, etc.)
================================================================ */

const express = require('express');
const router  = express.Router();
const { getDB }       = require('../db');
const { requireUser } = require('../middleware/auth');

function now() { return new Date().toISOString(); }

// GET /api/templates — list all
router.get('/', requireUser, (req, res) => {
  const rows = getDB()
    .prepare('SELECT supplier, data, updated_at FROM supplier_templates ORDER BY supplier')
    .all();
  res.json(rows.map(r => ({ supplier: r.supplier, ...JSON.parse(r.data), updated_at: r.updated_at })));
});

// GET /api/templates/:supplier — get one
router.get('/:supplier', requireUser, (req, res) => {
  const row = getDB()
    .prepare('SELECT data, updated_at FROM supplier_templates WHERE supplier = ?')
    .get(req.params.supplier);
  if (!row) return res.json(null);
  res.json({ supplier: req.params.supplier, ...JSON.parse(row.data), updated_at: row.updated_at });
});

// POST /api/templates — upsert
router.post('/', requireUser, (req, res) => {
  const { supplier, ...data } = req.body ?? {};
  if (!supplier) return res.status(400).json({ error: 'supplier required' });
  getDB().prepare(`
    INSERT INTO supplier_templates (supplier, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(supplier) DO UPDATE SET
      data       = json_patch(data, excluded.data),
      updated_at = excluded.updated_at
  `).run(supplier, JSON.stringify(data), now());
  res.json({ ok: true });
});

module.exports = router;
