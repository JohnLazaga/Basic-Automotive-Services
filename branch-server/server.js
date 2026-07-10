/* Basic by JMSI — Branch Parts Server
   Runs on a branch's always-on mini-PC. Serves the parts catalog to the app
   over the branch LAN (fast, offline). Two data sources:

     • SQL Server  — connects to the shop's SQL Server (via .NET SqlClient
                     through PowerShell, exactly like sync/export-sql.ps1, so
                     NO npm packages and Windows/Integrated auth just works).
                     Configured IN-APP: the app posts the connection details to
                     /admin/sql/*, and this server tests + syncs.
     • parts.tsv   — a plain tab-separated file next to server.js (fallback /
                     works even with no SQL Server).

   Run:   node server.js
   Env:   PORT (8790)  BRANCH (name)  DATA_FILE (tsv path)
          ADMIN_TOKEN  (optional — if set, /admin/* requires header X-Admin-Token)

   API (read):
     GET  /health
     GET  /api/version
     GET  /api/all               gzipped {version,count,parts:[[sku,name,net,srp]]}
     GET  /api/parts/:sku
     GET  /api/parts?q=TERM&limit
   API (admin — attach SQL Server from the app):
     GET  /admin/sql/status
     POST /admin/sql/test   {server,database,auth,user,password,query}
     POST /admin/sql/save   {…same…}     validate + persist + sync
     POST /admin/sql/sync                 re-run the saved query
*/
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { createStore } = require('./store');
const sse = require('./sse');

const PORT = Number(process.env.PORT) || 8790;
const BRANCH = process.env.BRANCH || 'branch';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const APP_DIR = process.env.APP_DIR || '';   // optional: also serve the branch app (dist/<slug>) at /
const SQL_CONFIG_FILE = path.join(__dirname, 'sql-config.json');
const TSV_FILE = path.join(__dirname, 'parts.tsv');
const PHOTOS_DIR = path.join(__dirname, 'photos');   // job photos (Phase 3e)
const PS_FILE = path.join(os.tmpdir(), 'bjmsi_partsquery.ps1');
const store = createStore(path.join(__dirname, 'data.sqlite'));   // operational data (Phase 3)
const sessions = new Map();   // token -> user (in-memory; re-login after a restart)
function tokenFromReq(req, u) { return req.headers['x-session-token'] || (u && u.searchParams.get('token')) || ''; }
function sessionUser(req, u) { var t = tokenFromReq(req, u); return t ? (sessions.get(t) || null) : null; }

// Sensible defaults matching this shop's SQL Server (see sync/export-sql.ps1).
const DEFAULT_SQL = {
  server: 'JASSERVER\\SQLSERVER2014',
  database: 'JasregaladoDB',
  auth: 'sql',          // 'integrated' (Windows) | 'sql' (user+password)
  user: 'basic_parts_ro',   // least-privilege read-only login (see Desktop .sql script)
  // WITH (NOLOCK) = read-only, takes no locks, so this sync never blocks the
  // shared production database that other apps rely on. Read-only by design.
  query: 'SELECT ap.fldStockCode AS sku, p.fldPartDesc AS part_name, ' +
         'ap.fldNetPrice AS net_price, ap.fldSRPExc AS srp ' +
         'FROM tblAutoPart ap WITH (NOLOCK) ' +
         'LEFT JOIN tblPart p WITH (NOLOCK) ON ap.fldPartNameCode = p.fldPartNameCode ' +
         'WHERE ap.fldIsActive = 1 ORDER BY ap.fldStockCode'
};

/* ---------------- catalog state ---------------- */
var BY_SKU = new Map();
var LIST = [];
var VERSION = '';
var LOADED_AT = null;
var ALL_GZ = null;
var SOURCE = 'none';      // 'sql:<db>' | 'tsv:<file>' | 'none'
var LAST_ERROR = null;

