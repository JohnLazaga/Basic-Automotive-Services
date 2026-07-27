/* ============================================================================
   PART 15 — Premises gate: "BASIC only opens inside the shop"

   The problem this replaces: we used to hand each worker a random password that
   the browser saved so he never had to know it. That does not restrict WHERE the
   app opens — any saved password can be revealed from the browser's password
   manager or synced to a personal phone. Secrecy of a replayable credential is
   not an access control.

   So location is checked on the SERVER. After sign-in the app calls
   startShopSession(); the Cloud Function compares the request's source IP with
   the branch's trusted networks and, only on a match, writes a short-lived
   session document that firestore.rules requires for every read and write.
   Off-premises the worker has a valid password, a valid auth token — and no data.

   This file is the client half: ask for the session, renew it while the app is
   open, show a clear lock screen when refused, and give admins the
   "Trust this network" controls in Settings.
   ========================================================================== */

var PREMISES = { checked:false, enforced:false, exempt:false, ip:'', expiresAt:0 };
var PREM_NET = null;              /* cached {enforce, ips[]} for the Settings card */
var _premNetLoading = false;
var _premTimer = null;
var PREM_REFRESH_MS = 20 * 60 * 1000;    /* renew every 20 min while open on-site */

/* The gate only applies to cloud branches. Local branches are already premises-
   bound: the branch server lives on the shop LAN. */
function premisesApplies(){
  if (typeof dataLocal==='function' && dataLocal()) return false;
  if (typeof cloudOn!=='function' || !cloudOn()) return false;
  return typeof firebase!=='undefined' && !!firebase.functions;
}

function _premCall(name, payload){
  return firebase.functions().httpsCallable(name)(payload || {});
}

/* ---- the gate ------------------------------------------------------------
   Resolves true when the app may proceed. Resolves false when the caller is
   off-premises (the lock screen has already been rendered by then).
   A network/deploy failure resolves TRUE: the Firestore rules are the real
   enforcement, so a function outage must not brick a shop that is on-site. */
async function premisesEnsure(){
  if (!premisesApplies()) return true;
  try {
    var res = await _premCall('startShopSession', { branchId: branchId() });
    var d = (res && res.data) || {};
    PREMISES = { checked:true, enforced:!!d.enforced, exempt:!!d.exempt,
                 ip:d.ip||'', expiresAt:Number(d.expiresAt)||0 };
    premisesStartTimer();
    return true;
  } catch(e){
    var code = (e && e.code) || '';
    var offPremises = code.indexOf('permission-denied')>=0 && /off-premises/.test((e&&e.message)||'');
    if (offPremises){
      PREMISES = { checked:true, enforced:true, exempt:false, ip:'', expiresAt:0 };
      renderPremisesBlocked();
      try { if (FB && FB.auth) await FB.auth.signOut(); } catch(_){}
      return false;
    }
    if (code.indexOf('not-found')>=0 || code.indexOf('unauthenticated')>=0){
      /* The account isn't provisioned in this branch — onSignedIn already has a
         message for that case; let it through and let the normal path report. */
      return true;
    }
    /* internal / unavailable / not-deployed — fail OPEN here, closed in rules. */
    console.warn('shop session check unavailable', code, (e&&e.message)||'');
    PREMISES.checked = true;
    return true;
  }
}

/* Renew quietly while the app stays open. A failure is not fatal: the existing
   session simply runs out, and the rules stop serving data at that point. */
function premisesStartTimer(){
  if (typeof setInterval!=='function') return;
  if (_premTimer) return;
  _premTimer = setInterval(function(){
    if (!premisesApplies()) return;
    if (typeof FB==='undefined' || !FB || !FB.auth || !FB.auth.currentUser) return;
    _premCall('startShopSession', { branchId: branchId() }).then(function(res){
      var d=(res&&res.data)||{};
      PREMISES.expiresAt = Number(d.expiresAt)||PREMISES.expiresAt;
      PREMISES.enforced  = !!d.enforced;
    }).catch(function(e){
      var msg=(e&&e.message)||'';
      if (/off-premises/.test(msg)){
        /* The device left the shop network mid-shift. Data access dies with the
           session; tell the user before it silently starts failing. */
        renderPremisesBlocked(true);
        try { if (FB && FB.auth) FB.auth.signOut(); } catch(_){}
        if (_premTimer){ clearInterval(_premTimer); _premTimer=null; }
      }
    });
  }, PREM_REFRESH_MS);
}

function renderPremisesBlocked(midSession){
  var app=(typeof document!=='undefined') && document.getElementById('app'); if(!app) return;
  if (_premTimer){ clearInterval(_premTimer); _premTimer=null; }
  app.innerHTML='<div class="login-bg"><div class="login-card">'+
    '<img class="login-logo" src="'+(typeof LOGO_LOCKUP!=='undefined'?LOGO_LOCKUP:'')+'" alt="Basic by JMSI"/>'+
    '<div class="lg-msg err">'+(midSession ? 'This device left the shop network' : 'BASIC can only be opened at the shop')+'</div>'+
    '<p class="login-sub">Your account is fine — this connection is not the shop’s. '+
      'Connect to the shop Wi-Fi and sign in again.</p>'+
    '<p class="login-sub">If you <b>are</b> at the shop, the branch’s internet address may have changed. '+
      'Ask an administrator to open <b>Settings → Shop network</b> and tap <b>Trust this network</b>.</p>'+
    '<button class="btn primary full lg-btn" onclick="location.reload()">Try again</button>'+
    '<div class="lg-ver">'+esc(typeof APP_VERSION!=='undefined'?APP_VERSION:'')+'</div>'+
  '</div></div>';
}

