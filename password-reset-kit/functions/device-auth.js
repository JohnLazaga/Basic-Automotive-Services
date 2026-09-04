/* ============================================================================
   device-auth — "BASIC only opens on a device we enrolled"
   ----------------------------------------------------------------------------
   WHY THIS EXISTS
   The premises gate (shop-session.js) ties access to the shop's internet
   address. That works, but consumer broadband rotates that address, and every
   rotation locks the shop out until an admin re-taps "Trust this network".

   This gate ties access to the DEVICE instead, using WebAuthn — the same
   mechanism behind Face ID / Windows Hello sign-in. At enrolment the iPad
   generates a keypair inside its secure hardware. We store only the PUBLIC key.
   The private key never leaves the device and cannot be exported, copied out of
   devtools, or read from a password manager.

   That is the property this whole exercise was after: a worker who copies her
   saved password out of Chrome and signs in from home cannot produce the
   signature, so she gets no session and reads nothing — no matter what the
   shop's IP address happens to be today.

   TWO THINGS THAT WOULD QUIETLY REOPEN THE HOLE, both closed here:
     1. WebAuthn normally offers "use a phone instead" (a QR / hybrid flow). A
        worker could enrol her own phone while standing in front of you. We pass
        authenticatorAttachment:'platform', so only the built-in authenticator
        of the machine in your hands can answer.
     2. An iPad signed into iCloud syncs its passkeys to the owner's personal
        iPhone — which would hand the key to exactly the person we are gating.
        The authenticator tells us when a credential is backed up (synced), and
        we REFUSE to enrol it, and refuse it later if it becomes synced.
        See rejectSyncedPasskeys.

   SAFE ROLLOUT: dormant until shopnet/network.deviceEnforce === true, and that
   flag cannot be set until at least one device is enrolled.
   ========================================================================== */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const C = require('./shop-common');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const WEBAUTHN = {
  rpName: 'BASIC by JMSI',
  /* The origins the app is really served from. All four branches share one
     origin (.../fairview, .../sudipen), which is why a credential is
     additionally tied to its branch by living under branches/{b}/devices — a
     Sudipen iPad cannot open Fairview's data. */
  allowedOrigins: ['https://basicautomotiveservices.com'],
  allowLocalhost: true,          // dev only; localhost is a secure context
  challengeTtlMs: 5 * 60 * 1000,
  /* Refuse credentials the authenticator reports as backed up / syncable.
     This is what enforces "the shop iPad must not be on a personal Apple ID". */
  rejectSyncedPasskeys: true,
};

/* ---- origin / RP id ------------------------------------------------------
   Read from the request's Origin header, which the browser sets and page script
   cannot forge — never from the callable's payload. */
function checkOrigin(context) {
  const req = (context && context.rawRequest) || {};
  const origin = String((req.headers || {}).origin || '').trim();
  const unreadable = () => new functions.https.HttpsError('failed-precondition', 'Could not read this page address.');
  if (!origin) throw unreadable();
  let host = '';
  try { host = new URL(origin).hostname; } catch (e) { host = ''; }
  if (!host) throw unreadable();
  const ok = WEBAUTHN.allowedOrigins.indexOf(origin) >= 0
          || (WEBAUTHN.allowLocalhost && (host === 'localhost' || host === '127.0.0.1'));
  if (!ok) throw new functions.https.HttpsError('permission-denied', 'This address is not allowed to enrol devices.');
  return { origin, rpID: host };
}

/* ---- challenges ----------------------------------------------------------
   One-shot and short-lived: taken (deleted) the moment it is looked up, so a
   captured challenge cannot be replayed. Stored server-side because the client
   must not be the one remembering what it was asked to sign. */
async function putChallenge(db, branchId, uid, kind, challenge) {
  await db.doc(C.pathFor(C.CONFIG.challengePath, branchId, uid)).set({
    challenge, kind,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + WEBAUTHN.challengeTtlMs),
  });
}
async function takeChallenge(db, branchId, uid, kind) {
  const ref = db.doc(C.pathFor(C.CONFIG.challengePath, branchId, uid));
  const snap = await ref.get();
  const stale = () => new functions.https.HttpsError('failed-precondition', 'That took too long — please try again.');
  if (!snap.exists) throw stale();
  const d = snap.data() || {};
  try { await ref.delete(); } catch (e) { /* one-shot regardless */ }
  const exp = (d.expiresAt && d.expiresAt.toMillis) ? d.expiresAt.toMillis() : 0;
  if (!d.challenge || d.kind !== kind || exp < Date.now()) throw stale();
  return d.challenge;
}

