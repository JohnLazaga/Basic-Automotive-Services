#!/usr/bin/env node
/* ============================================================================
   Nightly backup of every cloud branch's operational data to a local NAS.

   Usage:
     node backup-nas.js                       back up (dest from config)
     node backup-nas.js --dest=\\NAS\backups\basic
     node backup-nas.js --dry-run             read + count, write nothing
     node backup-nas.js --verify              re-read the newest snapshot
     node backup-nas.js --verify=<runFolder>  re-read a specific one
     node backup-nas.js --list                show what is on the NAS

   Destination, first match wins:
     1. --dest=<path>
     2. BACKUP_DEST environment variable
     3. "dest" in sync/backup-config.json      (git-ignored, per-machine)

   WHAT IS BACKED UP
   Collections are DISCOVERED, not listed, so a collection added later is picked
   up without editing this file — the failure mode of a hardcoded include-list is
   silently missing new data, and you only find out when you need the backup.
   Everything is taken except the exclusions below, each excluded for a reason:

     catalog     ~102k parts in gzipped chunks. Regenerated from SQL Server every
                 night by upload-all.js, so it is derived data, not a record. It
                 would also dwarf everything else in the snapshot.
     jobphotos   The bulk of the database. These docs are immutable once written,
     pmsphotos   so they want an incremental copy, not a nightly full pull. Phase
                 two — until then, PHOTOS ARE NOT BACKED UP.
     sessions    Premises-gate sessions. Short-lived, reissued on sign-in, and
                 restoring a stale one would be wrong.

   WHAT THIS PROTECTS AGAINST
   Losing the Firebase project, or a mass deletion. It does NOT give
   point-in-time recovery: a bad write during the day is captured by that night's
   run as the new truth. Recovering something damaged and then backed up needs
   Firestore PITR, which is a billing feature.

   The snapshot contains customer PII — names, plates, addresses, phone numbers —
   and the staff account documents. Treat the NAS share accordingly.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');

const ROOT = path.join(__dirname, '..');
const KEY = path.join(__dirname, 'serviceAccountKey.json');
const CONFIG = path.join(__dirname, 'backup-config.json');

const EXCLUDE = new Set(['catalog', 'jobphotos', 'pmsphotos', 'sessions']);

/* `portal` is the slowest collection by a wide margin — one published snapshot
   per vehicle, and it dominates the run. It IS derived: portalDataForVehicle()
   rebuilds it from the vehicle plus its jobs, and the pinHash comes from the
   vehicle's own portalPin, which is backed up. It is kept anyway BECAUSE there
   is no bulk republish tool — publishPortalDoc() is per-vehicle and fires on
   save, so losing it would leave every customer QR showing nothing until each
   vehicle was touched again. Drop it via config if you would rather have the
   time back and accept that. */

const argv = process.argv.slice(2);
const arg = (name) => {
  const hit = argv.find(a => a === '--' + name || a.indexOf('--' + name + '=') === 0);
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};
const DRY = !!arg('dry-run');
const LIST = !!arg('list');
const VERIFY = arg('verify');

function die(msg) { console.error('\n✗ ' + msg + '\n'); process.exit(1); }
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { return {}; } }

const cfg = readConfig();
const DEST = arg('dest') || process.env.BACKUP_DEST || cfg.dest || '';
const KEEP_DAILY = Number(arg('keep-daily') || cfg.keepDaily || 30);
const KEEP_MONTHLY = Number(arg('keep-monthly') || cfg.keepMonthly || 12);

/* Extra collections to skip, on top of the built-in list. Anything dropped here
   is NOT in the snapshot and cannot be restored from it — the manifest records
   what was excluded so a future reader knows what they are missing. */
[].concat(cfg.exclude || [], String(arg('exclude') || '').split(',').filter(Boolean))
  .map(s => String(s).trim()).filter(Boolean)
  .forEach(c => EXCLUDE.add(c));

