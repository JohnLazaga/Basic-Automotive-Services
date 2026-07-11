/* Basic by JMSI — one-time UPPERCASE migration of existing records.
   Brings already-saved data in line with the universal "encode in UPPERCASE"
   rule (see installUppercase() in src/part2_shell.js). Runs across EVERY cloud
   branch. Uppercases ONLY an explicit allowlist of free-text fields — codes,
   ids, dates, phone numbers, e-mails, enums, roles, SKUs, audit logs, payments
   and signatures are left exactly as they are.

   Safe by default:
     • Writes a full pre-migration backup per branch BEFORE touching anything.
     • DRY-RUN unless you pass --apply (prints what would change, writes nothing).
     • Idempotent — re-running changes nothing once data is uppercase.

   Usage (run inside sync/, needs serviceAccountKey.json):
     node uppercase-migrate.js                 # dry-run, all cloud branches
     node uppercase-migrate.js --branch=main   # dry-run, one branch
     node uppercase-migrate.js --apply         # back up + apply, all cloud branches
*/
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const ROOT = path.join(__dirname, '..');
const APPLY = process.argv.indexOf('--apply') >= 0;
const ONE = (process.argv.find(a => a.indexOf('--branch=') === 0) || '').split('=')[1] || '';

// Only free-text, staff-encoded fields. Everything not listed is left untouched.
// arrays: uppercase the named subfields of each element. objects: named subfields.
const SPEC = {
  jobs: {
    fields: ['contactPerson','approvedReleaseBy','notes','pmsRef','siRef','plate',
             'partsSalesman','chassis','owner','address','make','assessedBy','model','variant'],
    arrays: { lines: ['desc'], addlWork: ['desc','reportedTo'] },      // NOT sku (catalog match)
    objects: { inspection: ['condition','testDrive','lights'], checklist: ['bodyNotes'] },
  },
  vehicles:       { fields: ['model','plate','make','address','owner','chassis','contactPerson','variant'] },
  estimates:      { fields: ['plate','owner','contactPerson','make','model','assessedBy','approvedSA','approvedSV','notes','address'],
                    arrays: { lines: ['desc'] } },
  appointments:   { fields: ['plate','customer','vehicle','service','notes'] },
  purchaseOrders: { fields: ['supplier','notes'], arrays: { lines: ['name'] } },
  staff:          { fields: ['name','nickname'] },                     // NOT role (perms key)
  labor:          { fields: ['name'] },
  bays:           { fields: ['name'] },
};
const MIGRATE_COLLECTIONS = Object.keys(SPEC);
// Backups also capture these read-only-for-us collections so a restore is complete.
const BACKUP_ALSO = ['parts','portal','appt_requests','portal_claims'];

function upField(obj, f, counter) {
  if (obj && typeof obj[f] === 'string') {
    const u = obj[f].toUpperCase();
    if (u !== obj[f]) { obj[f] = u; counter.n++; }
  }
}
function transform(rec, spec) {
  const counter = { n: 0 };
  (spec.fields || []).forEach(f => upField(rec, f, counter));
  for (const arrKey in (spec.arrays || {})) {
    if (Array.isArray(rec[arrKey])) rec[arrKey].forEach(el => (spec.arrays[arrKey]).forEach(f => upField(el, f, counter)));
  }
  for (const objKey in (spec.objects || {})) {
    if (rec[objKey] && typeof rec[objKey] === 'object') (spec.objects[objKey]).forEach(f => upField(rec[objKey], f, counter));
  }
  return counter.n;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');

(async () => {
  initializeApp({ credential: cert(require(path.join(__dirname, 'serviceAccountKey.json'))) });
  const db = getFirestore();

  const branchesAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'branches.json'), 'utf8'));
  let slugs = Object.keys(branchesAll).filter(s => branchesAll[s].dataSource === 'cloud');
  if (ONE) slugs = slugs.filter(s => s === ONE);
  if (!slugs.length) { console.error('No matching cloud branches.'); process.exit(1); }

  console.log('\n' + (APPLY ? '=== APPLY ===' : '=== DRY-RUN (no writes) ===') + '  branches: ' + slugs.join(', ') + '\n');
  const grand = { docs: 0, changedDocs: 0, fields: 0 };

  for (const slug of slugs) {
    const bRoot = db.collection('branches').doc(slug);
    console.log('────────  ' + slug + '  ────────');

    // 1) full backup of this branch (always, even in dry-run so review is safe)
    const backup = { branch: slug, at: stamp, meta: {}, collections: {} };
    for (const m of ['shop','counters']) {
      const d = await bRoot.collection('meta').doc(m).get();
      backup.meta[m] = d.exists ? d.data() : null;
    }
    for (const c of MIGRATE_COLLECTIONS.concat(BACKUP_ALSO)) {
      const snap = await bRoot.collection(c).get();
      backup.collections[c] = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    }
    const bfile = path.join(__dirname, 'premigration-backup_' + slug + '_' + stamp + '.json');
    fs.writeFileSync(bfile, JSON.stringify(backup, null, 0));
    console.log('  backup → ' + path.basename(bfile));

    // 2) transform + (optionally) write
    let batch = db.batch(), ops = 0, bDocs = 0, bChanged = 0, bFields = 0;
    const samples = [];
    for (const c of MIGRATE_COLLECTIONS) {
      const docs = backup.collections[c];
      for (const { id, data } of docs) {
        bDocs++;
        const before = JSON.stringify(data);
        const nFields = transform(data, SPEC[c]);
        if (nFields > 0 && JSON.stringify(data) !== before) {
          bChanged++; bFields += nFields;
          if (samples.length < 6) samples.push(c + '/' + id + '  (' + nFields + ' field' + (nFields > 1 ? 's' : '') + ')');
          if (APPLY) {
            batch.set(bRoot.collection(c).doc(id), data);
            if (++ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
          }
        }
      }
    }
    if (APPLY && ops > 0) await batch.commit();

    console.log('  docs scanned: ' + bDocs + '   docs changed: ' + bChanged + '   fields uppercased: ' + bFields);
    samples.forEach(s => console.log('    · ' + s));
    console.log('  ' + (APPLY ? (bChanged ? '✓ written' : 'nothing to write') : '(dry-run — not written)') + '\n');
    grand.docs += bDocs; grand.changedDocs += bChanged; grand.fields += bFields;
  }

  console.log('======== TOTAL ========');
  console.log('  docs scanned: ' + grand.docs + '   docs changed: ' + grand.changedDocs + '   fields uppercased: ' + grand.fields);
  if (!APPLY) console.log('\n  Dry-run only. Re-run with --apply to write (a backup is saved either way).');
  process.exit(0);
})().catch(e => { console.error('\nMigration failed:', e); process.exit(1); });
