/* ============================================================================
   shop-session — "you can only open BASIC at the shop, on a shop device"
   ----------------------------------------------------------------------------
   WHY THIS EXISTS
   A password can never enforce *where* the app is opened. Whatever the browser
   can autofill, the worker can reveal (chrome://password-manager) or sync to his
   own phone. So the check happens HERE, on the server, where the client cannot
   lie — and Firestore rules refuse every read/write without the session document
   this file writes.

   TWO INDEPENDENT GATES, either or both:
     • Trusted network (enforce)       — is this the shop's internet address?
     • Enrolled device (deviceEnforce) — is this one of our iPads? (device-auth.js)

   The device gate is the stronger of the two and the one that survives a
   changing IP: the proof is a signature from hardware that never leaves the
   shop. The network gate is kept because it is already deployed, costs nothing
   to leave on, and catches an enrolled device that walked out of the building.

   HOW IT WORKS
     1. Worker signs in normally (Firebase Auth).
     2. The app calls startShopSession(). If the device gate is on we hand back
        a challenge; the iPad signs it with Face ID and calls again.
     3. We check the signature and/or the request's source IP.
     4. On success we write branches/{b}/sessions/{uid} with an expiry. ONLY the
        Admin SDK can write that collection, so it cannot be forged.
     5. firestore.rules requires a live session for every data operation.

   Off-premises the worker holds a valid password AND a valid auth token, and
   still reads nothing.

   SAFE ROLLOUT: both gates are OFF until their flag is set on
   branches/{b}/shopnet/network, so deploying this cannot lock a shop out.
   ========================================================================== */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const C = require('./shop-common');
const DEV = require('./device-auth');

const CONFIG = C.CONFIG;

/* Has this user already proved a device, on a session that has not run out —
   and is that device still enrolled and switched on? Returns the device id, or
   '' when a fresh hardware proof is required.

   Reading the session we ourselves wrote is safe here: only the Admin SDK can
   write that document, so its deviceId is not something a client can plant. */
async function provenDeviceId(db, branchId, uid) {
  const snap = await db.doc(C.pathFor(CONFIG.sessionPath, branchId, uid)).get();
  if (!snap.exists) return '';
  const d = snap.data() || {};
  const expires = (d.expiresAt && d.expiresAt.toMillis) ? d.expiresAt.toMillis() : 0;
  if (!d.deviceId || expires <= Date.now()) return '';
  const devices = await DEV._device.activeDevices(db, branchId);
  return devices.some((x) => x.id === d.deviceId) ? String(d.deviceId) : '';
}

/* ============================================================================
   startShopSession — called by the app right after sign-in, then every ~20 min.

   Returns { ok, enforced, deviceEnforced, exempt, expiresAt, ip } on success.
   Returns { ok:false, need:'device', options } when the device gate is on and
   the caller has not signed a challenge yet — the app then asks the hardware
   and calls straight back with deviceResponse.
   Throws permission-denied 'off-premises' when the caller is not on a trusted
   network, and 'unknown-device' / 'synced-passkey' for a device refusal.
   ========================================================================== */