function setCatalog(list, sourceLabel) {
  var map = new Map();
  for (var i = 0; i < list.length; i++) map.set(list[i].sku, list[i]);
  BY_SKU = map;
  LIST = list;
  var raw = list.map(function (r) { return r.sku + '\t' + r.name + '\t' + r.net + '\t' + r.srp; }).join('\n');
  VERSION = crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
  LOADED_AT = new Date().toISOString();
  SOURCE = sourceLabel;
  var payload = JSON.stringify({
    version: VERSION, count: list.length,
    parts: list.map(function (r) { return [r.sku, r.name, r.net, r.srp]; })
  });
  ALL_GZ = zlib.gzipSync(payload);
}

function parseRows(raw) {
  var list = [];
  var lines = String(raw || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].replace(/\r$/, '');
    if (!ln) continue;
    var t = ln.split('\t');
    var sku = (t[0] || '').trim();
    if (!sku) continue;
    list.push({ sku: sku, name: (t[1] || '').trim(), net: Number(t[2]) || 0, srp: Number(t[3]) || 0 });
  }
  return list;
}

function loadFromTsv() {
  var file = process.env.DATA_FILE || (fs.existsSync(TSV_FILE) ? TSV_FILE : path.join(__dirname, '..', 'sync', 'parts.tsv'));
  var list = parseRows(fs.readFileSync(file, 'utf8'));
  setCatalog(list, 'tsv:' + path.basename(file));
  return list.length;
}

/* ---------------- SQL Server via .NET SqlClient (PowerShell) ---------------- */
// Written once to a temp .ps1. Reads connection string + query from env so the
// password never appears in the process arguments or logs. Emits TSV to stdout.
const PS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$cn = New-Object System.Data.SqlClient.SqlConnection $env:BSQL_CS",
  "$cn.Open()",
  "$cmd = $cn.CreateCommand(); $cmd.CommandText = $env:BSQL_QUERY; $cmd.CommandTimeout = 300",
  "$rd = $cmd.ExecuteReader()",
  "$tab = [char]9",
  "$sw = New-Object System.IO.StringWriter",
  "while ($rd.Read()) {",
  "  $sku = [string]$rd[0]",
  "  if ([string]::IsNullOrWhiteSpace($sku)) { continue }",
  "  $name = ([string]$rd[1]) -replace '[\\t\\r\\n]', ' '",
  "  $net = $rd[2]; if ($net -is [System.DBNull]) { $net = 0 }",
  "  $srp = $rd[3]; if ($srp -is [System.DBNull]) { $srp = 0 }",
  "  $sw.WriteLine(\"$sku$tab$name$tab$net$tab$srp\")",
  "}",
  "$rd.Close(); $cn.Close()",
  "[Console]::Out.Write($sw.ToString())"
].join('\n');

function buildConnString(cfg) {
  var s = 'Server=' + cfg.server + ';Database=' + cfg.database +
          ';TrustServerCertificate=True;Encrypt=False;Connect Timeout=15';
  if (cfg.auth === 'sql' && cfg.user) return s + ';User ID=' + cfg.user + ';Password=' + (cfg.password || '');
  return s + ';Integrated Security=SSPI';
}

function querySql(cfg) {
  if (process.platform !== 'win32') throw new Error('SQL Server sync requires Windows (uses .NET SqlClient).');
  if (!cfg || !cfg.server || !cfg.database || !cfg.query) throw new Error('server, database and query are required.');
  fs.writeFileSync(PS_FILE, PS_SCRIPT, 'utf8');
  var res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_FILE], {
    env: Object.assign({}, process.env, { BSQL_CS: buildConnString(cfg), BSQL_QUERY: cfg.query }),
    maxBuffer: 128 * 1024 * 1024, encoding: 'utf8'
  });
  if (res.error) throw new Error(res.error.message);
  if (res.status !== 0) throw new Error(((res.stderr || '').trim()) || ('SQL query failed (exit ' + res.status + ')'));
  return parseRows(res.stdout || '');
}

