# Standing up a new branch

Each branch is a self-contained unit: an always-on **mini-PC** on the shop LAN
serves both the app and its parts catalog (pulled from that branch's SQL
Server). It works offline; the internet is only needed for the public URL and
customer QR portals.

Result per branch:
- **Local staff URL** — `http://<slug>.basic.local` (offline, on the LAN)
- **Public staff URL / customer portal** — `https://<slug>.basicautomotiveservices.com`

---

## 1. Register the branch
Add an entry to `branches.json` (copy the `cebu` example). Pick a short `slug`:

```json
"davao": {
  "id": "davao", "slug": "davao", "name": "Basic by JMSI — Davao",
  "localUrl": "http://davao.basic.local",
  "publicUrl": "https://davao.basicautomotiveservices.com",
  "partsUrl": "http://davao.basic.local:8790",
  "partsSource": "local"
}
```

## 2. Build that branch's app
```
node build.js --branch=davao
```
Produces `dist/davao/index.html` with that branch's URLs baked in.

## 3. Prepare the mini-PC
1. Install [Node.js](https://nodejs.org) (LTS).
2. Put the repo on the PC. Easiest is `git clone` (lets you one-click update
   later); otherwise copy the `branch-server/` and `dist/<slug>/` folders.
3. In `branch-server/`, copy **`branch.config.example.cmd`** to
   **`branch.config.cmd`** and set `SLUG`, `BRANCH`, `PORT` for this branch.
4. Double-click **`start.cmd`** — it serves the app **and** parts on the port,
   in its own window (logs to `server.log`).
5. **Auto-start on boot:** add a Task Scheduler task ("At startup") that runs
   `branch-server\start.cmd`, or install NSSM / pm2 pointing at `server.js`.

## 4. Give the mini-PC its LAN name
So staff can type `http://davao.basic.local` instead of an IP:
- Assign the mini-PC a **static LAN IP** in the router, and
- add a DNS entry `davao.basic.local → that IP` on the router, **or** enable
  mDNS/Bonjour and use the PC's `<hostname>.local`.
- (Optional) run the server on port 80 so no `:8790` is needed in the URL.

## 4b. First sign-in (local staff accounts)
On first start the server creates a default admin: **username `admin`, password
`admin`**. Sign in with it, then **Accounts & Roles → change the password**
immediately and add each staff member their own login (username + password +
role). Accounts, passwords (hashed), and sessions all live on the mini-PC — no
internet needed. Non-admins are limited by the role permission matrix, enforced
both in the UI and on the server.

## 5. Attach the parts database (in the app) — the easy part
1. Open the app on the LAN and sign in as an Admin.
2. **Settings → Parts catalog — SQL Server.** Fields are pre-filled for JMSI
   (`localhost\MSSQLSERVER01`, `jasRegaladoDB`, Windows auth, the standard query).
3. Click **Test connection** → confirm the row count + sample.
4. Click **Attach & sync** → the branch server pulls the full catalog and keeps
   a local snapshot. SKU lookups are now instant and offline.
5. Re-sync anytime with **Re-sync now** (or on a schedule — see below).

> The app never touches SQL directly. It sends the connection to the branch
> server, which connects with the same .NET SqlClient your `export-sql.ps1` uses.
> For SQL logins instead of Windows auth, choose "SQL login" and enter user/password.

## 6. Public URL (Cloudflare Tunnel)
Gives `https://<slug>.basicautomotiveservices.com` with HTTPS and **no router
port-forwarding**. Full walkthrough — including the important note about your
live domain's DNS and a zero-risk Quick-Tunnel option for piloting — is in
**[TUNNEL_SETUP.md](TUNNEL_SETUP.md)**.

Staff on the LAN keep using the fast offline `http://<mini-pc-ip>:8790/`; remote
staff use the public URL. (Customer QR portals over a local branch need one small
add-on — see the note at the end of TUNNEL_SETUP.md.)

## Cutover: move a live (cloud) branch onto its mini-PC
1. In the **current cloud app**: Settings → **Export JSON backup** (downloads the
   full shop state).
2. Set this branch's `dataSource` **and** `partsSource` to `"local"` in
   `branches.json`; `node build.js --branch=<slug>`; deploy `dist/<slug>/` +
   `branch-server/` to the mini-PC (see steps 3–4 above) and `start.cmd`.
3. Sign in `admin`/`admin` (then change it). Settings → **Import JSON backup to
   this branch** → pick the file. This replaces the branch server's data with
   your real data. Job **photos** upload to the mini-PC (`branch-server/photos/`)
   on the next save; the record keeps only the URL.
4. Settings → **Parts catalog — SQL Server** → Test → Attach (step 5 below).
5. Verify on two devices (live sync, OR numbers, prices), then retire the cloud
   for that branch.

## Updating a branch (push app / server changes)
You keep developing on your machine; branches run independently. To roll a new
version to a branch's mini-PC:

- **Online (recommended):** double-click **`branch-server\update.cmd`**. It
  `git pull`s the latest, rebuilds this branch's app (`build.js --branch=<slug>`),
  and restarts the server. Open browsers then show a **"reload to update"**
  prompt automatically (the running app polls `version.txt`).
- **Offline:** copy the new `branch-server/` and/or `dist/<slug>/` files over
  (USB / LAN / remote), then run **`update.cmd --offline`** — it just restarts
  with the already-copied files (no pull, no build).

Helpers: `start.cmd` / `stop.cmd` control the server on their own.

**Updates never touch data.** Jobs, estimates, accounts, and OR/JO counters live
in `data.sqlite`; replacing app or server code leaves them intact. Roll out one
branch at a time; keep app + server in step only when you change the data API.

## Keeping the catalog fresh
- Manual: **Settings → Re-sync now** in the app.
- Scheduled: a Task Scheduler job that POSTs `/admin/sql/sync` (e.g. nightly):
  `curl -X POST http://localhost:8790/admin/sql/sync`

## Branch security checklist
Goal: **branch users can never change the app, and every update comes only from
the owner.** Three layers deliver that — the first two are built in, the third
is how you set up the mini-PC.

**A. In the app (built in — nothing to do but use it right)**
- [ ] On first sign-in, **change the default `admin`/`admin`** password.
- [ ] Create staff as **non-admin roles** (SV/SA/SM/Mechanic/Parts/Secretary).
      Keep the **only admin account for yourself.** Then no branch user can reach
      Settings, Accounts, permissions, prices, or SQL config — enforced on the
      server (401/403), not just hidden.
- [ ] There is **no code-editing surface** in the app; the most an account can do
      is what its role allows.

**B. Updates come only from you (built in)**
- [ ] App code is built from **your GitHub repo**. `update.cmd` only ever
      `git pull`s *your* code — no one at a branch can inject their own.
- [ ] Keep **push access to the repo restricted to you.** That is the control
      that makes "all updates come from me" true.
- [ ] (Optional) a scheduled `git pull` on the mini-PC auto-reverts any local
      file tampering back to your version — ask to enable.

**C. Lock down the mini-PC (your IT step — the real dependency)**
The app files and data (`data.sqlite`, `sql-config.json` with the DB password)
sit on the mini-PC's disk. Anyone with **Windows admin / file-write access** to
that box could edit code or read data directly. So:
- [ ] Staff use the app from **their own phones/PCs over the LAN** — they never
      log into the mini-PC's Windows. Keep it headless in a locked spot.
- [ ] If anyone must use the box, give them a **standard (non-admin) Windows
      account**, and make `C:\basic` writable only by an owner/admin account.
- [ ] Run the server (Task Scheduler / service) under an **owner account**, not a
      staff user.
- [ ] Consider **BitLocker** on the drive so data + the SQL password are
      protected at rest.

## Security notes
- `sql-config.json` (holds the DB password) stays on the mini-PC and is
  git-ignored. Set `ADMIN_TOKEN` on the server to require a token for `/admin/*`
  if untrusted devices share the LAN.
- The public tunnel exposes the app (sign-in protected) and the read-only
  customer portal; the parts admin endpoints should be kept LAN-only or
  token-protected. (See TUNNEL_SETUP.md for Cloudflare Access.)