/* ---- device records ------------------------------------------------------ */
async function loadDevices(db, branchId) {
  const snap = await db.collection(C.pathFor(C.CONFIG.devicesColl, branchId, '')).get();
  return snap.docs.map((doc) => Object.assign({ id: doc.id }, doc.data() || {}));
}
async function activeDevices(db, branchId) {
  return (await loadDevices(db, branchId)).filter((d) => d.active !== false && d.credId);
}
/* What the Settings screen is allowed to see — never the stored key material. */
function publicDevice(d) {
  return {
    id: d.id, label: d.label || 'Shop device', active: d.active !== false,
    deviceType: d.deviceType || '', backedUp: !!d.backedUp,
    enrolledAt: (d.enrolledAt && d.enrolledAt.toMillis) ? d.enrolledAt.toMillis() : null,
    lastSeenAt: (d.lastSeenAt && d.lastSeenAt.toMillis) ? d.lastSeenAt.toMillis() : null,
  };
}

/* ============================================================================
   beginDeviceEnroll / finishDeviceEnroll — admin, standing at the shop with the
   device in hand. Two calls because WebAuthn is challenge/response: we hand out
   a challenge, the hardware signs it, we verify the signature.
   ========================================================================== */
exports.beginDeviceEnroll = functions.https.onCall(async (data, context) => {
  const branchId = C.requireBranchId(data);
  const db = admin.firestore();
  await C.requireAdmin(db, context, branchId);
  const { rpID } = checkOrigin(context);

  const label = String((data && data.label) || '').trim().slice(0, 60) || 'Shop device';
  const existing = await activeDevices(db, branchId);
  const deviceId = crypto.randomUUID();

  const options = await generateRegistrationOptions({
    rpName: WEBAUTHN.rpName,
    rpID,
    userName: label,
    userDisplayName: label,
    userID: Buffer.from(deviceId, 'utf8'),
    attestationType: 'none',
    timeout: 120000,
    /* Stops the same device being enrolled twice under two names. */
    excludeCredentials: existing.map((d) => ({ id: d.credId, transports: d.transports || undefined })),
    authenticatorSelection: {
      /* 'platform' = the built-in Face ID / Touch ID / Windows Hello of THIS
         machine. Without it the browser offers "use a phone instead", which
         would let a worker enrol her own handset. */
      authenticatorAttachment: 'platform',
      residentKey: 'discouraged',
      requireResidentKey: false,
      userVerification: 'required',
    },
  });
  await putChallenge(db, branchId, context.auth.uid, 'enroll', options.challenge);
  return { ok: true, deviceId, options };
});

exports.finishDeviceEnroll = functions.https.onCall(async (data, context) => {
  const branchId = C.requireBranchId(data);
  const db = admin.firestore();
  const caller = await C.requireAdmin(db, context, branchId);
  const { origin, rpID } = checkOrigin(context);

  const deviceId = String((data && data.deviceId) || '').trim();
  const response = data && data.response;
  if (!deviceId || !response) throw new functions.https.HttpsError('invalid-argument', 'deviceId and response are required.');
  const label = String((data && data.label) || '').trim().slice(0, 60) || 'Shop device';

  const expectedChallenge = await takeChallenge(db, branchId, context.auth.uid, 'enroll');
  let v;
  try {
    v = await verifyRegistrationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    throw new functions.https.HttpsError('invalid-argument', 'Could not enrol this device: ' + ((e && e.message) || ''));
  }
  if (!v.verified || !v.registrationInfo) {
    throw new functions.https.HttpsError('invalid-argument', 'Could not enrol this device.');
  }
  const info = v.registrationInfo;

  /* The iCloud check. 'multiDevice' / backed-up means this passkey syncs to the
     Apple ID's other devices — i.e. straight to somebody's personal phone. */
  if (WEBAUTHN.rejectSyncedPasskeys && (info.credentialBackedUp || info.credentialDeviceType === 'multiDevice')) {
    throw new functions.https.HttpsError('failed-precondition', 'synced-passkey');
  }

  const cred = info.credential;
  await db.doc(C.pathFor(C.CONFIG.devicePath, branchId, deviceId)).set({
    label,
    credId: cred.id,
    publicKey: Buffer.from(cred.publicKey).toString('base64'),
    counter: Number(cred.counter) || 0,
    transports: cred.transports || [],
    deviceType: info.credentialDeviceType || '',
    backedUp: !!info.credentialBackedUp,
    active: true,
    enrolledBy: caller.uid,
    enrolledAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const devices = (await loadDevices(db, branchId)).map(publicDevice);
  return { ok: true, deviceId, label, devices };
});

/* ============================================================================
   deviceChallenge / verifyDeviceAssertion — used BY shop-session.js when a
   worker signs in. Not callables of their own: a device proof is only ever
   worth anything as part of issuing a session.
   ========================================================================== */
async function deviceChallenge(db, branchId, uid, context) {
  const { rpID } = checkOrigin(context);
  const devices = await activeDevices(db, branchId);
  if (!devices.length) {
    /* Should be unreachable — setDeviceEnforcement refuses to switch on with no
       devices — but never hand out an empty allowCredentials list, which would
       invite ANY passkey on the machine to answer. */
    throw new functions.https.HttpsError('failed-precondition', 'No device is enrolled for this branch.');
  }
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: 120000,
    userVerification: 'required',
    allowCredentials: devices.map((d) => ({ id: d.credId, transports: d.transports || undefined })),
  });
  await putChallenge(db, branchId, uid, 'auth', options.challenge);
  return options;
}

