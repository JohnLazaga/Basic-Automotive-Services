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
    { id:'appointments', label:'Appointments', icon:'▤', cap:'appointments' },
    { id:'jobs', label:'Job Orders', icon:'▧' },
    { id:'estimates', label:'Estimates', icon:'✎', cap:'estimates' },
    { id:'pms', label:'PMS Queue', icon:'🔧' }
  ]},
  { group:'ANALYTICS', items:[
    { id:'reports', label:'Reports', icon:'▣', cap:'reports' },
    { id:'dailyclose', label:'Daily Close', icon:'◷', cap:'dailyclose' },
    { id:'productivity', label:'Productivity', icon:'⚙', cap:'productivity' },
    { id:'receivables', label:'Receivables', icon:'₱', cap:'receivables' }
  ]},
  { group:'RECORDS', items:[
    { id:'vehicles', label:'Vehicles', icon:'⛛' },
    { id:'parts', label:'Parts Catalog', icon:'◫', cap:'parts_manage' },
    { id:'labor', label:'Labor Catalog', icon:'☰', cap:'parts_manage' },
    { id:'purchaseorders', label:'Purchase Orders', icon:'⊞', cap:'parts_manage' },
    { id:'staff', label:'Staff', icon:'☺', cap:'staff_manage' }
  ]},
  { group:'SETUP', items:[
    { id:'accounts', label:'Accounts & Roles', icon:'⚷', cap:'staff_manage' },
    { id:'settings', label:'Settings', icon:'⚒', cap:'settings' }
  ]}
];
function navAllowed(it){ return (typeof can!=='function') || !it.cap || can(it.cap); }

var NAV_STACK = [];      // breadcrumb of visited pages for ESC "back"
function _navTo(view, arg){
  ROUTE.view = view; ROUTE.arg = arg||null;
  if (typeof document!=='undefined'){
    var sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('open');
    window.scrollTo(0,0);
  }
  render();
}
function go(view, arg){
  // Remember the page we're leaving so ESC can step back to it. Skip no-op
  // navigations and consecutive duplicates.
  if (ROUTE.view && !(ROUTE.view===view && (ROUTE.arg||null)===(arg||null))){
    var top=NAV_STACK[NAV_STACK.length-1];
    if (!top || top.view!==ROUTE.view || (top.arg||null)!==(ROUTE.arg||null)){
      NAV_STACK.push({ view:ROUTE.view, arg:ROUTE.arg });
      if (NAV_STACK.length>50) NAV_STACK.shift();
    }
  }
  _navTo(view, arg);
}
/* ESC "back": step to the previous page; the Operations Board is the last stop. */
function goBack(){
  while (NAV_STACK.length){
    var prev = NAV_STACK.pop();
    if (prev && !(prev.view===ROUTE.view && (prev.arg||null)===(ROUTE.arg||null))){
      _navTo(prev.view, prev.arg); return;
    }
  }
  if (ROUTE.view!=='board') _navTo('board');   // nothing left to go back to → Board
}

/* ---- View dispatch (filled by later parts) -------------------------------- */
var VIEWS = {}; // id -> function(arg) -> html string

function renderView(){
  if (typeof routeAllowed==='function' && !routeAllowed(ROUTE.view)){
    return '<div class="page">'+accessDenied(viewTitle(ROUTE.view))+'</div>';
  }
  var fn = VIEWS[ROUTE.view] || VIEWS['board'];
  try { return fn(ROUTE.arg); }
  catch(e){ return '<div class="card"><h2>View error</h2><pre>'+esc(e&&e.stack||e)+'</pre></div>'; }
}

/* ---- Sidebar -------------------------------------------------------------- */
/* Short branch label under the logo — the branch's location (e.g.
   "Commonwealth, Quezon City", "Sudipen, La Union", "Fairview, Quezon City"),
   falling back to the branch name minus the brand prefix. */
function branchLabel(){
  if (typeof BRANCH!=='undefined' && BRANCH){
    if (BRANCH.location) return BRANCH.location;
    if (BRANCH.name) return BRANCH.name.replace(/^Basic by JMSI\s*[—–-]\s*/i, '').trim() || BRANCH.name;
  }
  return 'Fairview, Quezon City';
}
function sidebarHTML(){
  var nav = NAV.map(function(g){
    var allowed = g.items.filter(navAllowed);
    if (!allowed.length) return '';
    var items = allowed.map(function(it){
      var on = (ROUTE.view===it.id) ? ' active' : '';
      return '<button class="nav'+on+'" data-nav="'+it.id+'" onclick="go(\''+it.id+'\')">'+
        '<span class="nav-i">'+it.icon+'</span>'+esc(it.label)+'</button>';
    }).join('');
    return '<div class="nav-group"><div class="nav-title">'+esc(g.group)+'</div>'+items+'</div>';
  }).join('');
  return '<aside id="sidebar" class="sidebar">'+
    '<div class="brandlock"><img class="lockup" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/>'+
      '<div class="brandsub">'+esc(branchLabel())+'</div></div>'+
    '<nav class="navwrap">'+nav+'</nav>'+
    '<div class="sidefoot">Shop Operations · offline-ready<br><span class="appver">'+esc(APP_VERSION)+'</span></div>'+
  '</aside>';
}

