/* Upload the exported parts catalog into a branch's Firestore catalog as a few
   compressed, login-protected documents (branches/<branch>/catalog).
   - Each chunk doc holds ~10k parts gzipped+base64 (well under the 1MB limit).
   - catalog/_meta holds {version, chunks, count}. The version is a content hash,
     so a sync with no real changes writes nothing (clients won't re-download).
   - The catalog is readable only by that branch's signed-in active staff
     (Firestore rules); it is never public.

   Usage:  node upload.js [--branch=<slug>]      (default branch: main)
   Each branch syncs its OWN SQL Server into its OWN cloud catalog, isolated. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const KEY = path.join(__dirname, 'serviceAccountKey.json');
const TSV = path.join(__dirname, 'parts.tsv');
const PER_CHUNK = 10000;
const BRANCH = (process.argv.find(a => a.indexOf('--branch=') === 0) || '').split('=')[1] || 'main';

initializeApp({ credential: cert(require(KEY)) });
const db = getFirestore();
const catalog = db.collection('branches').doc(BRANCH).collection('catalog');   // branches/<branch>/catalog
console.log('Target branch: ' + BRANCH + '  (branches/' + BRANCH + '/catalog)');

(async () => {
  const raw = fs.readFileSync(TSV, 'utf8');
  const lines = raw.split('\n');
  const parts = [];
  for (const ln of lines) {
    if (!ln) continue;
    const t = ln.split('\t');
    const sku = (t[0] || '').trim();
    if (!sku) continue;
    parts.push([sku, (t[1] || '').trim(), Number(t[2]) || 0, Number(t[3]) || 0]);
  }
  console.log('Parsed ' + parts.length.toLocaleString() + ' parts');

  // content hash for change detection
  const version = crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);

  const metaRef = catalog.doc('_meta');
  const existing = await metaRef.get();
  if (existing.exists && existing.data().version === version) {
    console.log('No changes (version ' + version + ') — nothing to upload.');
    process.exit(0);
  }

  // build chunks
  const chunks = [];
  for (let i = 0; i < parts.length; i += PER_CHUNK) chunks.push(parts.slice(i, i + PER_CHUNK));
  console.log('Writing ' + chunks.length + ' chunk docs…');

  let batch = db.batch(), ops = 0;
  for (let i = 0; i < chunks.length; i++) {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(chunks[i]), 'utf8')).toString('base64');
    batch.set(catalog.doc('chunk_' + i), { data: gz, n: chunks[i].length });
    if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  // remove stale chunks from a previous, larger sync
  if (existing.exists) {
    const prevChunks = existing.data().chunks || 0;
    for (let i = chunks.length; i < prevChunks; i++) { batch.delete(catalog.doc('chunk_' + i)); ops++; }
  }
  batch.set(metaRef, { version: version, chunks: chunks.length, count: parts.length, updatedAt: new Date().toISOString() });
  await batch.commit();

  console.log('Done. version=' + version + '  chunks=' + chunks.length + '  parts=' + parts.length.toLocaleString());
  process.exit(0);
})().catch(e => { console.error('Upload failed:', e); process.exit(1); });
