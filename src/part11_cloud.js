/* ============================================================================
   PART 11 — Cloud (Firebase): init, auth gate, login screen.
   Phase 2 increment 1: authentication foundation. Data still loads locally
   after sign-in; the Firestore data-layer swap is the next increment.
   All Firebase calls happen inside functions invoked at boot (browser only),
   never at module load — so the Node test bundle is unaffected.
   ========================================================================== */

var FB = { app:null, auth:null, db:null, storage:null, ready:false, user:null };

function cloudOn(){ return (typeof CLOUD_ENABLED!=='undefined') && CLOUD_ENABLED; }

function initFirebase(){
  if (FB.ready) return true;
  if (typeof firebase==='undefined' || typeof FIREBASE_CONFIG==='undefined') return false;
  try {
    FB.app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(FIREBASE_CONFIG);
    FB.auth = firebase.auth();
    FB.db = firebase.firestore();
    try { FB.storage = firebase.storage(); } catch(e){}
    // NOTE: multi-tab IndexedDB persistence was DISABLED — a wedged/locked local
    // cache (common with several tabs/stations open) made collection queries hang
    // forever, stranding users on "Loading shop data" (looked like "can't log in").
    // Reads now go straight to the network, which is reliable. Re-enable a durable
    // offline cache only as part of the deliberate offline-mode decision.
    FB.ready = true;
    return true;
  } catch(e){ console.error('Firebase init failed:', e); return false; }
}

/* Entry point from boot() when cloud is enabled.
   Paints the login screen IMMEDIATELY (no Firebase needed to draw it), then
   waits for the deferred Firebase SDK to finish loading before wiring auth.
   This keeps first paint fast on mobile — the SDK downloads in the background. */
function cloudStart(){
  // Public QR portal links (#v=<id>) are served WITHOUT sign-in: they read only
  // the minimal public `portal/<id>` snapshot — never the protected database.
  var portal = (typeof isPortalRoute==='function' && isPortalRoute());
  if (portal){ renderPortalLoading(); } else renderLogin(null, null, true);
  whenFirebaseReady(function(ok){
    if (!ok){
      if (portal){ renderPortalError('This portal is offline. Please check your connection or contact the shop.'); return; }
      renderCloudError('Couldn’t load the sign-in service.',
        'Check your internet connection and reload.');
      return;
    }
    if (!initFirebase()){
      if (portal){ renderPortalError('This portal is temporarily unavailable.'); return; }
      renderCloudError('Firebase failed to initialize.', 'The configuration may be incomplete.');
      return;
    }
    if (portal){ loadPublicPortal(); return; }   // public read, no auth
    FB.auth.onAuthStateChanged(function(user){
      FB.user = user;
      if (user) onSignedIn(user);
      else renderLogin();
    });
  });
}
/* Fetch and render the public portal snapshot for the vehicle in the URL. */
function loadPublicPortal(){
  var id = (typeof portalVehicleId==='function') ? portalVehicleId() : null;
  if(!id){ renderPortalError('No vehicle specified.'); return; }
  Promise.all([
    FB.db.collection('portal').doc(id).get(),
    FB.db.collection('portal').doc('_shop').get().catch(function(){ return null; })
  ]).then(function(res){
    var doc=res[0], shopDoc=res[1];
    var app=document.getElementById('app'); if(!app) return;
    if(!doc.exists){ renderPortalError('No service record found for this vehicle yet.'); return; }
    var data=doc.data();
    // Always use the current shared shop details when available (Settings edits
    // reflect immediately without re-publishing every vehicle).
    if(shopDoc && shopDoc.exists){ data.shop=shopDoc.data(); }
    app.innerHTML = '<div class="portal-page">'+portalCardsHTML(data)+'</div>';
  }).catch(function(){
    renderPortalError('Couldn’t load this vehicle’s service record.');
  });
}
/* Watch the public appt_requests collection; prompt staff immediately when a
   new customer appointment request arrives. */