function readSqlConfig() { try { return JSON.parse(fs.readFileSync(SQL_CONFIG_FILE, 'utf8')); } catch (e) { return null; } }
function saveSqlConfig(cfg) { fs.writeFileSync(SQL_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8'); }

function syncFromSql() {
  var cfg = readSqlConfig();
  if (!cfg) throw new Error('No SQL Server configuration saved yet.');
  var list = querySql(cfg);
  setCatalog(list, 'sql:' + cfg.database);
  // Snapshot to parts.tsv so the branch still works offline if SQL is later down.
  try { fs.writeFileSync(TSV_FILE, list.map(function (r) { return r.sku + '\t' + r.name + '\t' + r.net + '\t' + r.srp; }).join('\n'), 'utf8'); } catch (e) {}
  LAST_ERROR = null;
  return list.length;
}

function initialLoad() {
  if (readSqlConfig()) {
    try { var n = syncFromSql(); console.log('[parts] SQL sync: ' + n.toLocaleString() + ' SKUs'); return; }
    catch (e) { LAST_ERROR = e.message; console.error('[parts] SQL sync failed, falling back to parts.tsv:', e.message); }
  }
  try { var n2 = loadFromTsv(); console.log('[parts] TSV load: ' + n2.toLocaleString() + ' SKUs (' + SOURCE + ')'); }
  catch (e) { console.error('[parts] no data source yet:', e.message); setCatalog([], 'none'); }
}

/* ---------------- search ---------------- */
function search(q, limit) {
  var needle = String(q || '').trim().toUpperCase();
  if (!needle) return [];
  var out = [];
  for (var i = 0; i < LIST.length && out.length < limit; i++) {
    var r = LIST[i];
    if (r.sku.toUpperCase().indexOf(needle) === 0 || r.name.toUpperCase().indexOf(needle) >= 0) out.push(r);
  }
  return out;
}

/* ---------------- http ---------------- */
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
}
function send(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(function (resolve) {
    var b = '';
    req.on('data', function (c) { b += c; if (b.length > 8 * 1024 * 1024) req.destroy(); });
    req.on('end', function () { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({}); } });
  });
}
function adminOK(req, u) {
  if (ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN) return true;
  var su = sessionUser(req, u); if (su && su.isAdmin) return true;
  if (!ADMIN_TOKEN && store.countUsers() === 0) return true;   // fresh box, no accounts yet
  return false;
}