async function verifyDeviceAssertion(db, branchId, uid, response, context) {
  const { origin, rpID } = checkOrigin(context);
  const expectedChallenge = await takeChallenge(db, branchId, uid, 'auth');
  const devices = await activeDevices(db, branchId);
  const dev = devices.filter((d) => d.credId === (response && response.id))[0];
  const refuse = () => new functions.https.HttpsError('permission-denied', 'unknown-device');
  if (!dev) throw refuse();

  let v;
  try {
    v = await verifyAuthenticationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: dev.credId,
        publicKey: Buffer.from(String(dev.publicKey || ''), 'base64'),
        counter: Number(dev.counter) || 0,
        transports: dev.transports || undefined,
      },
    });
  } catch (e) {
    throw refuse();
  }
  if (!v.verified) throw refuse();

  /* An iPad that was clean at enrolment can be signed into iCloud later, which
     starts syncing the passkey. Catch that on the way in, and park the device
     so an admin sees why it stopped working. */
  if (WEBAUTHN.rejectSyncedPasskeys && v.authenticationInfo.credentialBackedUp) {
    try {
      await db.doc(C.pathFor(C.CONFIG.devicePath, branchId, dev.id))
        .set({ backedUp: true, active: false, deactivatedReason: 'synced-passkey' }, { merge: true });
    } catch (e) { /* non-fatal */ }
    throw new functions.https.HttpsError('permission-denied', 'synced-passkey');
  }

  try {
    await db.doc(C.pathFor(C.CONFIG.devicePath, branchId, dev.id)).set({
      counter: Number(v.authenticationInfo.newCounter) || 0,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUid: uid,
    }, { merge: true });
  } catch (e) { /* non-fatal: the proof already stands */ }
  return dev;
}

/* ---- forgetDevice — retire a lost, sold or reset device ------------------ */
exports.forgetDevice = functions.https.onCall(async (data, context) => {
  const branchId = C.requireBranchId(data);
  const deviceId = String((data && data.deviceId) || '').trim();
  if (!deviceId) throw new functions.https.HttpsError('invalid-argument', 'deviceId is required.');
  const db = admin.firestore();
  await C.requireAdmin(db, context, branchId);

  await db.doc(C.pathFor(C.CONFIG.devicePath, branchId, deviceId)).delete();
  const left = await activeDevices(db, branchId);
  /* Removing the last device while enforcing would lock out every non-admin,
     so enforcement is switched off with it. */
  if (!left.length) {
    await db.doc(C.pathFor(C.CONFIG.networkPath, branchId, '')).set({ deviceEnforce: false }, { merge: true });
  }
  const devices = (await loadDevices(db, branchId)).map(publicDevice);
  return { ok: true, devices, deviceEnforce: left.length > 0 };
});

/* ---- setDeviceEnforcement — turn the device gate on or off --------------- */
exports.setDeviceEnforcement = functions.https.onCall(async (data, context) => {
  const branchId = C.requireBranchId(data);
  const enforce = !!(data && data.enforce);
  const db = admin.firestore();
  await C.requireAdmin(db, context, branchId);

  if (enforce) {
    const devices = await activeDevices(db, branchId);
    if (!devices.length) {
      throw new functions.https.HttpsError('failed-precondition',
        'Enrol a shop device first — otherwise every worker is locked out.');
    }
  }
  await db.doc(C.pathFor(C.CONFIG.networkPath, branchId, '')).set({ deviceEnforce: enforce }, { merge: true });
  return { ok: true, deviceEnforce: enforce };
});

/* Used by shop-session.js, and exposed for unit tests. */
exports._device = {
  deviceChallenge, verifyDeviceAssertion, loadDevices, activeDevices,
  publicDevice, checkOrigin, putChallenge, takeChallenge, WEBAUTHN,
};
