/* ================================================================
   Logs Routes — /api/logs
================================================================ */

const express = require('express');
const router  = express.Router();
const { getDB }       = require('../db');
const { requireUser } = require('../middleware/auth');

// GET /api/logs
router.get('/', requireUser, (req, res) => {
  const logs = getDB()
    .prepare('SELECT * FROM logs ORDER BY ts DESC LIMIT 500')
    .all();
  res.json(logs);
});

module.exports = router;
