/* ================================================================
   Quotes Routes — /api/quotes
================================================================ */

const express = require('express');
const router  = express.Router();
const { getDB }       = require('../db');
const { requireUser } = require('../middleware/auth');
const { v4: uuid }    = require('uuid');

function now() { return new Date().toISOString(); }

function parseQuote(row) {
  if (!row) return null;
  return {
    ...row,
    equipment: JSON.parse(row.equipment || '[]'),
    items:     JSON.parse(row.items     || '[]'),
  };
}

// GET /api/quotes
router.get('/', requireUser, (req, res) => {
  const rows = getDB()
    .prepare('SELECT * FROM quotes ORDER BY created_at DESC')
    .all();
  res.json(rows.map(parseQuote));
});

// GET /api/quotes/:id
router.get('/:id', requireUser, (req, res) => {
  const row = getDB().prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: '报价不存在' });
  res.json(parseQuote(row));
});

// POST /api/quotes
router.post('/', requireUser, (req, res) => {
  const db   = getDB();
  const user = req.user;
  const d    = req.body ?? {};
  const ts   = now();
  const id   = d.id || uuid();

  const equipment = JSON.stringify(d.equipment ?? []);
  const items     = JSON.stringify(d.items     ?? []);

  db.prepare(`
    INSERT INTO quotes
      (id, supplier, quote_id, quote_date, delivery_time, total_amount, currency,
       notes, line_id, line_name, equipment, items, file_name, file_id,
       created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    d.supplier      ?? '',
    d.quote_id      ?? '',
    d.quote_date    ?? '',
    d.delivery_time ?? '',
    Number(d.total_amount) || 0,
    d.currency      ?? 'CNY',
    d.notes         ?? '',
    d.line_id       ?? '',
    d.line_name     ?? '',
    equipment,
    items,
    d.file_name     ?? '',
    d.file_id       ?? '',
    user,
    ts,
    ts,
  );

  // Auto-register supplier if new
  const supplierName = (d.supplier ?? '').trim();
  if (supplierName) {
    const exists = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(supplierName);
    if (!exists) {
      db.prepare('INSERT INTO suppliers (id, name, created_at) VALUES (?, ?, ?)')
        .run(require('uuid').v4(), supplierName, ts);
    }
  }

  db.prepare(`INSERT INTO logs (action, user, detail, ts) VALUES (?, ?, ?, ?)`)
    .run('upload', user, `quote_id: ${d.quote_id ?? ''} | supplier: ${d.supplier ?? ''}`, ts);

  res.status(201).json(parseQuote({
    id, supplier: d.supplier ?? '', quote_id: d.quote_id ?? '',
    quote_date: d.quote_date ?? '', delivery_time: d.delivery_time ?? '',
    total_amount: Number(d.total_amount) || 0, currency: d.currency ?? 'CNY',
    notes: d.notes ?? '', line_id: d.line_id ?? '', line_name: d.line_name ?? '',
    equipment, items, file_name: d.file_name ?? '', file_id: d.file_id ?? '',
    created_by: user, created_at: ts, updated_at: ts,
  }));
});

// DELETE /api/quotes/:id
router.delete('/:id', requireUser, (req, res) => {
  const db   = getDB();
  const user = req.user;
  const existing = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: '报价不存在' });

  db.prepare('DELETE FROM quotes WHERE id = ?').run(req.params.id);
  db.prepare(`INSERT INTO logs (action, user, detail, ts) VALUES (?, ?, ?, ?)`)
    .run('delete', user, `quote_id: ${existing.quote_id} | supplier: ${existing.supplier}`, now());

  res.json({ ok: true });
});

module.exports = router;
