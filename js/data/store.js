/* ================================================================
   IndexedDB Store — Data Layer
   Stores: quotes | lines | logs | files
================================================================ */

const DB_NAME    = 'qas-db';
const DB_VERSION = 1;

const STORES = {
  quotes: { keyPath: 'id' },
  lines:  { keyPath: 'id' },
  logs:   { keyPath: 'id', autoIncrement: true },
  files:  { keyPath: 'id' },
};

class Store {
  constructor() {
    this._db = null;
  }

  /** Open (or upgrade) the database */
  async init() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db = e.target.result;
        for (const [name, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: opts.keyPath, autoIncrement: opts.autoIncrement ?? false });
            if (name === 'quotes') {
              store.createIndex('supplier',   'supplier',   { unique: false });
              store.createIndex('quote_date', 'quote_date', { unique: false });
              store.createIndex('line_id',    'line_id',    { unique: false });
            }
            if (name === 'logs') {
              store.createIndex('ts', 'ts', { unique: false });
            }
          }
        }
      };

      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = e => reject(e.target.error);
    });
  }

  _tx(storeName, mode = 'readonly') {
    return this._db.transaction(storeName, mode).objectStore(storeName);
  }

  /** Wrap IDBRequest in a Promise */
  _wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  /** Add a record (insert only) */
  async add(storeName, record) {
    await this.init();
    return this._wrap(this._tx(storeName, 'readwrite').add(record));
  }

  /** Put a record (upsert) */
  async put(storeName, record) {
    await this.init();
    return this._wrap(this._tx(storeName, 'readwrite').put(record));
  }

  /** Get single record by key */
  async get(storeName, key) {
    await this.init();
    return this._wrap(this._tx(storeName).get(key));
  }

  /** Get all records in a store */
  async getAll(storeName) {
    await this.init();
    return this._wrap(this._tx(storeName).getAll());
  }

  /** Get records by index value */
  async getByIndex(storeName, indexName, value) {
    await this.init();
    return this._wrap(
      this._tx(storeName).index(indexName).getAll(IDBKeyRange.only(value))
    );
  }

  /** Delete a record by key */
  async delete(storeName, key) {
    await this.init();
    return this._wrap(this._tx(storeName, 'readwrite').delete(key));
  }

  /** Clear all records in a store */
  async clear(storeName) {
    await this.init();
    return this._wrap(this._tx(storeName, 'readwrite').clear());
  }

  /** Count records in a store */
  async count(storeName) {
    await this.init();
    return this._wrap(this._tx(storeName).count());
  }
}

export const store = new Store();
