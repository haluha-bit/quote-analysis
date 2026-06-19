/* ================================================================
   Database — node:sqlite (built-in since Node v22, no compilation)
================================================================ */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, 'qas.db');

let _db = null;

function getDB() {
  if (!_db) _db = new DatabaseSync(DB_PATH);
  return _db;
}

/* ---- Default production lines -------------------------------- */
const LINES_DEFAULT = [
  { id: 'AL1',       name: 'AL1',       equipment: ['打Pin机','绕线机','焊锡机','打环机','灌胶线','手动打扣01','手动打扣02','测试机','包装'] },
  { id: 'AL2',       name: 'AL2',       equipment: ['打环机','打Pin机','绕线机','焊锡机','灌胶机','固化单元','测试机','包装'] },
  { id: 'AL3',       name: 'AL3',       equipment: ['打Pin机','绕线机','焊锡机','灌胶机','固化','测试机','包装'] },
  { id: 'AL5',       name: 'AL5',       equipment: ['插PIN','绕线','焊锡','外观','灌胶','干燥','测试机','包装'] },
  { id: 'AL6',       name: 'AL6',       equipment: ['插PIN','绕线','焊锡','外观','灌胶','干燥','测试机','包装'] },
  { id: 'LRA1',      name: 'LRA1',      equipment: ['打PIN','绕线','焊锡','电感高压测试','外观','灌胶','测试机','包装'] },
  { id: 'LRA2',      name: 'LRA2',      equipment: ['打PIN','绕线','焊锡','电感高压测试','外观','灌胶','测试机','包装'] },
  { id: 'BHTC',      name: 'BHTC',      equipment: ['ITOS折弯机','波峰焊机01','波峰焊机02','注塑机01','注塑机02','测高01','测高02','电性能测试01','电性能测试03'] },
  { id: 'ZF_Filter', name: 'ZF Filter', equipment: ['外壳点胶','磁芯组装','外壳点胶及组装','最终测试','清洁及包装'] },
  { id: 'Valeo',     name: 'Valeo',     equipment: ['冲孔机','层压机01','层压机02','重绕机01','重绕机02'] },
];

/* ---- Schema -------------------------------------------------- */
function initDB() {
  const db = getDB();

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      created_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quotes (
      id            TEXT PRIMARY KEY,
      supplier      TEXT    DEFAULT '',
      quote_id      TEXT    DEFAULT '',
      quote_date    TEXT    DEFAULT '',
      delivery_time TEXT    DEFAULT '',
      total_amount  REAL    DEFAULT 0,
      currency      TEXT    DEFAULT 'CNY',
      notes         TEXT    DEFAULT '',
      line_id       TEXT    DEFAULT '',
      line_name     TEXT    DEFAULT '',
      equipment     TEXT    DEFAULT '[]',
      items         TEXT    DEFAULT '[]',
      file_name     TEXT    DEFAULT '',
      file_id       TEXT    DEFAULT '',
      created_by    TEXT    DEFAULT '',
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS files (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      type       TEXT DEFAULT '',
      size       INTEGER DEFAULT 0,
      path       TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      user   TEXT NOT NULL,
      detail TEXT DEFAULT '',
      ts     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lines (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      equipment TEXT DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_templates (
      supplier    TEXT PRIMARY KEY,
      data        TEXT NOT NULL DEFAULT '{}',
      updated_at  TEXT NOT NULL
    );
  `);

  // Seed lines if table is empty
  const count = db.prepare('SELECT COUNT(*) AS n FROM lines').get().n;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO lines (id, name, equipment) VALUES (?, ?, ?)');
    for (const line of LINES_DEFAULT) {
      insert.run(line.id, line.name, JSON.stringify(line.equipment));
    }
    console.log('[DB] Seeded default production lines.');
  }

  return db;
}

module.exports = { getDB, initDB };
