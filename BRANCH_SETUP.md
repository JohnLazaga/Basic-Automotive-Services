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
2. Copy the `branch-server/` folder and the `dist/<slug>/` folder onto the PC.
3. Start the server (serves app **and** parts on port 8790):
   ```
   set BRANCH=Davao
   set APP_DIR=..\dist\davao
   node server.js
   ```
4. **Auto-start on boot** so it survives reboots — Task Scheduler ("At startup",
   run `node C:\basic\branch-server\server.js`), or install NSSM / pm2.

## 4. Give the mini-PC its LAN name
So staff can type `http://davao.basic.local` instead of an IP:
- Assign the mini-PC a **static LAN IP** in the router, and
- add a DNS entry `davao.basic.local → that IP` on the router, **or** enable
  mDNS/Bonjour and use the PC's `<hostname>.local`.
- (Optional) run the server on port 80 so no `:8790` is needed in the URL.

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

## 6. Public URL + customer portals (Cloudflare Tunnel)
Gives `https://<slug>.basicautomotiveservices.com` with HTTPS and **no router
port-forwarding**, working behind the shop's NAT:

1. Point `basicautomotiveservices.com`'s DNS at **Cloudflare** (one-time, for the
   whole domain).
2. On the mini-PC: install `cloudflared`, `cloudflared login`, then create a
   tunnel and route the subdomain to the local server:
   ```
   cloudflared tunnel create davao
   cloudflared tunnel route dns davao davao.basicautomotiveservices.com
   cloudflared tunnel run --url http://localhost:8790 davao
   ```
3. Run `cloudflared` as a service so it stays up.

Now: staff on the LAN use the fast offline `*.basic.local` URL; remote staff and
customers (QR portal) use the public `*.basicautomotiveservices.com`. If the
internet drops, the branch keeps running locally.

## Keeping the catalog fresh
- Manual: **Settings → Re-sync now** in the app.
- Scheduled: a Task Scheduler job that POSTs `/admin/sql/sync` (e.g. nightly):
  `curl -X POST http://localhost:8790/admin/sql/sync`

## Security notes
- `sql-config.json` (holds the DB password) stays on the mini-PC and is
  git-ignored. Set `ADMIN_TOKEN` on the server to require a token for `/admin/*`
  if untrusted devices share the LAN.
- The public tunnel exposes the app (sign-in protected) and the read-only
  customer portal; the parts admin endpoints should be kept LAN-only or
  token-protected.
