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
  { key:'receivables',  label:'Receivables (A/R)' },
  { key:'reports',      label:'Reports / Daily Close' },
  { key:'productivity', label:'Productivity & commissions' },
  { key:'parts_manage', label:'Parts / Labor / PO' },
  { key:'staff_manage', label:'Staff & accounts' },
  { key:'settings',     label:'Settings' },
  { key:'delete',       label:'Delete / clear data' }
];

/* Default matrix (Admin always has everything via isAdmin). Admin-editable. */
var DEFAULT_PERMS = {
  SV:               { appointments:1, estimates:1, prices:1, part_cost:1, discounts:1, billing:1, receivables:1, reports:1, parts_manage:1 },
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
  var ref = FB.db.collection('users').doc(user.uid);
  var doc = await ref.get();
  if (doc.exists){
    var d = doc.data();
    if (d.active === false){ var e1=new Error('inactive'); e1.code='inactive'; throw e1; }
    CURRENT_USER = Object.assign({ uid:user.uid, email:user.email }, d);
    return;
  }
  // No account doc yet — first ever user becomes Admin (bootstrap).
  var any = await FB.db.collection('users').limit(1).get();
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
  if (_accountsLoading || !FB.ready) return;
  _accountsLoading = true;
  FB.db.collection('users').get().then(function(snap){
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
  if (ROUTE.view==='accounts' && ACCOUNTS===null && typeof cloudOn==='function' && cloudOn() && FB && FB.ready){ loadAccounts(); }
};

/* ---- Account management (Admin) ------------------------------------------- */
function getSecondaryApp(){
  // a separate Firebase app so creating a user doesn't sign the Admin out
  var existing = (firebase.apps||[]).filter(function(a){ return a.name==='sec'; })[0];
  return existing || firebase.initializeApp(FIREBASE_CONFIG, 'sec');
}
function addAccountDialog(){
  if (!isAdminUser()){ toast('Admins only','err'); return; }
  openModal('Add staff account',
    field('Full name','<input id="acName" placeholder="Juan Dela Cruz">')+
    field('Email','<input id="acEmail" type="email" placeholder="staff@example.com">')+
    '<div class="grid2">'+
    field('Role','<select id="acRole">'+ROLE_LIST.map(function(r){return '<option value="'+r+'">'+esc(roleLabel(r))+'</option>';}).join('')+'</select>')+
    field('Admin?','<label class="chk"><input type="checkbox" id="acAdmin"> Full admin access</label>')+'</div>'+
    '<p class="muted small">The staff member gets an email to set their own password. They can sign in once they do.</p>',
    { onOk:'createStaffAccount', okText:'Create account' });
}
function createStaffAccount(){
  var name=val('acName').trim(), email=val('acEmail').trim(), role=val('acRole'), isAdmin=checked('acAdmin');
  if(!name||!email){ toast('Name and email required','err'); return; }
  var btn=document.querySelector('.modal-foot .btn.primary'); if(btn){ btn.textContent='Creating…'; btn.disabled=true; }
  var sec=getSecondaryApp();
  var tempPass='Basic-'+Math.random().toString(36).slice(2,10)+'-'+Math.floor(Math.random()*900+100);
  sec.auth().createUserWithEmailAndPassword(email, tempPass).then(function(cred){
    return FB.db.collection('users').doc(cred.user.uid).set({
      email:email, name:name, role:role, isAdmin:isAdmin, active:true, createdAt:new Date().toISOString()
    }).then(function(){ return sec.auth().sendPasswordResetEmail(email); })
      .then(function(){ return sec.auth().signOut(); });
  }).then(function(){
    closeModal(); toast('Account created · reset email sent to '+email); refreshAccounts();
  }).catch(function(e){
    var msg = (e.code||'').indexOf('email-already-in-use')>=0 ? 'That email already has an account.' : (e.message||'Could not create account');
    toast(msg,'err'); if(btn){ btn.textContent='Create account'; btn.disabled=false; }
  });
}
function setAccountRole(uid, role){ FB.db.collection('users').doc(uid).update({ role:role }).then(function(){ toast('Role updated'); refreshAccounts(); }); }
function setAccountAdmin(uid, isAdmin){ FB.db.collection('users').doc(uid).update({ isAdmin:isAdmin }).then(function(){ toast('Updated'); refreshAccounts(); }); }
function setAccountActive(uid, active){ FB.db.collection('users').doc(uid).update({ active:active }).then(function(){ toast(active?'Account enabled':'Account disabled'); refreshAccounts(); }); }
function resetAccountPassword(email){ FB.auth.sendPasswordResetEmail(email).then(function(){ toast('Reset email sent to '+email); }).catch(function(e){ toast(e.message,'err'); }); }

/* ---- Permission matrix editing (Admin) ------------------------------------ */
function togglePerm(role, cap, on){
  var m = JSON.parse(JSON.stringify(permsMatrix()));
  if (!m[role]) m[role]={};
  if (on) m[role][cap]=1; else delete m[role][cap];
  S.shop.permissions = m;
  persist(); render();
}
function resetPerms(){
  confirmModal('Reset permissions?','Restore the default role permissions for all roles.', function(){
    S.shop.permissions = JSON.parse(JSON.stringify(DEFAULT_PERMS)); persist(); render();
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
      var roleSel = '<select onchange="setAccountRole(\''+u.uid+'\',this.value)"'+(u.isAdmin?' disabled':'')+'>'+
        ROLE_LIST.map(function(r){return '<option value="'+r+'"'+(u.role===r?' selected':'')+'>'+esc(roleLabel(r))+'</option>';}).join('')+'</select>';
      var me = CURRENT_USER && CURRENT_USER.uid===u.uid;
      return '<tr><td><b>'+esc(u.name||u.email)+'</b>'+(me?' <span class="chip">you</span>':'')+'<div class="muted small">'+esc(u.email)+'</div></td>'+
        '<td>'+(u.isAdmin?chip('Admin','gold'):roleSel)+'</td>'+
        '<td>'+(u.active===false?chip('Disabled'):chip('Active','ok'))+'</td>'+
        '<td class="r">'+
          '<label class="chk small" title="Full admin access"><input type="checkbox" '+(u.isAdmin?'checked':'')+(me?' disabled':'')+' onchange="setAccountAdmin(\''+u.uid+'\',this.checked)"> admin</label> '+
          '<button class="btn xs ghost" onclick="resetAccountPassword(\''+attr(u.email)+'\')">Reset PW</button> '+
          (me?'':'<button class="btn xs ghost" onclick="setAccountActive(\''+u.uid+'\','+(u.active===false?'true':'false')+')">'+(u.active===false?'Enable':'Disable')+'</button>')+
        '</td></tr>';
    }).join('');
    accHTML = '<div class="card pad0"><table class="tbl"><thead><tr><th>Staff</th><th>Role</th><th>Status</th><th class="r">Actions</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  var m = permsMatrix();
  var head = '<tr><th>Capability</th>'+ROLE_LIST.map(function(r){return '<th class="r">'+esc(roleLabel(r))+'</th>';}).join('')+'</tr>';
  var body = CAPS.map(function(c){
    return '<tr><td>'+esc(c.label)+'</td>'+ROLE_LIST.map(function(r){
      var on=!!(m[r]&&m[r][c.key]);
      return '<td class="r"><input type="checkbox" '+(on?'checked':'')+' onchange="togglePerm(\''+r+'\',\''+c.key+'\',this.checked)"></td>';
    }).join('')+'</tr>';
  }).join('');

  return '<div class="page"><div class="page-head"><h1>Accounts & Roles</h1>'+
    '<button class="btn primary" onclick="addAccountDialog()">＋ Add staff account</button></div>'+
    '<h2 class="sec">Staff accounts</h2>'+accHTML+
    '<div class="row gap sec"><h2 style="margin:0">Role permissions</h2><button class="btn sm ghost" onclick="resetPerms()">Reset to defaults</button></div>'+
    '<p class="muted small">Admins always have full access. Tick what each role can do — changes apply to everyone in that role immediately.</p>'+
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
  reports:'reports', dailyclose:'reports', productivity:'productivity', receivables:'receivables',
  parts:'parts_manage', labor:'parts_manage', purchaseorders:'parts_manage', po:'parts_manage',
  staff:'staff_manage', accounts:'staff_manage', settings:'settings'
};
function routeAllowed(view){ var c=VIEW_CAP[view]; return !c || can(c); }
