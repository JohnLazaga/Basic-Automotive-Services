/* Build: concatenate modules -> single self-contained BASIC_by_JMSI_System.html */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const PARTS = ['logo.js','firebase-config.js','part1_core.js','part2_shell.js','part3_board.js','part4_jobs.js','part5_estimates.js',
  'part6_records.js','part7_analytics.js','part8_settings.js','part9_print.js','part10_portal.js','part11_cloud.js'];

function read(f){ return fs.readFileSync(path.join(SRC,f),'utf8'); }

const css = read('styles.css');
let js = PARTS.map(read).join('\n\n/* ===== */\n\n');
// CRITICAL: a literal "</script>" inside a JS string would close the inline
// <script> tag early when embedded in HTML. Escape it (equivalent at runtime).
js = js.replace(/<\/script/gi, '<\\/script');
const shell = read('index_shell.html');

const out = shell.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);

const dest = path.join(__dirname, 'BASIC_by_JMSI_System.html');
fs.writeFileSync(dest, out, 'utf8');

// Emit index.html at the repo root so GitHub Pages serves the app directly.
fs.writeFileSync(path.join(__dirname, 'index.html'), out, 'utf8');

// Also emit the concatenated JS as a CommonJS bundle for the Node smoke test.
fs.writeFileSync(path.join(__dirname, '_bundle.js'), js, 'utf8');

console.log('Built ' + dest);
console.log('  CSS  : ' + css.length.toLocaleString() + ' bytes');
console.log('  JS   : ' + js.length.toLocaleString() + ' bytes');
console.log('  HTML : ' + out.length.toLocaleString() + ' bytes');