if (!DEST) {
  die('No backup destination set.\n\n' +
      '  Set it once, then this script needs no arguments:\n' +
      '    sync/backup-config.json   { "dest": "\\\\\\\\NAS\\\\backups\\\\basic", "keepDaily": 30, "keepMonthly": 12 }\n\n' +
      '  Or pass it:   node backup-nas.js --dest=\\\\NAS\\backups\\basic');
}

/* A UNC path that is offline looks exactly like a path that is simply wrong, and
   both must stop the run — a backup that silently writes nowhere is worse than
   no backup, because it reports success. */
function assertDestWritable() {
  try { fs.mkdirSync(DEST, { recursive: true }); } catch (e) {
    die('Cannot reach or create the destination:\n    ' + DEST + '\n  ' + e.message +
        '\n\n  If this is a NAS share, check it is mounted and this account can write to it.');
  }
  const probe = path.join(DEST, '.write-probe-' + process.pid);
  try { fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe); } catch (e) {
    die('Destination is not writable:\n    ' + DEST + '\n  ' + e.message);
  }
}

function cloudBranchIds() {
  const branches = JSON.parse(fs.readFileSync(path.join(ROOT, 'branches.json'), 'utf8'));
  // Branch ID, not URL slug — Fairview's slug is 'fairview' but its id is 'main'.
  const all = Object.values(branches).filter(b => b.partsSource === 'cloud').map(b => b.id || b.slug);
  /* --branch limits the run to one branch. A full run takes ~25 minutes on this
     link, almost all of it Fairview, which makes any change to this script
     painful to check — and an unverifiable backup script is how you end up with
     unverified backups. Also useful for re-pulling a single branch on demand. */
  const only = arg('branch');
  if (!only || only === true) return all;
  const want = String(only).split(',').map(s => s.trim()).filter(Boolean);
  const bad = want.filter(w => !all.includes(w));
  if (bad.length) die('Unknown branch id(s): ' + bad.join(', ') +
                      '\n  Known cloud branch ids: ' + all.join(', ') +
                      '\n  (these are branches.json "id" values, not URL slugs)');
  return want;
}

function stampNow() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
         'T' + p(d.getHours()) + p(d.getMinutes());
}
const runFolders = () => {
  try {
    return fs.readdirSync(DEST)
      .filter(n => /^\d{4}-\d{2}-\d{2}T\d{4}$/.test(n))
      .filter(n => { try { return fs.statSync(path.join(DEST, n)).isDirectory(); } catch (e) { return false; } })
      .sort();
  } catch (e) { return []; }
};

/* Read a collection in PAGES rather than one get().

   A single unbounded get() on `jobs` takes longer than the Firestore client's
   300s gRPC deadline over a shop-grade connection — measured at roughly 5-25
   KB/s from here, so 1.85 MB of job documents overruns it and the whole run dies
   with DEADLINE_EXCEEDED. Paging keeps every request small and quick regardless
   of how slow the link is or how large the collection grows, and bounds memory
   at one page instead of a whole collection.

   Ordering by document id gives a stable, index-free cursor that works on any
   collection without needing a composite index. */
const PAGE_SIZE = Number(arg('page') || cfg.pageSize || 100);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Unattended job: a transient network blip must not lose the night's backup. */
async function withRetry(label, fn, tries = 4) {
  let wait = 2000;
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = (e && e.message) || String(e);
      const transient = /DEADLINE_EXCEEDED|UNAVAILABLE|INTERNAL|RESET|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg);
      if (!transient || i >= tries) throw e;
      console.log('      retry ' + i + '/' + (tries - 1) + ' on ' + label + ' — ' + msg.split('\n')[0].slice(0, 80));
      await sleep(wait); wait *= 2;
    }
  }
}

