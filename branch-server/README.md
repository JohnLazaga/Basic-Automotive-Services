# Branch Parts Server

A tiny, **zero-dependency** parts-catalog server that runs on a branch's
always-on mini-PC. It loads the parts catalog into memory and answers SKU
lookups + search over the branch LAN — **no internet required**, instant, and
independent from every other branch.

## Requirements
- [Node.js](https://nodejs.org) (LTS) installed on the mini-PC. Nothing else.

## Setup (per branch)
1. Copy this `branch-server` folder onto the mini-PC.
2. Put that branch's catalog next to `server.js` as **`parts.tsv`**
   (tab-separated: `SKU <tab> NAME <tab> COST <tab> PRICE`).
   Each branch can carry its own prices/stock — the file is local to the branch.
3. Start it:
   ```
   node server.js
   ```
   Optional settings (environment variables):
   | Var          | Default        | Purpose                                        |
   |--------------|----------------|------------------------------------------------|
   | `PORT`       | `8790`         | Port to listen on                              |
   | `BRANCH`     | `branch`       | Branch name/id (shown in /health)              |
   | `DATA_FILE`  | `./parts.tsv`  | Path to the catalog file (fallback source)     |
   | `APP_DIR`    | *(unset)*      | If set to `dist/<slug>`, also serves the app at `/` |
   | `ADMIN_TOKEN`| *(unset)*      | If set, `/admin/*` requires header `X-Admin-Token` |

   Example (Windows): `set BRANCH=Main& set APP_DIR=..\dist\main& node server.js`

## Parts source: SQL Server (recommended) or parts.tsv
The catalog can come straight from **SQL Server** — configured **in the app**
(Settings → *Parts catalog — SQL Server* → Test → Attach). The app posts the
connection details here; this server connects via .NET SqlClient (PowerShell,
Windows-only) exactly like `sync/export-sql.ps1`, so **no npm packages** and
Windows/Integrated auth works. It also snapshots to `parts.tsv` so the branch
keeps working if SQL Server is later offline. Admin endpoints:
`GET /admin/sql/status`, `POST /admin/sql/test|save|sync`. Saved connection
(incl. password) lives in `sql-config.json` — local to the mini-PC, git-ignored.

## Keep it running
On the mini-PC, run it as an auto-start service so it survives reboots — e.g.
Task Scheduler ("At log on" / "At startup"), NSSM, or `pm2`. (A ready-made
Windows service wrapper can be added in a later phase.)

## API
| Method & path                | Returns                                            |
|------------------------------|----------------------------------------------------|
| `GET /health`                | `{ ok, branch, count, version, loadedAt }`         |
| `GET /api/version`           | `{ version, count }` — content hash for change checks |
| `GET /api/all`               | Whole catalog, **gzipped** `{ version, count, parts:[[sku,name,net,srp]] }` — the app downloads this once on sign-in |
| `GET /api/parts/:sku`        | `{ sku, name, net, srp }` (`404` if unknown)       |
| `GET /api/parts?q=TERM&limit`| `{ count, results:[…] }` — SKU-prefix or name match |

## How the app finds it
The web app points at `http://<mini-pc-hostname-or-ip>:8790`. On a LAN this is
typically a static IP or a hostname like `http://parts.local:8790`. Wiring the
app to use this (with a cloud fallback) is Phase 2.

## Updating the catalog
Replace `parts.tsv` and restart the server (an in-place `/import` endpoint can
be added later). `version` is a hash of the file, so the app can tell when the
catalog actually changed.