var _apptReqData={}, _apptReqQueue=[], _apptReqShowing=false, _apptReqSub=null;
function subscribeApptRequests(){
  if(typeof FB==='undefined'||!FB||!FB.db||_apptReqSub) return;
  try{
    _apptReqSub=FB.db.collection('appt_requests').where('status','==','new').onSnapshot(function(snap){
      snap.docChanges().forEach(function(ch){
        if(ch.type==='added'){ var id=ch.doc.id; if(_apptReqData[id]) return; _apptReqData[id]=ch.doc.data(); _apptReqQueue.push(id); }
      });
      pumpApptReqPrompt();
    }, function(){ /* ignore listen errors */ });
  }catch(e){ /* non-fatal */ }
}
function pumpApptReqPrompt(){
  if(_apptReqShowing || !_apptReqQueue.length || typeof openModal!=='function') return;
  var id=_apptReqQueue.shift(); var r=_apptReqData[id]||{}; _apptReqShowing=true;
  openModal('📅 New appointment request',
    '<div class="ksmall">'+
      kv('Name', esc(r.name||'—'))+ kv('Contact', esc(r.contact||'—'))+
      kv('Vehicle', esc(r.vehicle||'—'))+ kv('Plate', esc(r.plate||'—'))+
      kv('Preferred date', esc(r.preferredDate||'—'))+ kv('Request', esc(r.notes||'—'))+
    '</div><p class="muted small">Requested from the customer portal.</p>',
    { footer:'<button class="btn ghost" onclick="dismissApptRequest(\''+id+'\')">Dismiss</button>'+
      '<button class="btn primary" onclick="acceptApptRequest(\''+id+'\')">Add to appointments</button>', width:'460px' });
}
function _apptReqNext(){ _apptReqShowing=false; if(typeof closeModal==='function') closeModal(); pumpApptReqPrompt(); }
function acceptApptRequest(id){
  var r=_apptReqData[id]||{};
  S.appointments.push({ id:uid('ap'), date:r.preferredDate||todayISO(), time:'', plate:r.plate||'',
    customer:r.name||'', contactNumber:r.contact||'', vehicle:r.vehicle||'', service:r.notes||'',
    assignedTo:'TBA', bayId:'TBA', status:'Booked', notes:'From customer portal request', jobId:null });
  persist();
  if(FB&&FB.db){ try{ FB.db.collection('appt_requests').doc(id).set({status:'accepted', handledAt:new Date().toISOString()},{merge:true}); }catch(e){} }
  delete _apptReqData[id];
  if(typeof toast==='function') toast('Appointment added');
  _apptReqNext(); if(typeof render==='function') render();
}
function dismissApptRequest(id){
  if(FB&&FB.db){ try{ FB.db.collection('appt_requests').doc(id).set({status:'dismissed', handledAt:new Date().toISOString()},{merge:true}); }catch(e){} }
  delete _apptReqData[id];
  _apptReqNext();
}
function renderPortalLoading(){
  var app=(typeof document!=='undefined') && document.getElementById('app'); if(!app) return;
  app.innerHTML='<div class="login-bg"><div class="login-card">'+
    '<img class="login-logo" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/>'+
    '<div class="login-sub">Vehicle Service Portal</div><div class="cloud-spin"></div></div></div>';
}
function renderPortalError(msg){
  var app=(typeof document!=='undefined') && document.getElementById('app'); if(!app) return;
  app.innerHTML='<div class="login-bg"><div class="login-card">'+
    '<img class="login-logo" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/>'+
    '<div class="login-sub">Vehicle Service Portal</div>'+
    '<div class="lg-msg" style="background:#f5f5f7;color:#1d1d1f">'+esc(msg)+'</div></div></div>';
}
/* Poll briefly for the deferred Firebase SDK to become available. */
function whenFirebaseReady(cb){
  if (typeof window==='undefined') return cb(false);
  var tries=0;
  (function check(){
    if (typeof firebase!=='undefined' && firebase.auth && firebase.firestore) return cb(true);
    if (tries++ > 150) return cb(false);     // ~15s ceiling
    setTimeout(check, 100);
  })();
}

