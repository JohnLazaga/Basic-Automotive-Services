/* Branch operational data store — Node's built-in SQLite (node:sqlite).
   One row per record (coll,id -> json), plus meta (shop/permissions, counters
   snapshot) and an atomic counters table for OR/JO/EST/PO numbers.
   Single-process => all writes/counter allocations are naturally serialized. */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

const COLLECTIONS = ['staff', 'bays', 'parts', 'labor', 'vehicles', 'estimates', 'jobs', 'appointments', 'purchaseOrders'];

function createStore(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS records (coll TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updatedAt TEXT, PRIMARY KEY (coll, id));');
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, json TEXT);');
  db.exec('CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);');
  db.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT, role TEXT, isAdmin INTEGER, active INTEGER, salt TEXT, hash TEXT, createdAt TEXT);');
  db.exec('CREATE TABLE IF NOT EXISTS portal (id TEXT PRIMARY KEY, json TEXT);');

  const qUpsert = db.prepare('INSERT INTO records (coll,id,json,updatedAt) VALUES (?,?,?,?) ON CONFLICT(coll,id) DO UPDATE SET json=excluded.json, updatedAt=excluded.updatedAt');
  const qDelete = db.prepare('DELETE FROM records WHERE coll=? AND id=?');
  const qAll    = db.prepare('SELECT coll,id,json FROM records');
  const qMetaAll = db.prepare('SELECT k,json FROM meta');
  const qMetaSet = db.prepare('INSERT INTO meta (k,json) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET json=excluded.json');
  const qCntGet  = db.prepare('SELECT value FROM counters WHERE name=?');
  const qCntSet  = db.prepare('INSERT INTO counters (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value');
  const qUsrByName = db.prepare('SELECT * FROM users WHERE username=?');
  const qUsrById   = db.prepare('SELECT * FROM users WHERE id=?');
  const qUsrAll    = db.prepare('SELECT id,username,name,role,isAdmin,active,createdAt FROM users ORDER BY name');
  const qUsrIns    = db.prepare('INSERT INTO users (id,username,name,role,isAdmin,active,salt,hash,createdAt) VALUES (?,?,?,?,?,?,?,?,?)');
  const qUsrUpd    = db.prepare('UPDATE users SET name=?, role=?, isAdmin=?, active=? WHERE id=?');
  const qUsrPw     = db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?');
  const qUsrDel    = db.prepare('DELETE FROM users WHERE id=?');
  const qUsrCount  = db.prepare('SELECT COUNT(*) AS n FROM users');
  const qPortalGet = db.prepare('SELECT json FROM portal WHERE id=?');
  const qPortalSet = db.prepare('INSERT INTO portal (id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json');

  function nowISO() { return new Date().toISOString(); }
  function hashPw(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
  function pubUser(r) { return r ? { uid: r.id, id: r.id, username: r.username, name: r.name, role: r.role, isAdmin: !!r.isAdmin, active: r.active !== 0, createdAt: r.createdAt } : null; }

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

    count() { let n = 0; for (const _ of qAll.all()) n++; return n; },

    /* ---- users / auth (Phase 3d) ---- */
    usersAll() { return qUsrAll.all().map(function (r) { return pubUser(r); }); },
    userById(id) { return pubUser(qUsrById.get(id)); },
    verifyLogin(username, password) {
      const r = qUsrByName.get(String(username || '').trim().toLowerCase());
      if (!r) return { error: 'bad_credentials' };
      if (r.active === 0) return { error: 'inactive' };
      if (hashPw(password, r.salt) !== r.hash) return { error: 'bad_credentials' };
      return { user: pubUser(r) };
    },
    createUser(u) {
      const id = 'u' + crypto.randomBytes(6).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      try {
        qUsrIns.run(id, String(u.username || '').trim().toLowerCase(), u.name || u.username || '', u.role || 'SA',
          u.isAdmin ? 1 : 0, 1, salt, hashPw(u.password || '', salt), nowISO());
      } catch (e) { if (String(e.message).indexOf('UNIQUE') >= 0) return { error: 'username_taken' }; throw e; }
      return { user: pubUser(qUsrById.get(id)) };
    },
    updateUser(id, f) {
      const r = qUsrById.get(id); if (!r) return { error: 'not_found' };
      qUsrUpd.run(f.name != null ? f.name : r.name, f.role != null ? f.role : r.role,
        f.isAdmin != null ? (f.isAdmin ? 1 : 0) : r.isAdmin, f.active != null ? (f.active ? 1 : 0) : r.active, id);
      return { user: pubUser(qUsrById.get(id)) };
    },
    setUserPassword(id, password) {
      const r = qUsrById.get(id); if (!r) return { error: 'not_found' };
      const salt = crypto.randomBytes(16).toString('hex');
      qUsrPw.run(salt, hashPw(password, salt), id);
      return { ok: true };
    },
    deleteUser(id) { qUsrDel.run(id); return { ok: true }; },

    /* ---- public customer portal snapshots (Phase 3e/local) ---- */
    setPortal(id, data) { qPortalSet.run(String(id), JSON.stringify(data || {})); },
    getPortal(id) { var r = qPortalGet.get(String(id)); if (!r) return null; try { return JSON.parse(r.json); } catch (e) { return null; } },

    countUsers() { return qUsrCount.get().n; },
    /* First run: create a default admin so the branch can be signed into. */
    bootstrapAdmin() {
      if (qUsrCount.get().n > 0) return null;
      const id = 'u' + crypto.randomBytes(6).toString('hex');
      const salt = crypto.randomBytes(16).toString('hex');
      qUsrIns.run(id, 'admin', 'Administrator', 'SV', 1, 1, salt, hashPw('admin', salt), nowISO());
      return { username: 'admin', password: 'admin' };
    }
  };
}

module.exports = { createStore, COLLECTIONS };
