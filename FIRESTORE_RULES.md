# Firestore rules — customer portal PIN (cloud / main site)

The QR-portal PIN is **off by default** on the cloud site. To turn it on you add
**one** rule (a `portal_claims` collection that anonymous customers may write to,
exactly like the existing `appt_requests` pattern), then flip a toggle in the app.
Until you do this, the cloud portal behaves exactly as it does today (open).

## How it works (cloud)
- Staff set/edit a vehicle's PIN in the app; a **hash** of it (never the PIN) is
  written to `portal/<id>.pinHash`. The customer portal checks the PIN
  **client-side** against that hash — lightweight protection for read-only
  history (a determined person could brute-force a 4–6 digit hash, so treat it as
  a courtesy lock, not a secret).
- **Customer self-claim:** on first scan with no PIN, the customer's chosen PIN is
  written to `portal_claims` (create-only, anonymous). A signed-in staff device
  picks it up, records it on the vehicle (so staff can view it), republishes the
  hash, and deletes the claim. Until a staff device is online to process it, the
  portal isn't yet locked — fine for a shop with staff signed in daily.

> Local (mini-PC) branches don't use any of this — they gate the PIN on the
> server and always require it. This file is only for the cloud/main site.

## 1. Add the rule
In the Firebase console → **Firestore → Rules**, add this block **inside**
`match /databases/{database}/documents { … }`, alongside your existing rules
(do not remove anything already there):

```
// Customer portal PIN claims — anonymous create only, staff read/delete.
match /portal_claims/{claim} {
  allow create: if request.resource.data.keys().hasOnly(['vehicleId','pin','ts'])
                && request.resource.data.pin is string
                && request.resource.data.pin.size() >= 4
                && request.resource.data.pin.size() <= 6;
  allow read, delete: if request.auth != null;   // signed-in staff only
  allow update: if false;
}
```

Your existing `portal` collection stays public-read (it already is) — the
`pinHash` field rides along in that doc; no rule change needed there.

**Publish** the rules.

## 2. Turn it on in the app
- Sign in as an admin → **Settings → Customer QR portal** →
  check **"Require a PIN to open portals"** → Save.
- Re-publish existing vehicles once (**Settings → Publish all portals**) so their
  docs get a `pinHash` where a PIN is already set.

## 3. Test on a throwaway vehicle
- Add a test vehicle, open its QR link in an incognito window → you should get
  **"Create a PIN"** → set one → record shows.
- Confirm the PIN appears on the vehicle in the app (after a staff device
  processes the claim — usually within a second while signed in).
- Reopen the QR link → **"Enter your PIN"**; wrong PIN is rejected, correct shows
  the record.
- Untick the toggle to return the cloud portal to fully open.

## Note
This client-side check is the honest limit of a serverless (Firestore) portal.
The **robust** version is the local-branch model (server-verified PIN, staff view
of customer-set PINs) — migrating `main` to a local branch makes this file moot.