async function onSignedIn(user){
  renderCloudLoading();
  // 1) Resolve this user's account & role (bootstraps first Admin).
  try {
    await loadCurrentUser(user);
  } catch(e){
    if (e.code==='not-provisioned'){
      await FB.auth.signOut(); renderLogin('This account isn’t set up yet. Ask your administrator to add you.','err'); return;
    }
    if (e.code==='inactive'){
      await FB.auth.signOut(); renderLogin('Your account has been disabled. Contact your administrator.','err'); return;
    }
    console.error('account load failed', e);
    renderCloudError('Sign-in problem.', (e&&e.message)||'Please try again.'); return;
  }
  // 2) Load shop data.
  try {
    await cloudLoadAll();
  } catch(e){
    console.error('cloud load failed', e);
    renderCloudError('Couldn’t load shop data.', (e&&e.message)||'Check your connection and reload.');
    return;
  }
  applyTheme((S.shop && S.shop.theme) || 'light');
  cloudSubscribe();
  subscribeApptRequests();          // live customer appointment requests
  render();
  updateUserChip();
  if (typeof loadCatalog==='function') loadCatalog();   // preload parts catalog in the background
}

function renderCloudLoading(){
  var app=(typeof document!=='undefined') && document.getElementById('app'); if(!app) return;
  app.innerHTML='<div class="login-bg"><div class="login-card">'+
    '<img class="login-logo" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/>'+
    '<div class="login-sub">Loading shop data…</div>'+
    '<div class="cloud-spin"></div></div></div>';
}

/* ============================================================================
   Firestore data layer (increment 2.2)
   - One-time migration of current local data when the cloud is empty.
   - Load all collections into S; keep S as the in-memory working cache.
   - Real-time listeners merge remote changes (skipping local echoes).
   - Writes go through cloudPersist(): diff S vs last snapshot, upsert/delete.
   - Job photos are uploaded to Firebase Storage so docs stay under 1 MB.
   ========================================================================== */
var COLLECTIONS = ['staff','bays','parts','labor','vehicles','estimates','jobs','appointments','purchaseOrders'];
var _cloudSnap = {};       /* {collection: {id: jsonString}} — for diffing */
var _metaSnap = { shop:null, counters:null };  /* last-synced meta docs */
var _cloudSubs = [];       /* unsubscribe fns */
var _applyingRemote = false;

function plain(o){ return JSON.parse(JSON.stringify(o)); }          /* drops undefined/functions */
function snapMap(arr){ var m={}; (arr||[]).forEach(function(r){ m[r.id]=JSON.stringify(r); }); return m; }
function modalOpen(){ return typeof document!=='undefined' && !!document.querySelector('#modalRoot .modal'); }

async function cloudLoadAll(){
  // is the cloud already populated?
  var shopDoc = await FB.db.collection('meta').doc('shop').get();
  if (!shopDoc.exists){
    // empty cloud → migrate from current local data (or a fresh seed)
    var raw = await Storage.get(STORE_KEY);
    var base = null; try { base = raw ? JSON.parse(raw) : null; } catch(e){}
    if (!base || base.version!==2) base = seedState();
    await cloudMigrate(base);
  }
  S = await cloudFetchState();
  ensureStateShape();
  rememberSnap();
}

function ensureStateShape(){
  COLLECTIONS.forEach(function(c){ if(!Array.isArray(S[c])) S[c]=[]; });
  if(!S.counters) S.counters={ est:0, jo:0, or:1000, po:0 };
  if(!S.shop) S.shop=seedState().shop;
  if(!S.shop.theme) S.shop.theme='light';
}

async function cloudFetchState(){
  var st = seedState();              // defaults for shop/counters + array shape
  var shopDoc = await FB.db.collection('meta').doc('shop').get();
  if (shopDoc.exists) st.shop = Object.assign(st.shop, shopDoc.data());
  var cntDoc = await FB.db.collection('meta').doc('counters').get();
  if (cntDoc.exists) st.counters = Object.assign(st.counters, cntDoc.data());
  for (var i=0;i<COLLECTIONS.length;i++){
    var c = COLLECTIONS[i];
    var snap = await FB.db.collection(c).get();
    st[c] = snap.docs.map(function(d){ return d.data(); });
  }
  return st;
}

