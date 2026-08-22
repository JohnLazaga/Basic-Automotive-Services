# Backing up to a local NAS

`sync/backup-nas.js` copies every cloud branch's operational data out of
Firestore to a folder you control — a NAS share, an external disk, anywhere this
machine can write.

Before this existed there was no scheduled backup at all. The only files on disk
were two `sync/backup_*.json` from 2026-07-08, and those were side-effects of a
migration script rather than a backup. When job order JO-0170 lost line items in
August, nothing could be recovered, because the only snapshots predated the job.

## Set it up once

1. Copy `sync/backup-config.example.json` to `sync/backup-config.json` and set
   `dest` to your NAS path. That file is git-ignored — it is per-machine.
2. Run it once by hand and watch it finish:

   ```
   node sync/backup-nas.js
   ```

3. Prove the result is readable:

   ```
   node sync/backup-nas.js --verify
   ```

## What it writes

```
<dest>/
  2026-08-20T0312/
    manifest.json        what the run believed it wrote
    main.json            Fairview  (branch id 'main', NOT 'fairview')
    commonwealth.json
    sudipen.json
    sandbox.json
```

Each branch file holds every collection under `branches/<id>/`, with each
document's id preserved as `__id`.

The run assembles into a `.incoming-*` folder and renames it into place only
after everything succeeds, so an interrupted or failed run never leaves behind
something that looks like a good backup. A failure exits non-zero, which is what
makes Task Scheduler show the run as failed.

## What is deliberately excluded

| Collection | Why |
| --- | --- |
| `catalog` | ~102k parts, rebuilt from SQL Server nightly by `upload-all.js`. Derived data, not a record, and it would dwarf the snapshot. |
| `portal` | Derived customer-QR snapshots, rebuilt by **Settings → "Publish all portals"**. See below. |
| `jobphotos`, `pmsphotos` | Handled separately as an incremental photo store — see below. Not in the dated snapshots. |
| `sessions` | Premises-gate sessions. Short-lived, reissued on sign-in, and restoring a stale one would be wrong. |

Collections are **discovered**, not listed, so anything added later is picked up
without editing the script. A hardcoded include-list fails silently — you find
out it missed something at the moment you need the backup.

You can skip more via `"exclude": ["portal"]` in the config, or
`--exclude=portal`. The manifest records what was excluded, so whoever reads the
snapshot later knows what is missing from it.

### About `portal` — excluded, and why

`portal` holds one published customer-QR snapshot per vehicle, ~880 of them. It
was **730 of Fairview's ~1,150 seconds** — roughly half the entire nightly run.

It is excluded because it is **derived and rebuildable in one click**:
`portalDataForVehicle()` reconstructs each document from the vehicle plus its
jobs, and **Settings → "↑ Publish all portals"** (`publishAllPortals`)
regenerates every one. The PIN hash derives from the vehicle's own `portalPin`,
which *is* backed up.

The deciding argument is staleness. `publishPortalDoc()` only fires at defined
moments, so a published snapshot holds whatever it last happened to contain — in
practice some were months old. Backing them up preserves stale data, while
rebuilding after a restore produces portals **fresher than the backup ever
held.** Spending twelve minutes a night copying stale derived data buys nothing.

> **Restore consequence:** after restoring, click **Settings → "↑ Publish all
> portals"**, or every customer QR shows nothing. It is in the restore steps
> below.

Put it back with `"exclude": []` in the config if you would rather have the
snapshots than the time.

## Photos

Photos are not copied into the dated snapshots. They live in a **write-once
store** beside them:

```
<dest>/photos/main/jobphotos/ph_mrk7ufd8_r.jpg
<dest>/photos/main/jobphotos/index.json
<dest>/photos/main/pmsphotos/…
```

They are the bulk of the database and never change once written, so putting them
in every nightly run would duplicate the same megabytes forever. Each run instead
fetches only ids that are not already on disk.

`listDocuments()` is what makes that cheap — it returns document *references*
without their payloads, so discovering what exists costs a couple of seconds
rather than transferring every image. That matters because fetching one photo
takes **20–40 seconds** on this link. The first run pulls everything; after that
a night with no new photos costs seconds.

Images are decoded from their `data:` URL and written as real `.jpg` files, not
base64 JSON — about a quarter smaller, and openable by anyone who needs them
without a tool to decode them first. `index.json` holds the metadata for each:
job id, caption, timestamp, size, and a SHA-256.

**Photos are never deleted from the store** when they disappear from Firestore.
That is the point of a backup. `index.json` records `lastSeen`, so you can tell
what is still live.

Two behaviours worth knowing:

- "Already stored" is derived from the **files on disk**, not from the index, so
  an interrupted run never re-downloads what it already saved, and a lost index
  cannot cost hours of refetching.
