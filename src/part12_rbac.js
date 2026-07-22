/* ============================================================================
   PART 12 — RBAC: individual staff accounts, roles, permission matrix,
   and the Admin "Accounts & Roles" screen.

   Enforcement is at the UI layer (nav, buttons, sensitive fields). Firestore
   rules currently allow any signed-in staff; database-level per-role hardening
   is a later step. can() defaults to TRUE when no user is loaded (local/dev/
   tests) so the offline build and the Node tests are unaffected.
   ========================================================================== */

var CURRENT_USER = null;     // {uid,email,name,role,isAdmin,active}
var ACCOUNTS = null;         // cached users list for the Accounts screen
var _accountsLoading = false;

var ROLE_LIST = ['SV','SA','SM','Mechanic','Parts Salesman','Secretary'];

/* Capabilities that gate features (baseline board/jobs/vehicles are always on). */
var CAPS = [
  { key:'appointments', label:'Appointments' },
  { key:'estimates',    label:'Estimates' },
  { key:'prices',       label:'See prices / running bill' },
  { key:'part_cost',    label:'Part cost & margin' },
  { key:'discounts',    label:'Apply discounts' },
  { key:'billing',      label:'Final billing / OR #' },
  { key:'billing_edit', label:'Edit billing after it is done' },
  { key:'receivables',  label:'Receivables (A/R)' },
  { key:'reports',      label:'Reports' },
  { key:'dailyclose',   label:'Daily Close' },
  { key:'productivity', label:'Productivity & commissions' },
  { key:'parts_manage', label:'Parts / Labor / PO' },
  { key:'staff_manage', label:'Staff & accounts' },
  { key:'settings',     label:'Settings' },
  { key:'delete',       label:'Delete / clear data' }
];

/* Default matrix (Admin always has everything via isAdmin). Admin-editable. */
var DEFAULT_PERMS = {
  SV:               { appointments:1, estimates:1, prices:1, part_cost:1, discounts:1, billing:1, billing_edit:1, receivables:1, reports:1, dailyclose:1, parts_manage:1 },
  SA:               { appointments:1, estimates:1, prices:1, billing:1, receivables:1 },
  SM:               { estimates:1, prices:1 },
  Mechanic:         {},
  'Parts Salesman': { prices:1, parts_manage:1 },
  Secretary:        { appointments:1, prices:1, billing:1, receivables:1 }
};

function permsMatrix(){
  return (S && S.shop && S.shop.permissions) ? S.shop.permissions : DEFAULT_PERMS;
}
function isAdminUser(){ return !!(CURRENT_USER && CURRENT_USER.isAdmin); }
/* Admin or Supervisor (SV). Local / pre-auth (dev build, mini-PC) returns true,
   matching the can() convention. Used to gate money figures on the board etc. */
function isAdminOrSV(){
  if (typeof CURRENT_USER==='undefined' || !CURRENT_USER) return true;
  return !!CURRENT_USER.isAdmin || CURRENT_USER.role==='SV';
}
/* Prices on the Job Order (running bill + line prices, list totals) are visible
   only to Admin, Supervisor, Secretary and Parts Salesman. Local / pre-auth true. */
function canSeeJobPrices(){
  if (typeof CURRENT_USER==='undefined' || !CURRENT_USER) return true;
  var role=CURRENT_USER.role;
  return !!CURRENT_USER.isAdmin || role==='SV' || role==='Secretary' || role==='Parts Salesman';
}

/* The single access check used everywhere. */
function can(cap){
  if (typeof CURRENT_USER==='undefined' || !CURRENT_USER) return true; // pre-auth / local / tests
  if (CURRENT_USER.isAdmin) return true;
  if (!cap) return true;                                                // baseline feature
  var rp = permsMatrix()[CURRENT_USER.role] || {};
  return !!rp[cap];
}

