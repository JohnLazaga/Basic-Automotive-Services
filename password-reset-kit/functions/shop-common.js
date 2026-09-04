/* ============================================================================
   shop-common — the pieces the premises gate (shop-session.js) and the device
   gate (device-auth.js) both need: who is asking, from which address, and what
   this branch's policy says.

   Split out so there is exactly ONE definition of "is this caller an admin" and
   ONE definition of "which IP did Google actually see". Both gates issue the
   same session document, so they must agree on those answers.
   ========================================================================== */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const CONFIG = {
  ownerEmails: ['johnlazaga1980@yahoo.com'],
  userDocPath:   'branches/{b}/users/{uid}',
  sessionPath:   'branches/{b}/sessions/{uid}',
  /* Its own collection, NOT a meta/ document: the app listens to meta/ as a
     whole, and rules for a listened collection cannot carry per-document-id
     conditions without breaking that listen. */
  networkPath:   'branches/{b}/shopnet/network',
  devicesColl:   'branches/{b}/devices',
  devicePath:    'branches/{b}/devices/{id}',
  challengePath: 'branches/{b}/webauthn_challenges/{uid}',

  /* How long a shop session stays valid. A worker who signs in at the shop and
     then leaves keeps access until this runs out, so shorter = tighter. The app
     silently renews every ~20 min while it is open, so a device that stays
     on-site never notices the expiry. */
  sessionHours: 3,
};

/* {b} = branch, {uid}/{id} = the trailing key. */
function pathFor(tpl, b, key) {
  return String(tpl).replace('{b}', b || '').replace('{uid}', key || '').replace('{id}', key || '');
}

/* ---- IP helpers ---------------------------------------------------------- */
/* SECURITY: x-forwarded-for is NOT trustworthy from the left. Any client can
   send their own X-Forwarded-For header, and Google's front end APPENDS the
   real client address to whatever arrived — so the chain looks like
       <anything the worker made up>, <his real address>, <google hop>
   Reading the left-most entry would therefore let a worker at home simply
   claim the shop's address and walk straight through the gate.

   We read from the RIGHT instead, skipping addresses that belong to the
   infrastructure (private ranges and Google's load-balancer ranges). The
   right-most remaining address is the one Google observed, which the caller
   cannot influence. Anything he prepends sits to the left and is ignored. */
function ipChain(context) {
  const req = (context && context.rawRequest) || {};
  const headers = req.headers || {};
  return String(headers['x-forwarded-for'] || '')
    .split(',').map(normalizeIp).filter(Boolean);
}
function isInfrastructureIp(ip) {
  if (!ip) return true;
  return ipMatches(ip, '10.0.0.0/8')
      || ipMatches(ip, '172.16.0.0/12')
      || ipMatches(ip, '192.168.0.0/16')
      || ipMatches(ip, '127.0.0.0/8')
      || ipMatches(ip, '169.254.0.0/16')
      || ipMatches(ip, '35.191.0.0/16')      // Google LB / health checks
      || ipMatches(ip, '130.211.0.0/22');    // Google LB
}
function callerIp(context) {
  const chain = ipChain(context);
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isInfrastructureIp(chain[i])) return chain[i];
  }
  const req = (context && context.rawRequest) || {};
  return normalizeIp(req.ip || '');
}
function normalizeIp(ip) {
  ip = String(ip || '').trim();
  if (ip.toLowerCase().indexOf('::ffff:') === 0) ip = ip.slice(7);
  return ip;
}
function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const o = Number(parts[i]);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n * 256) + o;
  }
  return n >>> 0;
}
/* Exact match, or an IPv4 CIDR block such as 112.198.44.0/24. */
function ipMatches(ip, rule) {
  if (!ip || !rule) return false;
  rule = String(rule).trim();
  if (rule.indexOf('/') < 0) return normalizeIp(ip) === normalizeIp(rule);
  const slash = rule.split('/');
  const bits = Number(slash[1]);
  const a = ipv4ToInt(normalizeIp(ip));
  const b = ipv4ToInt(slash[0]);
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xFFFFFFFF : (~((1 << (32 - bits)) - 1)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/* ---- shared lookups ------------------------------------------------------ */
async function loadAccount(db, branchId, uid) {
  const snap = await db.doc(pathFor(CONFIG.userDocPath, branchId, uid)).get();
  return snap.exists ? snap.data() : null;
}
/* The branch's gate policy. Absent doc / absent field == off, so both gates
   stay dormant until an admin switches them on. */
async function loadNetwork(db, branchId) {
  const snap = await db.doc(pathFor(CONFIG.networkPath, branchId, '')).get();
  const d = snap.exists ? (snap.data() || {}) : {};
  return {
    enforce: d.enforce === true,               // trusted-network (IP) gate
    deviceEnforce: d.deviceEnforce === true,   // enrolled-device (passkey) gate
    ips: Array.isArray(d.ips) ? d.ips : [],
  };
}
function isOwnerEmail(email) {
  return CONFIG.ownerEmails.map((e) => String(e).toLowerCase()).includes(String(email || '').toLowerCase());
}
/* Admins and the owner are exempt from both gates — they are expected to work
   from home. */
async function requireAdmin(db, context, branchId) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Please sign in.');
  if (isOwnerEmail(context.auth.token.email)) return { uid: context.auth.uid, owner: true };
  const acct = await loadAccount(db, branchId, context.auth.uid);
  if (!acct || acct.isAdmin !== true || acct.active === false) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.');
  }
  return { uid: context.auth.uid, owner: false };
}
function requireBranchId(data) {
  const branchId = String((data && data.branchId) || '').trim();
  if (!branchId) throw new functions.https.HttpsError('invalid-argument', 'branchId is required.');
  return branchId;
}

module.exports = {
  CONFIG, pathFor,
  ipChain, isInfrastructureIp, callerIp, normalizeIp, ipv4ToInt, ipMatches,
  loadAccount, loadNetwork, isOwnerEmail, requireAdmin, requireBranchId,
};
