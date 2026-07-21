# Integrations roadmap — BASIC by JMSI

External-service integrations to streamline the shop. Unlike the in-app features
(comebacks, profit, consent log, labor timer, deposits — all shipped in the
static app + Firestore), most of these need an external account and usually a
small backend / cloud function to hold API keys securely. Ordered by friction removed.

## Tier 1 — removes the most manual work
- **Auto SMS / Viber** (Semaphore, Movider, or Viber Business). Today the app builds
  SMS *deep-links*; staff still tap send. Auto-send: "car ready", PMS-results link,
  service-due reminders, deposit receipts, review requests. Ends phone tag.
- **Digital payments** (GCash / Maya / InstaPay QR Ph). Payment QR on the invoice and
  the intake deposit; paid amount lands in `payments[]` and clears the balance.
  Pairs directly with the **deposits** feature and fixes cash reconciliation.
- **Inspection → approve → upsell loop.** Push PMS "items needing attention" to the
  customer as a link with photos + an *Approve to fix* button; approval flows into the
  job as authorized work. Turns inspection into revenue and *is* the customer-consent
  channel for the **additional-work authorization** log (timestamped, dispute-proof).

## Tier 2 — tightens operations & money
- **Supplier auto-PO on low stock.** Reorder points + low-stock alerts already exist;
  auto-draft the PO and email/send to the supplier when stock trips — pre-empts the
  "waiting for parts" (B1/B3) stalls.
- **Accounting / BIR export** (QuickBooks, Xero, or a sales-book CSV). Auto BIR sales
  journal, 2307 for corporate clients, e-invoicing-ready.
- **Thermal label printer** (ESC/POS / Zebra) for the 1.5×3in QR stickers — solves the
  browser-to-label-stock printing friction directly.

## Tier 3 — reduces typing & elevates data
- **VIN/chassis decoder at intake** — auto-fill year/make/model/engine.
- **OBD-II scanner → PMS Fault Code** — pull DTCs straight into the inspection.
- **Time-clock / biometric → labor timer** — feed clock-in into the per-mechanic timer
  and onward to payroll.
- **Online booking page → appointments** — customers self-book against bay capacity.

Natural pairings with the shipped in-app features: payments ↔ deposits · Viber-approve ↔
consent log · time-clock ↔ labor timer · thermal printer ↔ QR stickers.