/* ---- Sign-in: load this user's account, bootstrapping the first Admin ----- */
async function loadCurrentUser(user){
  var ref = bcol('users').doc(user.uid);
  var doc = await ref.get();
  if (doc.exists){
    var d = doc.data();
    if (d.active === false){ var e1=new Error('inactive'); e1.code='inactive'; throw e1; }
    CURRENT_USER = Object.assign({ uid:user.uid, email:user.email }, d);
    return;
  }
  // No account doc yet — first ever user becomes Admin (bootstrap).
  var any = await bcol('users').limit(1).get();
  if (any.empty){
    CURRENT_USER = { uid:user.uid, email:user.email, name:user.email, role:'SV', isAdmin:true, active:true };
    await ref.set({ email:user.email, name:user.email, role:'SV', isAdmin:true, active:true, createdAt:new Date().toISOString() });
    return;
  }
  CURRENT_USER = null;
  var e2 = new Error('not-provisioned'); e2.code='not-provisioned'; throw e2;
}

/* ---- Accounts screen data ------------------------------------------------- */
function loadAccounts(){
  if (_accountsLoading) return;
  if (typeof dataLocal==='function' && dataLocal()){
    _accountsLoading = true;
    fetch(branchBase()+'/auth/users', { headers:authHeaders() }).then(function(r){ return r.json(); }).then(function(d){
      ACCOUNTS = (d && d.users) || []; _accountsLoading=false; if (ROUTE.view==='accounts') render();
    }).catch(function(e){ _accountsLoading=false; ACCOUNTS=[]; if(ROUTE.view==='accounts') render(); });
    return;
  }
  if (!FB.ready) return;
  _accountsLoading = true;
  bcol('users').get().then(function(snap){
    ACCOUNTS = snap.docs.map(function(d){ return Object.assign({ uid:d.id }, d.data()); });
    _accountsLoading = false;
    if (ROUTE.view==='accounts') render();
  }).catch(function(e){ _accountsLoading=false; console.error('loadAccounts', e); ACCOUNTS=[]; if(ROUTE.view==='accounts') render(); });
}
function refreshAccounts(){ ACCOUNTS=null; loadAccounts(); }

/* trigger the accounts fetch when that view is shown */
var _arPrevRBAC = (typeof afterRender==='function') ? afterRender : function(){};
afterRender = function(){
  _arPrevRBAC();
  if (ROUTE.view==='accounts' && ACCOUNTS===null && (((typeof dataLocal==='function')&&dataLocal()) || (typeof cloudOn==='function' && cloudOn() && FB && FB.ready))){ loadAccounts(); }
};

/* ---- Account management (Admin) ------------------------------------------- */
function getSecondaryApp(){
  // a separate Firebase app so creating a user doesn't sign the Admin out
  var existing = (firebase.apps||[]).filter(function(a){ return a.name==='sec'; })[0];
  return existing || firebase.initializeApp(FIREBASE_CONFIG, 'sec');
}
/* Staff log in with a USERNAME + a password the admin sets (no email needed).
   Internally each username maps to a synthetic email for Firebase Auth.
   The owner still signs in with their real email (kept for the isOwner rule). */
var LOGIN_DOMAIN = 'basic-jmsi.local';
function usernameToEmail(u){ return String(u||'').trim().toLowerCase().replace(/[^a-z0-9_.\-]/g,'') + '@' + LOGIN_DOMAIN; }
function loginIdToEmail(id){ id=String(id||'').trim(); return id.indexOf('@')>=0 ? id : usernameToEmail(id); }
function cleanUsername(u){ return String(u||'').trim().toLowerCase().replace(/[^a-z0-9_.\-]/g,''); }

