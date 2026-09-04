/* ============================================================================
   PART 16 — Device gate: "BASIC only opens on a shop device"

   The premises gate (part 15) asks WHERE you are, by internet address. That
   address changes whenever the ISP feels like it, and every change locks the
   shop out until an admin re-taps "Trust this network".

   This gate asks WHICH DEVICE you are on, and the answer cannot be copied.
   At enrolment the iPad generates a keypair inside its secure hardware
   (Face ID / Touch ID; Windows Hello on a PC). The server keeps only the public
   key. The private key never leaves the device — it cannot be revealed from a
   password manager, exported, or synced to a worker's own phone.

   So the original problem finally closes: the password Chrome saved is still a
   valid password, and it still gets her a Firebase login, but without the
   iPad's signature the server issues no session and the rules serve no data.

   This file is the client half: turn the server's challenge into a Face ID
   prompt, send the signature back, and give admins the enrolment controls in
   Settings. The decisions are all made in device-auth.js.
   ========================================================================== */

var DEVICES = null;               /* cached device list for the Settings card */
var _devLoading = false;

function deviceApplies(){
  if (typeof dataLocal==='function' && dataLocal()) return false;
  if (typeof cloudOn!=='function' || !cloudOn()) return false;
  return typeof firebase!=='undefined' && !!firebase.functions;
}

/* Is the WebAuthn API here at all? Needs a secure context (https, or
   localhost). False on anything older than iOS 13.3 / Safari 13.1. */
function deviceSupported(){
  return typeof window!=='undefined'
      && !!window.PublicKeyCredential
      && !!(navigator && navigator.credentials && navigator.credentials.create);
}

/* Does this device have a BUILT-IN authenticator (Face ID / Touch ID / Windows
   Hello) rather than only accepting a plug-in security key?

   The version line that matters is iOS 14, not iOS 16. iOS 13 has WebAuthn but
   only for external keys; iOS 14 and 15 added Face ID / Touch ID backed by the
   Secure Enclave, and — because iCloud passkey syncing did not arrive until
   iOS 16 — those keys are permanently stuck to the one iPad. For this gate an
   iOS 14/15 iPad is not a compromise, it is the ideal case.

   Answer defensively: Safari 14 has been known to answer 'false' when the
   authenticator does in fact work, so a false here downgrades to a warning
   rather than a refusal. */
function devicePlatformAvailable(){
  try {
    if (!deviceSupported()) return Promise.resolve(false);
    var f = window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
    if (typeof f !== 'function') return Promise.resolve(true);
    return f.call(window.PublicKeyCredential).then(function(v){ return !!v; })
            .catch(function(){ return true; });
  } catch(e){ return Promise.resolve(true); }
}

function _devCall(name, payload){
  return firebase.functions().httpsCallable(name)(payload || {});
}

/* ---- base64url <-> ArrayBuffer ------------------------------------------
   WebAuthn speaks ArrayBuffers; JSON does not. The server sends and expects
   base64url, so every id/challenge crosses this boundary twice. */