/* ---- Auto-update check ---------------------------------------------------- */
/* Poll the deployed version.txt; if it differs from the running APP_VERSION a new
   build is live, so prompt a reload. This lets every branch self-update instead
   of relying on someone remembering to hard-refresh. */
var _updShown=false;
function startUpdateChecker(){
  if (typeof window==='undefined' || typeof fetch!=='function') return;
  if (typeof cloudOn==='function' && !cloudOn()) return;   // skip the local/dev build
  function check(){
    fetch('version.txt?v='+Date.now(), { cache:'no-store' })
      .then(function(r){ return r.ok ? r.text() : null; })
      .then(function(t){
        if (!t) return; t=t.trim();
        if (t && typeof APP_VERSION!=='undefined' && t!==APP_VERSION && !_updShown){ _updShown=true; showUpdateBanner(t); }
      }).catch(function(){ /* offline / not found — ignore */ });
  }
  setTimeout(check, 15000);      // shortly after load
  setInterval(check, 300000);    // then every 5 minutes
}
function showUpdateBanner(ver){
  if (typeof document==='undefined' || document.getElementById('updBanner')) return;
  var b=document.createElement('div'); b.id='updBanner';
  b.innerHTML='<span>🔄 A new version ('+esc(ver)+') is available.</span>'+
    '<button class="upd-go" onclick="location.reload()">Reload now</button>'+
    '<button class="upd-x" onclick="this.parentNode.remove()" aria-label="Later">✕</button>';
  document.body.appendChild(b);
}

/* ---- Disable browser autofill on data-entry fields ------------------------
   All branches share one origin (basicautomotiveservices.com/<branch>), so the
   browser would suggest values typed into one branch's form (e.g. Fairview staff
   names) inside another branch's form. Force autocomplete="off" on every field
   that doesn't already declare one — the login/credential fields keep their
   explicit autocomplete so password managers still work. A MutationObserver
   covers dynamically-rendered content and modals. */
function installNoAutofill(){
  if (typeof document==='undefined' || typeof MutationObserver==='undefined') return;
  function fix(node){
    if (!node || node.nodeType!==1) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName) && !node.getAttribute('autocomplete')){
      node.setAttribute('autocomplete','off');
    }
    if (node.querySelectorAll){
      var els = node.querySelectorAll('input:not([autocomplete]),select:not([autocomplete]),textarea:not([autocomplete])');
      for (var i=0;i<els.length;i++){ els[i].setAttribute('autocomplete','off'); }
    }
  }
  fix(document.body);
  try {
    var mo = new MutationObserver(function(muts){
      for (var i=0;i<muts.length;i++){ var a=muts[i].addedNodes; for (var j=0;j<a.length;j++){ fix(a[j]); } }
    });
    mo.observe(document.body, { childList:true, subtree:true });
  } catch(e){ /* non-fatal */ }
}

/* ---- Universal rule: encode everything in UPPERCASE ----------------------
   Shop policy across EVERY branch: text typed into the system ("encoding") is
   stored in UPPERCASE, so records and printouts read consistently regardless of
   who keyed them in. One capture-phase input listener force-uppercases every
   text field as it is typed OR pasted, so the value the rest of the app reads
   and saves is already uppercase — no per-field code needed. Runs in the CAPTURE
   phase so a field's own oninput handler (plate/SKU lookups) sees the uppercased
   value too. Because it lives in the shared core, it applies to all branches.

   Left untouched — fields where case is meaningful or must stay lower/mixed:
     • password / e-mail / url / number / date-time / colour input types
     • anything with autocapitalize="off" or "none"  (logins, usernames, passwords)
     • search boxes (queries, not encoded data — search is case-insensitive)
     • anything explicitly opted out with the data-no-upper attribute */
