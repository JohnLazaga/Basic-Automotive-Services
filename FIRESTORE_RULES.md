# Firestore rules (cloud branches)

`firestore.rules` in this repo **is** the live ruleset. It is deployed with the
Firebase CLI and covers all four cloud branches (Fairview, Commonwealth,
Sudipen, Sandbox). Local mini-PC branches don't use Firestore at all — the
branch server enforces everything itself.

## How rules get deployed — read this before editing anything

```
firebase deploy --only firestore:rules --project basic-automotive-services
```

`firebase.json` declares `"firestore": { "rules": "firestore.rules" }`, so that
command uploads **this repo's file** and replaces whatever is live.

> **Do not edit rules in the Firebase console.** This project used to work that
> way, and the instructions here used to say so. It no longer does. A console
> edit survives only until the next CLI deploy, then vanishes without warning.
> Change `firestore.rules`, commit it, deploy it.

Deploying from this machine needs the working CLI (the bundled
`tools/firebase.exe` is broken — it crashes on startup with a JSON parse error):

```powershell
$env:USERPROFILE="C:\fbcli-home"; $env:HOME="C:\fbcli-home"
& "C:\node20\node-v20.18.2-win-x64\firebase.cmd" deploy --only firestore:rules --project basic-automotive-services
```

`C:\fbcli-home` is where the owner account's login is cached. The CLI compiles
the rules before releasing them, so a syntax error fails the deploy rather than
breaking the live site.

Every release is kept in the console under **Firestore → Rules → history**, so a
bad deploy can be rolled back there.

## What the rules enforce

**Tenant isolation.** Everything lives under `branches/{b}/…`. You are a member
of a branch only if `branches/{b}/users/{uid}` exists and `active != false`.
One branch's data is completely walled off from another's. The owner email
(`johnlazaga1980@yahoo.com`) is a super-admin everywhere.

**The premises gate.** Members also need to be *on the shop's network* — see
below.

**Collections clients may never write:**

| Path | Who writes it |
| --- | --- |
| `branches/{b}/sessions/{uid}` | `startShopSession` only (Admin SDK) |
| `branches/{b}/shopnet/network` | `trustThisNetwork` / `setEnforcement` only |
| `branches/{b}` (the branch doc) | owner only |

If a client could write either of the first two, the premises gate would be
worthless — a worker would simply grant himself a session, or add his home
address to the trusted list.

## Public write surface: `appt_requests`

`branches/{b}/appt_requests` is the **only** collection an unauthenticated
stranger can write to. Customers create booking requests there with no login;
staff read, accept and dismiss them. It is therefore the shop's entire public
attack surface, and it is deliberately *not* premises-gated — customers are off
the shop network by definition.

**Phase 1 (done).** Every accepted key is listed in a `hasOnly` clause and
individually size-capped. Before this, three fields were validated and anything
else was waved through, so a stranger could attach arbitrary extra fields up to
the 1 MB document limit. The ceiling is now ~1.4 KB of field data per request.

Accepted keys: `name` (required, 1–119), `contact` (required, 1–59),
`status` (required, must equal `'new'`), `notes` (<1000), `source` (<24),
`plate` (<24), `vehicle` (<120), `vehicleId` (<64), `preferredDate` (≤10),
`createdAt` (≤32).

**If you add a field to the booking form, add it here too or the write is
rejected.** The portal sends exactly these ten keys today.

### Phase 2 — App Check, before any public website links to this

Rules **cannot rate-limit**. Phase 1 bounds how big each junk request can be, not
how many arrive. A public booking page on the marketing site advertises this
endpoint, and a script could flood it — every junk request pops a modal on every
staff device and costs a Firestore write.