async function readCollection(col) {
  const out = [];
  let cursor = null;
  for (;;) {
    let q = col.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await withRetry(col.id, () => q.get());
    if (snap.empty) break;
    snap.docs.forEach(d => out.push({ __id: d.id, ...d.data() }));
    cursor = snap.docs[snap.docs.length - 1];      // snapshot cursor: no id-format guesswork
    if (snap.docs.length < PAGE_SIZE) break;
  }
  return out;
}

/* ---------------------------------------------------------------- back up -- */
async function backup(db) {
  assertDestWritable();
  const stamp = stampNow();
  // Assemble under a dot-prefixed staging folder and rename only on full success,
  // so an interrupted or failed run never leaves something that looks complete.
  const staging = path.join(DEST, '.incoming-' + stamp);
  const finalDir = path.join(DEST, stamp);
  if (!DRY) { fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true }); }

  const manifest = { startedAt: new Date().toISOString(), finishedAt: null, stamp,
                     excluded: [...EXCLUDE], branches: {}, ok: false };
  let grandDocs = 0, grandBytes = 0;

  for (const b of cloudBranchIds()) {
    const branchRef = db.collection('branches').doc(b);
    const data = { branchId: b, meta: {}, collections: {} };
    const counts = {};
    console.log('  ' + b);

    const branchDoc = await branchRef.get();
    if (branchDoc.exists) data.meta.branchDoc = branchDoc.data();

    const cols = await branchRef.listCollections();
    for (const col of cols) {
      if (EXCLUDE.has(col.id)) continue;
      /* Progress is per COLLECTION, not per branch. Reads from a shop connection
         run at single-digit KB/s, so `jobs` alone can take minutes — without a
         line per collection an unattended run is indistinguishable from a hang,
         and someone will kill it halfway. */
      const t0 = Date.now();
      const rows = await readCollection(col);
      data.collections[col.id] = rows;
      counts[col.id] = rows.length;
      console.log('    ' + col.id.padEnd(16) + String(rows.length).padStart(6) +
                  ' docs  ' + ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's');
    }

    const json = JSON.stringify(data);
    const bytes = Buffer.byteLength(json, 'utf8');
    const docs = Object.values(counts).reduce((s, n) => s + n, 0);
    grandDocs += docs; grandBytes += bytes;
    manifest.branches[b] = { docs, bytes, counts };

    if (!DRY) fs.writeFileSync(path.join(staging, b + '.json'), json, 'utf8');
    console.log('    ' + '→ '.padEnd(16) + String(docs).padStart(6) + ' docs  ' +
                (bytes / 1048576).toFixed(2) + ' MB');
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.ok = true;
  if (!DRY) {
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(staging, finalDir);     // the commit point
  }

  console.log('\n  ' + (DRY ? '[dry run] would write ' : 'wrote ') + grandDocs.toLocaleString() +
              ' docs, ' + (grandBytes / 1048576).toFixed(2) + ' MB' + (DRY ? '' : ' -> ' + finalDir));
  return finalDir;
}

/* --------------------------------------------------------------- rotation -- */
/* Keep the last KEEP_DAILY runs, plus the FIRST run of each of the last
   KEEP_MONTHLY months. Without rotation the share fills and nobody notices until
   a backup fails for lack of space — which is precisely when it is needed. */
function rotate() {
  const runs = runFolders();
  if (!runs.length) return;
  const keep = new Set(runs.slice(-KEEP_DAILY));
  const firstOfMonth = new Map();
  for (const r of runs) {
    const ym = r.slice(0, 7);
    if (!firstOfMonth.has(ym)) firstOfMonth.set(ym, r);
  }
  [...firstOfMonth.entries()].sort().slice(-KEEP_MONTHLY).forEach(([, r]) => keep.add(r));

  const drop = runs.filter(r => !keep.has(r));
  if (!drop.length) { console.log('  rotation: nothing to remove (' + runs.length + ' kept)'); return; }
  for (const r of drop) {
    if (DRY) continue;
    try { fs.rmSync(path.join(DEST, r), { recursive: true, force: true }); } catch (e) {
      console.error('  could not remove ' + r + ': ' + e.message);
    }
  }
  console.log('  rotation: removed ' + drop.length + ', kept ' + keep.size +
              (DRY ? '  [dry run — nothing deleted]' : ''));
}