function addAccountDialog(){
  if (!isAdminUser()){ toast('Admins only','err'); return; }
  openModal('Add staff account',
    field('Full name','<input id="acName" placeholder="Juan Dela Cruz">')+
    '<div class="grid2">'+
    field('Username','<input id="acUser" placeholder="e.g. junjun" autocomplete="off" autocapitalize="off" oninput="this.value=this.value.toLowerCase().replace(/[^a-z0-9_.-]/g,\'\')">')+
    field('Password','<input id="acPass" type="text" placeholder="set a password" autocomplete="off" autocapitalize="off">')+
    '</div>'+
    '<div class="grid2">'+
    field('Role','<select id="acRole">'+ROLE_LIST.map(function(r){return '<option value="'+r+'">'+esc(roleLabel(r))+'</option>';}).join('')+'</select>')+
    field('Admin?','<label class="chk"><input type="checkbox" id="acAdmin"> Full admin access</label>')+'</div>'+
    '<p class="muted small">The staff member signs in with this <b>username</b> and <b>password</b>. Share it with them; they can keep or you can change it later.</p>',
    { onOk:'createStaffAccount', okText:'Create account' });
}
function createStaffAccount(){
  var name=val('acName').trim(), username=cleanUsername(val('acUser')), pass=val('acPass'), role=val('acRole'), isAdmin=checked('acAdmin');
  if(!name||!username){ toast('Name and username required','err'); return; }
  if(!pass || pass.length<6){ toast('Password must be at least 6 characters','err'); return; }
  var btn=document.querySelector('.modal-foot .btn.primary'); if(btn){ btn.textContent='Creating…'; btn.disabled=true; }
  if (typeof dataLocal==='function' && dataLocal()){
    _postJSON(branchBase()+'/auth/users', { name:name, username:username, password:pass, role:role, isAdmin:isAdmin }).then(function(d){
      if(d && d.ok){ closeModal(); toast('Account created · username "'+username+'"'); refreshAccounts(); }
      else { toast(d&&d.error==='username_taken' ? 'That username is already taken.' : 'Could not create account','err'); if(btn){ btn.textContent='Create account'; btn.disabled=false; } }
    }).catch(function(){ toast('Cannot reach branch server','err'); if(btn){ btn.textContent='Create account'; btn.disabled=false; } });
    return;
  }
  var email=usernameToEmail(username);
  var sec=getSecondaryApp();
  sec.auth().createUserWithEmailAndPassword(email, pass).then(function(cred){
    return bcol('users').doc(cred.user.uid).set({
      username:username, email:email, name:name, role:role, isAdmin:isAdmin, active:true, password:pass, createdAt:new Date().toISOString()
    }).then(function(){ return sec.auth().signOut(); });
  }).then(function(){
    closeModal(); toast('Account created · username "'+username+'"'); refreshAccounts();
  }).catch(function(e){
    var msg = (e.code||'').indexOf('email-already-in-use')>=0 ? 'That username is already taken.' : (e.message||'Could not create account');
    toast(msg,'err'); if(btn){ btn.textContent='Create account'; btn.disabled=false; }
  });
}
function _localUserUpdate(uid, fields, msg){ return _postJSON(branchBase()+'/auth/users/'+encodeURIComponent(uid), fields).then(function(d){ if(d&&d.ok){ toast(msg); refreshAccounts(); } else toast((d&&d.error)||'Update failed','err'); }); }
function setAccountRole(uid, role){ if(typeof dataLocal==='function'&&dataLocal()){ return _localUserUpdate(uid,{role:role},'Role updated'); } bcol('users').doc(uid).update({ role:role }).then(function(){ toast('Role updated'); refreshAccounts(); }); }
function setAccountAdmin(uid, isAdmin){ if(typeof dataLocal==='function'&&dataLocal()){ return _localUserUpdate(uid,{isAdmin:isAdmin},'Updated'); } bcol('users').doc(uid).update({ isAdmin:isAdmin }).then(function(){ toast('Updated'); refreshAccounts(); }); }
function setAccountActive(uid, active){ if(typeof dataLocal==='function'&&dataLocal()){ return _localUserUpdate(uid,{active:active},active?'Account enabled':'Account disabled'); } bcol('users').doc(uid).update({ active:active }).then(function(){ toast(active?'Account enabled':'Account disabled'); refreshAccounts(); }); }
/* Admin: view and change a staff login password. Firebase Auth never reveals a
   password, so the app keeps an admin-only copy in the user doc. Changing it is
   done by signing into a secondary Firebase app as that user (with the current
   password) and calling updatePassword — no Admin SDK needed. */