exports.startShopSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Please sign in.');
  const uid = context.auth.uid;
  const branchId = C.requireBranchId(data);

  const db = admin.firestore();
  const ip = C.callerIp(context);

  const acct = await C.loadAccount(db, branchId, uid);
  if (!acct) throw new functions.https.HttpsError('not-found', 'That account is not set up in this branch.');
  if (acct.active === false) throw new functions.https.HttpsError('permission-denied', 'This account is disabled.');

  const net = await C.loadNetwork(db, branchId);
  const exempt = C.isOwnerEmail(context.auth.token.email) || acct.isAdmin === true;

  /* ---- Gate 1: enrolled device -----------------------------------------
     Done before the IP check so a worker at home gets the accurate reason. */
  let deviceId = '';
  if (net.deviceEnforce && !exempt) {
    const response = data && data.deviceResponse;
    if (response) {
      const dev = await DEV._device.verifyDeviceAssertion(db, branchId, uid, response, context);
      deviceId = dev.id;
    } else {
      /* The app renews every ~20 min while it stays open. Asking the hardware
         again each time would put a Face ID prompt in front of a mechanic with
         his hands in an engine, so a session that was ALREADY device-proven is
         simply extended. The device must still be enrolled and active, which is
         what makes "remove device" revoke access within one renewal. */
      deviceId = await provenDeviceId(db, branchId, uid);
      if (!deviceId) {
        /* First leg of the round trip: hand out a challenge and stop here. No
           session is written, so this is not an access decision yet. */
        const options = await DEV._device.deviceChallenge(db, branchId, uid, context);
        return { ok: false, need: 'device', options, enforced: net.enforce, deviceEnforced: true };
      }
    }
  }

  /* ---- Gate 2: trusted network ------------------------------------------ */
  const ipAllowed = !net.enforce || exempt || net.ips.some((e) => C.ipMatches(ip, e && e.ip));
  if (!ipAllowed) {
    /* Leave a trace so an admin can see who tried from where. Best-effort. */
    try {
      await db.doc(C.pathFor(CONFIG.sessionPath, branchId, uid)).set({
        deniedIp: ip, deniedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) { /* non-fatal */ }
    throw new functions.https.HttpsError('permission-denied', 'off-premises');
  }

  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + CONFIG.sessionHours * 3600 * 1000);
  await db.doc(C.pathFor(CONFIG.sessionPath, branchId, uid)).set({
    uid, ip, expiresAt, exempt, deviceId,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    deniedIp: admin.firestore.FieldValue.delete(),
    deniedAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  return {
    ok: true, enforced: net.enforce, deviceEnforced: net.deviceEnforce,
    exempt, expiresAt: expiresAt.toMillis(), ip,
  };
});

/* ============================================================================
   trustThisNetwork — admin taps this ONCE while standing in the shop, on the
   shop's WiFi. Records the connection's current public IP as trusted. Consumer
   broadband rotates its IP, so this is the button to tap again when it does.
   (The device gate exists precisely so you do not have to.)
   ========================================================================== */
exports.trustThisNetwork = functions.https.onCall(async (data, context) => {
  const branchId = C.requireBranchId(data);
  const db = admin.firestore();
  const caller = await C.requireAdmin(db, context, branchId);

  const ip = C.callerIp(context);
  if (!ip) throw new functions.https.HttpsError('failed-precondition', 'Could not read this connection address.');

  const label = String((data && data.label) || '').trim().slice(0, 60) || 'Shop network';
  const net = await C.loadNetwork(db, branchId);
  if (net.ips.some((e) => e && C.normalizeIp(e.ip) === ip)) {
    return { ok: true, ip, alreadyTrusted: true, ips: net.ips, enforce: net.enforce };
  }

  const entry = { ip, label, addedBy: caller.uid, addedAt: new Date().toISOString() };
  const ips = net.ips.concat([entry]);
  await db.doc(C.pathFor(CONFIG.networkPath, branchId, '')).set({ ips }, { merge: true });
  /* `chain` is returned for diagnosis only — it shows which hop was picked out
     of the forwarding chain if a shop ever appears to be trusting the wrong
     address. It is never used for a decision. */
  return { ok: true, ip, alreadyTrusted: false, ips, enforce: net.enforce, chain: C.ipChain(context) };
});

/* ---- forgetNetwork — drop a trusted address ------------------------------ */
exports.forgetNetwork = functions.https.onCall(async (data, context) => {
  const branchId = C.requireBranchId(data);
  const target = C.normalizeIp((data && data.ip) || '');
  if (!target) throw new functions.https.HttpsError('invalid-argument', 'ip is required.');
  const db = admin.firestore();
  await C.requireAdmin(db, context, branchId);

  const net = await C.loadNetwork(db, branchId);
  const ips = net.ips.filter((e) => !(e && C.normalizeIp(e.ip) === target));
  /* Removing the last trusted network while enforcing would lock out every
     non-admin, so enforcement is switched off with it. */
  const patch = { ips };
  if (!ips.length && net.enforce) patch.enforce = false;
  await db.doc(C.pathFor(CONFIG.networkPath, branchId, '')).set(patch, { merge: true });
  return { ok: true, ips, enforce: patch.enforce !== undefined ? patch.enforce : net.enforce };
});

/* ---- setEnforcement — turn the NETWORK gate on or off -------------------- */
exports.setEnforcement = functions.https.onCall(async (data, context) => {
  const branchId = C.requireBranchId(data);
  const enforce = !!(data && data.enforce);
  const db = admin.firestore();
  await C.requireAdmin(db, context, branchId);

  const net = await C.loadNetwork(db, branchId);
  if (enforce && !net.ips.length) {
    throw new functions.https.HttpsError('failed-precondition',
      'Trust the shop network first — otherwise every worker is locked out.');
  }
  await db.doc(C.pathFor(CONFIG.networkPath, branchId, '')).set({ enforce }, { merge: true });
  return { ok: true, enforce, ips: net.ips };
});

/* Exposed for unit tests. The implementations now live in shop-common.js so the
   device gate and the network gate cannot drift apart. */
exports._internals = {
  ipMatches: C.ipMatches, normalizeIp: C.normalizeIp, ipv4ToInt: C.ipv4ToInt,
  callerIp: C.callerIp, ipChain: C.ipChain, isInfrastructureIp: C.isInfrastructureIp,
};
