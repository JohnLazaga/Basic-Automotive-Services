# Basic by JMSI — Shared Cloud Database Plan

Goal: turn the app from per-browser local storage into a **shared, real-time cloud
database** with **individual staff logins** and an **Admin** role that controls
restricted areas — while keeping it a static site deployed via GitHub Pages
(no server to run).

Owner / first Admin: **johnlazaga1980@yahoo.com**

---

## 1. Backend choice — Firebase (Firestore + Auth + Storage)

Chosen because it fits the app as built:
- **Document-shaped** records (jobs, vehicles…) map 1:1 to Firestore documents → minimal rewrite.
- **Real-time** listeners → changes appear on every device instantly.
- **Offline-first** → caches locally, auto-syncs on reconnect (matters for spotty internet/power).
- **Static-friendly** → loads from CDN, talks to Google directly; still hosts on GitHub Pages.
- **Free tier** (~50K reads / 20K writes per day, 1 GB data, 5 GB file storage) — ample for one shop.

Alternatives considered: Supabase (Postgres/SQL, offline needs custom work); on-prem on the
shop's existing SQL Server (no monthly cost but LAN-only unless hosted). Firestore chosen.

---

## 2. Architecture

```
   Shop PC ─┐
   Phone   ─┼─►  Firestore (cloud)  ◄── real-time sync ──►  all devices
   Laptop  ─┘        ▲
                     │  app code still served by GitHub Pages (unchanged)
            Firebase Auth (staff login) + Storage (photos)
```

UI and business logic stay the same. Only the **data layer** changes: instead of
`persist()` writing one big JSON blob to local storage, each record reads/writes its
own cloud document. A local-storage fallback stays during migration so nothing breaks.

---

## 3. Data model mapping

Each state array → a Firestore **collection**, one document per record (existing `id`s kept):

`staff · bays · parts · labor · vehicles · estimates · jobs · appointments · purchaseOrders`
plus a `meta` collection for **shop settings**, **counters**, and **permissions**.

Refinements:
- **Counters (OR / JO / EST / PO numbers)** → server-side **atomic increments** in a
  transaction so two devices never produce the same OR number (critical for BIR receipts).
- **Photos** → move from base64-in-record to **Firebase Storage**; store only the URL in the
  job. Keeps documents small and sync fast.
- Each record carries `updatedAt` for conflict handling.

---

## 4. Concurrency, offline & security

- **Last-write-wins per record** (per-record edits, not whole-DB) — fine for a small shop.
- **Offline:** writes queue locally and flush on reconnect (built into Firestore).
- **Security enforced in two layers:**
  1. *App/UX* — users only see what their role allows (restricted nav, buttons, sensitive
     columns like part cost/margin hidden).
  2. *Firestore Security Rules (the real lock)* — the server checks the user's role before any
     read/write. Roles live in the `users` collection; **only Admin can change roles**
     (no self-promotion). No server code required — rules use `get()` lookups.

---

## 5. Accounts & roles

- Every staff member gets their **own** Firebase Auth login (email + password) → individual
  accountability (every status update / billing / discount is traceable to a person).
- Each login links to a `users/{uid}` doc holding **role** + **isAdmin**.
- Roles reuse the app's existing set — **SV, SA, SM, Mechanic, Parts Salesman** — plus
  **Admin** (owner/manager; can be more than one).

### Account management (Admin)
- **Add staff in-app:** name, role, email → creates the login + a temp password to change on
  first sign-in (done via a secondary auth instance so the Admin isn't logged out).
- **Password resets:** built-in "Forgot password" email; no Admin needed.
- **Deactivate** instantly revokes access.
- **First Admin bootstrap:** flagged once in the Firebase console during setup
  (johnlazaga1980@yahoo.com); everyone else is managed in-app afterward.

---

## 6. Default permission matrix (Admin-editable in-app)

Day-to-day ops open to all; money / payroll / config locked down.

| Area / action | Admin | SV | SA | SM | Mechanic | Parts |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Board, job orders, status log, check-in, photos | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Appointments | ✓ | ✓ | ✓ | – | – | – |
| Estimates (create/approve) | ✓ | ✓ | ✓ | ✓ | – | – |
| See prices / running bill | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| Part cost & margin | ✓ | ✓ | – | – | – | – |
| Apply discounts | ✓ | ✓ | – | – | – | – |
| Final billing / assign OR # | ✓ | ✓ | ✓ | – | – | – |
| Receivables (A/R) | ✓ | ✓ | ✓ | – | – | – |
| Reports / Daily Close | ✓ | ✓ | – | – | – | – |
| Productivity & commissions (payroll) | ✓ | – | – | – | – | – |
| Parts / PO management | ✓ | ✓ | – | – | – | ✓ |
| Staff management | ✓ | – | – | – | – | – |
| Settings (shop/BIR/portal/API) | ✓ | – | – | – | – | – |
| Delete records / Clear all data | ✓ | – | – | – | – | – |

An Admin-only **Roles & Permissions** screen lets the Admin toggle any cell without code.

---

## 7. Migration phases

1. **Provision Firebase** — create project, Web app config, enable Auth (Email/Password),
   Firestore, Storage; bootstrap first Admin. *(Walkthrough; ~30 min.)*
2. **Data layer** — `Db` module (load-all, upsert-record, delete-record); swap ~50 save
   points from `persist()` to per-record cloud writes; keep local-storage fallback.
3. **Real-time + counters** — live listeners update every device; atomic OR/JO counters.
4. **Auth & RBAC** — login screen, roles, permission matrix, Firestore rules, Admin
   "Roles & Permissions" + "Staff accounts" screens.
5. **Photos → Storage + one-time migration** — in-app "Upload local data to cloud" button
   (pushes current local-storage data + photos up once).
6. **Test & harden** — multi-device, offline, OR-number race, permission tests.

Estimated effort: ~3–5 focused sessions. App keeps working throughout.

---

## 8. Region & cost

- **Region:** `asia-southeast1` (Singapore) — closest low-latency to the Philippines. Firestore
  location is **permanent once set** — choose at creation.
- **Cost:** free tier covers a single shop comfortably. Photos in Storage (5 GB free).

---

## 9. What's needed from the owner

- Google account: **johnlazaga1980@yahoo.com** (create one on this email if it isn't a Google
  account yet, or use a Gmail).
- First Admin email: **johnlazaga1980@yahoo.com** (bootstrapped with full access).
- The `firebaseConfig` keys from the new project (public client keys — safe to embed; security
  is enforced by rules, not by hiding them).

## 10. Notes

- Firebase web `apiKey` is **not a secret** — it identifies the project. Access is controlled by
  Auth + Security Rules. Embedding it in the static app is normal and expected.
- During build we may start Firestore in **test mode** (no real data yet); strict rules are
  applied in Phase 4 **before** real shop data goes in.