async function cloudMigrate(base){
  await FB.db.collection('meta').doc('shop').set(plain(base.shop||{}));
  await FB.db.collection('meta').doc('counters').set(plain(base.counters||{est:0,jo:0,or:1000,po:0}));
  for (var i=0;i<COLLECTIONS.length;i++){
    var c = COLLECTIONS[i]; var arr = base[c]||[];
    for (var j=0;j<arr.length;j++){
      var rec = arr[j]; if (c==='jobs') await uploadJobPhotos(rec);
      await FB.db.collection(c).doc(rec.id).set(plain(rec));
    }
  }
}

async function cloudFetchState_noop(){}  /* reserved */

/* ---- Write path: diff S against last snapshot, sync changes -------------- */
async function cloudPersist(){
  if (!FB.ready || !FB.user || _applyingRemote) return;
  var amAdmin = !!(typeof CURRENT_USER!=='undefined' && CURRENT_USER && CURRENT_USER.isAdmin);
  // meta/shop (settings + permissions) is ADMIN-ONLY at the DB level. Only an
  // admin attempts it; everyone else just acknowledges the change locally so it
  // is NOT retried — a denied write here must never block the data writes below.
  var shopJSON = JSON.stringify(S.shop);
  if (shopJSON !== _metaSnap.shop){
    if (amAdmin){ try { await FB.db.collection('meta').doc('shop').set(plain(S.shop)); } catch(e){ console.error('meta/shop', e); } }
    _metaSnap.shop = shopJSON;
  }
  var cntJSON = JSON.stringify(S.counters);
  if (cntJSON !== _metaSnap.counters){
    try { await FB.db.collection('meta').doc('counters').set(plain(S.counters)); _metaSnap.counters = cntJSON; } catch(e){ console.error('counters', e); }
  }
  for (var i=0;i<COLLECTIONS.length;i++){
    var c = COLLECTIONS[i];
    var cur = {}; (S[c]||[]).forEach(function(r){ cur[r.id]=r; });
    var prev = _cloudSnap[c] || (_cloudSnap[c]={});
    // upserts (new or changed) — each isolated so one failure never aborts the rest
    var ids = Object.keys(cur);
    for (var k=0;k<ids.length;k++){
      var id = ids[k], rec = cur[id], js = JSON.stringify(rec);
      if (prev[id] === js) continue;                            // unchanged
      try {
        if (c==='jobs') await uploadJobPhotos(rec);             // relocate base64 → Storage
        await FB.db.collection(c).doc(id).set(plain(rec));
        prev[id] = js;                                          // mark synced only on success
      } catch(e){ console.error('save '+c+'/'+id, e); }         // keep stale -> retried next save
    }
    // deletes (gone from S)
    var prevIds = Object.keys(prev);
    for (var d=0; d<prevIds.length; d++){ var did=prevIds[d];
      if(!cur[did]){ try { await FB.db.collection(c).doc(did).delete(); delete prev[did]; } catch(e){ console.error('del '+c+'/'+did, e); } }
    }
  }
}

function rememberSnap(){
  COLLECTIONS.forEach(function(c){ _cloudSnap[c]=snapMap(S[c]); });
  _metaSnap.shop = JSON.stringify(S.shop);
  _metaSnap.counters = JSON.stringify(S.counters);
}

/* ---- Photos → Firebase Storage ------------------------------------------- */
async function uploadJobPhotos(job){
  if (!job || !Array.isArray(job.photos) || !FB.storage) return;
  for (var i=0;i<job.photos.length;i++){
    var p = job.photos[i];
    if (p.url || !p.data) continue;                            // already uploaded / nothing to do
    try {
      var ref = FB.storage.ref('photos/'+job.id+'/'+p.id+'.jpg');
      await ref.putString(p.data, 'data_url');
      var url = await ref.getDownloadURL();
      job.photos[i] = { id:p.id, url:url, caption:p.caption||'', ts:p.ts };
    } catch(e){ console.error('photo upload failed', e); /* keep base64 as fallback */ }
  }
}

