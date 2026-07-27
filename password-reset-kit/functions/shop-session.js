/* ============================================================================
   shop-session — "you can only open BASIC inside the shop"
   ----------------------------------------------------------------------------
   WHY THIS EXISTS
   A password can never enforce *where* the app is opened. Whatever the browser
   can autofill, the worker can reveal (chrome://password-manager) or sync to his
   own phone. So location is checked HERE, on the server, where the client cannot
   lie — and Firestore rules refuse every read/write without the session document
   this file writes.

   HOW IT WORKS
     1. Worker signs in normally (Firebase Auth).
     2. The app calls startShopSession(). We compare the request's source IP with
        the branch's trusted-network list.
     3. On a match we write branches/{b}/sessions/{uid} with an expiry. ONLY the
        Admin SDK can write that collection, so it cannot be forged.
     4. firestore.rules requires a live session for every data operation.

   Off-premises the worker holds a valid password AND a valid auth token, and
   still reads nothing.

   SAFE ROLLOUT: enforcement is OFF until meta/network.enforce === true, so
   deploying this cannot lock a shop out. Trust the shop network first, then
   switch enforcement on.
   ========================================================================== */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const CONFIG = {
  ownerEmails: ['johnlazaga1980@yahoo.com'],
  userDocPath: 'branches/{b}/users/{uid}',
  sessionPath: 'branches/{b}/sessions/{uid}',
  /* Its own collection, NOT a meta/ document: the app listens to meta/ as a
     whole, and rules for a listened collection cannot carry per-document-id
     conditions without breaking that listen. */
  networkPath: 'branches/{b}/shopnet/network',

  /* How long a shop session stays valid. A worker who signs in at the shop and
     then leaves keeps access until this runs out, so shorter = tighter. The app
     silently renews every ~20 min while it is open on the shop network, so a
     device that stays on-site never notices the expiry. */
  sessionHours: 3,
};

function pathFor(tpl, b, uid) { return String(tpl).replace('{b}', b || '').replace('{uid}', uid || ''); }

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
   cannot influence. Anything he prepends sits to the left and is ignored.

   IPv4-mapped IPv6 (::ffff:1.2.3.4) is unwrapped so it compares equal to the
   plain IPv4 an admin would recognise. */
function ipChain(context) {
  const req = (context && context.rawRequest) || {};
  const headers = req.headers || {};
  return String(headers['x-forwarded-for'] || '')
    .split(',').map(normalizeIp).filter(Boolean);
}
/* Private/loopback/link-local, plus the published Google front-end and
   load-balancer ranges that appear as the final hops. */
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
async function loadNetwork(db, branchId) {
  const snap = await db.doc(pathFor(CONFIG.networkPath, branchId, '')).get();
  const d = snap.exists ? (snap.data() || {}) : {};
  return { enforce: d.enforce === true, ips: Array.isArray(d.ips) ? d.ips : [] };
}
function isOwnerEmail(email) {
  return CONFIG.ownerEmails.map((e) => String(e).toLowerCase()).includes(String(email || '').toLowerCase());
}
/* Admins and the owner are exempt — they are expected to work from home. */
async function requireAdmin(db, context, branchId) {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Please sign in.');
  if (isOwnerEmail(context.auth.token.email)) return { uid: context.auth.uid, owner: true };
  const acct = await loadAccount(db, branchId, context.auth.uid);
  if (!acct || acct.isAdmin !== true || acct.active === false) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.');
  }
  return { uid: context.auth.uid, owner: false };
}

/* ============================================================================
   startShopSession — called by the app right after sign-in, then every ~20 min.
   Returns { ok, enforced, exempt, expiresAt, ip }. Throws permission-denied
   with message 'off-premises' when the caller is not on a trusted network.
   ========================================================================== */
