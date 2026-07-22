# password-reset-kit

A tiny, reusable piece you can drop into **any Firebase app**: an admin clicks a
button, the app resets a chosen user's password to a **fresh random value**, shows
it **once**, and **stores nothing**. No plaintext passwords are ever kept.

It solves a real Firebase limitation: the client SDK **cannot** set another user's
password — only the Admin SDK (server-side) can. So this ships a small callable
**Cloud Function** plus a one-file **client helper**.

```
password-reset-kit/
├── functions/
│   ├── index.js        ← the callable Cloud Function (edit CONFIG at the top)
│   ├── package.json
│   └── .gitignore
├── client/
│   └── admin-reset.js  ← browser helper (Firebase COMPAT SDK)
└── README.md
```

## What it does (and doesn't)
- ✅ Admin resets **anyone's** password without knowing the old one.
- ✅ New password returned **once** to the admin — never written to a database.
- ✅ On reset it also **deletes any legacy plaintext `password` field** on the user's
  record and stamps `passwordResetAt` / `passwordResetBy` for an audit trail.
- ✅ Multi-tenant safe (caller and target must be in the same branch/tenant).
- ❌ Does not store, email, or SMS the password — you copy it and type it in once.

## Security model
- The function runs with the project's **default service account** — no key file.
- It authorizes the caller as an admin **server-side** two ways: a super-admin
  **owner email**, or an **admin flag** on the caller's directory doc. A normal user
  calling the endpoint directly is rejected with `permission-denied`.
- Because nothing is persisted, there's no plaintext-password liability to guard.

---

## Setup (about 5 minutes, one time per app)

You need the **Firebase CLI** and the app on the **Blaze** plan (Cloud Functions
require it). Do this from the app's project folder.

**1. Edit `functions/index.js` → `CONFIG`:**
```js
ownerEmails: ['you@example.com'],           // your super-admin sign-in email(s)
userDocPath: 'branches/{b}/users/{uid}',    // where a user's record lives
                                            //   single-tenant? use 'users/{uid}'
adminField:  'isAdmin',                     // truthy on that doc == admin
requireSameBranch: true,                    // multi-tenant safety
passwordStyle: 'memorable',                 // or 'strong'
```

**2. Point Firebase at the functions folder.** In your app's `firebase.json`:
```json
{ "functions": { "source": "password-reset-kit/functions" } }
```
(If you keep functions elsewhere, copy `functions/` there and set `source` to it.)

**3. Install + deploy** (run in the app folder):
```bash
npm --prefix password-reset-kit/functions install
firebase login          # one time, opens a browser
firebase deploy --only functions:adminResetPassword
```
That's it — the endpoint is live. Redeploy only when you change `index.js`.

---

## Use it from the browser

**Compat SDK (what this app uses).** Load these on the page, then the helper:
```html
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js"></script>
<script src="password-reset-kit/client/admin-reset.js"></script>
```
```js
adminResetPassword(targetUid, branchId /* or '' */)
  .then(function (pw) { /* show pw ONCE, offer Copy, save nothing */ })
  .catch(function (e) { alert(adminResetErrorText(e)); });
```

**Modular SDK (v9+)**, if another app uses it:
```js
import { getFunctions, httpsCallable } from 'firebase/functions';
const call = httpsCallable(getFunctions(), 'adminResetPassword');
const { data } = await call({ targetUid, branchId });
const pw = data.password;   // show once
```

---

## Notes
- **Region:** defaults to `us-central1`. To pin another, set it in `index.js`
  (`functions.region('asia-southeast1').https.onCall(...)`) **and** on the client
  (`firebase.app().functions('asia-southeast1')`).
- **Cost:** a handful of password resets a month is effectively free on Blaze.
- **Rotate on exit:** when someone leaves, reset their password (kills their saved
  login) or disable their account — no need to ever look a password up.
