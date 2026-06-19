/* ================================================================
   Files Routes — /api/files
================================================================ */

const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const { getDB }       = require('../db');
const { requireUser } = require('../middleware/auth');
const { v4: uuid }    = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '../uploads');

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const id  = uuid();
    const ext = path.extname(file.originalname).toLowerCase();
    req._fileId = id;          // stash for route handler
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.xlsx', '.xls', '.docx', '.doc'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

// POST /api/files/upload
router.post('/upload', requireUser, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '不支持的文件类型' });

  const db  = getDB();
  const id  = req._fileId;

  db.prepare(
    `INSERT INTO files (id, name, type, size, path, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, req.file.originalname, req.file.mimetype, req.file.size, req.file.filename, new Date().toISOString());

  res.json({ file_id: id, name: req.file.originalname, size: req.file.size });
});

// GET /api/files/:id  — serve file (no auth so browser can open it in new tab)
router.get('/:id', (req, res) => {
  const record = getDB().prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!record) return res.status(404).json({ error: '文件不存在' });

  const filePath = path.join(UPLOADS_DIR, record.path);
  res.download(filePath, record.name);
});

module.exports = router;
