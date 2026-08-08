# Krishna Mobile

Desktop software for a multi-shop mobile phone retail business. Electron + React
+ TypeScript, with Turso (libSQL) as the database and a signed Windows installer
that updates itself.

---

## Quick start

```bash
npm install
npm run dev
```

Default login — **username `admin`, PIN `202600`** (set by `DEFAULT_ADMIN_PIN` in
`.env`). Change it after the first login, or change the `.env` value before you
build the installer you hand out.

Build the `.exe`:

```bash
npm run build:win
```

The installer lands in `release/<version>/Krishna Mobile-Setup-<version>.exe`.

---

## How the business is modelled

**One row per physical handset.** Every unit you buy becomes a `stock_units`
row carrying its own IMEI, colour, landed cost and current shop. That single
decision is what makes per-handset profit, shop-to-shop transfers, and stock
reconciliation all work without guesswork.

| Concept | How it works |
| --- | --- |
| **Companies** | Fully separate businesses. Customers, stock, bills and reports never cross between them. |
| **Shops** | Belong to a company. Add as many as you open — Shop 1, Shop 2, Shop 3… |
| **Purchase** | Supplier bill → creates one stock unit per IMEI at the receiving shop. Bill-level charges and discounts are spread across units so the stored cost is the true landed cost. |
| **Transfer** | Shop 1 → Shop 2. Units go `in_transit` and only count as Shop 2's stock once the receiving end confirms. Optional mark-up books a margin at the sending shop. |
| **Sale** | Scan the IMEI, pick the customer, take payment. Prices are GST-inclusive, as printed on the box. Three kinds, chosen on the New Sale screen: **Product** (goods from stock), **Recharge** (an amount + note, no stock touched), and **Repair** (a labour charge plus any parts pulled from stock, which get sold like a normal unit). Recharge/repair bills carry a type badge and can be filtered in the Sales list. |
| **Credit (udhaar)** | Any unpaid balance becomes credit with a **promised date**. Tracked, aged, chased and reminded until settled. Applies to service bills too. |
| **EMI loan** | A separate financing path: down payment now, the rest as a fixed monthly installment schedule generated up front, with penalties, partial payments and early foreclosure. |
| **Reconciliation** | Pick any date range, compare expected vs physically counted stock, record a reason for every difference. |

---

## The reconciliation engine

This is the part worth understanding. `stock_units` stores only the *current*
state of each handset, so "what should have been on the shelf between 1 July and
31 July" cannot be read off a column. Instead the system replays every dated
movement as a `+1` / `-1` event:

| Event | Shop | Date | Qty |
| --- | --- | --- | --- |
| Purchase | receiving shop | bill date | +1 |
| Transfer dispatched | sending shop | transfer date | −1 |
| Transfer received | receiving shop | received date | +1 |
| Sale | selling shop | sale date | −qty |
| Adjustment | that shop | adjustment date | ±qty |

From that ledger:

- **Opening** = sum of movements before the "from" date
- **Expected** = sum of movements up to and including the "to" date
- **Variance** = physically counted − expected

Your example — books say 7 on 31 July, only 6 on the shelf — comes out as a
variance of −1 on that SKU. You pick a reason, optionally tick *exactly which
IMEI* is missing, and on finalise the system moves that unit out of stock and
writes a `stock_adjustments` row. The value impact then shows up as shrinkage in
the shop's P&L.

Sixteen reasons ship built in (theft, damage, sale not entered, transfer not
entered, demo piece, service centre, counting error, wrong IMEI, *Other* — which
requires a written explanation). Add your own under **Settings → Reasons**.

Finalising is blocked until every line has a physical count and every difference
has a reason. Finalised checks are read-only forever.

---

## Users, PINs and permissions

- Every session starts at the lock screen. There is no "stay signed in".
- Login is a **6-digit PIN** — pick your face, type six digits, you're in.
- PINs are stored as bcrypt hashes. Five wrong attempts locks the account for
  five minutes; an admin can unlock it.
- Creating a user takes a name, a username and a PIN. Tick which companies and
  shops they can touch.
