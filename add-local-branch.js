#!/usr/bin/env node
/* ============================================================================
   Add a NEW LOCAL branch (unreliable / no internet) — ONE COMMAND.

   This branch runs on an on-site mini-PC (branch-server) with LAN real-time and
   works with ZERO internet. Its data lives on-site, not in the cloud.

   Usage:
     node add-local-branch.js <slug> "<Name>" "<Location>" [--host <hostname:port>]

   Example:
     node add-local-branch.js batangas "Batangas" "Batangas City" --host batangas:8790

   What it does:
     1. Registers the branch in branches.json (local, on-site host).
     2. Builds a self-contained artifact into dist/<slug>/ for the mini-PC to serve.
     3. Commits branches.json and prints the on-site setup steps.

   (The artifact is NOT deployed to the public site — a local branch is served
   from its own mini-PC on the shop LAN.)
   ========================================================================== */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = __dirname;
function die(m){ console.error('✗ ' + m); process.exit(1); }

const argv = process.argv.slice(2);
const hostIdx = argv.indexOf('--host');
const host = hostIdx >= 0 ? argv[hostIdx + 1] : null;
const positional = argv.filter((a, i) => a !== '--host' && i !== hostIdx + 1);
const [slug, name, location] = positional;

if (!slug || !name || !location)
  die('Usage: node add-local-branch.js <slug> "<Name>" "<Location>" [--host <hostname:port>]');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
  die('slug must be lowercase letters/numbers/dashes, e.g. "batangas"');
if (!fs.existsSync(path.join(ROOT, 'build.js')))
  die('run this from the repo root (build.js not found)');

const hostPort = host || (slug + ':8790');
const url = 'http://' + hostPort;

const bfile = path.join(ROOT, 'branches.json');
const branches = JSON.parse(fs.readFileSync(bfile, 'utf8'));
if (branches[slug]) die('branch "' + slug + '" already exists in branches.json');

branches[slug] = {
  id: slug, slug: slug,
  name: 'Basic by JMSI — ' + name,
  location: location,
  localUrl: url,
  publicUrl: url,
  partsUrl: url,
  partsSource: 'local',
  dataSource: 'local'
};
fs.writeFileSync(bfile, JSON.stringify(branches, null, 2) + '\n');
console.log('✓ registered LOCAL branch in branches.json (host ' + hostPort + ')');

// build the self-contained on-site artifact
cp.execSync('node build.js --branch=' + slug, { cwd: ROOT, stdio: 'inherit' });
console.log('✓ built self-contained artifact → dist/' + slug + '/index.html');

// commit branches.json (dist/ is git-ignored; the artifact ships to the mini-PC)
cp.execSync('git add branches.json', { cwd: ROOT, stdio: 'inherit' });
cp.execSync('git commit -q -m "Add local branch: ' + name + ' (' + slug + ')"', { cwd: ROOT, stdio: 'inherit' });
console.log('✓ committed branches.json');

console.log('\n── ON-SITE SETUP (on the branch mini-PC) ──────────────────────────');
console.log('  1. Copy the  branch-server/  folder and  dist/' + slug + '/  to the mini-PC.');
console.log('  2. In branch-server/:  npm install');
console.log('     Configure SQL (sql-config.json) and set the branch to "' + slug + '".');
console.log('  3. Start the server — it serves the app + data + parts at ' + url + '.');
console.log('  4. Point the shop\'s devices/browsers to ' + url + '.');
console.log('\n  Data stays on-site: works fully OFFLINE with LAN real-time (SSE) across');
console.log('  stations. A cloud-sync bridge (so this branch also shows centrally and');
console.log('  its customers get the online QR portal) can be added later.');
