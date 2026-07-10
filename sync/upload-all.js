/* Upload the freshly-exported parts catalog (parts.tsv) into EVERY cloud branch.

   All cloud branches share the one Fairview SQL Server catalog, so the nightly
   sync exports from SQL once (export-sql.ps1) and then fans the same parts.tsv
   out to each branch's own Firestore catalog (branches/<slug>/catalog). This
   loops over branches.json, so newly-added cloud branches are covered
   automatically with no edit here.

   Each branch is uploaded via the existing, tested upload.js (which content-
   hashes the catalog and writes nothing when a branch is already current — so
   re-running is cheap). Local-parts branches are skipped: they sync from their
   own mini-PC's SQL Server, not from here.

   Usage:  node upload-all.js
   Exit code is non-zero if ANY branch failed, so the scheduled task surfaces it. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const branches = JSON.parse(fs.readFileSync(path.join(ROOT, 'branches.json'), 'utf8'));
const cloud = Object.values(branches).filter(b => b.partsSource === 'cloud').map(b => b.slug);

if (!cloud.length) { console.log('No cloud branches in branches.json — nothing to do.'); process.exit(0); }
console.log('Cloud branches to sync: ' + cloud.join(', '));

const failed = [];
for (const slug of cloud) {
  console.log('\n=== ' + slug + ' ===');
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'upload.js'), '--branch=' + slug], { stdio: 'inherit' });
  } catch (e) {
    console.error('✗ upload failed for branch "' + slug + '"');
    failed.push(slug);
  }
}

console.log('\n----------------------------------------');
if (failed.length) {
  console.error('DONE with errors — failed: ' + failed.join(', ') + '  (ok: ' + (cloud.length - failed.length) + '/' + cloud.length + ')');
  process.exit(1);
}
console.log('DONE — all ' + cloud.length + ' cloud branches synced (' + cloud.join(', ') + ').');
process.exit(0);
