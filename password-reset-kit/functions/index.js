/* ============================================================================
   password-reset-kit — Admin "reset to random" Cloud Function
   ----------------------------------------------------------------------------
   A callable HTTPS function that lets an ADMIN reset ANOTHER user's password to a
   fresh random value, returns it to the admin ONCE, and stores nothing. No
   plaintext password is ever kept anywhere.

   Why a Cloud Function at all: the Firebase *client* SDK cannot set another user's
   password — only the Admin SDK (server-side) can. This function runs with the
   default Firebase service account, so it needs no key file when deployed.

   Reusable across apps: edit CONFIG below, then `firebase deploy --only functions`.
   See ../README.md for the 5-minute setup.
   ========================================================================== */
const functions = require('firebase-functions/v1');   // v1 API (stable on firebase-functions v4/v5)
const admin = require('firebase-admin');
const crypto = require('crypto');
admin.initializeApp();

/* ======================= EDIT THIS FOR YOUR APP ========================== */
const CONFIG = {
  // Super-admins allowed no matter what, by their sign-in email.
  ownerEmails: ['johnlazaga1980@yahoo.com'],

  // Where each user's directory record lives — used to (a) check the CALLER is an
  // admin and (b) confirm the TARGET belongs here. Tokens: {b}=branchId, {uid}=uid.
  // Multi-tenant example: 'branches/{b}/users/{uid}'
  // Single-tenant example: 'users/{uid}'
  // Set to null to authorize ONLY ownerEmails (or swap in a custom-claim check).
  userDocPath: 'branches/{b}/users/{uid}',

  adminField:  'isAdmin',   // a truthy value on that doc == admin
  activeField: 'active',    // if === false, the account is treated as disabled

  // Require caller and target to resolve under the same branchId (tenant safety).
  requireSameBranch: true,

  // 'memorable' => Word-1234-Word-5678 (easy to type once) ; 'strong' => random.
  passwordStyle: 'memorable',
};
/* ========================================================================= */

/* A small word pool for memorable passwords. Swap freely — it only affects looks. */
const WORDS = ['Motor','Bakal','Pusa','Aso','Kalye','Lobo','Tigre','Bituin','Araw','Buwan',
  'Dagat','Bundok','Ilog','Apoy','Hangin','Lupa','Tala','Ulan','Kidlat','Yelo',
  'Piston','Gulong','Preno','Makina','Susi','Martilyo','Turnilyo','Kable','Tubo','Pinto'];

function randInt(n){ return crypto.randomInt(n); }                 // cryptographically secure
function pick(a){ return a[randInt(a.length)]; }
function genMemorable(){ return pick(WORDS)+'-'+(1000+randInt(9000))+'-'+pick(WORDS)+'-'+(1000+randInt(9000)); }
function genStrong(){
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';   // no look-alikes
  let s=''; for (let i=0;i<18;i++) s += set[randInt(set.length)];
  return s.slice(0,6)+'-'+s.slice(6,12)+'-'+s.slice(12);
}
function genPassword(style){ return style === 'strong' ? genStrong() : genMemorable(); }
function pathFor(tpl, b, uid){ return String(tpl).replace('{b}', b||'').replace('{uid}', uid||''); }

exports.adminResetPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Please sign in.');
  const callerUid   = context.auth.uid;
  const callerEmail = String(context.auth.token.email || '').toLowerCase();
  const targetUid   = String((data && data.targetUid) || '').trim();
  const branchId    = String((data && data.branchId)  || '').trim();
  if (!targetUid) throw new functions.https.HttpsError('invalid-argument', 'targetUid is required.');

  const db = admin.firestore();

  /* 1) Authorize the caller as an admin (owner email, or an admin directory doc). */
  const owners = CONFIG.ownerEmails.map((e) => String(e).toLowerCase());
  let authorized = !!callerEmail && owners.includes(callerEmail);
  if (!authorized && CONFIG.userDocPath) {
    const me = await db.doc(pathFor(CONFIG.userDocPath, branchId, callerUid)).get();
    authorized = me.exists && me.get(CONFIG.adminField) === true && me.get(CONFIG.activeField) !== false;
  }
  if (!authorized) throw new functions.https.HttpsError('permission-denied', 'Admins only.');

  /* 2) Tenant safety — the target must exist in this branch's directory. */
  if (CONFIG.userDocPath && CONFIG.requireSameBranch) {
    const t = await db.doc(pathFor(CONFIG.userDocPath, branchId, targetUid)).get();
    if (!t.exists) throw new functions.https.HttpsError('not-found', 'That user is not in this branch.');
  }

  /* 3) Reset the password (Admin SDK — no old password required). */
  const password = genPassword(CONFIG.passwordStyle);
  await admin.auth().updateUser(targetUid, { password });

  /* 4) Store NOTHING. Also wipe any legacy plaintext copy and leave an audit stamp. */
  if (CONFIG.userDocPath) {
    try {
      await db.doc(pathFor(CONFIG.userDocPath, branchId, targetUid)).set({
        password: admin.firestore.FieldValue.delete(),
        passwordResetAt: new Date().toISOString(),
        passwordResetBy: callerUid,
      }, { merge: true });
    } catch (e) { /* audit/cleanup is best-effort; the reset itself already succeeded */ }
  }

  return { password };   // shown ONCE to the admin; never persisted
});
