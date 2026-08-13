/* Upload the exported parts catalog into a branch's Firestore catalog as a few
   compressed, login-protected documents (branches/<branch>/catalog).
   - Each chunk doc holds ~10k parts gzipped+base64 (well under the 1MB limit).
   - catalog/_meta holds {version, chunks, count}. The version is a content hash,
     so a sync with no real changes writes nothing (clients won't re-download).
   - The catalog is readable only by that branch's signed-in active staff
     (Firestore rules); it is never public.

   Usage:  node upload.js [--branch=<branchId>]   (default branch: main)
   --branch takes the FIRESTORE BRANCH ID from branches.json (the `id` field),
   which is what the app reads — NOT the URL slug. They differ for Fairview:
   slug 'fairview', branch id 'main'.
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

/* Rows the upstream database carries that are not sellable parts — negative-SKU
   internal adjustment records, a SKU 0, and rows with no name at all. Kept
   identical to the branch server's junkRow() in branch-server/server.js: this is
   the OTHER end of the same catalog, and the two must not disagree about what a
   usable part is.

   The nameless rows are the harmful ones. The SKU lookup exists to supply the
   part name, so a row without one fills in nothing while still overwriting Net
   and SRP with its own figures — that is how SKU 1034 put its prices under a SKU
   the encoder was still typing. Named parts with no price are kept: no price yet
   is normal, and the encoder can see the name and type the amount. */
function junkRow(sku, name) {
  if (!/^\d+$/.test(sku) || Number(sku) <= 0) return true;
  return name === '';
}

(async () => {
  const raw = fs.readFileSync(TSV, 'utf8');
  const lines = raw.split('\n');
  const parts = [];
  let skipped = 0;
  for (const ln of lines) {
    if (!ln) continue;
    const t = ln.split('\t');
    const sku = (t[0] || '').trim();
    if (!sku) continue;
    const name = (t[1] || '').trim();
    if (junkRow(sku, name)) { skipped++; continue; }
    parts.push([sku, name, Number(t[2]) || 0, Number(t[3]) || 0]);
  }
  console.log('Parsed ' + parts.length.toLocaleString() + ' parts' +
              (skipped ? '  (skipped ' + skipped.toLocaleString() + ' unusable row(s))' : ''));

  /* Content hash over what is actually UPLOADED, not over the source file.
     Hashing the raw file would mean a change to the filter yields the SAME
     version, so the "no changes" check below would skip the re-upload and leave
     the junk sitting in the cloud catalog indefinitely. Hashing the filtered
     rows also matches how the branch server derives its version (setCatalog in
     server.js), so the two ends agree on what "unchanged" means. */
  const version = crypto.createHash('md5')
    .update(parts.map(r => r.join('\t')).join('\n')).digest('hex').slice(0, 16);

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