exports.startShopSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Please sign in.');
  const uid = context.auth.uid;
  const branchId = String((data && data.branchId) || '').trim();
  if (!branchId) throw new functions.https.HttpsError('invalid-argument', 'branchId is required.');

  const db = admin.firestore();
  const ip = callerIp(context);

  const acct = await loadAccount(db, branchId, uid);
  if (!acct) throw new functions.https.HttpsError('not-found', 'That account is not set up in this branch.');
  if (acct.active === false) throw new functions.https.HttpsError('permission-denied', 'This account is disabled.');

  const net = await loadNetwork(db, branchId);
  const exempt = isOwnerEmail(context.auth.token.email) || acct.isAdmin === true;
  const allowed = !net.enforce || exempt || net.ips.some((e) => ipMatches(ip, e && e.ip));

  if (!allowed) {
    /* Leave a trace so an admin can see who tried from where. Best-effort. */
    try {
      await db.doc(pathFor(CONFIG.sessionPath, branchId, uid)).set({
        deniedIp: ip, deniedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) { /* non-fatal */ }
    throw new functions.https.HttpsError('permission-denied', 'off-premises');
  }

  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + CONFIG.sessionHours * 3600 * 1000);
  await db.doc(pathFor(CONFIG.sessionPath, branchId, uid)).set({
    uid, ip, expiresAt, exempt,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    deniedIp: admin.firestore.FieldValue.delete(),
    deniedAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  return { ok: true, enforced: net.enforce, exempt, expiresAt: expiresAt.toMillis(), ip };
});

/* ============================================================================
   trustThisNetwork — admin taps this ONCE while standing in the shop, on the
   shop's WiFi. Records the connection's current public IP as trusted. Consumer
   broadband rotates its IP, so this is the button to tap again when it does.
   ========================================================================== */
exports.trustThisNetwork = functions.https.onCall(async (data, context) => {
  const branchId = String((data && data.branchId) || '').trim();
  if (!branchId) throw new functions.https.HttpsError('invalid-argument', 'branchId is required.');
  const db = admin.firestore();
  const caller = await requireAdmin(db, context, branchId);

  const ip = callerIp(context);
  if (!ip) throw new functions.https.HttpsError('failed-precondition', 'Could not read this connection’s address.');

  const label = String((data && data.label) || '').trim().slice(0, 60) || 'Shop network';
  const net = await loadNetwork(db, branchId);
  if (net.ips.some((e) => e && normalizeIp(e.ip) === ip)) {
    return { ok: true, ip, alreadyTrusted: true, ips: net.ips, enforce: net.enforce };
  }

  const entry = { ip, label, addedBy: caller.uid, addedAt: new Date().toISOString() };
  const ips = net.ips.concat([entry]);
  await db.doc(pathFor(CONFIG.networkPath, branchId, '')).set({ ips }, { merge: true });
  /* `chain` is returned for diagnosis only — it shows which hop was picked out
     of the forwarding chain if a shop ever appears to be trusting the wrong
     address. It is never used for a decision. */
  return { ok: true, ip, alreadyTrusted: false, ips, enforce: net.enforce, chain: ipChain(context) };
});

/* ---- forgetNetwork — drop a trusted address ------------------------------ */
exports.forgetNetwork = functions.https.onCall(async (data, context) => {
  const branchId = String((data && data.branchId) || '').trim();
  const target = normalizeIp((data && data.ip) || '');
  if (!branchId || !target) throw new functions.https.HttpsError('invalid-argument', 'branchId and ip are required.');
  const db = admin.firestore();
  await requireAdmin(db, context, branchId);

  const net = await loadNetwork(db, branchId);
  const ips = net.ips.filter((e) => !(e && normalizeIp(e.ip) === target));
  /* Removing the last trusted network while enforcing would lock out every
     non-admin, so enforcement is switched off with it. */
  const patch = { ips };
  if (!ips.length && net.enforce) patch.enforce = false;
  await db.doc(pathFor(CONFIG.networkPath, branchId, '')).set(patch, { merge: true });
  return { ok: true, ips, enforce: patch.enforce !== undefined ? patch.enforce : net.enforce };
});

/* ---- setEnforcement — turn the whole gate on or off ---------------------- */
exports.setEnforcement = functions.https.onCall(async (data, context) => {
  const branchId = String((data && data.branchId) || '').trim();
  if (!branchId) throw new functions.https.HttpsError('invalid-argument', 'branchId is required.');
  const enforce = !!(data && data.enforce);
  const db = admin.firestore();
  await requireAdmin(db, context, branchId);

  const net = await loadNetwork(db, branchId);
  if (enforce && !net.ips.length) {
    throw new functions.https.HttpsError('failed-precondition',
      'Trust the shop network first — otherwise every worker is locked out.');
  }
  await db.doc(pathFor(CONFIG.networkPath, branchId, '')).set({ enforce }, { merge: true });
  return { ok: true, enforce, ips: net.ips };
});

/* Exposed for unit tests. */
exports._internals = { ipMatches, normalizeIp, ipv4ToInt, callerIp, ipChain, isInfrastructureIp };
