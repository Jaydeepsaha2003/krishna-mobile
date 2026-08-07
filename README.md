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
| **Sale** | Scan the IMEI, pick the customer, take payment. Prices are GST-inclusive, as printed on the box. |
| **Credit (udhaar)** | Any unpaid balance becomes credit with a **promised date**. Tracked, aged, chased and reminded until settled. |
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
  **Custom** with 27 individual permissions.
- `report.profit` is the one to watch — without it a user sees revenue but never
  cost price or margin.
- Every meaningful action is written to an audit trail (**Settings → Audit**).

---

## Reminders and desktop notifications

A background scan runs shortly after login and every 10 minutes after that. It
raises reminders for:

- credit past its promised date (severity rises after 7 days)
- credit promised today or tomorrow
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
local SQLite copy in the user's data folder and syncs to Turso every
`TURSO_SYNC_INTERVAL` seconds. Reads are instant and survive an internet drop.
Set it to `false` to talk to Turso directly over HTTP with no local copy.

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
| `Ctrl+N` | New customer / supplier / model, depending on the screen |
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

**Delete both scripts before shipping to a real shop**, or at least never run
them against live data.

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
