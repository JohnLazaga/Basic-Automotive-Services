/* Generate the owner "branches" landing page from branches.json.
   One page listing every branch with an Open link + a live online/offline
   indicator (pings each branch's public /health, which sends CORS *).
   Run:  node tools/make-owner-page.js   ->  dist/owner.html
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BRANCHES = JSON.parse(fs.readFileSync(path.join(ROOT, 'branches.json'), 'utf8'));

// Real mini-PC branches only (exclude the cloud "main" and the localhost dev target).
const list = Object.keys(BRANCHES).map(function (k) { return BRANCHES[k]; }).filter(function (b) {
  var localhost = String(b.publicUrl || '').indexOf('localhost') >= 0;
  return b.slug !== 'main' && b.slug !== 'localtest' && !localhost && (b.dataSource === 'local' || b.partsSource === 'local');
});
const cloud = BRANCHES.main ? { name: BRANCHES.main.name || 'Cloud site (HQ)', publicUrl: BRANCHES.main.publicUrl } : null;

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const cards = list.map(function (b) {
  return '<div class="card" data-health="' + esc((b.publicUrl||'').replace(/\/+$/,'')) + '/health">' +
    '<div class="row"><div class="nm">' + esc(b.name || b.slug) + '</div><span class="pill checking">checking…</span></div>' +
    '<div class="meta" >—</div>' +
    '<div class="urls">' +
      '<a class="btn" href="' + esc(b.publicUrl) + '" target="_blank" rel="noopener">Open (online)</a>' +
      '<a class="btn ghost" href="' + esc(b.localUrl) + '" target="_blank" rel="noopener">On-site LAN</a>' +
    '</div></div>';
}).join('\n');

const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
'<title>Basic by JMSI — Branches</title><style>' +
':root{--ink:#1d1d1f;--ink2:#6b6b70;--brand:#d10000;--hair:#e4e4e7;--bg:#f5f5f7;--panel:#fff;--ok:#127a2b;--okbg:#e7f6ec;--off:#a11;--offbg:#fdeaea}' +
'*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}' +
'.wrap{max-width:820px;margin:0 auto;padding:32px 20px 60px}' +
'.cover{background:#101014;color:#fff;border-radius:16px;padding:24px 26px;margin-bottom:22px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}' +
'.cover h1{margin:0;font-size:24px}.brand{color:var(--brand);font-weight:800;letter-spacing:.5px}.cover p{margin:2px 0 0;color:#c9c9cf;font-size:13px}' +
'.refresh{background:#26262b;color:#fff;border:0;border-radius:9px;padding:9px 14px;cursor:pointer;font:inherit}' +
'.card{background:var(--panel);border:1px solid var(--hair);border-radius:14px;padding:16px 18px;margin-bottom:14px;box-shadow:0 1px 0 var(--hair)}' +
'.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.nm{font-size:18px;font-weight:700}' +
'.pill{font-size:12px;font-weight:700;padding:3px 10px;border-radius:20px;white-space:nowrap}' +
'.pill.checking{background:#eee;color:#666}.pill.online{background:var(--okbg);color:var(--ok)}.pill.offline{background:var(--offbg);color:var(--off)}' +
'.meta{color:var(--ink2);font-size:13px;margin:6px 0 12px;min-height:18px}' +
'.urls{display:flex;gap:10px;flex-wrap:wrap}' +
'.btn{display:inline-block;background:var(--brand);color:#fff;text-decoration:none;border-radius:9px;padding:9px 16px;font-weight:600;font-size:14px}' +
'.btn.ghost{background:#f2f2f4;color:var(--ink)}' +
'.hq{margin-top:20px;font-size:13px;color:var(--ink2)}.hq a{color:var(--brand)}' +
'.foot{color:var(--ink2);font-size:12px;margin-top:26px;text-align:center}' +
'</style></head><body><div class="wrap">' +
'<div class="cover"><div><div class="brand">BASIC by JMSI</div><h1>Branches</h1><p>Open any branch online, or on-site over its LAN. Status auto-refreshes.</p></div>' +
'<button class="refresh" onclick="checkAll()">↻ Refresh</button></div>' +
(list.length ? cards : '<div class="card">No online branches configured yet. Add branches to <code>branches.json</code> and re-run this generator.</div>') +
(cloud ? '<div class="hq">HQ cloud site: <a href="' + esc(cloud.publicUrl) + '" target="_blank" rel="noopener">' + esc(cloud.publicUrl) + '</a></div>' : '') +
'<div class="foot">A branch shows <b>online</b> only when its mini-PC + internet + tunnel are up. If offline, on-site staff can still use the LAN URL.</div>' +
'</div><script>' +
'function fmt(n){try{return Number(n).toLocaleString();}catch(e){return n;}}' +
'async function one(card){' +
'  var url=card.getAttribute("data-health");' +
'  var pill=card.querySelector(".pill"), meta=card.querySelector(".meta");' +
'  pill.className="pill checking";pill.textContent="checking…";' +
'  try{' +
'    var c=new AbortController();var t=setTimeout(function(){c.abort();},6000);' +
'    var r=await fetch(url,{cache:"no-store",signal:c.signal});clearTimeout(t);' +
'    var d=await r.json();' +
'    pill.className="pill online";pill.textContent="online";' +
'    meta.textContent=fmt(d.count)+" parts · source: "+(d.source||"?")+(d.version?(" · v"+d.version):"");' +
'  }catch(e){pill.className="pill offline";pill.textContent="offline";meta.textContent="Not reachable right now (mini-PC or internet down).";}' +
'}' +
'function checkAll(){document.querySelectorAll(".card[data-health]").forEach(one);}' +
'checkAll();setInterval(checkAll,30000);' +
'</script></body></html>';

const dir = path.join(ROOT, 'dist');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'owner.html');
fs.writeFileSync(out, html, 'utf8');
console.log('Wrote ' + out + '  (' + list.length + ' branch' + (list.length===1?'':'es') + ': ' + list.map(function(b){return b.slug;}).join(', ') + ')');