- Roles: **Administrator**, **Shop Manager**, **Cashier**, **Read only**, or
  **Custom** with an individual permission for every action in the app.
- `report.profit` is the one to watch — without it a user sees revenue but never
  cost price or margin.
- Every meaningful action is written to an audit trail (**Settings → Audit**).

---

## Consumer EMI loans

> **Held back from release.** The EMI module is fully built but disabled behind
> the `FEATURES.emiLoans` flag in `src/shared/constants.ts`. While it is `false`
> the menus appear as a single locked **"EMI Loans — 🔒 Upgrade"** teaser at the
> bottom of the sidebar, the `/loans` routes redirect to the dashboard, and the
> EMI tabs in Reports and Settings are hidden. Flip the flag to `true` to unlock
> everything in its original place — no other change needed. The rest of this
> section describes the feature as it works once unlocked.

A customer can take any product — a phone, an accessory, or anything else the
shop sells — on a down payment plus fixed monthly installments instead of
paying in full. This is the shop's own buy-now-pay-later financing, separate
from the credit/udhaar tracked on regular sales, and it isn't limited to
phones.

- **New EMI Loan** — pick the customer, then choose how the item is sourced:
  **From current stock** (pulls in the cost and IMEI automatically and marks
  the unit sold, exactly like a POS sale) or **Direct sale** (type in the
  product by hand — for accessories, other product lines, or anything not
  tracked as serialised stock; nothing in inventory is touched). Neither is
  the "unusual" path — which one applies depends only on whether that
  particular item happens to be in the stock system. Enter the sale amount,
  down payment, processing fee and tenure; the monthly EMI is calculated
  automatically (editable) and a full repayment schedule is generated in one
  shot, with the last installment absorbing any rounding remainder so the
  schedule always sums exactly to the financed amount. The shop's purchase
  cost is always required, so margin reporting stays accurate either way.
- **EMI Loans** — every loan, filterable by shop, status and date, with an
  "overdue EMI" filter. Opens into the repayment screen.
- **Repayment screen** — the full installment schedule with due dates,
  paid/balance columns and status. Click an installment to collect against it
  (supports partial payments — a part-paid EMI stays open until settled), with
  a suggested late-payment penalty pulled from **Settings → EMI loans** that
  is always editable at the time of collection. **Foreclose** settles every
  remaining installment in one payment (optionally at a discount) and closes
  the loan immediately. A loan with no payments recorded yet can be cancelled
  outright, which returns any stock-linked item to stock.
- **Reports → EMI loans** — a full KPI dashboard: sales financed, purchase
  cost, margin, processing fee income, EMI and penalty collected, outstanding,
  overdue count/amount, active/closed loan counts, distinct customers, and a
  recovery-period estimate (months until the last active loan's final EMI is
  due) — plus the full loan grid, exportable to CSV.
- Desktop reminders fire for EMI installments that are overdue or due within a
  day, the same way credit/udhaar reminders do.

### Importing the old Access database

**Settings → Import data** brings the shop's previous MS Access database
(`krishna_mobile_database.accdb`) into the EMI module. Choose the `.accdb`
file, review a full preview (counts, per-loan sample, and any data-quality
warnings) and pick which shop the loans belong to, then confirm.

- It is **additive only** — it never edits or deletes anything already in the
  app. A customer whose mobile already exists is reused rather than
  duplicated, and a loan whose number was already imported is skipped, so the
  import is safe to run again.
- Customers, loans and repayment history come from `CUSTOMER TBL`, `LOAN TBL`
  and `LOAN REPAYMENT`. The old `PRODUCT TBL` is **not** imported — its
  categories were too inconsistent to link to tracked stock — so each imported
  loan keeps its brand/model as plain text, exactly like a direct sale.
- Payment history is **rebuilt**, not copied row-for-row: a fresh flat-EMI
  schedule is generated and every real payment (the old "CARRY FORWARD"
  book-keeping rows are excluded) is allocated oldest-first. On the loans that
  were fully paid, the real cash reconciles exactly to the scheduled payable.
- Aadhaar numbers are validated leniently — a value that fails its checksum is
  dropped (with a warning) rather than blocking the customer.

---

## Reminders and desktop notifications

