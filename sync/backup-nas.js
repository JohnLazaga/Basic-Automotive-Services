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

/* `portal` is excluded for the same reason as `catalog`: it is DERIVED, and it
   has a one-click rebuild. portalDataForVehicle() reconstructs each document
   from the vehicle plus its jobs, and Settings -> "Publish all portals"
   (publishAllPortals) regenerates every one of them. The pinHash comes from the
   vehicle's own portalPin, which IS backed up.

   It was also the single most expensive thing in the run — 730 of Fairview's
   ~1,150 seconds, roughly half the nightly total, for ~880 documents.

   The deciding argument is that these snapshots go STALE: publishPortalDoc()
   only fires at defined moments, so backing them up preserves whatever they last
   happened to hold. Rebuilding after a restore produces FRESHER portals than the
   backup ever contained. Copying stale derived data for twelve minutes a night
   buys nothing.

   RESTORE CONSEQUENCE: after restoring data, click Settings -> "Publish all
   portals" or every customer QR shows nothing. That step is in BACKUP.md.
   Put "portal" back by removing it here or setting "exclude": [] in the config. */
const EXCLUDE = new Set(['catalog', 'jobphotos', 'pmsphotos', 'sessions', 'portal']);

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
const NO_PHOTOS = !!arg('no-photos');
const PHOTOS_ONLY = !!arg('photos-only');

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

/* ---------------------------------------------------------------- photos --- */
/* Photos live in a WRITE-ONCE store beside the dated snapshots, not inside them:

     <dest>/photos/<branch>/<collection>/<docId>.jpg
     <dest>/photos/<branch>/<collection>/index.json

   They are the bulk of the database and they never change once written, so
   copying them into every nightly run would duplicate the same megabytes
   forever. Instead each run fetches only ids that are not already on disk.

   listDocuments() is what makes that cheap: it returns document REFERENCES
   without their payloads, so discovering "what exists" costs a couple of
   seconds instead of transferring every image. Fetching one photo takes 20-40s
   on this link, so downloading only the new ones is the difference between a
   viable nightly job and an impossible one.

   Images are decoded from their data: URL and written as real .jpg files rather
   than base64 JSON — a quarter smaller, and openable by anyone who ever needs
   them without a tool to decode them first.

   Photos are NEVER deleted from the store when they disappear from Firestore.
   That is the whole point of a backup. The index records lastSeen so you can
   tell what is still live. */
const PHOTO_COLLECTIONS = ['jobphotos', 'pmsphotos'];

function decodeDataUrl(s) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(s || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp'
            : mime === 'image/gif' ? 'gif' : 'jpg';
  return { ext, mime, buf: Buffer.from(m[2], 'base64') };
}

async function backupPhotos(db) {
  const crypto = require('crypto');
  console.log('\n  photos (incremental — only ids not already stored)');
  let fetched = 0, skipped = 0, bytes = 0, failed = 0;

  for (const b of cloudBranchIds()) {
    for (const coll of PHOTO_COLLECTIONS) {
      const col = db.collection('branches').doc(b).collection(coll);
      let refs;
      try { refs = await withRetry(coll, () => col.listDocuments()); }
      catch (e) { console.log('    ' + b + '/' + coll + ': listing failed — ' + e.message); failed++; continue; }
      if (!refs.length) continue;

      const dir = path.join(DEST, 'photos', b, coll);
      if (!DRY) fs.mkdirSync(dir, { recursive: true });

      /* "Already have" is derived from the FILES on disk, not from the index, so
         a run interrupted midway never re-downloads what it already saved and a
         lost index cannot cost hours of refetching. */
      let onDisk = new Set();
      try {
        onDisk = new Set(fs.readdirSync(dir)
          .filter(f => f !== 'index.json')
          .map(f => f.replace(/\.[^.]+$/, '')));
      } catch (e) { /* first run */ }

      let index = {};
      try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch (e) {}

      const missing = refs.filter(r => !onDisk.has(r.id));
      console.log('    ' + (b + '/' + coll).padEnd(24) + refs.length + ' live, ' +
                  onDisk.size + ' stored, ' + missing.length + ' to fetch');
      skipped += refs.length - missing.length;

      const now = new Date().toISOString();
      refs.forEach(r => { if (index[r.id]) index[r.id].lastSeen = now; });

      for (let i = 0; i < missing.length; i++) {
        const ref = missing[i];
        try {
          const t0 = Date.now();
          const snap = await withRetry(ref.id, () => ref.get());
          if (!snap.exists) continue;
          const d = snap.data() || {};
          const img = decodeDataUrl(d.data);
          if (!img) {
            /* Local-branch uploads store a URL instead of base64. Record it so
               the gap is visible rather than silently absent. */
            index[ref.id] = { jobId: d.jobId || '', url: d.url || '', note: 'no inline image data',
                              firstSeen: now, lastSeen: now };
            console.log('      ' + ref.id + ': no inline data (url only) — recorded, not fetched');
            continue;
          }
          const file = ref.id + '.' + img.ext;
          if (!DRY) fs.writeFileSync(path.join(dir, file), img.buf);
          index[ref.id] = {
            file, bytes: img.buf.length, mime: img.mime,
            sha256: crypto.createHash('sha256').update(img.buf).digest('hex'),
            jobId: d.jobId || '', caption: d.caption || '', ts: d.ts || '',
            key: d.key || undefined, ord: (typeof d.ord === 'number' ? d.ord : undefined),
            firstSeen: now, lastSeen: now
          };
          fetched++; bytes += img.buf.length;
          console.log('      [' + (i + 1) + '/' + missing.length + '] ' + file + '  ' +
                      (img.buf.length / 1024).toFixed(0) + ' KB  ' +
                      ((Date.now() - t0) / 1000).toFixed(1) + 's');
          /* Index written after every photo: each one costs 20-40s to fetch, so
             a local write is free by comparison and a crash keeps its metadata. */
          if (!DRY) fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
        } catch (e) {
          failed++;
          console.log('      ' + ref.id + ': FAILED — ' + ((e && e.message) || e).split('\n')[0].slice(0, 90));
        }
      }
      if (!DRY) fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
    }
  }
  console.log('    → ' + fetched + ' new (' + (bytes / 1048576).toFixed(2) + ' MB), ' +
              skipped + ' already stored' + (failed ? ', ' + failed + ' FAILED' : ''));
  return { fetched, skipped, bytes, failed };
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
  bad += verifyPhotos();

  console.log(bad ? '\n✗ ' + bad + ' problem(s) found' : '\n✓ snapshot verified');
  process.exit(bad ? 1 : 0);
}

