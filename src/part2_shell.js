/* ============================================================================
   PART 2 — App shell: sidebar, top bar, router, modal/toast, signature, photos
   ========================================================================== */

/* ---- Router state --------------------------------------------------------- */
var ROUTE = { view:'board', arg:null };

/* ---- Theme (light / dark) ------------------------------------------------- */
var THEME = 'light';
function applyTheme(t){
  THEME = (t==='dark') ? 'dark' : 'light';
  if (typeof document!=='undefined' && document.documentElement && document.documentElement.setAttribute){
    document.documentElement.setAttribute('data-theme', THEME);
  }
  if (S && S.shop) S.shop.theme = THEME;
}
function toggleTheme(){ applyTheme(THEME==='dark'?'light':'dark'); persist(); updateThemeBtn(); }
function updateThemeBtn(){
  if (typeof document==='undefined') return;
  var b=document.getElementById('themeBtn'); if(b && 'textContent' in b) b.textContent = THEME==='dark'?'☀':'☾';
}

var NAV = [
  { group:'OPERATIONS', items:[
    { id:'board', label:'Board', icon:'▦' },
    { id:'appointments', label:'Appointments', icon:'▤' },
    { id:'jobs', label:'Job Orders', icon:'▧' },
    { id:'estimates', label:'Estimates', icon:'✎' }
  ]},
  { group:'ANALYTICS', items:[
    { id:'reports', label:'Reports', icon:'▣' },
    { id:'dailyclose', label:'Daily Close', icon:'◷' },
    { id:'productivity', label:'Productivity', icon:'⚙' },
    { id:'receivables', label:'Receivables', icon:'₱' }
  ]},
  { group:'RECORDS', items:[
    { id:'vehicles', label:'Vehicles', icon:'⛛' },
    { id:'parts', label:'Parts Catalog', icon:'◫' },
    { id:'labor', label:'Labor Catalog', icon:'☰' },
    { id:'purchaseorders', label:'Purchase Orders', icon:'⊞' },
    { id:'staff', label:'Staff', icon:'☺' }
  ]},
  { group:'SETUP', items:[
    { id:'settings', label:'Settings', icon:'⚒' }
  ]}
];

function go(view, arg){
  ROUTE.view = view; ROUTE.arg = arg||null;
  if (typeof document!=='undefined'){
    var sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
    window.scrollTo(0,0);
  }
  render();
}

/* ---- View dispatch (filled by later parts) -------------------------------- */
var VIEWS = {}; // id -> function(arg) -> html string

function renderView(){
  var fn = VIEWS[ROUTE.view] || VIEWS['board'];
  try { return fn(ROUTE.arg); }
  catch(e){ return '<div class="card"><h2>View error</h2><pre>'+esc(e&&e.stack||e)+'</pre></div>'; }
}

/* ---- Sidebar -------------------------------------------------------------- */
function sidebarHTML(){
  var nav = NAV.map(function(g){
    var items = g.items.map(function(it){
      var on = (ROUTE.view===it.id) ? ' active' : '';
      return '<button class="nav'+on+'" data-nav="'+it.id+'" onclick="go(\''+it.id+'\')">'+
        '<span class="nav-i">'+it.icon+'</span>'+esc(it.label)+'</button>';
    }).join('');
    return '<div class="nav-group"><div class="nav-title">'+esc(g.group)+'</div>'+items+'</div>';
  }).join('');
  return '<aside id="sidebar" class="sidebar">'+
    '<div class="brandlock"><img class="lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/>'+
      '<div class="brandsub">Fairview, Quezon City</div></div>'+
    '<nav class="navwrap">'+nav+'</nav>'+
    '<div class="sidefoot">Shop Operations · offline-ready</div>'+
  '</aside>';
}

/* ---- Top bar -------------------------------------------------------------- */
function topbarHTML(){
  var openJobs = S.jobs.filter(function(j){return j.stage!=='Released';}).length;
  return '<header class="topbar">'+
    '<button class="hamburger" onclick="toggleSidebar()" aria-label="Menu">☰</button>'+
    '<div class="tb-title">'+esc(viewTitle(ROUTE.view))+'</div>'+
    '<div class="tb-right">'+
      '<span class="tb-stat">'+openJobs+' active</span>'+
      '<span id="saveState" class="savestate" data-st="saved">All changes saved</span>'+
      '<button class="iconbtn" id="themeBtn" onclick="toggleTheme()" title="Toggle dark mode" aria-label="Toggle dark mode">'+(THEME==='dark'?'☀':'☾')+'</button>'+
    '</div>'+
  '</header>';
}
function viewTitle(v){
  var map={ board:'Operations Board', appointments:'Appointments', jobs:'Job Orders', job:'Job Order',
    estimates:'Estimates', estimate:'Estimate', reports:'Reports & Analytics', dailyclose:'Daily Close',
    productivity:'Mechanic Productivity', receivables:'Receivables (A/R)', vehicles:'Vehicles', vehicle:'Vehicle',
    parts:'Parts Catalog', labor:'Labor Catalog', purchaseorders:'Purchase Orders', po:'Purchase Order',
    staff:'Staff', settings:'Settings' };
  return map[v]||'Basic by JMSI';
}
function toggleSidebar(){ var sb=document.getElementById('sidebar'); if(sb) sb.classList.toggle('open'); }