/* ---- Real-time listeners ------------------------------------------------- */
function cloudSubscribe(){
  cloudUnsub();
  COLLECTIONS.forEach(function(c){
    var u = FB.db.collection(c).onSnapshot(function(snap){
      if (snap.metadata.hasPendingWrites) return;             // ignore our own local writes
      _applyingRemote = true;
      S[c] = snap.docs.map(function(d){ return d.data(); });
      _cloudSnap[c] = snapMap(S[c]);
      _applyingRemote = false;
      if (!modalOpen()) render();
    }, function(err){ console.error('listener '+c, err); });
    _cloudSubs.push(u);
  });
  var um = FB.db.collection('meta').onSnapshot(function(snap){
    if (snap.metadata.hasPendingWrites) return;
    snap.docs.forEach(function(d){
      if (d.id==='shop'){ S.shop = Object.assign(S.shop||{}, d.data()); _metaSnap.shop = JSON.stringify(S.shop); }
      if (d.id==='counters'){ S.counters = Object.assign(S.counters||{}, d.data()); _metaSnap.counters = JSON.stringify(S.counters); }
    });
    if (!modalOpen()) render();
  });
  _cloudSubs.push(um);
}
function cloudUnsub(){ _cloudSubs.forEach(function(u){ try{u();}catch(e){} }); _cloudSubs=[]; }

/* ============================================================================
   LOCAL BRANCH BACKEND (Phase 3) — operational data on the branch mini-PC.
   Selected when BRANCH.dataSource==='local'. Talks to the same branch server
   as parts (BRANCH.partsUrl): GET /data on load, per-record POST/DELETE driven
   by the persist() diff, live changes over an SSE /events stream, and
   server-atomic counters. The Firestore (cloud) path is left untouched.
   ========================================================================== */
var CLIENT_ID = (typeof Math!=='undefined') ? ('c'+Math.random().toString(36).slice(2)+Date.now().toString(36)) : 'c0';
var _es = null;
var SESSION_TOKEN = null;                 /* branch-server session (Phase 3d) */
var SESSION_KEY = 'bas_session';

function dataLocal(){ return typeof BRANCH!=='undefined' && BRANCH && BRANCH.dataSource==='local' && !!BRANCH.partsUrl; }
/* The branch server also serves the app, so its base is simply the origin the
   page was loaded from — works from any device/IP/hostname with no baked URL.
   BRANCH.partsUrl is only the "this is a local branch" flag + a non-browser
   fallback (e.g. tests). */
function branchBase(){
  if (typeof location!=='undefined' && location && String(location.origin||'').indexOf('http')===0) return location.origin;
  return (typeof BRANCH!=='undefined' && BRANCH && BRANCH.partsUrl) ? String(BRANCH.partsUrl).replace(/\/+$/,'') : '';
}
function authHeaders(extra){ var h=extra||{}; if(SESSION_TOKEN) h['X-Session-Token']=SESSION_TOKEN; return h; }
function _postJSON(url, obj){ return fetch(url, { method:'POST', headers:authHeaders({'Content-Type':'application/json'}), body:JSON.stringify(obj) }).then(function(r){ return r.json(); }); }

async function localLoadAll(){
  var res = await fetch(branchBase()+'/data', { headers: authHeaders() });
  if(!res.ok) throw new Error('branch server HTTP '+res.status);
  var d = await res.json();
  var empty = !d.shop && COLLECTIONS.every(function(c){ return !((d.collections&&d.collections[c])||[]).length; });
  if (empty){
    // First run for this branch: seed the server from current local data (or defaults).
    var raw = await Storage.get(STORE_KEY); var base=null; try{ base = raw?JSON.parse(raw):null; }catch(e){}
    if (!base || base.version!==2) base = seedState();
    await _postJSON(branchBase()+'/data/import', base);
    S = base;
  } else {
    var st = seedState();
    if (d.shop) st.shop = Object.assign(st.shop, d.shop);
    if (d.counters) st.counters = Object.assign(st.counters, d.counters);
    COLLECTIONS.forEach(function(c){ st[c] = (d.collections && d.collections[c]) || []; });
    S = st;
  }
  ensureStateShape();
  rememberSnap();
  return S;
}

function _applyRemote(fn){ _applyingRemote = true; try{ fn(); }catch(e){ console.error('apply remote', e); } _applyingRemote = false; if(!modalOpen()) render(); }

