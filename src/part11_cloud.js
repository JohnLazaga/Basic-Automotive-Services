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

/* Entry point from boot() when cloud is enabled. */
function cloudBoot(){
  if (typeof firebase==='undefined'){
    renderCloudError('Couldn’t load the Firebase service.',
      'Check your internet connection and reload. (The app needs to reach Google to sign you in.)');
    return;
  }
  if (!initFirebase()){
    renderCloudError('Firebase failed to initialize.', 'The configuration may be incomplete.');
    return;
  }
  renderLogin(null, null, true); // show a connecting state immediately
  FB.auth.onAuthStateChanged(function(user){
    FB.user = user;
    if (user) onSignedIn(user);
    else renderLogin();
  });
}

async function onSignedIn(user){
  // Increment 1: load data locally; the Firestore swap replaces this next.
  await loadState();
  applyTheme((S.shop && S.shop.theme) || 'light');
  render();
  // surface who is signed in (added to the top bar by the shell)
  updateUserChip();
}

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
      '<label class="lg-field"><span>Email</span>'+
        '<input id="lgEmail" type="email" autocomplete="username" placeholder="you@example.com"></label>'+
      '<label class="lg-field"><span>Password</span>'+
        '<input id="lgPass" type="password" autocomplete="current-password" placeholder="••••••••" '+
        'onkeydown="if(event.key===\'Enter\')doLogin()"></label>'+
      '<button class="btn primary full lg-btn" onclick="doLogin()">Sign in</button>'+
      '<button class="lg-link" onclick="doReset()">Forgot password?</button>'+
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
  var email=(val('lgEmail')||'').trim(), pw=val('lgPass')||'';
  if(!email||!pw){ renderLogin('Enter your email and password.','err'); return; }
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
  if(c.indexOf('wrong-password')>=0||c.indexOf('invalid-credential')>=0) return 'Incorrect email or password.';
  if(c.indexOf('user-not-found')>=0) return 'No account found for that email.';
  if(c.indexOf('invalid-email')>=0) return 'That email address looks invalid.';
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
