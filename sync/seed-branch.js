/* Seed an EMPTY cloud branch in Firestore: branches/<slug>/meta/{shop,counters}.
   Idempotent — skips if the branch already has a shop doc. Run from sync/:
     node seed-branch.js <slug>
   Requires sync/serviceAccountKey.json (git-ignored). Used by add-cloud-branch.js. */
const { cert } = require('firebase-admin/app');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

const slug = process.argv[2];
if (!slug) { console.error('  ✗ slug required'); process.exit(1); }
const branches = JSON.parse(fs.readFileSync('../branches.json', 'utf8'));
const b = branches[slug];
if (!b) { console.error('  ✗ "' + slug + '" not found in branches.json'); process.exit(1); }

admin.initializeApp({ credential: cert(require('./serviceAccountKey.json')) });
const db = getFirestore();

(async () => {
  const root = db.collection('branches').doc(slug);
  const shop = await root.collection('meta').doc('shop').get();
  if (shop.exists) { console.log('  branch "' + slug + '" already seeded — skipping'); process.exit(0); }
  // Minimal shop (owner fills address/contact/TIN in Settings); fresh counters.
  await root.collection('meta').doc('shop').set({
    name: b.name, businessStyle: '', address: '', contact: '', tin: '',
    vatReg: true, vatRate: 12, portalUrl: b.publicUrl, partsSource: 'cloud', theme: 'light'
  });
  await root.collection('meta').doc('counters').set({ est: 0, jo: 0, or: 1000, po: 0 });
  await root.set({ id: slug, name: b.name, createdAt: new Date().toISOString() }, { merge: true });
  console.log('  ✓ seeded empty branch branches/' + slug + ' (fresh OR/JO/EST/PO series)');
  process.exit(0);
})().catch(e => { console.error('  ✗ seed error:', e.message || e); process.exit(1); });
