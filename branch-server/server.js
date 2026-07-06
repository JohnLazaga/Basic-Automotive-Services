/* Basic by JMSI — Branch Parts Server (Phase 1)
   Runs on a branch's always-on mini-PC. Zero external dependencies — just Node.
   Loads the parts catalog (parts.tsv: SKU  NAME  COST  PRICE) into memory and
   serves fast SKU lookups + search over the branch LAN, with NO internet needed.

   Run:   node server.js
   Config (optional env vars):
     PORT        listen port            (default 8790)
     DATA_FILE   path to the .tsv file  (default ./parts.tsv, else ../sync/parts.tsv)
     BRANCH      branch name/id          (default "branch") — for identification

   API:
     GET /health                 -> { ok, branch, count, version, loadedAt }
     GET /api/version            -> { version, count }
     GET /api/parts/:sku         -> { sku, name, net, srp }  (404 if unknown)
     GET /api/parts?q=TERM&limit -> { count, results:[ {sku,name,net,srp} ] }
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 8790;
const BRANCH = process.env.BRANCH || 'branch';

function resolveDataFile() {
  if (process.env.DATA_FILE) return process.env.DATA_FILE;
  const local = path.join(__dirname, 'parts.tsv');
  if (fs.existsSync(local)) return local;
  return path.join(__dirname, '..', 'sync', 'parts.tsv'); // dev fallback
}

/* ---- catalog state ---- */
var BY_SKU = new Map();   // sku -> { sku, name, net, srp }
var LIST = [];            // array for search
var VERSION = '';         // content hash
var LOADED_AT = null;
var DATA_FILE = '';
var ALL_GZ = null;        // gzipped {version,count,parts:[[sku,name,net,srp]]} — built once per load

function load() {
  DATA_FILE = resolveDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const map = new Map();
  const list = [];
  const lines = raw.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln) continue;
    var t = ln.split('\t');
    var sku = (t[0] || '').trim();
    if (!sku) continue;
    var rec = { sku: sku, name: (t[1] || '').trim(), net: Number(t[2]) || 0, srp: Number(t[3]) || 0 };
    map.set(sku, rec);
    list.push(rec);
  }
  BY_SKU = map;
  LIST = list;
  VERSION = crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
  LOADED_AT = new Date().toISOString();
  // Pre-build the gzipped whole-catalog payload the app downloads on sign-in.
  var payload = JSON.stringify({
    version: VERSION,
    count: list.length,
    parts: list.map(function (r) { return [r.sku, r.name, r.net, r.srp]; })
  });
  ALL_GZ = zlib.gzipSync(payload);
  console.log('[parts] loaded ' + list.length.toLocaleString() + ' SKUs from ' + DATA_FILE +
    '  (v' + VERSION + ', /api/all = ' + (ALL_GZ.length / 1024 | 0).toLocaleString() + ' KB gzipped)');
}

/* ---- search: exact/prefix SKU or name substring, case-insensitive ---- */
function search(q, limit) {
  var needle = String(q || '').trim().toUpperCase();
  if (!needle) return [];
  var out = [];
  for (var i = 0; i < LIST.length && out.length < limit; i++) {
    var r = LIST[i];
    if (r.sku.toUpperCase().indexOf(needle) === 0 || r.name.toUpperCase().indexOf(needle) >= 0) {
      out.push(r);
    }
  }
  return out;
}

/* ---- helpers ---- */
function send(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  var u = new URL(req.url, 'http://localhost');
  var p = u.pathname;

  if (p === '/health') {
    return send(res, 200, { ok: true, branch: BRANCH, count: LIST.length, version: VERSION, loadedAt: LOADED_AT, dataFile: DATA_FILE });
  }
  if (p === '/api/version') {
    return send(res, 200, { version: VERSION, count: LIST.length });
  }
  if (p === '/api/all') {
    // Whole catalog, gzipped. The browser transparently decompresses it.
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    return res.end(ALL_GZ);
  }
  if (p === '/api/parts' && u.searchParams.has('q')) {
    var limit = Math.min(Number(u.searchParams.get('limit')) || 50, 200);
    var results = search(u.searchParams.get('q'), limit);
    return send(res, 200, { count: results.length, results: results });
  }
  var m = p.match(/^\/api\/parts\/(.+)$/);
  if (m) {
    var sku = decodeURIComponent(m[1]).trim();
    var rec = BY_SKU.get(sku);
    if (!rec) return send(res, 404, { error: 'not_found', sku: sku });
    return send(res, 200, rec);
  }
  return send(res, 404, { error: 'unknown_route', path: p });
});

try {
  load();
} catch (e) {
  console.error('[parts] FAILED to load data file:', e.message);
  process.exit(1);
}
server.listen(PORT, function () {
  console.log('[parts] Branch "' + BRANCH + '" parts server listening on http://0.0.0.0:' + PORT);
  console.log('[parts] Try:  http://localhost:' + PORT + '/health');
});