A background scan runs shortly after login and every 10 minutes after that. It
raises reminders for:

- credit past its promised date (severity rises after 7 days)
- credit promised today or tomorrow
- EMI installments overdue, or due today / tomorrow
- models at or below their low-stock alert level
- transfers still waiting to be received
- supplier bills due within 2 days
- handsets unsold for 90+ days

New reminders fire a **native Windows toast** while the app is open; clicking one
focuses the window and jumps straight to the record. Everything is also in the
bell menu (`Ctrl+Shift+N`). Each reminder carries a dedupe key so the same thing
is never raised twice in a day.

---

## Auto-update

`electron-updater` against a plain static HTTP folder.

1. Bump `version` in `package.json`.
2. `UPDATE_FEED_URL=https://your-host/path npm run build:win`
3. Upload three files from `release/<version>/` to that folder:
   `latest.yml`, `Krishna Mobile-Setup-<version>.exe`, and the `.blockmap`.

Installed copies check on launch (after 30 s) and every
`UPDATE_CHECK_INTERVAL_MINUTES`. With `UPDATE_MODE=auto` the update downloads
silently, waits 20 seconds so nobody loses a half-typed bill, then installs and
**relaunches on its own**. Set `UPDATE_MODE=notify` to ask first.

The `.blockmap` enables differential downloads — a small patch instead of the
full 106 MB every time.

To use GitHub Releases instead, replace the `publish:` block in
`electron-builder.yml`:

```yaml
publish:
  - provider: github
    owner: your-github-user
    repo: your-repo
```

---

## Database

Turso (libSQL), configured entirely through `.env` so the shop owner never sets
anything up. The `.env` is bundled into the installer as an extra resource.

**Embedded replica mode** (`TURSO_EMBEDDED_REPLICA=true`, the default) keeps a
local SQLite copy in the user's data folder. It runs **local-first**
(`offline: true`): every read *and every write* hits the local copy and returns
in well under a millisecond, so saving is instant and the app never freezes
waiting on the network. Local writes are pushed to Turso — and other shops'
changes pulled down — by a background `sync()` that fires ~2 seconds after any
write and again every `TURSO_SYNC_INTERVAL` seconds, and once more on exit. Two
shops therefore stay in step within the sync window without any save ever
blocking on the connection. The trade-off is that a write is only cloud-durable
after its next sync (a couple of seconds), and cross-shop visibility has the
same short delay. Set `TURSO_EMBEDDED_REPLICA=false` to talk to Turso directly
over HTTP with no local copy — correct, but every write then waits a full
network round-trip, which is very slow on a poor link.

With no `TURSO_DATABASE_URL` at all the app still runs, fully offline, against a
local file — useful for a demo. The login screen says so.

Config is read in priority order, first match wins:

1. `%APPDATA%/Krishna Mobile/.env` — lets you fix credentials without a rebuild
2. `<install dir>/resources/.env` — the bundled copy
3. `<project>/.env` — development

Schema changes go in `src/main/db/schema.ts` as a **new** migration entry. Never
edit one that has shipped.

---

## Keyboard shortcuts

Press <kbd>Shift</kbd>+<kbd>?</kbd> anywhere for the live list — it shows only
what is actually bound on the current screen.

| | |
| --- | --- |
| `Ctrl+K` | Command palette — searches customers, IMEIs and invoices live |
| `Ctrl+B` | Collapse / expand the sidebar |
| `Ctrl+1…9` | Switch shop |
| `Alt+1…9` | Jump to a section |
| `F2` | New sale — and, on the sale screen, focus the IMEI scan box |
| `F4` | Jump to "amount received" |
| `F9` / `F10` | Save bill / save and print |
| `Ctrl+F` | Focus the search box on any list |
| `Ctrl+N` | New customer / supplier / model / EMI loan, depending on the screen |
| `Ctrl+Shift+E` | Export the current list to CSV |
| `Ctrl+Shift+T` | Light / dark theme |
| `Esc` | Clear the bill, close a dialog, go back |

---

## Field validation