function installUppercase(){
  if (typeof document==='undefined' || !document.addEventListener) return;
  var SKIP_TYPE = { password:1, email:1, url:1, number:1, date:1, 'datetime-local':1,
    month:1, week:1, time:1, color:1, file:1, range:1, checkbox:1, radio:1, hidden:1,
    submit:1, button:1, image:1, reset:1 };
  function skip(el){
    if (!el || !el.tagName) return true;
    var tag = el.tagName;
    if (tag!=='INPUT' && tag!=='TEXTAREA') return true;
    if (tag==='INPUT' && SKIP_TYPE[(el.getAttribute('type')||'text').toLowerCase()]) return true;
    var ac = (el.getAttribute('autocapitalize')||'').toLowerCase();
    if (ac==='off' || ac==='none') return true;
    if (el.hasAttribute('data-no-upper')) return true;
    if (el.classList && el.classList.contains('searchbox')) return true;
    return false;
  }
  document.addEventListener('input', function(e){
    var el = e.target;
    if (skip(el)) return;
    var v = el.value; if (!v) return;
    var up = v.toUpperCase(); if (up===v) return;
    // Uppercasing never changes length — preserve the caret so mid-field edits
    // don't jump the cursor to the end.
    var s = el.selectionStart, en = el.selectionEnd;
    el.value = up;
    try { if (s!=null) el.setSelectionRange(s, en); } catch(_){ /* non-text field */ }
  }, true);   // capture: run before the field's own oninput handler
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
      ((typeof cloudOn==='function' && cloudOn() && FB && FB.user)
        ? (CURRENT_USER ? '<span class="rolebadge'+(CURRENT_USER.isAdmin?' admin':'')+'">'+esc(CURRENT_USER.isAdmin?'Admin':roleLabel(CURRENT_USER.role))+'</span>' : '')+
          '<span class="userchip" id="userChip" title="Signed in">'+esc(FB.user.email||'')+'</span>'+
          '<button class="iconbtn" onclick="doLogout()" title="Sign out" aria-label="Sign out">⎋</button>'
        : '')+
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
/* Global keyboard:
   - ESC = "back": close an open modal, else step a detail page back to its list.
   - ENTER in a field = move to the next field; on the last field of a dialog,
     trigger its Save/primary button (textareas keep normal multi-line Enter). */
var _keysBound=false;
function _formFields(container){
  return Array.prototype.slice.call(container.querySelectorAll(
    'input:not([type=hidden]):not([disabled]):not([readonly]), select:not([disabled])'
  )).filter(function(el){ return el.type!=='button' && el.type!=='submit' && el.offsetParent!==null; });
}
function bindKeys(){
  if (_keysBound || typeof document==='undefined' || !document.addEventListener) return;
  _keysBound=true;
  document.addEventListener('keydown', function(e){
    // ESC = close any open modal, otherwise step back a page (Board is last stop)
    if (e.key==='Escape' || e.keyCode===27){
      if (document.querySelector && document.querySelector('#modalRoot .modal-back')){ e.preventDefault(); closeModal(); return; }
      if (ROUTE.view!=='board' || NAV_STACK.length){ e.preventDefault(); goBack(); }
      return;
    }
    // ENTER = advance to next field (or submit on the last one)
    if (e.key==='Enter' || e.keyCode===13){
      var t=e.target; if(!t||!t.tagName) return;
      var tag=t.tagName.toUpperCase();
      if (tag==='TEXTAREA') return;                       // allow newlines in notes
      if (tag!=='INPUT' && tag!=='SELECT') return;        // only form fields
      if (t.type==='button' || t.type==='submit') return;
      var modal=t.closest && t.closest('.modal');
      var login=t.closest && t.closest('.login-card');
      var container = modal || login || (t.closest && (t.closest('.card')||t.closest('.page'))) || document.getElementById('app');
      if(!container) return;
      var fields=_formFields(container);
      var idx=fields.indexOf(t);
      if(idx<0) return;
      if(idx < fields.length-1){
        e.preventDefault();
        var nx=fields[idx+1]; if(nx.focus) nx.focus();
        if(nx.select && /^(text|number|email|password|search|tel|url)$/.test(nx.type||'text')){ try{nx.select();}catch(_){} }
      } else if (modal || login){
        e.preventDefault();
        var btn=(modal && (modal.querySelector('.modal-foot .btn.primary')||modal.querySelector('.btn.primary'))) ||
                (login && login.querySelector('.btn.primary'));
        if(btn) btn.click();
      }
    }
  });
}

var _mounted=false, _mode=null;
function render(){
  if (typeof document==='undefined') return;
  // In cloud mode, until a staff session exists the auth/portal screens own the
  // DOM. A signed-out visitor on a #v= link gets the public portal snapshot;
  // any other route just keeps the login screen. (No-op in local/test mode.)
  if (typeof cloudOn==='function' && cloudOn() && typeof FB!=='undefined' && FB && FB.ready && !FB.user){
    if (typeof isPortalRoute==='function' && isPortalRoute() && typeof loadPublicPortal==='function') loadPublicPortal();
    return;   // not signed in yet → login screen holds the DOM; the #addphoto hash survives for after login
  }
  // "Add photos by phone" QR deep link (#addphoto=<jobId>): now that a staff
  // session exists, jump straight to the mobile uploader. Consume the hash once
  // so normal navigation afterwards isn't pinned to this route.
  var _photoJob = (typeof photoRouteJobId==='function') ? photoRouteJobId() : null;
  if (_photoJob){
    try { if (window.history && history.replaceState) history.replaceState(null, '', location.pathname + location.search); } catch(e){}
    ROUTE.view = 'photoup'; ROUTE.arg = _photoJob;
  }
  bindKeys();
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
    '<div class="modal-back">'+
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

/* Signatures are captured by hand on the printouts — no in-app signature pad. */

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
