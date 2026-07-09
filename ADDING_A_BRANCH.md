# Adding a branch

Two one-command scripts. Run them from the **repo root** on a machine that has
this repo, Node, and `sync/serviceAccountKey.json` (cloud script only).

Slugs must be lowercase letters/numbers/dashes (e.g. `novaliches`). The branch is
served at `basicautomotiveservices.com/<slug>` (cloud) or on its own mini-PC
(local). **No Firestore rules change and no DNS setup is ever needed.**

---

## Reliable internet → CLOUD branch

```
node add-cloud-branch.js <slug> "<Name>" "<Location>" [--deploy]
```

Example:
```
node add-cloud-branch.js novaliches "Novaliches" "Novaliches, Quezon City" --deploy
```

Does: register in `branches.json` → seed an empty branch in Firestore
(`branches/<slug>`, fresh OR/JO/EST/PO series) → build + stage `/<slug>/` →
commit (and push with `--deploy`). Live in ~2 min.

Then at `https://basicautomotiveservices.com/<slug>`:
1. Sign in as the owner → you're auto-made that branch's admin.
2. **Settings → Shop & BIR** → set address, contact, TIN.
3. **Accounts** → create the branch's admin + staff logins.
4. (Optional) sync that branch's parts catalog; print its QR portal stickers.

Isolated automatically: its data never mixes with other branches, and it has its
own number series. One branch offline never affects another.

---

## Unreliable / no internet → LOCAL branch

```
node add-local-branch.js <slug> "<Name>" "<Location>" [--host <hostname:port>]
```

Example:
```
node add-local-branch.js batangas "Batangas" "Batangas City" --host batangas:8790
```

Does: register in `branches.json` (local) → build a self-contained artifact into
`dist/<slug>/` → commit `branches.json` → print on-site setup steps.

The branch runs on an **on-site mini-PC** (`branch-server/`): works fully
**offline** with **LAN real-time** across stations. Follow the printed steps to
install and run it on the mini-PC. A cloud-sync bridge (so the branch also shows
centrally and its customers get the online QR portal) can be added later.

---

## Notes
- The cloud script needs `sync/serviceAccountKey.json` (git-ignored) to seed the
  branch. If seeding fails, `branches.json` is still updated — fix the key and run
  `cd sync && node seed-branch.js <slug>`.
- Sidebar label comes from the `location` field per branch in `branches.json`.
- Adding a branch does **not** change other branches' code; they keep running and
  update themselves via the auto-update banner.
