#!/usr/bin/env node
/* ============================================================================
   One-time backfill: fill BLANK Vehicles-record fields from the vehicle's jobs.

   Why: a Job Order created with "Create, finish later" made its Vehicles record
   with gaps, and completing the details later in Job Details only updated the
   job — the vehicle (and its public portal page) stayed blank. The app now
   syncs going forward (fillVehicleBlanks in part4_jobs.js); this repairs the
   records created before that.

   Rules (same as the app): only BLANK vehicle fields are filled, never
   overwritten. Each field takes the newest non-blank value across the
   vehicle's non-cancelled jobs (linked by vehicleId, or by plate).

   Usage:
     node backfill-vehicles.js                    dry run, every cloud branch
     node backfill-vehicles.js --branch=commonwealth
     node backfill-vehicles.js --apply            write the changes
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const ROOT = path.join(__dirname, '..');
const KEY = path.join(__dirname, 'serviceAccountKey.json');
const APPLY = process.argv.includes('--apply');
const onlyArg = (process.argv.find(a => a.startsWith('--branch=')) || '').split('=')[1];

const FIELDS = ['owner','address','contactPerson','contactNumber','chassis','year','make','model','variant'];
const blank = v => !String(v == null ? '' : v).trim();
/* Same as VEHICLE_PLACEHOLDER in part4_jobs.js — values typed only to get past the gate. */
const PLACEHOLDER = /^(n\/?a|none|tba|[-.\s]+)$/i;
const usable = v => !blank(v) && !PLACEHOLDER.test(String(v).trim());

/* Mirror of pickContact() in part10_portal.js — the portal shows one mobile #. */
function pickContact(s){
  const parts = String(s || '').split(/[·,;\/|\n]+/).map(t => t.trim()).filter(Boolean);
  const mobile = parts.filter(p => /(^|\D)(09\d|\+?639)/.test(p))[0];
  return mobile || parts[0] || '';
}

function cloudBranchIds(){
  const branches = JSON.parse(fs.readFileSync(path.join(ROOT, 'branches.json'), 'utf8'));
  const all = Object.values(branches).filter(b => b.dataSource === 'cloud').map(b => b.id || b.slug);
  if (!onlyArg) return all;
  const want = onlyArg.split(',').map(s => s.trim());
  return Object.values(branches).filter(b => want.includes(b.id) || want.includes(b.slug)).map(b => b.id || b.slug);
}

async function run(db, b){
  const root = db.collection('branches').doc(b);
  const [vs, js] = await Promise.all([root.collection('vehicles').get(), root.collection('jobs').get()]);
  const jobs = js.docs.map(d => d.data()).filter(j => !j.joCancel)
    .sort((a, c) => String(c.billedAt || c.dateIn || '').localeCompare(String(a.billedAt || a.dateIn || '')));
  const changes = [];
  vs.forEach(d => {
    const v = d.data();
    const missing = FIELDS.filter(k => blank(v[k]));
    if (!missing.length) return;
    const plate = String(v.plate || '').trim().toUpperCase();
    const mine = jobs.filter(j => j.vehicleId === d.id || (plate && String(j.plate || '').trim().toUpperCase() === plate));
    const patch = {};
    missing.forEach(k => { const src = mine.find(j => usable(j[k])); if (src) patch[k] = src[k]; });
    if (Object.keys(patch).length) changes.push({ id: d.id, plate: v.plate, patch, jobs: mine.map(j => j.no) });
  });

  console.log('\n== ' + b + ': ' + vs.size + ' vehicles, ' + changes.length + ' to fill');
  changes.forEach(c => {
    console.log('  ' + (c.plate || '(no plate)').padEnd(10) + ' ' + c.id + '  from ' + c.jobs.slice(0, 3).join(','));
    Object.entries(c.patch).forEach(([k, v]) => console.log('      ' + k.padEnd(14) + ' ← ' + v));
  });
  if (!APPLY || !changes.length) return changes.length;

  for (const c of changes){
    await root.collection('vehicles').doc(c.id).set(c.patch, { merge: true });
    /* Refresh the public portal snapshot's header fields if it exists. */
    const pref = root.collection('portal').doc(c.id);
    const p = await pref.get();
    if (p.exists){
      const merged = Object.assign({}, (await root.collection('vehicles').doc(c.id).get()).data());
      await pref.set({ year: merged.year || '', make: merged.make || '', model: merged.model || '',
        variant: merged.variant || '', owner: merged.owner || '', contact: pickContact(merged.contactNumber),
        updatedAt: new Date().toISOString() }, { merge: true });
    }
  }
  console.log('  ✓ written');
  return changes.length;
}

(async () => {
  initializeApp({ credential: cert(require(KEY)) });
  const db = getFirestore();
  console.log(APPLY ? 'APPLY — writing changes' : 'DRY RUN — nothing is written (pass --apply to write)');
  let total = 0;
  for (const b of cloudBranchIds()) total += await run(db, b);
  console.log('\nTotal vehicles ' + (APPLY ? 'filled' : 'that would be filled') + ': ' + total);
})().catch(e => { console.error(e); process.exit(1); });
