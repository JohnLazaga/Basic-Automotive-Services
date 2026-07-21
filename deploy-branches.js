#!/usr/bin/env node
/* ============================================================================
   Deploy the app to EVERY branch — ONE COMMAND.

   Usage:
     node deploy-branches.js                 build + stage all branches (review)
     node deploy-branches.js --push          also commit & push (goes live)
     node deploy-branches.js --push "msg"    ...with a custom commit message

   What it does:
     1. Builds every CLOUD branch from branches.json (Fairview, Commonwealth,
        Sudipen, Sandbox) and stages BOTH index.html AND version.txt into
        /<slug>/ (served at basicautomotiveservices.com/<slug>). Fairview is now
        /fairview — the site ROOT is a separate marketing placeholder this script
        never overwrites.
     2. Runs the acceptance tests (node test.js) — aborts the push if they fail.
     3. With --push: commits everything and pushes to GitHub Pages.

   WHY version.txt matters: the in-app update checker (part2_shell.js) compares
   the served /<slug>/version.txt against the running app's baked-in version and
   only then shows the "Reload now" banner. Staging index.html WITHOUT bumping
   version.txt means clients never learn an update exists. This script always
   copies both, so that failure mode can't recur.
   ========================================================================== */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = __dirname;
function die(m){ console.error('✗ ' + m); process.exit(1); }
function run(cmd){ cp.execSync(cmd, { cwd: ROOT, stdio: 'inherit' }); }

const argv = process.argv.slice(2);
const PUSH = argv.includes('--push');
const MSG = argv.filter(a => a !== '--push')[0] || 'Deploy app to all branches';

if (!fs.existsSync(path.join(ROOT, 'build.js'))) die('run this from the repo root (build.js not found)');
const branches = JSON.parse(fs.readFileSync(path.join(ROOT, 'branches.json'), 'utf8'));

// Every cloud branch is served as a /<slug>/ folder — INCLUDING Fairview (now at
// /fairview). The site ROOT is a separate marketing placeholder that this script
// never touches. Local/dev entries (dataSource 'local', e.g. localtest) are skipped.
const cloudSlugs = Object.keys(branches).filter(function(slug){
  var b = branches[slug];
  return b && b.dataSource === 'cloud';
});

console.log('\n=== Deploy to all branches ===');
console.log('Cloud branches (each served at /<slug>/): ' + cloudSlugs.join(', '));
console.log('Site root (index.html) is the marketing placeholder — left untouched.\n');

// Build each cloud branch -> /<slug>/{index.html,version.txt}. Fairview (the default
// branch) also emits _bundle.js, which the acceptance tests below require.
cloudSlugs.forEach(function(slug){
  console.log('[build] ' + slug);
  run('node build.js --branch=' + slug);
  var src = path.join(ROOT, 'dist', slug), dst = path.join(ROOT, slug);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(path.join(src, 'index.html'),   path.join(dst, 'index.html'));
  fs.copyFileSync(path.join(src, 'version.txt'),  path.join(dst, 'version.txt'));
  console.log('  ✓ staged /' + slug + '/  (index.html + version.txt)');
});

// 3. Acceptance tests
console.log('\n[test] running acceptance tests…');
run('node test.js');

// 4. Commit + push
if (PUSH) {
  console.log('\n[git] committing + pushing…');
  run('git add -A');
  var pending = cp.execSync('git status --porcelain', { cwd: ROOT }).toString().trim();
  if (!pending) { console.log('Nothing changed — working tree clean.'); process.exit(0); }
  run('git commit -m "' + MSG.replace(/"/g, '\\"') + '"');
  run('git push');
  console.log('\n✓ DEPLOYED to all branches. GitHub Pages refreshes in ~1–2 min.');
  console.log('  Open clients get the "Reload now" banner within ~15s of the next check.');
} else {
  console.log('\n✓ Built + staged all branches (not pushed).');
  console.log('  Review with:  git status');
  console.log('  Deploy with:  node deploy-branches.js --push "your message"');
}
