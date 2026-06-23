const fs=require('fs');
const outName=process.argv[2]||'_profile.html';
let h=fs.readFileSync('BASIC_by_JMSI_System.html','utf8');
const trap='<script>window.addEventListener("error",function(e){var a=document.getElementById("app");if(a)a.innerHTML="<pre style=\\"padding:18px;color:#b00020;font:12px Consolas,monospace;white-space:pre-wrap\\">ERROR: "+e.message+"\\n"+e.filename+":"+e.lineno+"\\n"+((e.error&&e.error.stack)||"")+"</pre>";});window.addEventListener("unhandledrejection",function(e){var a=document.getElementById("app");var r=e.reason;if(a)a.innerHTML="<pre style=\\"padding:18px;color:#b00020;font:12px Consolas,monospace;white-space:pre-wrap\\">REJECTION: "+((r&&r.message)||r)+"\\n"+((r&&r.stack)||"")+"</pre>";});<\/script>';
h=h.replace('<div id="app">', trap+'<div id="app">');
const bench=[
'<script>',
'(function(){',
'function b(){',
'  if(typeof window.S==="undefined"||!window.S){ return setTimeout(b,60); }',
'  var r=window.render;',
'  var t0=performance.now();',
'  for(var i=0;i<500;i++){ window.ROUTE.view=(i%2?"jobs":"board"); r(); }',
'  var sw=(performance.now()-t0)/500;',
'  var t1=performance.now();',
'  for(var i=0;i<500;i++){ window._mounted=false; window.ROUTE.view=(i%2?"jobs":"board"); r(); }',
'  var fu=(performance.now()-t1)/500;',
'  window._mounted=true; window.ROUTE.view="board"; r();',
'  var d=document.createElement("div");',
'  d.style.cssText="position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:99999;background:#1d1d1f;color:#fff;padding:11px 20px;border-radius:12px;font:700 13px -apple-system,Segoe UI,sans-serif;box-shadow:0 8px 40px rgba(0,0,0,.35)";',
'  d.textContent="LIVE BENCHMARK  -  content-swap "+sw.toFixed(3)+" ms   vs   full-remount "+fu.toFixed(3)+" ms   =   "+(fu/sw).toFixed(1)+"x faster per interaction";',
'  document.body.appendChild(d);',
'}',
'setTimeout(b,500);',
'})();',
'<\/script>'
].join('\n');
// inject before the REAL closing body tag (the last one — earlier "</body>"
// occurrences are literal strings inside print-document templates)
const i=h.lastIndexOf('</body>');
h=h.slice(0,i)+bench+h.slice(i);
fs.writeFileSync(outName, h);
console.log('regenerated '+outName);
