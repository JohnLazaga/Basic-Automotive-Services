# Changelog

All notable changes to **Basic by JMSI — Shop Operations** are recorded here.
The version shown in the app sidebar (and each branch's `version.txt`) matches the
entries below. Newest first.

## [1.2.0] — 2026-07-11

### Added
- **Duplicate-plate gate on Add Vehicle.** Entering a plate that already exists
  now shows a live in-form warning ("Plate … is already registered to …") with an
  **Open that vehicle** shortcut, and blocks the save so the same plate can't be
  registered twice. The check ignores case and spacing, so `abc1234` is caught
  against `ABC 1234`. Editing a vehicle never flags itself.

### Changed
- **Final Billing shows discounts itemised.** The Final Billing receipt (and the
  customer portal receipt, which mirrors it) now lists **Parts**, **Labor**, and
  **Other** discounts as separate lines instead of one consolidated "Discount".
  The "Other" line carries its note. Falls back to a single line for legacy or
  capped discounts, so the **Total Amount Due is always exact**.

### Fixed
- Corrected a stale footnote on the Mechanic Commission printout to describe the
  even split (shop rate × labor ÷ mechanics assigned).

## [1.1.9] — 2026-07-11

### Fixed
- **Only the Mechanic(s) field earns the labor-commission pool.** Non-mechanic
  assignees (Service Adviser, the "Assessed by" senior mechanic, parts salesman)
  no longer inherit the shop's default mechanic rate when they have no rate of
  their own — a blank rate now means no commission. Fixes jobs where an assessor
  with no rate silently earned a full extra commission.

## [1.1.8] — 2026-07-11

### Changed
- **Mechanics split one commission pool evenly.** A job's labor commission is now
  `labor × shop rate`, divided equally among the mechanics assigned (e.g. ₱1000
  labor @ 5% → 1 mech ₱50, 2 mechs ₱25 each, 3 mechs ₱16.67 each), instead of
  every mechanic earning the full rate. The divisor is the count of mechanics
  assigned, so removing one from payout never inflates the others' shares.
  Because commission is computed live, past reports reflect the corrected math too.

## [1.1.7] — 2026-07-11

### Added
- **Universal UPPERCASE encoding.** Text typed into any data-entry field is
  auto-uppercased as it is typed or pasted, across every branch, for consistent
  records and printouts. Case-sensitive fields (passwords, logins, e-mail/URL,
  search boxes) are left untouched. Existing records were migrated to uppercase.

## [1.1.6] — 2026-07-10

### Changed
- Cloud parts refresh skips re-downloading an unchanged catalog and fetches chunks
  in parallel; added a "Refresh parts catalog" button in Cloud settings.
- Deployed to the Commonwealth and Sudipen branches and brought Sandbox online.

## [1.1.5] — 2026-07-09
- Reports: live search on "OR numbers by series".

## [1.1.4] — 2026-07-09
- Reports: new "OR numbers by series" view with corresponding JO #s.

## [1.1.3] — 2026-07-09
- Sidebar: show each branch's city/location under the logo.

## [1.1.2] — 2026-07-09
- Sidebar: show each branch's name under the logo.

## [1.1.1] — 2026-07-09
- Disable cross-branch browser autofill on data-entry fields.

## [1.1.0] — 2026-07-08
- Multi-tenant: all cloud data stored under `branches/{id}/`.

## [1.0.2] — 2026-07-04
- Switch custom domain to basicautomotiveservices.com (CNAME + portal URL).

## [1.0.1] — 2026-07-04
- Fix login/loading hang: disable multi-tab IndexedDB persistence.