/* ---- Settings → Shop network (admin only) -------------------------------- */
function loadPremisesNetwork(){
  if (_premNetLoading || !premisesApplies()) return;
  if (typeof FB==='undefined' || !FB || !FB.ready || !FB.db) return;
  _premNetLoading = true;
  bcol('shopnet').doc('network').get().then(function(doc){
    var d = doc.exists ? (doc.data()||{}) : {};
    PREM_NET = { enforce: d.enforce===true, ips: Array.isArray(d.ips)?d.ips:[] };
    _premNetLoading=false;
    if (ROUTE.view==='settings') render();
  }).catch(function(){
    _premNetLoading=false; PREM_NET={ enforce:false, ips:[] };
    if (ROUTE.view==='settings') render();
  });
}

function premisesCard(){
  if (!premisesApplies() || !isAdminUser()) return '';
  if (PREM_NET===null){
    return '<div class="card"><h2>Shop network</h2><div class="muted small">Loading…</div></div>';
  }
  var ips = PREM_NET.ips || [];
  var rows = ips.length
    ? ips.map(function(e){
        return '<span class="tagx">'+esc(e.ip||'')+(e.label?' · '+esc(e.label):'')+
          '<button title="Forget" onclick="forgetShopNetwork(\''+esc(e.ip||'')+'\')">✕</button></span>';
      }).join('')
    : '<span class="muted small">No trusted network yet.</span>';
  var on = PREM_NET.enforce;
  return '<div class="card"><h2>Shop network</h2>'+
    '<div id="premStatus" class="lg-msg '+(on?'ok':'')+'" style="margin:0 0 10px">'+
      (on ? 'ON — staff can only open BASIC on the trusted networks below.'
          : 'OFF — staff can open BASIC from anywhere.')+'</div>'+
    '<div class="tags">'+rows+'</div>'+
    '<div class="row gap mt8">'+
      '<button class="btn primary" onclick="trustShopNetwork()">＋ Trust this network</button>'+
      '<button class="btn ghost" onclick="togglePremisesEnforce('+(on?'false':'true')+')">'+
        (on?'Turn enforcement OFF':'Turn enforcement ON')+'</button>'+
    '</div>'+
    '<p class="muted small mt8">Tap <b>Trust this network</b> while you are standing in the shop, on the shop Wi-Fi. '+
    'It records this connection’s internet address. Workers are then refused everywhere else — even with the right password, '+
    'because the check happens on our server, not in the browser.</p>'+
    '<p class="muted small">Administrators are always exempt, so you keep working from home. '+
    'Internet providers change a connection’s address from time to time; when staff suddenly get '+
    '“BASIC can only be opened at the shop” <i>while at the shop</i>, come here and tap Trust this network again.</p></div>';
}

function trustShopNetwork(){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var el=document.getElementById('premStatus'); if(el){ el.textContent='Checking this connection…'; }
  _premCall('trustThisNetwork', { branchId: branchId(), label: 'Shop network' }).then(function(res){
    var d=(res&&res.data)||{};
    PREM_NET = { enforce: !!d.enforce, ips: d.ips||[] };
    toast(d.alreadyTrusted ? 'Already trusted · '+(d.ip||'') : 'Trusted this network · '+(d.ip||''));
    render();
  }).catch(function(e){ toast(_premErr(e),'err'); render(); });
}

function forgetShopNetwork(ip){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  confirmModal('Forget this network?',
    'Staff will no longer be able to open BASIC from <b>'+esc(ip)+'</b>. '+
    'If this is the last trusted network, enforcement switches off so nobody is locked out.',
    function(){
      if (typeof closeModal==='function') closeModal();
      _premCall('forgetNetwork', { branchId: branchId(), ip: ip }).then(function(res){
        var d=(res&&res.data)||{};
        PREM_NET = { enforce: !!d.enforce, ips: d.ips||[] };
        toast('Network removed'); render();
      }).catch(function(e){ toast(_premErr(e),'err'); });
    }, 'Forget');
}

function togglePremisesEnforce(on){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var turnOn = (on===true || on==='true');
  var go = function(){
    if (typeof closeModal==='function') closeModal();
    _premCall('setEnforcement', { branchId: branchId(), enforce: turnOn }).then(function(res){
      var d=(res&&res.data)||{};
      PREM_NET = { enforce: !!d.enforce, ips: d.ips||PREM_NET.ips };
      toast(turnOn ? 'Enforcement is ON' : 'Enforcement is OFF'); render();
    }).catch(function(e){ toast(_premErr(e),'err'); });
  };
  if (turnOn){
    confirmModal('Lock BASIC to the shop?',
      'From now on staff can only open BASIC on the trusted networks listed. '+
      'A worker signing in from home will see their data refused, even with the correct password. '+
      'You and other administrators are not affected.', go, 'Turn on');
  } else {
    confirmModal('Turn enforcement off?',
      'Staff will be able to open BASIC from anywhere again.', go, 'Turn off');
  }
}

function _premErr(e){
  var code=(e&&e.code)||'', msg=(e&&e.message)||'';
  if (code.indexOf('permission-denied')>=0) return 'Admins only.';
  if (code.indexOf('failed-precondition')>=0) return msg || 'Trust the shop network first.';
  if (code.indexOf('unauthenticated')>=0) return 'Please sign in again.';
  if (code.indexOf('internal')>=0 || code.indexOf('not-found')>=0)
    return 'The shop-network service isn’t deployed yet — run: firebase deploy --only functions';
  return msg || 'Could not update the shop network.';
}

/* Load the trusted-network list the first time Settings is opened. */
var _arPrevPrem = (typeof afterRender==='function') ? afterRender : function(){};
afterRender = function(){
  _arPrevPrem();
  if (ROUTE.view==='settings' && PREM_NET===null && isAdminUser() && premisesApplies()) loadPremisesNetwork();
};
