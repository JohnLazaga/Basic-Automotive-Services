# Public URL for a branch — Cloudflare Tunnel

Gives a branch's mini-PC a public HTTPS address
(`<slug>.basicautomotiveservices.com`) with **no router port-forwarding** and
automatic TLS, by running `cloudflared` on the mini-PC. The mini-PC stays the
source of truth; the tunnel is just a secure inbound pipe. If the internet
drops, the LAN keeps working — only the public URL pauses.

> Example below uses the **pilot** branch and port **8790**. Swap for your slug.

---

## ⚠️ Read first: this touches your live domain's DNS
`cloudflared` can only create `<slug>.basicautomotiveservices.com` if that
**domain's DNS is managed by Cloudflare**. Your live cloud site
(`basicautomotiveservices.com` on GitHub Pages) uses that same domain, so:

- Moving the domain to Cloudflare means **changing its nameservers** at your
  registrar. Cloudflare scans and imports your existing records during signup —
  but **verify the GitHub Pages records survive** or the live site goes down.
- **Keep the existing records DNS-only (grey cloud), not proxied (orange).** The
  apex `A` records (GitHub Pages: `185.199.108/109/110/111.153`) and any `www`
  CNAME should stay **grey-cloud** so the live site behaves exactly as now.
- Only the **new tunnel subdomain** (`pilot.…`) is proxied (orange) — that's what
  `cloudflared` sets up for you.

**Want zero risk to the live site for now?** Use a **Quick Tunnel** (below) — it
gives a throwaway `*.trycloudflare.com` HTTPS URL with **no DNS changes** at all.
Perfect for piloting; switch to the branded subdomain later.

---

## Option A — Quick Tunnel (no DNS, instant, great for the pilot)
On the mini-PC, after the branch server is running on 8790:
```
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:8790
```
It prints a URL like `https://random-words.trycloudflare.com`. That's your
temporary public address — reachable anywhere, HTTPS included. It changes each
run and isn't branded, so use it to validate remote access, then move to Option B.

---

## Option B — Named tunnel on your subdomain (stable, branded)

### 1. Put the domain on Cloudflare (one-time)
- Create a free Cloudflare account → **Add a site** → `basicautomotiveservices.com`.
- Cloudflare shows the records it imported — **confirm the GitHub Pages apex `A`
  records and `www` are present and set to DNS-only (grey cloud).**
- Change the nameservers at your registrar to the two Cloudflare gives you.
  Wait for "Active" (minutes to a few hours).

### 2. Install & authenticate on the mini-PC
```
winget install --id Cloudflare.cloudflared
cloudflared tunnel login
```
(A browser opens; pick `basicautomotiveservices.com` to authorize.)

### 3. Create the tunnel
```
cloudflared tunnel create pilot
```
Note the **Tunnel ID** and the credentials file it writes to
`C:\Users\<you>\.cloudflared\<TUNNEL-ID>.json`.

### 4. Config file
Create `C:\Users\<you>\.cloudflared\config.yml`:
```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\<you>\.cloudflared\<TUNNEL-ID>.json
ingress:
  - hostname: pilot.basicautomotiveservices.com
    service: http://localhost:8790
  - service: http_status:404
```

### 5. Point the subdomain at the tunnel
```
cloudflared tunnel route dns pilot pilot.basicautomotiveservices.com
```
(Creates a proxied CNAME for `pilot.…` — leave it orange-cloud.)

### 6. Run it as a service (survives reboots)
```
cloudflared service install
```
Then start the **cloudflared** service (Services app or `net start cloudflared`).

### 7. Point the branch's public URL at it
In `branches.json`, the pilot's `publicUrl` is already
`https://pilot.basicautomotiveservices.com`. That's what QR/portal links use, so
no rebuild needed unless you change the subdomain.

---

## Security (public exposure)
The tunnel exposes the branch server publicly. It's built to handle that —
`/data` and `/events` require a valid **session**, and account management
requires an **admin** session — but harden it:
- Set **`ADMIN_TOKEN`** in `branch.config.cmd` so `/admin/*` (SQL config) needs a
  token, not just an admin session.
- Consider **Cloudflare Access** (free for small teams) in front of the hostname
  to require an email login before the staff app is even reachable.
- Use strong staff passwords; the default `admin/admin` must be changed.

## Verify
- From a phone **off the shop Wi-Fi** (mobile data), open the public URL → you
  should get the login screen over HTTPS and be able to sign in.
- On the LAN, keep using `http://<mini-pc-ip>:8790/` (faster, works offline).

---

## Note on customer QR portals
The **staff app** works over the tunnel immediately. The **public customer
portal** (`#v=<id>` QR links) still reads its snapshot from the cloud (Firestore)
— on a fully-local branch that path isn't wired to the mini-PC yet. Making QR
portals resolve from the branch server is a small add-on (a public
`/portal/:id` endpoint + portal handling in the local boot). Ask and it can be
built; until then, use the tunnel for **remote staff access**.