const server = http.createServer(async function (req, res) {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  var u = new URL(req.url, 'http://localhost');
  var p = u.pathname;

  // ---- read endpoints ----
  if (p === '/health') return send(res, 200, { ok: true, branch: BRANCH, count: LIST.length, version: VERSION, source: SOURCE, loadedAt: LOADED_AT, lastError: LAST_ERROR });
  if (p === '/api/version') return send(res, 200, { version: VERSION, count: LIST.length });
  if (p === '/api/all') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' });
    return res.end(ALL_GZ);
  }
  if (p === '/api/parts' && u.searchParams.has('q')) {
    var limit = Math.min(Number(u.searchParams.get('limit')) || 50, 200);
    var results = search(u.searchParams.get('q'), limit);
    return send(res, 200, { count: results.length, results: results });
  }
  var m = p.match(/^\/api\/parts\/(.+)$/);
  if (m) {
    var rec = BY_SKU.get(decodeURIComponent(m[1]).trim());
    return rec ? send(res, 200, rec) : send(res, 404, { error: 'not_found' });
  }

  // ---- auth (Phase 3d): local staff login + admin account management ----
  if (p.indexOf('/auth') === 0) {
    if (p === '/auth/login' && req.method === 'POST') {
      var lb = await readBody(req);
      var vr = store.verifyLogin(lb.username, lb.password);
      if (vr.error) return send(res, 200, { ok: false, error: vr.error });
      var token = crypto.randomBytes(24).toString('hex');
      sessions.set(token, vr.user);
      return send(res, 200, { ok: true, token: token, user: vr.user });
    }
    if (p === '/auth/me' && req.method === 'GET') {
      var su0 = sessionUser(req, u);
      return send(res, 200, su0 ? { ok: true, user: su0 } : { ok: false });
    }
    if (p === '/auth/logout' && req.method === 'POST') {
      var t = tokenFromReq(req, u); if (t) sessions.delete(t);
      return send(res, 200, { ok: true });
    }
    // everything below is admin-only account management
    var au = sessionUser(req, u);
    if (!au || !au.isAdmin) return send(res, 403, { error: 'admin_only' });
    if (p === '/auth/users' && req.method === 'GET') return send(res, 200, { ok: true, users: store.usersAll() });
    if (p === '/auth/users' && req.method === 'POST') { var nb = await readBody(req); var cr = store.createUser(nb); return send(res, 200, cr.error ? { ok: false, error: cr.error } : { ok: true, user: cr.user }); }
    var upm = p.match(/^\/auth\/users\/([^/]+)\/password$/);
    if (upm && req.method === 'POST') { var pb = await readBody(req); var pr = store.setUserPassword(decodeURIComponent(upm[1]), pb.password); return send(res, 200, pr.error ? { ok: false, error: pr.error } : { ok: true }); }
    var um2 = p.match(/^\/auth\/users\/([^/]+)$/);
    if (um2 && req.method === 'POST') { var ub = await readBody(req); var ur = store.updateUser(decodeURIComponent(um2[1]), ub); return send(res, 200, ur.error ? { ok: false, error: ur.error } : { ok: true, user: ur.user }); }
    if (um2 && req.method === 'DELETE') { store.deleteUser(decodeURIComponent(um2[1])); return send(res, 200, { ok: true }); }
    return send(res, 404, { error: 'unknown_auth_route' });
  }

  // ---- admin (SQL Server attach) ----
  if (p.indexOf('/admin/') === 0) {
    if (!adminOK(req, u)) return send(res, 401, { error: 'unauthorized' });

    if (p === '/admin/sql/status' && req.method === 'GET') {
      var cfg = readSqlConfig();
      return send(res, 200, {
        configured: !!cfg,
        source: SOURCE, count: LIST.length, version: VERSION, loadedAt: LOADED_AT, lastError: LAST_ERROR,
        platform: process.platform,
        defaults: DEFAULT_SQL,
        config: cfg ? { server: cfg.server, database: cfg.database, auth: cfg.auth, user: cfg.user || '', query: cfg.query } : null
      });
    }
    if (p === '/admin/sql/test' && req.method === 'POST') {
      var body = await readBody(req);
      try {
        var list = querySql(body);
        return send(res, 200, { ok: true, count: list.length, sample: list.slice(0, 5) });
      } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/admin/sql/save' && req.method === 'POST') {
      var cfg2 = await readBody(req);
      try {
        var list2 = querySql(cfg2);                 // validate first
        saveSqlConfig(cfg2);                          // persist (incl. password) locally
        setCatalog(list2, 'sql:' + cfg2.database);
        try { fs.writeFileSync(TSV_FILE, list2.map(function (r) { return r.sku + '\t' + r.name + '\t' + r.net + '\t' + r.srp; }).join('\n'), 'utf8'); } catch (e) {}
        LAST_ERROR = null;
        return send(res, 200, { ok: true, count: list2.length, version: VERSION });
      } catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    if (p === '/admin/sql/sync' && req.method === 'POST') {
      try { var n = syncFromSql(); return send(res, 200, { ok: true, count: n, version: VERSION }); }
      catch (e) { LAST_ERROR = e.message; return send(res, 200, { ok: false, error: e.message }); }
    }
    return send(res, 404, { error: 'unknown_admin_route' });
  }

  // ---- operational data (Phase 3): full-state load, per-record writes, SSE, counters ----
  if (p === '/events' || p.indexOf('/data') === 0) {
    if (!sessionUser(req, u)) return send(res, 401, { error: 'auth_required' });
    if (p === '/events' && req.method === 'GET') return sse.addClient(req, res);
    if (p === '/data' && req.method === 'GET') return send(res, 200, store.getState());
    if (p === '/data/import' && req.method === 'POST') {
      var suImp = sessionUser(req, u);
      if (!(suImp && suImp.isAdmin)) return send(res, 403, { error: 'admin_only' });
      var st = await readBody(req);
      try { var n = store.importState(st); sse.broadcast('reload', { reason: 'import' }); return send(res, 200, { ok: true, count: n }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    var cm = p.match(/^\/data\/counter\/([^/]+)$/);        // POST /data/counter/:name  -> {value}
    if (cm && req.method === 'POST') {
      var cbody = await readBody(req);
      try { return send(res, 200, { ok: true, value: store.allocCounter(decodeURIComponent(cm[1]), cbody.seed) }); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
    }
    var mm = p.match(/^\/data\/meta\/([^/]+)$/);            // POST /data/meta/:key
    if (mm && req.method === 'POST') {
      var mbody = await readBody(req);
      var mkey = decodeURIComponent(mm[1]);
      var suM = sessionUser(req, u);
      if (mkey === 'shop' && !(suM && suM.isAdmin)) return send(res, 403, { error: 'admin_only' });
      store.setMeta(mkey, mbody.value);
      sse.broadcast('meta', { key: mkey, value: mbody.value, origin: mbody.origin || null });
      return send(res, 200, { ok: true });
    }
    var pgm = p.match(/^\/data\/portal\/(.+)$/);            // POST /data/portal/:id  (staff publishes a snapshot)
    if (pgm && req.method === 'POST') {
      var pgbody = await readBody(req);
      store.setPortal(decodeURIComponent(pgm[1]), { data: pgbody.data || {}, pin: pgbody.pin != null ? String(pgbody.pin) : '' });
      return send(res, 200, { ok: true });
    }
    var rm = p.match(/^\/data\/([^/]+)\/(.+)$/);            // POST/DELETE /data/:coll/:id
    if (rm) {
      var coll = decodeURIComponent(rm[1]), id = decodeURIComponent(rm[2]);
      if (store.collections.indexOf(coll) < 0) return send(res, 400, { error: 'unknown_collection', coll: coll });
      if (req.method === 'POST') {
        var rbody = await readBody(req);
        store.upsert(coll, id, rbody.rec);
        sse.broadcast('upsert', { coll: coll, id: id, rec: rbody.rec, origin: rbody.origin || null });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        store.remove(coll, id);
        sse.broadcast('delete', { coll: coll, id: id, origin: u.searchParams.get('origin') || null });
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'unknown_data_route', path: p });
  }

  // ---- public customer portal (no auth): PIN-gated ----
  if (p.indexOf('/portal/') === 0) {
    // Build the customer-facing payload (vehicle data + current shop details).
    function portalPayload(id){
      var s = store.getPortal(id); if (!s) return null;
      var out = s.data || {};
      var shopE = store.getPortal('_shop'); if (shopE && shopE.data) out.shop = shopE.data;
      return out;
    }
    var pvm = p.match(/^\/portal\/([^/]+)\/verify$/);
    var pcm = p.match(/^\/portal\/([^/]+)\/claim$/);
    if (pvm && req.method === 'POST') {
      var vsnap = store.getPortal(decodeURIComponent(pvm[1]));
      if (!vsnap || !vsnap.pin) return send(res, 404, { error: 'no_record' });
      var vb = await readBody(req);
      if (String(vb.pin || '') === String(vsnap.pin)) return send(res, 200, { ok: true, data: portalPayload(decodeURIComponent(pvm[1])) });
      return send(res, 401, { ok: false, error: 'bad_pin' });
    }
    if (pcm && req.method === 'POST') {
      var cid = decodeURIComponent(pcm[1]);
      var csnap = store.getPortal(cid);
      if (!csnap) return send(res, 404, { error: 'no_record' });
      if (csnap.pin) return send(res, 409, { ok: false, error: 'already_set' });
      var cb = await readBody(req);
      var newPin = String(cb.pin || '').replace(/\D/g, '').slice(0, 6);
      if (newPin.length < 4) return send(res, 400, { ok: false, error: 'pin_too_short' });
      csnap.pin = newPin; store.setPortal(cid, csnap);
      // write the pin back onto the vehicle record so staff can view it (and it syncs live)
      var veh = store.getRecord('vehicles', cid);
      if (veh) { veh.portalPin = newPin; store.upsert('vehicles', cid, veh); sse.broadcast('upsert', { coll: 'vehicles', id: cid, rec: veh, origin: 'portal' }); }
      return send(res, 200, { ok: true, data: portalPayload(cid) });
    }
    if (req.method === 'GET') {
      var gid = decodeURIComponent(p.replace(/^\/portal\//, ''));
      var gsnap = store.getPortal(gid);
      if (!gsnap) return send(res, 404, { error: 'no_record' });
      return send(res, 200, { state: gsnap.pin ? 'locked' : 'claim' });
    }
  }

  // ---- job photos (Phase 3e): stored as files on the mini-PC ----
  if (p.indexOf('/photos/') === 0) {
    if (req.method === 'GET') {
      // Served openly (LAN / customer portal). Images can't send auth headers.
      var rel = p.replace(/^\/photos\//, '');
      var pfile = path.resolve(path.join(PHOTOS_DIR, rel));
      if (pfile.indexOf(path.resolve(PHOTOS_DIR)) !== 0) return send(res, 404, { error: 'not_found' });
      try {
        var pbuf = fs.readFileSync(pfile);
        var pext = path.extname(pfile).toLowerCase();
        var pct = pext === '.png' ? 'image/png' : pext === '.webp' ? 'image/webp' : 'image/jpeg';
        cors(res); res.writeHead(200, { 'Content-Type': pct, 'Cache-Control': 'public, max-age=31536000' });
        return res.end(pbuf);
      } catch (e) { return send(res, 404, { error: 'not_found' }); }
    }
    if (req.method === 'POST') {
      if (!sessionUser(req, u)) return send(res, 401, { error: 'auth_required' });
      var phm = p.match(/^\/photos\/([^/]+)\/([^/]+)$/);
      if (!phm) return send(res, 400, { error: 'bad_path' });
      var pbody = await readBody(req);
      var m2 = String(pbody.data || '').match(/^data:image\/(\w+);base64,(.*)$/);
      if (!m2) return send(res, 400, { error: 'bad_data' });
      var pex = m2[1] === 'png' ? 'png' : m2[1] === 'webp' ? 'webp' : 'jpg';
      var jid = decodeURIComponent(phm[1]).replace(/[^a-zA-Z0-9_-]/g, '');
      var pid = decodeURIComponent(phm[2]).replace(/[^a-zA-Z0-9_-]/g, '');
      var pdir = path.join(PHOTOS_DIR, jid);
      try { fs.mkdirSync(pdir, { recursive: true }); fs.writeFileSync(path.join(pdir, pid + '.' + pex), Buffer.from(m2[2], 'base64')); }
      catch (e) { return send(res, 200, { ok: false, error: e.message }); }
      return send(res, 200, { ok: true, url: '/photos/' + jid + '/' + pid + '.' + pex });
    }
  }

  // ---- optionally serve the branch app itself (self-contained mini-PC) ----
  if (req.method === 'GET' && APP_DIR) {
    var root = path.resolve(APP_DIR);
    var rel = decodeURIComponent(p).replace(/^\/+/, '');
    var file = path.resolve(path.join(root, rel || 'index.html'));
    if (file.indexOf(root) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    try {
      var data = fs.readFileSync(file);
      var ext = path.extname(file).toLowerCase();
      var ct = ext === '.html' ? 'text/html' : ext === '.js' ? 'application/javascript' :
               ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' :
               ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
      cors(res); res.writeHead(200, { 'Content-Type': ct }); return res.end(data);
    } catch (e) { /* fall through to 404 */ }
  }

  return send(res, 404, { error: 'unknown_route', path: p });
});

initialLoad();
var _bootAdmin = store.bootstrapAdmin();
if (_bootAdmin) console.log('[auth] created default admin — username "' + _bootAdmin.username + '" password "' + _bootAdmin.password + '"  (change it in the app: Accounts & Roles)');
server.listen(PORT, function () {
  console.log('[parts] Branch "' + BRANCH + '" parts server on http://0.0.0.0:' + PORT + '  (source: ' + SOURCE + ', ' + LIST.length.toLocaleString() + ' SKUs)');
  if (ADMIN_TOKEN) console.log('[parts] admin endpoints require X-Admin-Token');
});