- A photo that fails to download **fails the whole run** (non-zero exit) rather
  than printing a tick. Rerun it — everything already stored is skipped.

`--verify` re-hashes every stored image against its recorded SHA-256. That is
what catches silent corruption on the NAS: a truncated or bit-rotted JPEG is
still a file of the right name, and would otherwise be discovered only when
someone actually needed the picture.

Current scale: **42 photos, ~10 MB, all on Fairview** — the other three branches
have none.

## Scheduling it

Run it after the nightly catalog sync. Task Scheduler → Create Task:

- **Trigger:** daily, a little after your existing 03:00 sync
- **Action:** `node.exe` with arguments `C:\...\BASIC_by_JMSI\sync\backup-nas.js`
- **Start in:** the `sync` folder
- **Run whether the user is logged on or not**, and use an account that can
  write to the NAS share

Use the **UNC path** (`\\NAS\share\...`), not a mapped drive letter. Task
Scheduler frequently cannot see mapped drives when running non-interactively,
and the failure looks like "destination not writable".

## Restoring

There is no one-click restore, and you should know that before you need one.

- Branch files are plain JSON — open one and read it.
- The app's **Settings → Import JSON backup** is **local-branches-only**. It
  cannot restore into a cloud branch.
- Restoring to a cloud branch means writing a script against the Admin SDK. For
  a handful of documents, the fastest honest path is to read the JSON and repair
  by hand.

**After any restore, rebuild the derived collections — they are not in the
snapshot:**

1. **Settings → "↑ Publish all portals"** — rebuilds every customer-QR snapshot.
   Skip this and every QR code shows nothing.
2. **`node sync/upload-all.js`** — rebuilds the parts catalog from SQL Server.
3. Photos restore from `<dest>/photos/…` — they are real `.jpg` files, but
   putting them back into Firestore needs a script that does not exist yet.

If a real restore path matters, say so and it gets built and tested — an
untested restore is not a restore.

## What this does and does not protect against

**Does:** the Firebase project being lost, deleted, billing-suspended, or mass
data deletion.

**Does not:** point-in-time recovery inside a day. A bad write at 10am is
captured by that night's run as the new truth. Recovering something that was
damaged and then backed up needs Firestore PITR, which is a paid feature. This
is exactly the JO-0170 case — a nightly backup would not have saved those lines.

## Two things to be aware of

**Runtime.** Measured at **~26 minutes** for all four branches (4,030 documents,
6.84 MB) *while `portal` was still included*. Excluding `portal` removes ~880
documents and roughly half the wall-clock, so expect **~13–14 minutes**. Fairview
dominates either way; Sandbox, with 29 documents, still takes over two.

That is because Firestore reads from this connection run at roughly 5–25 KB/s
and the latency is erratic — four documents in `sandbox/parts` once took 124
seconds. It is round-trip latency, not bandwidth.

This is also why reads are **paginated**. The first working version used a plain
`collection.get()` and died on Fairview's `jobs` with `DEADLINE_EXCEEDED after
300s` — a single unbounded read simply cannot finish inside the Firestore
client's deadline over this link. Each page is now its own short request, with
retry and backoff on transient errors. If you ever see that error again, lower
`pageSize`.

**The snapshot is customer data.** Names, plates, addresses, phone numbers, and
the staff account documents. It lands on a share that is probably on the shop
LAN. Decide who can read that share, and whether it should be encrypted at rest.

## Commands

```
node sync/backup-nas.js                 # back up, then rotate old snapshots
node sync/backup-nas.js --dry-run       # read and count, write nothing
node sync/backup-nas.js --verify        # re-read the newest snapshot
node sync/backup-nas.js --verify=2026-08-20T0312
node sync/backup-nas.js --list          # what is on the NAS
node sync/backup-nas.js --dest=D:\tmp   # override the destination
node sync/backup-nas.js --page=50       # smaller reads on a slow link
node sync/backup-nas.js --branch=main   # one branch only (ids, not slugs)
node sync/backup-nas.js --exclude=portal
node sync/backup-nas.js --no-photos     # data only, skip the photo store
node sync/backup-nas.js --photos-only   # photos only, no snapshot, no rotation
```

`--branch` takes **branch ids** from `branches.json`, not URL slugs — Fairview is
`main`. Passing `fairview` is rejected with the list of valid ids rather than
silently backing up nothing. That distinction has bitten before: the nightly
catalog upload mapped slugs instead of ids and left Fairview three weeks stale.

A full run is long enough that `--branch=sandbox` is the sane way to test any
change to this script.

Retention keeps the last `keepDaily` runs plus the first run of each of the last
`keepMonthly` months. Without rotation the share fills, and nobody notices until
a backup fails for lack of space — which is precisely when it is needed.