function localSubscribe(){
  if (typeof EventSource==='undefined') return;
  if (_es){ try{ _es.close(); }catch(e){} }
  _es = new EventSource(branchBase()+'/events?token='+encodeURIComponent(SESSION_TOKEN||''));
  _es.addEventListener('upsert', function(ev){ var m; try{m=JSON.parse(ev.data);}catch(e){return;} if(m.origin===CLIENT_ID) return;
    _applyRemote(function(){ var arr=S[m.coll]||(S[m.coll]=[]); var i=-1; for(var x=0;x<arr.length;x++){ if(String(arr[x].id)===String(m.id)){ i=x; break; } }
      if(i>=0) arr[i]=m.rec; else arr.push(m.rec); (_cloudSnap[m.coll]||(_cloudSnap[m.coll]={}))[m.id]=JSON.stringify(m.rec); });
  });
  _es.addEventListener('delete', function(ev){ var m; try{m=JSON.parse(ev.data);}catch(e){return;} if(m.origin===CLIENT_ID) return;
    _applyRemote(function(){ S[m.coll]=(S[m.coll]||[]).filter(function(r){return String(r.id)!==String(m.id);}); if(_cloudSnap[m.coll]) delete _cloudSnap[m.coll][m.id]; });
  });
  _es.addEventListener('meta', function(ev){ var m; try{m=JSON.parse(ev.data);}catch(e){return;} if(m.origin===CLIENT_ID) return;
    _applyRemote(function(){ if(m.key==='shop'){ S.shop=Object.assign(S.shop||{},m.value); _metaSnap.shop=JSON.stringify(S.shop); } else if(m.key==='counters'){ S.counters=Object.assign(S.counters||{},m.value); _metaSnap.counters=JSON.stringify(S.counters); } });
  });
  _es.addEventListener('reload', function(){ localLoadAll().then(function(){ if(!modalOpen()) render(); }).catch(function(){}); });
}

/* Move a job's base64 photos to files on the branch server; store the URL. */
async function localUploadJobPhotos(job){
  if (!job || !Array.isArray(job.photos)) return;
  for (var i=0;i<job.photos.length;i++){
    var pp = job.photos[i];
    if (pp.url || !pp.data) continue;                    // already a file / nothing to upload
    try {
      var d = await _postJSON(branchBase()+'/photos/'+encodeURIComponent(job.id)+'/'+encodeURIComponent(pp.id), { data:pp.data });
      if (d && d.ok && d.url){ job.photos[i] = { id:pp.id, url:branchBase()+d.url, caption:pp.caption||'', ts:pp.ts }; }
    } catch(e){ /* keep base64 as a fallback */ }
  }
}

async function localPersist(){
  if (_applyingRemote) return;
  var base = branchBase();
  var amAdmin = !(typeof isAdminUser==='function') || isAdminUser();
  var shopJSON = JSON.stringify(S.shop);
  if (shopJSON !== _metaSnap.shop){
    // meta/shop (settings + permissions) is admin-only server-side; non-admins
    // just acknowledge locally so the write is never retried (mirrors cloud).
    if (amAdmin) await _postJSON(base+'/data/meta/shop', { value:plain(S.shop), origin:CLIENT_ID });
    _metaSnap.shop = shopJSON;
  }
  var cntJSON = JSON.stringify(S.counters);
  if (cntJSON !== _metaSnap.counters){ await _postJSON(base+'/data/meta/counters', { value:plain(S.counters), origin:CLIENT_ID }); _metaSnap.counters = cntJSON; }
  for (var i=0;i<COLLECTIONS.length;i++){
    var c = COLLECTIONS[i];
    var cur = {}; (S[c]||[]).forEach(function(r){ cur[r.id]=r; });
    var prev = _cloudSnap[c] || (_cloudSnap[c]={});
    var ids = Object.keys(cur);
    for (var k=0;k<ids.length;k++){ var id=ids[k], rec=cur[id], js=JSON.stringify(rec);
      if (prev[id]===js) continue;
      try {
        if (c==='jobs') await localUploadJobPhotos(rec);       // base64 photos -> files on the mini-PC
        var js2 = JSON.stringify(rec);                          // recompute (photos may now carry urls)
        await _postJSON(base+'/data/'+c+'/'+encodeURIComponent(id), { rec:plain(rec), origin:CLIENT_ID });
        prev[id]=js2;
      }
      catch(e){ console.error('local save '+c+'/'+id, e); }
    }
    var prevIds = Object.keys(prev);
    for (var d2=0; d2<prevIds.length; d2++){ var did=prevIds[d2];
      if(!cur[did]){ try { await fetch(base+'/data/'+c+'/'+encodeURIComponent(did)+'?origin='+CLIENT_ID, { method:'DELETE', headers:authHeaders() }); delete prev[did]; } catch(e){ console.error('local del '+c+'/'+did, e); } }
    }
  }
}

