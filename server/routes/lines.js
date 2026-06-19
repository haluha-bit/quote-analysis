/* ================================================================
   Lines Routes — /api/lines
================================================================ */

const express = require('express');
const router  = express.Router();
const { getDB }       = require('../db');
const { requireUser } = require('../middleware/auth');

function parseLine(row) {
  return { ...row, equipment: JSON.parse(row.equipment || '[]') };
}

// GET /api/lines
router.get('/', requireUser, (req, res) => {
  const rows = getDB().prepare('SELECT * FROM lines ORDER BY name').all();
  res.json(rows.map(parseLine));
});

// POST /api/lines
router.post('/', requireUser, (req, res) => {
  const { id, name, equipment = [] } = req.body ?? {};
  if (!id || !name) return res.status(400).json({ error: 'id 和 name 必填' });
  getDB().prepare(`INSERT OR REPLACE INTO lines (id, name, equipment) VALUES (?, ?, ?)`)
    .run(id, name, JSON.stringify(equipment));
  const log = `INSERT INTO logs (action, user, detail, ts) VALUES ('add_line', ?, ?, ?)`;
  getDB().prepare(log).run(req.user, `line: ${name}`, new Date().toISOString());
  res.status(201).json({ id, name, equipment });
});

// PUT /api/lines/:id
router.put('/:id', requireUser, (req, res) => {
  const { name, equipment } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name 必填' });
  getDB().prepare('UPDATE lines SET name = ?, equipment = ? WHERE id = ?')
    .run(name, JSON.stringify(equipment ?? []), req.params.id);
  const log = `INSERT INTO logs (action, user, detail, ts) VALUES ('edit_line', ?, ?, ?)`;
  getDB().prepare(log).run(req.user, `line_id: ${req.params.id} | new_name: ${name}`, new Date().toISOString());
  res.json({ ok: true });
});

// DELETE /api/lines/:id
router.delete('/:id', requireUser, (req, res) => {
  getDB().prepare('DELETE FROM lines WHERE id = ?').run(req.params.id);
  const log = `INSERT INTO logs (action, user, detail, ts) VALUES ('edit_line', ?, ?, ?)`;
  getDB().prepare(log).run(req.user, `deleted line_id: ${req.params.id}`, new Date().toISOString());
  res.json({ ok: true });
});

module.exports = router;
