/* Build: concatenate modules -> single self-contained BASIC_by_JMSI_System.html */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const PARTS = ['logo.js','firebase-config.js','branch-config.js','part1_core.js','part2_shell.js','part3_board.js','part4_jobs.js','part5_estimates.js',
  'part6_records.js','part7_analytics.js','part8_settings.js','part9_print.js','part10_portal.js','part11_cloud.js','part12_rbac.js','part13_catalog.js','part14_pms.js'];

function read(f){ return fs.readFileSync(path.join(SRC,f),'utf8'); }

// Args: "dev" (positional) selects the isolated local build; --branch=<slug>
// selects which branch (from branches.json) to build. Default branch: "main".
const ARGS = process.argv.slice(2);
// MODE: "prod" (default) = cloud build for the live team site.
//       "dev"            = isolated LOCAL build (no cloud, own private storage).
const MODE = ARGS.indexOf('dev') >= 0 ? 'dev' : 'prod';
const branchArg = (ARGS.find(function(a){ return a.indexOf('--branch=') === 0; }) || '').split('=')[1];
// Fairview is the default/reference branch. It is served at /fairview/ like every
// other branch — the site ROOT is a separate marketing placeholder, never the app.
const BRANCH_SLUG = branchArg || 'fairview';
const BRANCHES = JSON.parse(fs.readFileSync(path.join(__dirname, 'branches.json'), 'utf8'));
const BRANCH = BRANCHES[BRANCH_SLUG];
if (!BRANCH) { throw new Error('Unknown branch "' + BRANCH_SLUG + '". Known: ' + Object.keys(BRANCHES).join(', ')); }
const IS_DEFAULT_BRANCH = (BRANCH_SLUG === 'fairview');   // emits the Node test bundle + reference HTML

// Version stamp: semantic version from the VERSION file + build date + the short
// git hash of HEAD. The hash makes every deploy's version string unique, so
// same-day rebuilds still differ and the in-app update checker fires its
// "Reload now" banner (date alone repeats within a day and would suppress it).
const semver = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim() || '0.0.0';
const buildDate = new Date().toISOString().slice(0, 10);
let gitHash = '';
try { gitHash = require('child_process').execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch (e) { /* not a git checkout — omit */ }
const APP_VERSION = 'v' + semver + ' · ' + buildDate + (gitHash ? ' · ' + gitHash : '');

const css = read('styles.css');
let js = PARTS.map(read).join('\n\n/* ===== */\n\n');
js = js.replace('__APP_VERSION__', APP_VERSION);
js = js.split('__BRANCH_CONFIG__').join(JSON.stringify(BRANCH)); // all occurrences, literal

if (MODE === 'dev') {
  // Local mode: turn cloud OFF so the dev build uses local storage only and
  // never touches the team's live database.
  js = js.replace('var CLOUD_ENABLED = true;', 'var CLOUD_ENABLED = false;');
}

// CRITICAL: a literal "</script>" inside a JS string would close the inline
// <script> tag early when embedded in HTML. Escape it (equivalent at runtime).
js = js.replace(/<\/script/gi, '<\\/script');
let shell = read('index_shell.html');

if (MODE === 'dev') {
  // Drop the Firebase SDK <script> tags (offline build) and mark it visibly DEV.
  shell = shell.split(/\r?\n/).filter(function(line){ return line.indexOf('gstatic.com/firebasejs') < 0; }).join('\n');
  shell = shell.replace('<title>Basic by JMSI — Shop Operations</title>', '<title>DEV · Basic by JMSI (local test)</title>');
  shell = shell.replace('<body>',
    '<body>\n<div id="devbadge">DEV · local test data — NOT live</div>' +
    '<style>#devbadge{position:fixed;left:12px;bottom:12px;z-index:99999;background:var(--gold,#FFC000);color:#1D1D1F;' +
    'font:700 11px -apple-system,Segoe UI,sans-serif;letter-spacing:.02em;padding:6px 12px;border-radius:9px;' +
    'box-shadow:0 6px 20px rgba(0,0,0,.28);pointer-events:none}</style>');
}

const out = shell.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);

if (MODE === 'dev') {
  const devDest = path.join(__dirname, 'BASIC_dev.html');
  fs.writeFileSync(devDest, out, 'utf8');
  console.log('Built DEV (local mode, isolated) -> ' + devDest);
  console.log('  HTML : ' + out.length.toLocaleString() + ' bytes');
} else {
  // Every prod branch — INCLUDING Fairview — is a self-contained artifact in
  // dist/<slug>/, served at /<slug>/. The site ROOT (index.html) is the marketing
  // placeholder and is NEVER written by the build, so it can't clobber the website.
  const dir = path.join(__dirname, 'dist', BRANCH.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), out, 'utf8');
  fs.writeFileSync(path.join(dir, 'branch.json'), JSON.stringify(BRANCH, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'version.txt'), APP_VERSION, 'utf8');
  console.log('Built branch "' + BRANCH.slug + '" (' + BRANCH.name + ') -> ' + path.join(dir, 'index.html'));
  console.log('  Public URL : ' + BRANCH.publicUrl);
  console.log('  Parts URL  : ' + BRANCH.partsUrl + '  (' + BRANCH.partsSource + ')');
  console.log('  HTML : ' + out.length.toLocaleString() + ' bytes');
  // The default branch (Fairview) also emits the reference HTML + the Node test
  // bundle used by `node test.js`. These are dev artifacts, not the served site.
  if (IS_DEFAULT_BRANCH) {
    fs.writeFileSync(path.join(__dirname, 'BASIC_by_JMSI_System.html'), out, 'utf8');
    fs.writeFileSync(path.join(__dirname, '_bundle.js'), js, 'utf8');
    console.log('  + reference BASIC_by_JMSI_System.html and _bundle.js (test)  (' + APP_VERSION + ')');
  }
}
