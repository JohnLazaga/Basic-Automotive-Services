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
    // offline cache (best-effort; ignored if unsupported / multi-tab)
    try { FB.db.enablePersistence({ synchronizeTabs:true }).catch(function(){}); } catch(e){}
    FB.ready = true;
    return true;
  } catch(e){ console.error('Firebase init failed:', e); return false; }
}

/* Entry point from boot() when cloud is enabled.
   Paints the login screen IMMEDIATELY (no Firebase needed to draw it), then
   waits for the deferred Firebase SDK to finish loading before wiring auth.
   This keeps first paint fast on mobile — the SDK downloads in the background. */
function cloudStart(){
  renderLogin(null, null, true);              // instant first paint
  whenFirebaseReady(function(ok){
    if (!ok){
      renderCloudError('Couldn’t load the sign-in service.',
        'Check your internet connection and reload.');
      return;
    }
    if (!initFirebase()){
      renderCloudError('Firebase failed to initialize.', 'The configuration may be incomplete.');
      return;
    }
    FB.auth.onAuthStateChanged(function(user){
      FB.user = user;
      if (user) onSignedIn(user);
      else renderLogin();
    });
  });
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

/* ---- Login screen --------------------------------------------------------- */
function renderLogin(msg, kind, connecting){
  var app = (typeof document!=='undefined') && document.getElementById('app');
  if (!app) return;
  var status = connecting
    ? '<div class="lg-status ok">Connected to <b>'+esc(FIREBASE_CONFIG.projectId)+'</b></div>'
    : (FB.ready ? '<div class="lg-status ok">Connected to <b>'+esc(FIREBASE_CONFIG.projectId)+'</b></div>' : '');
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
  var name = FB.user ? (FB.user.email||'Signed in') : '';
  el.textContent = name;
}
function currentUserEmail(){ return FB.user ? FB.user.email : ''; }