/* ----------------------------------------------------------------- verify -- */
/* A backup nobody has read back is a hope, not a backup. This re-opens a
   snapshot from the NAS, parses every branch file and checks it against the
   manifest the run wrote. */
function verify(which) {
  const runs = runFolders();
  if (!runs.length) die('No snapshots found in ' + DEST);
  const name = (typeof which === 'string' && which !== 'true' && which) ? which : runs[runs.length - 1];
  const dir = path.join(DEST, name);
  if (!fs.existsSync(dir)) die('No such snapshot: ' + dir);

  console.log('Verifying ' + dir + '\n');
  let man;
  try { man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { die('manifest.json missing or unreadable — snapshot is incomplete: ' + e.message); }
  if (!man.ok) die('manifest says this run did not complete');

  let bad = 0;
  for (const [b, exp] of Object.entries(man.branches)) {
    const f = path.join(dir, b + '.json');
    let got;
    try { got = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (e) { console.log('  ' + b.padEnd(14) + 'UNREADABLE — ' + e.message); bad++; continue; }
    const counts = {};
    for (const [c, arr] of Object.entries(got.collections || {})) counts[c] = arr.length;
    const mismatch = Object.keys(exp.counts).filter(c => counts[c] !== exp.counts[c]);
    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    if (mismatch.length) {
      bad++;
      console.log('  ' + b.padEnd(14) + 'MISMATCH in ' + mismatch.map(c =>
        c + ' (manifest ' + exp.counts[c] + ', file ' + (counts[c] || 0) + ')').join(', '));
    } else {
      console.log('  ' + b.padEnd(14) + 'ok  ' + String(total).padStart(6) + ' docs across ' +
                  Object.keys(counts).length + ' collections');
    }
  }
  console.log(bad ? '\n✗ ' + bad + ' branch file(s) failed verification' : '\n✓ snapshot verified');
  process.exit(bad ? 1 : 0);
}

function list() {
  const runs = runFolders();
  if (!runs.length) { console.log('No snapshots in ' + DEST); return; }
  console.log('Snapshots in ' + DEST + ':\n');
  for (const r of runs) {
    let n = '?', mb = '?';
    try {
      const m = JSON.parse(fs.readFileSync(path.join(DEST, r, 'manifest.json'), 'utf8'));
      n = Object.values(m.branches).reduce((s, x) => s + x.docs, 0).toLocaleString();
      mb = (Object.values(m.branches).reduce((s, x) => s + x.bytes, 0) / 1048576).toFixed(2);
    } catch (e) { n = 'INCOMPLETE'; }
    console.log('  ' + r + '   ' + String(n).padStart(9) + ' docs   ' + String(mb).padStart(7) + ' MB');
  }
  console.log('\n  ' + runs.length + ' snapshot(s)');
}

/* ------------------------------------------------------------------- main -- */
(async () => {
  if (!fs.existsSync(KEY)) die('serviceAccountKey.json not found in sync/');
  console.log('Destination: ' + DEST + (DRY ? '   [DRY RUN]' : '') + '\n');

  if (LIST) { list(); process.exit(0); }
  if (VERIFY) { verify(VERIFY); return; }

  initializeApp({ credential: cert(require(KEY)) });
  const db = getFirestore();
  await backup(db);
  rotate();
  console.log('\n✓ Backup complete.');
  process.exit(0);
})().catch(e => {
  console.error('\n✗ Backup FAILED: ' + (e && e.message ? e.message : e));
  process.exit(1);   // non-zero so Task Scheduler shows the run as failed
});