var pwCtx=null;
function passwordDialog(uid){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var u=(ACCOUNTS||[]).find(function(x){return x.uid===uid;}); if(!u) return;
  var has = !!u.password;
  openModal('Password — '+esc(u.name||u.username||u.email),
    field('Current password', has
        ? '<input id="pwCur" value="'+attr(u.password)+'" readonly autocomplete="off">'
        : '<input id="pwCur" value="" placeholder="not stored — type the current password" autocomplete="off">',
      has ? 'Stored password for this login.' : 'No stored copy yet. Enter the current password once to change it; it will be saved afterward.')+
    field('New password','<input id="pwNew" type="text" placeholder="set a new password (min 6 characters)" autocomplete="off">'),
    { onOk:'saveStaffPassword', okText:'Update password' });
  setTimeout(function(){ pwCtx=uid; },10);
}
function saveStaffPassword(){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var u=(ACCOUNTS||[]).find(function(x){return x.uid===pwCtx;}); if(!u){ closeModal(); return; }
  var newPw=val('pwNew'); if(!newPw || newPw.length<6){ toast('New password must be at least 6 characters','err'); return; }
  if (typeof dataLocal==='function' && dataLocal()){
    _postJSON(branchBase()+'/auth/users/'+encodeURIComponent(u.uid)+'/password', { password:newPw }).then(function(d){
      if(d&&d.ok){ closeModal(); toast('Password updated'); refreshAccounts(); } else toast((d&&d.error)||'Could not update password','err');
    }).catch(function(){ toast('Cannot reach branch server','err'); });
    return;
  }
  var curPw=(u.password || val('pwCur') || '');
  if(!curPw){ toast('Enter the current password first','err'); return; }
  var email=u.email || usernameToEmail(u.username);
  var btn=document.querySelector('.modal-foot .btn.primary'); if(btn){ btn.textContent='Updating…'; btn.disabled=true; }
  var sec=getSecondaryApp();
  sec.auth().signInWithEmailAndPassword(email, curPw)
    .then(function(cred){ return cred.user.updatePassword(newPw); })
    .then(function(){ return sec.auth().signOut(); })
    .then(function(){ return bcol('users').doc(u.uid).update({ password:newPw }); })
    .then(function(){ closeModal(); toast('Password updated'); refreshAccounts(); })
    .catch(function(e){
      var code=(e.code||'');
      var wrong = code.indexOf('wrong-password')>=0 || code.indexOf('invalid-credential')>=0 || code.indexOf('invalid-login')>=0;
      toast(wrong ? 'Current password is incorrect — correct it and retry.' : (e.message||'Could not update password'),'err');
      if(btn){ btn.textContent='Update password'; btn.disabled=false; }
    });
}

/* Admin: reset a login to a fresh RANDOM password and show it ONCE, storing
   nothing. Cloud branches call the secure adminResetPassword Cloud Function
   (Admin SDK — see password-reset-kit/). Local branches use the branch server's
   password endpoint with a client-generated random. */