| Field | Rule |
| --- | --- |
| Aadhaar | 12 digits, must not start 0 or 1, **Verhoeff checksum** — the real UIDAI algorithm, not just a length check |
| PAN | `AAAAA9999A` with a valid 4th-character holder type (shown back to you: Individual, Company, Firm…) |
| Mobile | 10 digits starting 6–9; `+91` and leading `0` are stripped automatically |
| IMEI | 15 digits with a Luhn check. A failing checksum warns rather than blocks — grey-market handsets genuinely carry them |
| GSTIN | 15 characters with the state code, embedded PAN and mod-36 checksum all verified |
| PIN code | 6 digits, not starting 0 |
| State | Searchable dropdown of all 36 Indian states and union territories, with GST state codes |

Aadhaar is masked to `XXXX XXXX 9012` in lists; there is a toggle to reveal it.

---

## Project layout

```
src/
├── main/                  Electron main process — the only place that touches the DB
│   ├── db/                client, schema/migrations, first-run seed
│   ├── services/          business logic: auth, users, org, catalog, parties,
│   │                      inventory, sales, reconciliation, reports, notifications
│   ├── bootstrap.ts       open DB → migrate → seed
│   ├── ipc.ts             one `api` channel, every handler registered here
│   ├── updater.ts         electron-updater wiring
│   └── env.ts             .env loading and typed config
├── preload/               contextBridge — exposes `window.api.invoke` only
├── shared/                constants + validators used by both sides
└── renderer/src/
    ├── components/ui/     the design system (button, combobox, data-table…)
    ├── components/layout/ shell, sidebar, command palette, notifications
    ├── features/          one folder per screen
    ├── lib/               api client, hooks, hotkeys, theme, formatting
    └── store/             session state
```

The renderer never touches the database. Everything goes through
`api.<domain>.<method>()` → one IPC channel → a permission check → a service.

---

## Demo data

`scripts/seed-demo.mjs` writes a complete, realistic July 2026 trading month
straight into the configured Turso database — models, suppliers, customers,
purchases, Shop 1 → Shop 2 transfers, sales, and credit that is partly collected
and partly overdue.

```bash
node scripts/seed-demo.mjs            # insert (refuses if sales already exist)
node scripts/seed-demo.mjs --clear    # wipe trading data first, then insert
node scripts/check-demo.mjs           # print the month back as tables + integrity checks
```

`--clear` deletes sales, purchases, transfers, stock, customers, suppliers,
models and counters. Companies, shops and users are left alone.

It runs the same arithmetic the app does — landed cost per unit, GST-inclusive
pricing, per-handset profit, invoice numbering — so reports, the credit book and
reconciliation all read exactly as they would after a real month. Everything is
fictional: names, addresses, Aadhaar and PAN are randomly generated, with valid
checksums only so the app's validation accepts them.

`scripts/test-loan-flow.mjs` is a separate, self-contained check of the EMI
loan module: it creates a real loan against whatever database `.env` points
at, runs it through an on-time payment, a late partial payment with penalty,
overdue detection, and a discounted foreclosure — asserting the schedule and
outstanding-balance math at every step — then deletes everything it created
and exits non-zero on any failure. Useful after touching `services/loans.ts`.

**Delete all three scripts before shipping to a real shop**, or at least never
run them against live data.

## Scripts

| | |
| --- | --- |
| `npm run dev` | Development with hot reload |
| `npm run typecheck` | Type-check main and renderer |
| `npm run build` | Bundle without packaging |
| `npm run build:unpack` | Package to a folder, no installer — fastest way to test a real build |
| `npm run build:win` | Full NSIS installer |
| `npm run publish:win` | Build and upload to the update feed |

---

## Before you hand this to a shop

- [ ] Change `DEFAULT_ADMIN_PIN` in `.env` — `202600` is a published default
- [ ] Point `UPDATE_FEED_URL` at a real host you control
- [ ] Fill in company details and GSTIN under **Settings → Companies**
- [ ] Rename Shop 1 / Shop 2 and set their invoice prefixes
- [ ] Create a user per staff member; give cashiers the Cashier role, not admin
- [ ] Consider a code-signing certificate — without one, Windows SmartScreen
      warns on first install, and `electron-updater` cannot verify signatures