/* ---- Master render --------------------------------------------------------
   Mount the shell (sidebar + top bar) ONCE; thereafter only the content region
   is repainted. Avoids rebuilding/re-laying-out the sidebar on every action and
   preserves scroll/focus — the main "make it fast" win. A full remount happens
   only on first paint or when switching between the shop UI and the portal. */
var _mounted=false, _mode=null;
function render(){
  if (typeof document==='undefined') return;
  var mode = isPortalRoute() ? 'portal' : 'app';
  if (!_mounted || mode!==_mode){
    if (mode==='portal'){ document.getElementById('app').innerHTML = portalHTML(); _mode='portal'; _mounted=true; return; }
    document.getElementById('app').innerHTML =
      sidebarHTML() +
      '<div class="main">' + topbarHTML() +
        '<div class="content" id="content">' + renderView() + '</div>' +
      '</div>' +
      '<div id="modalRoot"></div>';
    _mode='app'; _mounted=true;
    if (typeof afterRender==='function') afterRender();
    return;
  }
  // fast path: shell already in the DOM — swap only the content + light nav/topbar bits
  var c = document.getElementById('content');
  if (c) c.innerHTML = renderView();
  updateNavActive();
  updateTopbar();
  if (typeof afterRender==='function') afterRender();
}
function updateNavActive(){
  var btns = document.querySelectorAll ? document.querySelectorAll('.nav') : null;
  if (!btns) return;
  for (var i=0;i<btns.length;i++){ var b=btns[i];
    if (b.getAttribute) b.classList.toggle('active', b.getAttribute('data-nav')===ROUTE.view); }
}
function updateTopbar(){
  var open = S.jobs.filter(function(j){return j.stage!=='Released';}).length;
  var t = document.querySelector ? document.querySelector('.tb-title') : null;
  if (t && 'textContent' in t) t.textContent = viewTitle(ROUTE.view);
  var st = document.querySelector ? document.querySelector('.tb-stat') : null;
  if (st && 'textContent' in st) st.textContent = open+' active';
}

/* ---- Toast ---------------------------------------------------------------- */
function toast(msg, kind){
  if (typeof document==='undefined') return;
  var t = document.createElement('div');
  t.className = 'toast' + (kind ? ' '+kind : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.classList.add('show'); }, 10);
  setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); }, 300); }, 2600);
}

/* ---- Modal ---------------------------------------------------------------- */
function openModal(title, bodyHTML, opts){
  opts = opts || {};
  var root = document.getElementById('modalRoot'); if(!root) return;
  var foot = opts.footer!==undefined ? opts.footer :
    '<button class="btn ghost" onclick="closeModal()">Cancel</button>'+
    (opts.onOk? '<button class="btn primary" onclick="('+opts.onOk+')()">'+(opts.okText||'Save')+'</button>':'');
  root.innerHTML =
    '<div class="modal-back" onclick="if(event.target===this)closeModal()">'+
      '<div class="modal" style="max-width:'+(opts.width||'620px')+'">'+
        '<div class="modal-head"><h3>'+esc(title)+'</h3><button class="x" onclick="closeModal()">✕</button></div>'+
        '<div class="modal-body">'+bodyHTML+'</div>'+
        (foot? '<div class="modal-foot">'+foot+'</div>':'')+
      '</div>'+
    '</div>';
  if (opts.after) setTimeout(opts.after, 20);
}
function closeModal(){ var r=document.getElementById('modalRoot'); if(r) r.innerHTML=''; }

function confirmModal(title, msg, onYes, yesText, danger){
  openModal(title, '<p class="muted">'+esc(msg)+'</p>', {
    footer:'<button class="btn ghost" onclick="closeModal()">Cancel</button>'+
           '<button class="btn '+(danger?'danger':'primary')+'" id="cfmYes">'+(yesText||'Confirm')+'</button>'
  });
  setTimeout(function(){ var b=document.getElementById('cfmYes'); if(b) b.onclick=function(){ closeModal(); onYes(); }; },20);
}

/* ---- Form value helpers --------------------------------------------------- */
function val(id){ var e=document.getElementById(id); return e? e.value : ''; }
function checked(id){ var e=document.getElementById(id); return e? e.checked : false; }
function setVal(id,v){ var e=document.getElementById(id); if(e) e.value=v; }