The fix is [App Check](https://firebase.google.com/docs/app-check) with
reCAPTCHA v3, which is a **two-phase rollout — do not skip the order**:

1. Register the site in the Firebase console, add the App Check SDK to the staff
   app *and* the customer portal *and* the website, and deploy all of them.
   Watch the App Check metrics until verified requests are ~100%.
2. Only then require it in the rule, by adding as the first condition:

   ```
   allow create: if request.app != null
                 && request.resource.data.keys().hasOnly([...
   ```

Adding step 2 before step 1 rejects every existing client at once — the staff
apps included, since the same rules file governs them. There is no staged
rollout inside rules; it flips for everyone the moment you deploy.

## The premises gate (shop-network lock)

Being signed in is not enough. A non-admin also needs a live session document at
`branches/{b}/sessions/{uid}`, which only the Cloud Function issues, and only
when the request arrives from one of the branch's trusted networks.

Why it exists: we used to hand each worker a random password the browser saved
so he never had to know it. That does not restrict *where* the app opens — any
saved password can be revealed from the browser's password manager or synced to
a personal phone. Location has to be checked on the server.

**It is dormant until you switch it on.** With `shopnet/network.enforce` unset or
false, `activeMember()` behaves exactly like the old `memberOf()`. Deploying the
rules therefore changes nothing until an admin enables the gate.

### Turning it on, per branch

1. Stand in the shop, on the shop WiFi, on any device.
2. Sign in as an **admin** (the card is hidden for non-admins).
3. **Settings → Shop network → ＋ Trust this network.** Confirm an address
   appears — that's the branch's public IP.
4. **Turn enforcement ON.**

Admins and the owner are exempt and keep working from home. That also means
anyone you promote to admin gains standing off-site access; if you don't want
that, promote them, have them tap the button, then demote them — the trusted
network stays.

Consumer broadband rotates public IPs. When staff report *"BASIC can only be
opened at the shop"* **while standing in the shop**, that's the address having
changed: tap **Trust this network** again. If it happens often, switch the entry
to a `/24` block or ask for device enrollment instead.

Sessions last 3 hours and renew every 20 minutes while the app is open on a
trusted network, so an on-site device never notices. A device that leaves keeps
working until its session runs out, then stops.

## Customer QR portal PIN

Staff set a vehicle's PIN in the app; a **hash** of it (never the PIN) rides
along in `portal/<id>.pinHash`, and the portal checks it client-side.

On first scan with no PIN, the customer's chosen PIN is written to
`portal_claims` (anonymous create-only). A signed-in staff device picks it up,
records it on the vehicle so staff can view it, republishes the hash, and
deletes the claim. Until a staff device is online to process it, the portal
isn't locked yet.

**The `portal_claims` rule is already deployed** — it's in `firestore.rules`.
There is nothing to paste. To use the feature you only flip the app toggle:

- Sign in as admin → **Settings → Customer QR portal** → tick **"Require a PIN
  to open portals"** → Save.
- **Settings → Publish all portals** once, so existing vehicles get a `pinHash`
  where a PIN is already set.

To test: add a throwaway vehicle, open its QR link in an incognito window → you
should get **"Create a PIN"** → set one → the record shows. Confirm the PIN then
appears on the vehicle in the app. Reopen the link → **"Enter your PIN"**; a
wrong PIN is rejected. Untick the toggle to return the portal to fully open.

### What this PIN does and does not protect

Be clear-eyed about it — the PIN is a **courtesy lock on the UI, not a secret**:

- `portal/{doc}` is `allow read: if true`, and the published snapshot carries the
  owner's name, contact number, plate, full service history, amounts and TIN.
  Anyone who knows a vehicle ID can read all of it straight from Firestore
  without touching the PIN.
- `pinHash` is `SHA-256(vehicleId + ':' + pin)` over 4–6 digits — at most a
  million candidates, crackable in under a second, with the salt published
  beside it.
- `portal_claims` accepts an anonymous claim for **any** vehicle ID, so a
  stranger can set the PIN on any vehicle that hasn't been claimed yet.

The robust fix is to move the portal behind a callable function that verifies the
PIN server-side and returns the payload, leaving only
`{ state: 'locked' | 'claim' }` publicly readable — which is exactly what the
local branch server already does (`branch-server/server.js`, `/portal/:id/verify`).
Until that's done, treat the cloud portal as public information.

## Gotcha: keep `meta` reads document-scoped

Rules for a **listened collection** cannot carry per-document-id conditions. A
collection listen is a `list`, and a `list` can't satisfy `doc != 'shop'` — so
the moment anything subscribes to `branches/{b}/meta` as a collection, that
condition has to come out of the rule and live sync breaks without it.

This matters because Firestore **ORs all matching rules together**. A broad
`match /meta/{doc}` grant overrides the narrower admin-only rule on `meta/shop`
sitting right above it, and every member gets to rewrite shop settings — BIR
details, VAT rate, commission rate, portal config.

So `part11_cloud.js` watches **`meta/shop` and `meta/counters` as two document
listeners**, never the collection, which is what lets `match /meta/{doc}` carry
`&& doc != 'shop'`. If you ever replace those with a collection listener you
silently reopen the hole. The same constraint is why the trusted-network list
lives in its own `shopnet` collection rather than as another `meta` document.
