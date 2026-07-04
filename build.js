/* Build: concatenate modules -> single self-contained BASIC_by_JMSI_System.html */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const PARTS = ['logo.js','firebase-config.js','part1_core.js','part2_shell.js','part3_board.js','part4_jobs.js','part5_estimates.js',
  'part6_records.js','part7_analytics.js','part8_settings.js','part9_print.js','part10_portal.js','part11_cloud.js','part12_rbac.js','part13_catalog.js'];

function read(f){ return fs.readFileSync(path.join(SRC,f),'utf8'); }

// MODE: "prod" (default) = cloud build for the live team site.
//       "dev"            = isolated LOCAL build (no cloud, own private storage).
const MODE = process.argv[2] === 'dev' ? 'dev' : 'prod';

// Version stamp: semantic version from the VERSION file + build date.
const semver = fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim() || '0.0.0';
const buildDate = new Date().toISOString().slice(0, 10);
const APP_VERSION = 'v' + semver + ' · ' + buildDate;

const css = read('styles.css');
let js = PARTS.map(read).join('\n\n/* ===== */\n\n');
js = js.replace('__APP_VERSION__', APP_VERSION);

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
  const dest = path.join(__dirname, 'BASIC_by_JMSI_System.html');
  fs.writeFileSync(dest, out, 'utf8');
  // Emit index.html at the repo root so GitHub Pages serves the app directly.
  fs.writeFileSync(path.join(__dirname, 'index.html'), out, 'utf8');
  // Also emit the concatenated JS as a CommonJS bundle for the Node smoke test.
  fs.writeFileSync(path.join(__dirname, '_bundle.js'), js, 'utf8');
  // A tiny version marker at the site root — for a future auto-update check.
  fs.writeFileSync(path.join(__dirname, 'version.txt'), APP_VERSION, 'utf8');
  console.log('Built ' + dest + '  (' + APP_VERSION + ')');
  console.log('  CSS  : ' + css.length.toLocaleString() + ' bytes');
  console.log('  JS   : ' + js.length.toLocaleString() + ' bytes');
  console.log('  HTML : ' + out.length.toLocaleString() + ' bytes');
}