/* Boot for a local branch: local staff login against the branch server. */
async function localBootStart(){
  try { SESSION_TOKEN = (typeof localStorage!=='undefined') ? localStorage.getItem(SESSION_KEY) : null; } catch(e){ SESSION_TOKEN=null; }
  if (SESSION_TOKEN){
    try {
      var d = await fetch(branchBase()+'/auth/me?token='+encodeURIComponent(SESSION_TOKEN)).then(function(r){ return r.json(); });
      if (d && d.ok){ CURRENT_USER = d.user; return afterLocalLogin(); }
    } catch(e){ /* fall through to login */ }
    SESSION_TOKEN=null; try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  }
  renderLogin();
}
/* After a successful local login: load data, subscribe, render. */
async function afterLocalLogin(){
  renderCloudLoading();
  try { await localLoadAll(); }
  catch(e){ renderCloudError('Couldn’t reach the branch server.', 'Is the mini-PC server running at '+branchBase()+'? ('+((e&&e.message)||'')+')'); return; }
  applyTheme((S.shop && S.shop.theme) || 'light');
  localSubscribe();
  render();
  if (typeof updateUserChip==='function') updateUserChip();
  if (typeof loadCatalog==='function') loadCatalog();
}
function localLogin(){
  var id=(val('lgEmail')||'').trim(), pw=val('lgPass')||'';
  if(!id||!pw){ renderLogin('Enter your username and password.','err'); return; }
  var btn=document.querySelector('.lg-btn'); if(btn){ btn.textContent='Signing in…'; btn.disabled=true; }
  _postJSON(branchBase()+'/auth/login', { username:id, password:pw }).then(function(d){
    if(!d || !d.ok){ renderLogin(d&&d.error==='inactive' ? 'Your account has been disabled. Contact your administrator.' : 'Incorrect username or password.','err'); return; }
    SESSION_TOKEN=d.token; try{ localStorage.setItem(SESSION_KEY, d.token); }catch(e){}
    CURRENT_USER=d.user;
    afterLocalLogin();
  }).catch(function(){ renderLogin('Couldn’t reach the branch server. Is the mini-PC on?','err'); });
}
function localLogout(){
  var t=SESSION_TOKEN;
  SESSION_TOKEN=null; CURRENT_USER=null; try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  if(_es){ try{_es.close();}catch(e){} _es=null; }
  if(t){ fetch(branchBase()+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t})}).catch(function(){}); }
  renderLogin();
}