function resetPwRandom(uid){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var u=(ACCOUNTS||[]).find(function(x){return x.uid===uid;}); if(!u) return;
  var who=esc(u.name||u.username||u.email);
  confirmModal('Reset '+who+'’s password?',
    'This makes a brand-new <b>random</b> password and shows it to you <b>once</b>. Their old password stops working right away, and nothing is saved anywhere. Continue?',
    function(){ _doResetPwRandom(u); }, 'Reset to random');
}
function _doResetPwRandom(u){
  if(typeof dataLocal==='function' && dataLocal()){
    var pw=genRandomPassword();
    _postJSON(branchBase()+'/auth/users/'+encodeURIComponent(u.uid)+'/password', { password:pw }).then(function(d){
      if(d&&d.ok){ closeModal(); showOncePassword(u, pw); refreshAccounts(); }
      else toast((d&&d.error)||'Could not reset password','err');
    }).catch(function(){ toast('Cannot reach branch server','err'); });
    return;
  }
  if(typeof firebase==='undefined' || !firebase.functions){ toast('Reset service not loaded — reload the page','err'); return; }
  toast('Resetting…');
  var bId=(typeof branchId==='function')?branchId():'';
  firebase.functions().httpsCallable('adminResetPassword')({ targetUid:u.uid, branchId:bId })
    .then(function(res){ closeModal(); showOncePassword(u, (res&&res.data&&res.data.password)||''); refreshAccounts(); })
    .catch(function(e){ toast(_fnResetError(e),'err'); });
}
function _fnResetError(e){
  var code=(e&&e.code)||'';
  if(code.indexOf('permission-denied')>=0) return 'Admins only.';
  if(code.indexOf('unauthenticated')>=0) return 'Please sign in again.';
  if(code.indexOf('not-found')>=0) return 'User not found here — or the reset service isn’t deployed yet.';
  if(code.indexOf('internal')>=0) return 'The reset service isn’t deployed yet — see password-reset-kit/README.';
  return (e&&e.message)||'Could not reset the password.';
}
function showOncePassword(u, pw){
  if(!pw){ toast('Reset done, but no password came back','err'); return; }
  openModal('New password — '+esc(u.name||u.username||u.email),
    '<p class="muted small">Copy this now — it will <b>not</b> be shown again. Type it into the shop device once and let the browser <b>Save</b> it.</p>'+
    '<div class="pw-once"><code id="pwOnceVal">'+esc(pw)+'</code><button class="btn sm" type="button" onclick="copyOncePw()">Copy</button></div>'+
    '<p class="muted small">Nothing was saved anywhere. Lost it? Just reset again.</p>',
    { footer:'<button class="btn primary" onclick="closeModal()">Done</button>' });
}
function copyOncePw(){ var el=document.getElementById('pwOnceVal'); var t=el?el.textContent:''; if(t&&navigator.clipboard){ navigator.clipboard.writeText(t); } toast('Copied'); }
/* Memorable random password (browser-side, for LOCAL branches). */
function genRandomPassword(){
  var W=['Motor','Bakal','Pusa','Aso','Kalye','Lobo','Tigre','Bituin','Araw','Buwan','Piston','Gulong','Preno','Makina','Susi','Kable','Tubo','Pinto','Dagat','Bundok'];
  function r(n){ if(typeof crypto!=='undefined'&&crypto.getRandomValues){ var a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]%n; } return Math.floor(Math.random()*n); }
  return W[r(W.length)]+'-'+(1000+r(9000))+'-'+W[r(W.length)]+'-'+(1000+r(9000));
}