/* ---- Signature pad -------------------------------------------------------- */
var _sig = {};
var _sigDrawing=false, _sigBound=false;
function initSignature(canvasId){
  var c = document.getElementById(canvasId); if(!c) return;
  if (c._sigInit) return;            // already wired (content re-rendered but same node)
  c._sigInit = true;
  var ctx = c.getContext('2d'); ctx.lineWidth=2.4; ctx.lineCap='round'; ctx.strokeStyle='#1D1D1F';
  var last=null; _sig[canvasId]={ dirty:false };
  function pos(e){ var r=c.getBoundingClientRect(); var t=e.touches?e.touches[0]:e;
    return { x:(t.clientX-r.left)*(c.width/r.width), y:(t.clientY-r.top)*(c.height/r.height) }; }
  function start(e){ _sigDrawing=true; last=pos(e); e.preventDefault(); }
  function move(e){ if(!_sigDrawing) return; var p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y);
    ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; _sig[canvasId].dirty=true; e.preventDefault(); }
  c.addEventListener('mousedown',start); c.addEventListener('mousemove',move);
  c.addEventListener('touchstart',start,{passive:false}); c.addEventListener('touchmove',move,{passive:false});
  c.addEventListener('touchend',function(){ _sigDrawing=false; });
  if (!_sigBound){ window.addEventListener('mouseup',function(){ _sigDrawing=false; }); _sigBound=true; }
}
function clearSignature(canvasId){ var c=document.getElementById(canvasId); if(!c) return;
  c.getContext('2d').clearRect(0,0,c.width,c.height); if(_sig[canvasId]) _sig[canvasId].dirty=false; }
function getSignature(canvasId){ var c=document.getElementById(canvasId);
  if(!c||!_sig[canvasId]||!_sig[canvasId].dirty) return null; return c.toDataURL('image/png'); }

/* ---- Photo upload (resize ~1100px, JPEG ~0.7) ----------------------------- */
function handlePhotoFiles(files, cb){
  var arr = Array.prototype.slice.call(files||[]); var out=[]; var pending=arr.length;
  if (!pending){ cb([]); return; }
  arr.forEach(function(f){
    var r = new FileReader();
    r.onload = function(){
      var img = new Image();
      img.onload = function(){
        var max=1100, w=img.width, h=img.height;
        if (w>max||h>max){ if(w>h){ h=Math.round(h*max/w); w=max; } else { w=Math.round(w*max/h); h=max; } }
        var cv=document.createElement('canvas'); cv.width=w; cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        out.push(cv.toDataURL('image/jpeg',0.7));
        if(--pending===0) cb(out);
      };
      img.onerror=function(){ if(--pending===0) cb(out); };
      img.src=r.result;
    };
    r.onerror=function(){ if(--pending===0) cb(out); };
    r.readAsDataURL(f);
  });
}
function openLightbox(src){
  openModal('', '<img src="'+src+'" style="width:100%;border-radius:12px"/>', { footer:'<button class="btn ghost" onclick="closeModal()">Close</button>', width:'720px' });
}

/* ---- Print ---------------------------------------------------------------- */
function printDoc(html){
  if (typeof window==='undefined') return;
  var w = null;
  try { w = window.open('', '_blank'); } catch(e){ w=null; }
  if (w && w.document){
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(function(){ try{ w.focus(); w.print(); }catch(e){} }, 300);
  } else {
    // fallback: modal iframe (sandboxed artifact)
    openModal('Print preview',
      '<iframe style="width:100%;height:70vh;border:1px solid #E5E5EA;border-radius:10px" srcdoc="'+attr(html)+'"></iframe>',
      { footer:'<button class="btn ghost" onclick="closeModal()">Close</button>'+
               '<button class="btn primary" onclick="printIframe()">Print</button>', width:'860px' });
  }
}
function printIframe(){ var f=document.querySelector('#modalRoot iframe'); if(f&&f.contentWindow){ f.contentWindow.focus(); f.contentWindow.print(); } }

/* ---- Small UI atoms ------------------------------------------------------- */
function chip(text, cls){ return '<span class="chip '+(cls||'')+'">'+esc(text)+'</span>'; }
function statusBadge(code){
  var g=statusGroup(code); return '<span class="sbadge g'+g+'" title="'+esc(STATUS[code]||'')+'">'+esc(code)+'</span>';
}
function kpi(label,value,sub){
  return '<div class="kpi"><div class="kpi-l">'+esc(label)+'</div><div class="kpi-v">'+value+'</div>'+
    (sub?'<div class="kpi-s">'+sub+'</div>':'')+'</div>';
}
function bars(data, fmt){
  // data: [{label, value}]
  var max = Math.max(1, Math.max.apply(null, data.map(function(d){return d.value;}).concat([0])));
  return '<div class="bars">'+data.map(function(d){
    var pct = Math.round(d.value/max*100);
    return '<div class="bar-row"><div class="bar-lab">'+esc(d.label)+'</div>'+
      '<div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div>'+
      '<div class="bar-val">'+(fmt?fmt(d.value):num(d.value))+'</div></div>';
  }).join('')+'</div>';
}
function emptyState(msg){ return '<div class="empty">'+esc(msg)+'</div>'; }
function optionList(items, sel, withTBA, label){
  var o = withTBA ? '<option value="TBA"'+(sel==='TBA'||!sel?' selected':'')+'>TBA</option>' : '<option value="">—</option>';
  return o + items.map(function(it){
    return '<option value="'+attr(it.id)+'"'+(sel===it.id?' selected':'')+'>'+esc(it.name + (label?(' · '+it.role||''):''))+'</option>';
  }).join('');
}