function _devB64uToBuf(s){
  s = String(s||'').replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function _devBufToB64u(buf){
  if (!buf) return '';
  var bytes = new Uint8Array(buf), s = '';
  for (var i=0;i<bytes.length;i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function _devCredList(list){
  return (list||[]).map(function(c){
    return { id:_devB64uToBuf(c.id), type:c.type||'public-key', transports:c.transports||undefined };
  });
}

/* ---- the two hardware calls --------------------------------------------- */
async function deviceCreateCredential(options){
  var pk = {
    rp: options.rp,
    user: { id:_devB64uToBuf(options.user.id), name:options.user.name, displayName:options.user.displayName },
    challenge: _devB64uToBuf(options.challenge),
    pubKeyCredParams: options.pubKeyCredParams,
    timeout: options.timeout,
    attestation: options.attestation,
    authenticatorSelection: options.authenticatorSelection,
    excludeCredentials: _devCredList(options.excludeCredentials)
  };
  var cred = await navigator.credentials.create({ publicKey: pk });
  if (!cred) throw new Error('cancelled');
  var r = cred.response;
  return {
    id: cred.id,
    rawId: _devBufToB64u(cred.rawId),
    type: cred.type,
    clientExtensionResults: (cred.getClientExtensionResults && cred.getClientExtensionResults()) || {},
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    response: {
      clientDataJSON: _devBufToB64u(r.clientDataJSON),
      attestationObject: _devBufToB64u(r.attestationObject),
      transports: (r.getTransports && r.getTransports()) || []
    }
  };
}

async function deviceGetAssertion(options){
  var pk = {
    challenge: _devB64uToBuf(options.challenge),
    timeout: options.timeout,
    rpId: options.rpId,
    userVerification: options.userVerification,
    allowCredentials: _devCredList(options.allowCredentials)
  };
  var cred = await navigator.credentials.get({ publicKey: pk });
  if (!cred) throw new Error('cancelled');
  var r = cred.response;
  return {
    id: cred.id,
    rawId: _devBufToB64u(cred.rawId),
    type: cred.type,
    clientExtensionResults: (cred.getClientExtensionResults && cred.getClientExtensionResults()) || {},
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
    response: {
      clientDataJSON: _devBufToB64u(r.clientDataJSON),
      authenticatorData: _devBufToB64u(r.authenticatorData),
      signature: _devBufToB64u(r.signature),
      userHandle: r.userHandle ? _devBufToB64u(r.userHandle) : undefined
    }
  };
}

/* ---- lock screen for a device refusal ----------------------------------- */
function renderDeviceBlocked(reason){
  var app=(typeof document!=='undefined') && document.getElementById('app'); if(!app) return;
  var synced = (reason==='synced-passkey'), old = (reason==='unsupported');
  var head = synced ? 'This device’s passkey is being synced'
           : old    ? 'This device is too old for the shop lock'
                    : 'BASIC can only be opened on a shop device';
  var body = synced
    ? 'This device is signed into iCloud, so its passkey would copy itself to other personal devices. '+
      'An administrator needs to sign the device out of iCloud Keychain and enrol it again.'
    : old
    ? 'This iPad or computer cannot do the hardware check BASIC now requires. An iPad needs iPadOS 14 or newer '+
      '(Settings → General → About → Software Version). Use a newer shop device, or ask an administrator.'
    : 'Your account is fine — this device is not one of the shop’s. '+
      'Use a shop iPad or computer, or ask an administrator to enrol this device in <b>Settings → Shop devices</b>.';
  app.innerHTML='<div class="login-bg"><div class="login-card">'+
    '<img class="login-logo" src="'+(typeof LOGO_LOCKUP!=='undefined'?LOGO_LOCKUP:'')+'" alt="Basic by JMSI"/>'+
    '<div class="lg-msg err">'+head+'</div>'+
    '<p class="login-sub">'+body+'</p>'+
    '<button class="btn primary full lg-btn" onclick="location.reload()">Try again</button>'+
    '<div class="lg-ver">'+esc(typeof APP_VERSION!=='undefined'?APP_VERSION:'')+'</div>'+
  '</div></div>';
}

/* ---- Settings → Shop devices (admin only) -------------------------------- */
function loadDeviceList(){
  if (_devLoading || !deviceApplies()) return;
  if (typeof FB==='undefined' || !FB || !FB.ready || !FB.db) return;
  _devLoading = true;
  bcol('devices').get().then(function(snap){
    DEVICES = snap.docs.map(function(d){
      var v = d.data()||{};
      return { id:d.id, label:v.label||'Shop device', active:v.active!==false,
               backedUp:!!v.backedUp, deviceType:v.deviceType||'',
               reason:v.deactivatedReason||'' };
    });
    _devLoading=false;
    if (ROUTE.view==='settings') render();
  }).catch(function(){
    _devLoading=false; DEVICES=[];
    if (ROUTE.view==='settings') render();
  });
}

function devicesCard(){
  if (!deviceApplies() || !isAdminUser()) return '';
  if (DEVICES===null || PREM_NET===null){
    return '<div class="card"><h2>Shop devices</h2><div class="muted small">Loading…</div></div>';
  }
  var on = !!(PREM_NET && PREM_NET.deviceEnforce);
  var rows = DEVICES.length
    ? DEVICES.map(function(d){
        var warn = !d.active ? ' · <b>stopped</b>'+(d.reason==='synced-passkey'?' (iCloud sync)':'') : '';
        return '<span class="tagx">'+esc(d.label)+warn+
          '<button title="Remove" onclick="forgetShopDevice(\''+esc(d.id)+'\')">✕</button></span>';
      }).join('')
    : '<span class="muted small">No device enrolled yet.</span>';
  return '<div class="card"><h2>Shop devices</h2>'+
    '<div id="devStatus" class="lg-msg '+(on?'ok':'')+'" style="margin:0 0 10px">'+
      (on ? 'ON — staff can only open BASIC on the devices below.'
          : 'OFF — staff can open BASIC on any device.')+'</div>'+
    '<div class="tags">'+rows+'</div>'+
    '<div class="row gap mt8">'+
      '<button class="btn primary" onclick="enrollThisDevice()">＋ Enrol this device</button>'+
      '<button class="btn ghost" onclick="toggleDeviceEnforce('+(on?'false':'true')+')">'+
        (on?'Turn enforcement OFF':'Turn enforcement ON')+'</button>'+
    '</div>'+
    '<p class="muted small mt8">Do this <b>on the device itself</b>, with it in your hands. '+
    'It asks for Face ID (or the Windows PIN) and stores a key inside that device that cannot be copied off it. '+
    'Unlike a password, there is nothing here a worker can read, write down or take home.</p>'+
    '<p class="muted small">The iPad must <b>not</b> be signed into a personal Apple ID — iCloud would sync the key to that '+
    'person\'s own iPhone. Enrolment is refused when it detects this, and stops a device that starts syncing later. '+
    'Administrators are always exempt, so you keep working from home.</p></div>';
}

function enrollThisDevice(){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  if(!deviceSupported()){
    toast('This device is too old for the hardware check — an iPad needs iPadOS 14 or newer.','err'); return;
  }
  devicePlatformAvailable().then(function(available){
    /* Not a refusal — see devicePlatformAvailable. Warn, and let the admin try:
       the enrolment itself is the honest test, and it costs one tap. */
    var warn = available ? '' :
      '<div class="lg-msg err" style="margin:0 0 10px">This device says it has no built-in Face ID / Touch ID / Windows Hello. '+
      'Enrolling will probably fail. Check <b>Settings → General → About → Software Version</b> is iPadOS 14 or newer, '+
      'and that a passcode and Touch&nbsp;ID are switched on. You can still try.</div>';
    openModal('Enrol this device',
      warn+
      '<p class="muted">Name it so you can recognise it later — “Fairview front desk iPad”, “Bay 2 tablet”.</p>'+
      '<div class="f"><label>Device name</label><input id="devLabel" maxlength="60" placeholder="Shop iPad"/></div>'+
      '<p class="muted small">You will be asked for Face ID / Touch ID / the Windows PIN. That is the device proving it is itself.</p>',
      { footer:'<button class="btn ghost" onclick="closeModal()">Cancel</button>'+
               '<button class="btn primary" id="devGo">'+(available?'Enrol':'Try anyway')+'</button>',
        after:function(){
          var b=document.getElementById('devGo');
          if(b) b.onclick=function(){ enrollThisDeviceGo(val('devLabel')); };
        }});
  });
}

async function enrollThisDeviceGo(label){
  label = String(label||'').trim() || 'Shop device';
  if (typeof closeModal==='function') closeModal();
  toast('Ask the device to identify itself…');
  try {
    var begun = await _devCall('beginDeviceEnroll', { branchId: branchId(), label: label });
    var d = (begun && begun.data) || {};
    var attestation = await deviceCreateCredential(d.options);
    var done = await _devCall('finishDeviceEnroll',
      { branchId: branchId(), deviceId: d.deviceId, label: label, response: attestation });
    DEVICES = ((done && done.data && done.data.devices) || []).map(function(x){
      return { id:x.id, label:x.label, active:x.active, backedUp:x.backedUp,
               deviceType:x.deviceType, reason:'' };
    });
    toast('Enrolled · '+label);
    render();
  } catch(e){
    toast(_devErr(e),'err');
  }
}

function forgetShopDevice(id){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var dev = (DEVICES||[]).filter(function(d){ return d.id===id; })[0];
  confirmModal('Remove this device?',
    'BASIC will no longer open on “'+((dev&&dev.label)||'this device')+'”. '+
    'If it is the last enrolled device, enforcement switches off so nobody is locked out. '+
    'Removing a lost or stolen device takes effect within 20 minutes on anything still open.',
    function(){
      if (typeof closeModal==='function') closeModal();
      _devCall('forgetDevice', { branchId: branchId(), deviceId: id }).then(function(res){
        var r=(res&&res.data)||{};
        DEVICES = (r.devices||[]);
        if (PREM_NET && r.deviceEnforce===false) PREM_NET.deviceEnforce = false;
        toast('Device removed'); render();
      }).catch(function(e){ toast(_devErr(e),'err'); });
    }, 'Remove', true);
}

function toggleDeviceEnforce(on){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var turnOn = (on===true || on==='true');
  var go = function(){
    if (typeof closeModal==='function') closeModal();
    _devCall('setDeviceEnforcement', { branchId: branchId(), enforce: turnOn }).then(function(res){
      var r=(res&&res.data)||{};
      if (PREM_NET) PREM_NET.deviceEnforce = !!r.deviceEnforce;
      toast(turnOn ? 'Device enforcement is ON' : 'Device enforcement is OFF'); render();
    }).catch(function(e){ toast(_devErr(e),'err'); });
  };
  if (turnOn){
    confirmModal('Lock BASIC to shop devices?',
      'From now on staff can only open BASIC on the devices enrolled here. A worker signing in from her own '+
      'computer will be refused, even with the correct password. Enrol every device your staff actually use '+
      'before turning this on. You and other administrators are not affected.', go, 'Turn on');
  } else {
    confirmModal('Turn device enforcement off?',
      'Staff will be able to open BASIC on any device again.', go, 'Turn off');
  }
}

function _devErr(e){
  var code=(e&&e.code)||'', msg=(e&&e.message)||'', name=(e&&e.name)||'';
  if (/synced-passkey/.test(msg))
    return 'This device is signed into iCloud — the key would sync to a personal iPhone. Sign out of iCloud Keychain (Settings → Apple ID → iCloud → Passwords) and enrol again.';
  if (name==='InvalidStateError') return 'This device is already enrolled.';
  if (name==='NotAllowedError') return 'Cancelled, or it took too long. Try again.';
  if (name==='NotSupportedError') return 'This device can’t do passkeys — it may be too old.';
  if (code.indexOf('permission-denied')>=0) return msg||'Admins only.';
  if (code.indexOf('failed-precondition')>=0) return msg||'Enrol a shop device first.';
  if (code.indexOf('unauthenticated')>=0) return 'Please sign in again.';
  if (code.indexOf('internal')>=0 || code.indexOf('not-found')>=0)
    return 'The device service isn’t deployed yet — run: firebase deploy --only functions';
  return msg || 'Could not enrol this device.';
}

/* Load the device list the first time Settings is opened. */
var _arPrevDev = (typeof afterRender==='function') ? afterRender : function(){};
afterRender = function(){
  _arPrevDev();
  if (ROUTE.view==='settings' && DEVICES===null && isAdminUser() && deviceApplies()) loadDeviceList();
};