/* Edit one staff account (name, role, admin, active) — committed on Save. */
var acEditCtx=null;
function editAccountDialog(uid){
  if(!isAdminUser()){ toast('Admins only','err'); return; }
  var u=(ACCOUNTS||[]).find(function(x){return x.uid===uid;}); if(!u) return;
  var me = CURRENT_USER && CURRENT_USER.uid===uid;
  openModal('Edit staff account',
    field('Name','<input id="edName" value="'+attr(u.name||'')+'">')+
    field(u.username?'Username':'Email','<input value="'+attr(u.username||u.email||'')+'" disabled>','This is the login — to change it, remove the account and add a new one.')+
    field('Role','<select id="edRole">'+ROLE_LIST.map(function(r){return '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+esc(roleLabel(r))+'</option>';}).join('')+'</select>')+
    '<label class="chk"><input type="checkbox" id="edAdmin" '+(u.isAdmin?'checked':'')+(me?' disabled':'')+'> Full admin access</label>'+
    '<label class="chk"><input type="checkbox" id="edActive" '+(u.active===false?'':'checked')+(me?' disabled':'')+'> Account active (can sign in)</label>'+
    (me?'<p class="muted small">You can’t change your own admin/active status (prevents locking yourself out).</p>':''),
    { footer:'<button class="btn danger ghost" onclick="deleteAccountConfirm(\''+uid+'\')"'+(me?' disabled':'')+'>Remove</button>'+
      '<span style="flex:1"></span><button class="btn ghost" onclick="closeModal()">Cancel</button>'+
      '<button class="btn primary" onclick="saveAccount()">Save</button>' });
  setTimeout(function(){ acEditCtx=uid; },10);
}
function saveAccount(){
  var u=(ACCOUNTS||[]).find(function(x){return x.uid===acEditCtx;}); if(!u){ closeModal(); return; }
  var me = CURRENT_USER && CURRENT_USER.uid===u.uid;
  var data={ name:val('edName'), role:val('edRole') };
  if(!me){ data.isAdmin=checked('edAdmin'); data.active=checked('edActive'); }
  if (typeof dataLocal==='function' && dataLocal()){
    _postJSON(branchBase()+'/auth/users/'+encodeURIComponent(u.uid), data).then(function(d){
      if(d&&d.ok){ closeModal(); toast('Account saved'); refreshAccounts(); } else toast((d&&d.error)||'Save failed','err');
    }).catch(function(){ toast('Cannot reach branch server','err'); });
    return;
  }
  bcol('users').doc(u.uid).update(data)
    .then(function(){ closeModal(); toast('Account saved'); refreshAccounts(); })
    .catch(function(e){ toast(e.message||'Save failed','err'); });
}
function deleteAccountConfirm(uid){
  var u=(ACCOUNTS||[]).find(function(x){return x.uid===uid;}); if(!u) return;
  confirmModal('Remove access?','This removes '+esc(u.name||u.email)+'’s access (their role record is deleted; the login itself is disabled). They will no longer be able to use the app.', function(){
    if (typeof dataLocal==='function' && dataLocal()){
      fetch(branchBase()+'/auth/users/'+encodeURIComponent(uid), { method:'DELETE', headers:authHeaders() }).then(function(r){ return r.json(); }).then(function(){ closeModal(); toast('Access removed'); refreshAccounts(); }).catch(function(){ toast('Cannot reach branch server','err'); });
      return;
    }
    bcol('users').doc(uid).delete().then(function(){ closeModal(); toast('Access removed'); refreshAccounts(); }).catch(function(e){ toast(e.message,'err'); });
  },'Remove access',true);
}

/* ---- Permission matrix editing (Admin) ------------------------------------ */
/* Role-permission editing: changes are held in a draft until Save. */
var PERM_EDIT=false, PERM_DRAFT=null;
function permEditOn(){ PERM_EDIT=true; PERM_DRAFT=JSON.parse(JSON.stringify(permsMatrix())); render(); }
function permCancel(){ PERM_EDIT=false; PERM_DRAFT=null; render(); }
function permSave(){ if(PERM_DRAFT) S.shop.permissions=PERM_DRAFT; persist(); PERM_EDIT=false; PERM_DRAFT=null; toast('Permissions saved'); render(); }
function permDraftToggle(role, cap, on){
  if(!PERM_DRAFT) return;
  if(!PERM_DRAFT[role]) PERM_DRAFT[role]={};
  if(on) PERM_DRAFT[role][cap]=1; else delete PERM_DRAFT[role][cap];
}
function permResetDraft(){
  confirmModal('Reset to defaults?','Set every role back to the default permissions (you can still Cancel before saving).', function(){
    PERM_DRAFT=JSON.parse(JSON.stringify(DEFAULT_PERMS)); render();
  },'Reset to defaults');
}

/* ---- Accounts & Roles view ------------------------------------------------ */
VIEWS.accounts = function(){
  if (!isAdminUser()) return '<div class="page">'+accessDenied('Accounts & Roles')+'</div>';
  var accHTML;
  if (ACCOUNTS===null){ accHTML = '<div class="card">'+emptyState('Loading staff accounts…')+'</div>'; }
  else if (!ACCOUNTS.length){ accHTML = '<div class="card">'+emptyState('No staff accounts yet. Add one to give a teammate their own login.')+'</div>'; }
  else {
    var rows = ACCOUNTS.map(function(u){
      var me = CURRENT_USER && CURRENT_USER.uid===u.uid;
      return '<tr><td><b>'+esc(u.name||u.username||u.email)+'</b>'+(me?' <span class="chip">you</span>':'')+'<div class="muted small">'+esc(u.username?('@'+u.username):u.email)+'</div></td>'+
        '<td>'+(u.isAdmin?chip('Admin','gold'):chip(roleLabel(u.role)))+'</td>'+
        '<td>'+(u.active===false?chip('Disabled'):chip('Active','ok'))+'</td>'+
        '<td class="r">'+
          '<button class="btn xs" onclick="editAccountDialog(\''+u.uid+'\')">✎ Edit</button> '+
          '<button class="btn xs ghost" onclick="passwordDialog(\''+u.uid+'\')">🔑 Password</button> '+
          '<button class="btn xs ghost" onclick="resetPwRandom(\''+u.uid+'\')" title="Reset to a new random password, shown once">🎲 Reset</button>'+
        '</td></tr>';
    }).join('');
    accHTML = '<div class="card pad0"><table class="tbl"><thead><tr><th>Staff</th><th>Role</th><th>Status</th><th class="r">Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  var m = PERM_EDIT ? PERM_DRAFT : permsMatrix();
  var head = '<tr><th>Capability</th>'+ROLE_LIST.map(function(r){return '<th class="r">'+esc(roleLabel(r))+'</th>';}).join('')+'</tr>';
  var body = CAPS.map(function(c){
    return '<tr><td>'+esc(c.label)+'</td>'+ROLE_LIST.map(function(r){
      var on=!!(m[r]&&m[r][c.key]);
      return '<td class="r"><input type="checkbox" '+(on?'checked':'')+(PERM_EDIT?'':' disabled')+' onchange="permDraftToggle(\''+r+'\',\''+c.key+'\',this.checked)"></td>';
    }).join('')+'</tr>';
  }).join('');
  var permBtns = PERM_EDIT
    ? '<button class="btn sm primary" onclick="permSave()">Save</button>'+
      '<button class="btn sm ghost" onclick="permCancel()">Cancel</button>'+
      '<button class="btn sm ghost" onclick="permResetDraft()">Reset to defaults</button>'
    : '<button class="btn sm" onclick="permEditOn()">✎ Edit</button>';

  return '<div class="page"><div class="page-head"><h1>Accounts & Roles</h1>'+
    '<button class="btn primary" onclick="addAccountDialog()">＋ Add staff account</button></div>'+
    '<h2 class="sec">Staff accounts</h2>'+accHTML+
    '<div class="row gap sec" style="align-items:center"><h2 style="margin:0">Role permissions</h2>'+permBtns+
      (PERM_EDIT?'<span class="rolebadge admin">editing</span>':'')+'</div>'+
    '<p class="muted small">Admins always have full access. '+(PERM_EDIT?'Tick what each role can do, then <b>Save</b> (or Cancel to discard).':'Click <b>Edit</b> to change what each role can do.')+'</p>'+
    '<div class="card pad0"><table class="tbl perm"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>'+
  '</div>';
};

function accessDenied(what){
  return '<div class="card center" style="padding:48px 24px">'+
    '<div style="font-size:34px">🔒</div>'+
    '<h2>Access restricted</h2>'+
    '<p class="muted">You don’t have permission to view '+esc(what||'this')+'. Ask your administrator if you need access.</p>'+
    '<button class="btn primary" onclick="go(\'board\')">Back to Board</button></div>';
}

/* Map a route to the capability it requires (for the renderView guard). */
var VIEW_CAP = {
  appointments:'appointments', estimates:'estimates', estimate:'estimates',
  reports:'reports', dailyclose:'dailyclose', productivity:'productivity', receivables:'receivables',
  parts:'parts_manage', labor:'parts_manage', purchaseorders:'parts_manage', po:'parts_manage',
  staff:'staff_manage', accounts:'staff_manage', settings:'settings'
};
function routeAllowed(view){ var c=VIEW_CAP[view]; return !c || can(c); }
