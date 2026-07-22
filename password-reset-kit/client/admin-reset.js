/* ============================================================================
   password-reset-kit — client helper (Firebase COMPAT SDK)
   ----------------------------------------------------------------------------
   Calls the adminResetPassword Cloud Function and returns the new password ONCE.
   Store nothing — show it to the admin, they copy it, done.

   Requires (compat SDK, load BEFORE this file):
     firebase-app-compat.js, firebase-auth-compat.js, firebase-functions-compat.js
   and firebase.initializeApp(config) already called, with an admin signed in.

   Usage:
     adminResetPassword('<targetUid>', '<branchId or "">')
       .then(function (pw) { showItOnce(pw); })
       .catch(function (e) { alert(adminResetErrorText(e)); });

   For the Firebase MODULAR (v9+) SDK, see the snippet in ../README.md.
   ========================================================================== */
(function (global) {
  function adminResetPassword(targetUid, branchId) {
    if (!global.firebase || !firebase.functions) {
      return Promise.reject({ code: 'functions/not-loaded' });
    }
    var callable = firebase.functions().httpsCallable('adminResetPassword');
    return callable({ targetUid: targetUid, branchId: branchId || '' })
      .then(function (res) { return (res && res.data && res.data.password) || ''; });
  }

  /* Map the callable's error codes to friendly, human text. */
  function adminResetErrorText(e) {
    var code = (e && e.code) || '';
    if (code.indexOf('unauthenticated') >= 0)  return 'Please sign in first.';
    if (code.indexOf('permission-denied') >= 0) return 'Admins only.';
    if (code.indexOf('not-found') >= 0)         return 'That user is not in this branch — or the reset service isn’t deployed yet.';
    if (code.indexOf('invalid-argument') >= 0)  return 'Missing which user to reset.';
    if (code.indexOf('not-loaded') >= 0)        return 'The reset service isn’t loaded on this page.';
    if (code.indexOf('internal') >= 0)          return 'The reset service isn’t deployed yet — run the deploy step in the kit README.';
    return (e && e.message) || 'Could not reset the password.';
  }

  global.adminResetPassword = adminResetPassword;
  global.adminResetErrorText = adminResetErrorText;
})(typeof window !== 'undefined' ? window : this);
