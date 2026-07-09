#!/usr/bin/env node
/* ============================================================================
   Add a NEW CLOUD branch (reliable internet) — ONE COMMAND.

   Usage:
     node add-cloud-branch.js <slug> "<Name>" "<Location>" [--deploy]

   Example:
     node add-cloud-branch.js novaliches "Novaliches" "Novaliches, Quezon City" --deploy

   What it does:
     1. Registers the branch in branches.json (cloud, path URL, location).
     2. Seeds an EMPTY branch in Firestore (branches/<slug>/meta/shop + counters)
        so it starts clean with its own OR/JO/EST/PO series (needs
        sync/serviceAccountKey.json).
     3. Builds the branch bundle and stages it into /<slug>/ (served at
        basicautomotiveservices.com/<slug>).
     4. Commits. With --deploy it also pushes (goes live in ~2 min).

   No Firestore rules change and no DNS/subdomain setup is ever needed — the
   branches/{b} rules already cover any new branch, and it's a path on the
   existing domain.

   After it's live: open the URL, sign in as the owner (auto-admin), set the
   branch's address/contact/TIN in Settings, and create its staff accounts.
   ========================================================================== */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = __dirname;
function die(m){ console.error('✗ ' + m); process.exit(1); }

const argv = process.argv.slice(2);
const DEPLOY = argv.includes('--deploy');
const [slug, name, location] = argv.filter(a => a !== '--deploy');

if (!slug || !name || !location)
  die('Usage: node add-cloud-branch.js <slug> "<Name>" "<Location>" [--deploy]');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
  die('slug must be lowercase letters/numbers/dashes, e.g. "novaliches"');
if (!fs.existsSync(path.join(ROOT, 'build.js')))
  die('run this from the repo root (build.js not found)');

const bfile = path.join(ROOT, 'branches.json');
const branches = JSON.parse(fs.readFileSync(bfile, 'utf8'));
if (branches[slug]) die('branch "' + slug + '" already exists in branches.json');

branches[slug] = {
  id: slug, slug: slug,
  name: 'Basic by JMSI — ' + name,
  location: location,
  localUrl: '',
  publicUrl: 'https://basicautomotiveservices.com/' + slug,
  partsUrl: '',
  partsSource: 'cloud',
  dataSource: 'cloud'
};
fs.writeFileSync(bfile, JSON.stringify(branches, null, 2) + '\n');
console.log('✓ registered branch in branches.json');

// 2. seed the empty branch in Firestore (run inside sync/ so firebase-admin resolves)
try {
  cp.execSync('node seed-branch.js ' + slug, { cwd: path.join(ROOT, 'sync'), stdio: 'inherit' });
} catch (e) {
  die('Firestore seed failed (needs sync/serviceAccountKey.json). branches.json was updated; ' +
      'fix the key, then run:  cd sync && node seed-branch.js ' + slug);
}

// 3. build + stage the branch site
cp.execSync('node build.js --branch=' + slug, { cwd: ROOT, stdio: 'inherit' });
const src = path.join(ROOT, 'dist', slug), dst = path.join(ROOT, slug);
fs.mkdirSync(dst, { recursive: true });
fs.copyFileSync(path.join(src, 'index.html'), path.join(dst, 'index.html'));
fs.copyFileSync(path.join(src, 'version.txt'), path.join(dst, 'version.txt'));
console.log('✓ built + staged /' + slug + '/');

// 4. commit (+ optional deploy)
cp.execSync('git add branches.json "' + slug + '"', { cwd: ROOT, stdio: 'inherit' });
cp.execSync('git commit -q -m "Add cloud branch: ' + name + ' (' + slug + ')"', { cwd: ROOT, stdio: 'inherit' });
console.log('✓ committed');

if (DEPLOY) {
  cp.execSync('git push -q origin main', { cwd: ROOT, stdio: 'inherit' });
  console.log('✓ DEPLOYED → https://basicautomotiveservices.com/' + slug + '  (live in ~2 min)');
} else {
  console.log('\nReview, then deploy with:  git push origin main');
  console.log('Live URL after deploy: https://basicautomotiveservices.com/' + slug);
}
console.log('\nFinally, at that URL: sign in as owner (auto-admin) → Settings (address/contact/TIN) → Accounts (staff).');
