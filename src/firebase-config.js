/* ============================================================================
   Firebase configuration + cloud feature flag.
   The apiKey is a PUBLIC client identifier (not a secret) — access is controlled
   by Firebase Auth + Firestore Security Rules, not by hiding this value.
   ========================================================================== */
var CLOUD_ENABLED = true;   /* cloud branch: on. (main branch keeps this off / absent) */

/* ---- App Check (reCAPTCHA v3) ----------------------------------------------
   appt_requests is the one collection an unauthenticated stranger can write to.
   Security rules bound how BIG each request can be, but rules cannot rate-limit,
   so a public booking form on the marketing site can be flooded. App Check is
   what closes that, by attesting the write came from a real browser on a real
   page rather than a script.

   Like the apiKey above, a reCAPTCHA v3 SITE key is a public client identifier —
   the paired secret lives in the Firebase console, never here.

   Empty string = App Check stays OFF and the app behaves exactly as before.
   That is deliberate: enforcement must reach every client BEFORE the rules start
   requiring it, or every device breaks at once. Rollout order is written up in
   FIRESTORE_RULES.md, "Phase 2". */
var APPCHECK_SITE_KEY = '';

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyBrgR-4Tkp6juJAKhcurfXWERMy5nI73FA",
  authDomain: "basic-automotive-services.firebaseapp.com",
  projectId: "basic-automotive-services",
  storageBucket: "basic-automotive-services.firebasestorage.app",
  messagingSenderId: "990774465290",
  appId: "1:990774465290:web:392e9a649ded875a2c60f3"
};
