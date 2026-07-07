/* Branch operational data store — Node's built-in SQLite (node:sqlite).
   One row per record (coll,id -> json), plus meta (shop/permissions, counters
   snapshot) and an atomic counters table for OR/JO/EST/PO numbers.
   Single-process => all writes/counter allocations are naturally serialized. */
const { DatabaseSync } = require('node:sqlite');

const COLLECTIONS = ['staff', 'bays', 'parts', 'labor', 'vehicles', 'estimates', 'jobs', 'appointments', 'purchaseOrders'];

function createStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS records (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updatedAt TEXT, PRIMARY KEY (coll, id));');
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, json TEXT);');
  db.exec('CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);');

  const qUpsert = db.prepare('INSERT INTO records (coll,id,json,updatedAt) VALUES (?,?,?,?) ON CONFLICT(coll,id) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt');
  const qDelete = db.prepare('DELETE FROM records WHERE coll=? AND id=?');
  const qAll    = db.prepare('SELECT coll,id,json FROM records');
  const qMetaAll = db.prepare('SELECT k,json FROM meta');
  const qMetaSet = db.prepare('INSERT INTO meta (k,json) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET json=excluded.json');
  const qCntGet  = db.prepare('SELECT value FROM counters WHERE name=?');
  const qCntSet  = db.prepare('INSERT INTO counters (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value');

  function nowISO() { return new Date().toISOString(); }

  return {
    collections: COLLECTIONS,

    /* Full state for a client that just loaded (mirrors cloud's initial read). */
    getState() {
      const collections = {};
      COLLECTIONS.forEach(function (c) { collections[c] = []; });
      for (const row of qAll.all()) {
        if (!collections[row.coll]) collections[row.coll] = [];
        try { collections[row.coll].push(JSON.parse(row.json)); } catch (e) {}
      }
      const meta = {};
      for (const m of qMetaAll.all()) { try { meta[m.k] = JSON.parse(m.json); } catch (e) {} }
      return { collections: collections, shop: meta.shop || null, counters: meta.counters || null };
    },

    upsert(coll, id, rec) { qUpsert.run(coll, String(id), JSON.stringify(rec), nowISO()); },
    remove(coll, id) { qDelete.run(coll, String(id)); },
    setMeta(key, value) { qMetaSet.run(key, JSON.stringify(value)); },

    /* Atomic number allocation. First call seeds to `seed` (default 1), each
       subsequent call returns the previous value + 1. Serialized in one txn. */
    allocCounter(name, seed) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = qCntGet.get(name);
        let val = row ? row.value + 1 : (seed == null ? 1 : Number(seed));
        if (seed != null && Number(seed) > val) val = Number(seed);   // honor seed as a floor
        qCntSet.run(name, val);
        db.exec('COMMIT');
        return val;
      } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
    },

    /* Bulk import (one-time migration): replace everything from a state object. */
    importState(state) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('DELETE FROM records;');
        COLLECTIONS.forEach(function (c) {
          (state[c] || []).forEach(function (r) { if (r && r.id != null) qUpsert.run(c, String(r.id), JSON.stringify(r), nowISO()); });
        });
        if (state.shop) qMetaSet.run('shop', JSON.stringify(state.shop));
        if (state.counters) qMetaSet.run('counters', JSON.stringify(state.counters));
        db.exec('COMMIT');
      } catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
      return this.count();
    },

    count() { let n = 0; for (const _ of qAll.all()) n++; return n; }
  };
}

module.exports = { createStore, COLLECTIONS };
