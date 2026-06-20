/* ================================================================
   QAS Server — Express entry point
   Serves: static PWA + REST API at /api/*
   Port: 3001  (open http://localhost:3001)
================================================================ */

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const { initDB }      = require('./db');
const authRoutes      = require('./routes/auth');
const quotesRoutes    = require('./routes/quotes');
const filesRoutes     = require('./routes/files');
const logsRoutes      = require('./routes/logs');
const linesRoutes      = require('./routes/lines');
const suppliersRoutes   = require('./routes/suppliers');
const templatesRoutes   = require('./routes/templates');
const aiRoutes          = require('./routes/ai');

const app  = express();
const PORT = process.env.PORT || 3001;

/* ---- Ensure uploads directory exists ---- */
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });

/* ---- Initialise database ---- */
initDB();

/* ---- Middleware ---- */
// Allow cross-origin requests (needed when frontend dev server runs on a different port)
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));

/* ---- API routes ---- */
app.use('/api/auth',   authRoutes);
app.use('/api/quotes', quotesRoutes);
app.use('/api/files',  filesRoutes);
app.use('/api/logs',   logsRoutes);
app.use('/api/lines',      linesRoutes);
app.use('/api/suppliers',  suppliersRoutes);
app.use('/api/templates',  templatesRoutes);
app.use('/api/ai',         aiRoutes);

/* ---- Serve PWA static files from project root ---- */
const PWA_ROOT = path.join(__dirname, '..');
app.use(express.static(PWA_ROOT));

/* ---- SPA fallback — serve index.html for any unmatched GET ---- */
app.get('*', (req, res) => {
  res.sendFile(path.join(PWA_ROOT, 'index.html'));
});

/* ---- Start ---- */
app.listen(PORT, () => {
  console.log(`\n  QAS Server ready → http://localhost:${PORT}\n`);
});