/* The photo store is shared across runs rather than living inside a snapshot,
   so it is verified on its own terms: every file the index claims must exist and
   still hash to what was recorded. Re-hashing is what catches silent corruption
   on the NAS — a truncated or bit-rotted JPEG is still a file of the right name,
   and would otherwise be discovered only when someone needed the picture. */
function verifyPhotos() {
  const crypto = require('crypto');
  const root = path.join(DEST, 'photos');
  if (!fs.existsSync(root)) { console.log('\n  photos: no store yet'); return 0; }
  console.log('\n  photo store:');
  let problems = 0, files = 0, bytes = 0;

  for (const b of fs.readdirSync(root)) {
    for (const coll of PHOTO_COLLECTIONS) {
      const dir = path.join(root, b, coll);
      if (!fs.existsSync(dir)) continue;
      let index = {};
      try { index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); }
      catch (e) { console.log('    ' + b + '/' + coll + ': index.json unreadable'); problems++; continue; }

      let missing = 0, corrupt = 0, n = 0;
      for (const [id, rec] of Object.entries(index)) {
        if (!rec || !rec.file) continue;          // url-only records hold no file
        n++;
        const f = path.join(dir, rec.file);
        if (!fs.existsSync(f)) { missing++; continue; }
        const buf = fs.readFileSync(f);
        bytes += buf.length; files++;
        if (rec.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== rec.sha256) corrupt++;
      }
      /* Files present on disk but absent from the index would be invisible to a
         restore, so they count as a problem too. */
      const onDisk = fs.readdirSync(dir).filter(f => f !== 'index.json');
      const indexed = new Set(Object.values(index).map(r => r && r.file).filter(Boolean));
      const orphans = onDisk.filter(f => !indexed.has(f));

      problems += missing + corrupt + orphans.length;
      console.log('    ' + (b + '/' + coll).padEnd(24) + n + ' indexed' +
                  (missing ? ', ' + missing + ' MISSING' : '') +
                  (corrupt ? ', ' + corrupt + ' CHECKSUM MISMATCH' : '') +
                  (orphans.length ? ', ' + orphans.length + ' not in index' : '') +
                  (!missing && !corrupt && !orphans.length ? ' — all present, checksums match' : ''));
    }
  }
  console.log('    → ' + files + ' image file(s), ' + (bytes / 1048576).toFixed(2) + ' MB');
  return problems;
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

  /* The photo store sits outside the dated runs, so a listing that showed only
     snapshots would imply photos were not being backed up at all. */
  const proot = path.join(DEST, 'photos');
  if (!fs.existsSync(proot)) { console.log('  photo store: none yet'); return; }
  let files = 0, bytes = 0;
  for (const b of fs.readdirSync(proot)) {
    for (const coll of PHOTO_COLLECTIONS) {
      const dir = path.join(proot, b, coll);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f === 'index.json') continue;
        try { bytes += fs.statSync(path.join(dir, f)).size; files++; } catch (e) {}
      }
    }
  }
  console.log('  photo store: ' + files + ' image(s), ' + (bytes / 1048576).toFixed(2) + ' MB');
}

/* ------------------------------------------------------------------- main -- */
(async () => {
  if (!fs.existsSync(KEY)) die('serviceAccountKey.json not found in sync/');
  console.log('Destination: ' + DEST + (DRY ? '   [DRY RUN]' : '') + '\n');

  if (LIST) { list(); process.exit(0); }
  if (VERIFY) { verify(VERIFY); return; }

  initializeApp({ credential: cert(require(KEY)) });
  const db = getFirestore();

  let photoResult = null;
  if (!PHOTOS_ONLY) await backup(db);
  if (!NO_PHOTOS) photoResult = await backupPhotos(db);
  if (!PHOTOS_ONLY) rotate();

  /* A photo that failed to download is the one thing here that can quietly
     leave a gap, so it fails the run rather than printing a tick. */
  if (photoResult && photoResult.failed) {
    console.error('\n✗ Backup finished with ' + photoResult.failed +
                  ' photo failure(s) — rerun to pick them up (already-stored photos are skipped).');
    process.exit(1);
  }
  console.log('\n✓ Backup complete.');
  process.exit(0);
})().catch(e => {
  console.error('\n✗ Backup FAILED: ' + (e && e.message ? e.message : e));
  process.exit(1);   // non-zero so Task Scheduler shows the run as failed
});