/* ---- Login screen --------------------------------------------------------- */
function renderLogin(msg, kind, connecting){
  var app = (typeof document!=='undefined') && document.getElementById('app');
  if (!app) return;
  var local = (typeof dataLocal==='function' && dataLocal());
  var status = local
    ? '<div class="lg-status ok">'+esc((typeof BRANCH!=='undefined'&&BRANCH.name)||'Local branch')+' · on-site server</div>'
    : (connecting || FB.ready ? '<div class="lg-status ok">Connected to <b>'+esc(FIREBASE_CONFIG.projectId)+'</b></div>' : '');
  app.innerHTML =
    '<div class="login-bg"><div class="login-card">'+
      '<img class="login-logo" src="'+LOGO_LOCKUP+'" alt="Basic by JMSI"/>'+
      '<div class="login-sub">Shop Operations · Staff Sign-in</div>'+
      (msg ? '<div class="lg-msg '+(kind||'err')+'">'+esc(msg)+'</div>' : '')+
      '<label class="lg-field"><span>Username</span>'+
        '<input id="lgEmail" type="text" autocomplete="username" placeholder="your username" autocapitalize="off"></label>'+
      '<label class="lg-field"><span>Password</span>'+
        '<input id="lgPass" type="password" autocomplete="current-password" placeholder="••••••••"></label>'+
      '<button class="btn primary full lg-btn" onclick="doLogin()">Sign in</button>'+
      '<div class="lg-link" style="cursor:default">Forgot your password? Ask your administrator.</div>'+
      status+
      '<div class="lg-ver">'+esc(typeof APP_VERSION!=='undefined'?APP_VERSION:'')+'</div>'+
    '</div></div>';
  setTimeout(function(){ var e=document.getElementById('lgEmail'); if(e&&e.focus) e.focus(); }, 30);
}

function renderCloudError(title, detail){
  var app=(typeof document!=='undefined') && document.getElementById('app'); if(!app) return;
  app.innerHTML='<div class="login-bg"><div class="login-card">'+
    '<img class="login-logo" src="'+(typeof LOGO_LOCKUP!=='undefined'?LOGO_LOCKUP:'')+'" alt="Basic by JMSI"/>'+
    '<div class="lg-msg err">'+esc(title)+'</div>'+
    '<p class="login-sub">'+esc(detail||'')+'</p>'+
    '<button class="btn primary full lg-btn" onclick="location.reload()">Reload</button>'+
  '</div></div>';
}

function doLogin(){
  if (typeof dataLocal==='function' && dataLocal()){ return localLogin(); }
  var id=(val('lgEmail')||'').trim(), pw=val('lgPass')||'';
  if(!id||!pw){ renderLogin('Enter your username and password.','err'); return; }
  var email = (typeof loginIdToEmail==='function') ? loginIdToEmail(id) : id;  // username -> synthetic email; owner email kept as-is
  var btn=document.querySelector('.lg-btn'); if(btn){ btn.textContent='Signing in…'; btn.disabled=true; }
  FB.auth.signInWithEmailAndPassword(email, pw).catch(function(e){
    renderLogin(friendlyAuthError(e), 'err');
  });
}
function doLogout(){
  confirmModal('Sign out?','You will need to sign in again to use the app.', function(){
    if (typeof closeModal==='function') closeModal();
    if (typeof dataLocal==='function' && dataLocal()){ localLogout(); return; }
    if(FB.auth) FB.auth.signOut();
  },'Sign out');
}
function doReset(){
  var email=(val('lgEmail')||'').trim();
  if(!email){ renderLogin('Type your email above first, then tap “Forgot password?”.','err'); return; }
  FB.auth.sendPasswordResetEmail(email).then(function(){
    renderLogin('Password reset link sent to '+email+'. Check your inbox.','ok');
  }).catch(function(e){ renderLogin(friendlyAuthError(e),'err'); });
}
function friendlyAuthError(e){
  var c=e&&e.code||'';
  if(c.indexOf('wrong-password')>=0||c.indexOf('invalid-credential')>=0) return 'Incorrect username or password.';
  if(c.indexOf('user-not-found')>=0) return 'No account found for that username.';
  if(c.indexOf('invalid-email')>=0) return 'That username looks invalid.';
  if(c.indexOf('too-many-requests')>=0) return 'Too many attempts. Please wait a moment and try again.';
  if(c.indexOf('network')>=0) return 'Network error — check your internet connection.';
  return (e&&e.message)||'Sign-in failed.';
}

/* current-user chip in the top bar (populated after sign-in) */
function updateUserChip(){
  if (typeof document==='undefined') return;
  var el=document.getElementById('userChip'); if(!el) return;
  var name = FB.user ? (FB.user.email||'Signed in')
    : (typeof CURRENT_USER!=='undefined' && CURRENT_USER ? (CURRENT_USER.name||CURRENT_USER.username||'Signed in') : '');
  el.textContent = name;
}
function currentUserEmail(){ return FB.user ? FB.user.email : ''; }
