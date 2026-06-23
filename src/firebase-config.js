/* ============================================================================
   Firebase configuration + cloud feature flag.
   The apiKey is a PUBLIC client identifier (not a secret) — access is controlled
   by Firebase Auth + Firestore Security Rules, not by hiding this value.
   ========================================================================== */
var CLOUD_ENABLED = true;   /* cloud branch: on. (main branch keeps this off / absent) */

var FIREBASE_CONFIG = {
  apiKey: "AIzaSyBrgR-4Tkp6juJAKhcurfXWERMy5nI73FA",
  authDomain: "basic-automotive-services.firebaseapp.com",
  projectId: "basic-automotive-services",
  storageBucket: "basic-automotive-services.firebasestorage.app",
  messagingSenderId: "990774465290",
  appId: "1:990774465290:web:392e9a649ded875a2c60f3"
};
