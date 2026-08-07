/**
 * Database schema. Each entry in MIGRATIONS is applied exactly once, in order,
 * and recorded in `schema_migrations`. Never edit a migration that has shipped —
 * append a new one instead.
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

const V1 = /* sql */ `
-- ===========================================================================
--  ORGANISATION
-- ===========================================================================
CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  legal_name      TEXT,
  gstin           TEXT,
  pan             TEXT,
  phone           TEXT,
  alt_phone       TEXT,
  email           TEXT,
  website         TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  pincode         TEXT,
  logo_data_url   TEXT,
  invoice_prefix  TEXT NOT NULL DEFAULT 'INV',
  terms           TEXT,
  fy_start_month  INTEGER NOT NULL DEFAULT 4,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shops (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  pincode         TEXT,
  gstin           TEXT,
  invoice_prefix  TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_shops_company_code ON shops(company_id, code);
CREATE INDEX IF NOT EXISTS ix_shops_company ON shops(company_id);

-- ===========================================================================
--  USERS & ACCESS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  username           TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  pin_hash           TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'cashier',
  permissions        TEXT,
  avatar_color       TEXT,
  is_active          INTEGER NOT NULL DEFAULT 1,
  must_change_pin    INTEGER NOT NULL DEFAULT 0,
  failed_attempts    INTEGER NOT NULL DEFAULT 0,
  locked_until       TEXT,
  last_login_at      TEXT,
  default_company_id TEXT,
  default_shop_id    TEXT,
  is_system          INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(lower(username));

CREATE TABLE IF NOT EXISTS user_companies (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS user_shops (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, shop_id)
);

-- ===========================================================================
--  CATALOGUE
-- ===========================================================================
CREATE TABLE IF NOT EXISTS brands (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_brands_company_name ON brands(company_id, lower(name));

CREATE TABLE IF NOT EXISTS models (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  brand_id        TEXT NOT NULL REFERENCES brands(id),
  name            TEXT NOT NULL,
  sku             TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'Smartphone',
  hsn             TEXT,
  ram             TEXT,
  storage         TEXT,
  color           TEXT,
  gst_rate        REAL NOT NULL DEFAULT 18,
  default_cost    REAL NOT NULL DEFAULT 0,
  default_price   REAL NOT NULL DEFAULT 0,
  mrp             REAL NOT NULL DEFAULT 0,
  low_stock_alert INTEGER NOT NULL DEFAULT 2,
  track_imei      INTEGER NOT NULL DEFAULT 1,
  warranty_months INTEGER NOT NULL DEFAULT 12,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_models_company_sku ON models(company_id, lower(sku));
CREATE INDEX IF NOT EXISTS ix_models_brand ON models(brand_id);

-- ===========================================================================
--  PARTIES
-- ===========================================================================
CREATE TABLE IF NOT EXISTS customers (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  phone_primary    TEXT NOT NULL,
  phone_secondary  TEXT,
  email            TEXT,
  aadhaar          TEXT,
  pan              TEXT,
  dob              TEXT,
  gender           TEXT,
  address_line1    TEXT,
  address_line2    TEXT,
  city             TEXT,
  state            TEXT,
  pincode          TEXT,
  gstin            TEXT,
  customer_type    TEXT NOT NULL DEFAULT 'Retail',
  credit_limit     REAL NOT NULL DEFAULT 0,
  notes            TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_by       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_company_phone ON customers(company_id, phone_primary);
CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_company_aadhaar
  ON customers(company_id, aadhaar) WHERE aadhaar IS NOT NULL AND aadhaar <> '';
CREATE INDEX IF NOT EXISTS ix_customers_name ON customers(company_id, lower(name));

CREATE TABLE IF NOT EXISTS suppliers (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  contact_person   TEXT,
  phone            TEXT,
  alt_phone        TEXT,
  email            TEXT,
  gstin            TEXT,
  pan              TEXT,
  supplier_type    TEXT NOT NULL DEFAULT 'Distributor',
  address_line1    TEXT,
  address_line2    TEXT,
  city             TEXT,
  state            TEXT,
  pincode          TEXT,
  opening_balance  REAL NOT NULL DEFAULT 0,
  notes            TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_suppliers_company ON suppliers(company_id, lower(name));

-- ===========================================================================
--  PURCHASES
-- ===========================================================================
CREATE TABLE IF NOT EXISTS purchases (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  supplier_id    TEXT REFERENCES suppliers(id),
  invoice_no     TEXT NOT NULL,
  purchase_date  TEXT NOT NULL,
  subtotal       REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  other_charges  REAL NOT NULL DEFAULT 0,
  round_off      REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0,
  due_amount     REAL NOT NULL DEFAULT 0,
  payment_mode   TEXT,
  due_date       TEXT,
  status         TEXT NOT NULL DEFAULT 'completed',
  notes          TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_purchases_date ON purchases(company_id, purchase_date);
CREATE INDEX IF NOT EXISTS ix_purchases_shop ON purchases(shop_id, purchase_date);

CREATE TABLE IF NOT EXISTS purchase_items (
  id           TEXT PRIMARY KEY,
  purchase_id  TEXT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  model_id     TEXT NOT NULL REFERENCES models(id),
  qty          INTEGER NOT NULL DEFAULT 1,
  unit_cost    REAL NOT NULL DEFAULT 0,
  discount     REAL NOT NULL DEFAULT 0,
  gst_rate     REAL NOT NULL DEFAULT 0,
  tax_amount   REAL NOT NULL DEFAULT 0,
  line_total   REAL NOT NULL DEFAULT 0,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS ix_purchase_items_purchase ON purchase_items(purchase_id);

-- ===========================================================================
--  STOCK  (one row = one physical unit)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS stock_units (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  model_id         TEXT NOT NULL REFERENCES models(id),
  imei1            TEXT,
  imei2            TEXT,
  serial_no        TEXT,
  color            TEXT,
  condition        TEXT NOT NULL DEFAULT 'New',
  cost_price       REAL NOT NULL DEFAULT 0,
  sale_price       REAL NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'in_stock',
  current_shop_id  TEXT REFERENCES shops(id),
  origin_shop_id   TEXT REFERENCES shops(id),
  purchase_id      TEXT REFERENCES purchases(id),
  purchase_item_id TEXT REFERENCES purchase_items(id),
  supplier_id      TEXT REFERENCES suppliers(id),
  sale_id          TEXT,
  sale_item_id     TEXT,
  sold_at          TEXT,
  transfer_id      TEXT,
  warranty_months  INTEGER NOT NULL DEFAULT 12,
  box_no           TEXT,
  notes            TEXT,
  added_at         TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_stock_imei
  ON stock_units(company_id, imei1) WHERE imei1 IS NOT NULL AND imei1 <> '';
CREATE INDEX IF NOT EXISTS ix_stock_shop_status ON stock_units(current_shop_id, status);
CREATE INDEX IF NOT EXISTS ix_stock_model ON stock_units(model_id, status);
CREATE INDEX IF NOT EXISTS ix_stock_company_added ON stock_units(company_id, added_at);
CREATE INDEX IF NOT EXISTS ix_stock_sale ON stock_units(sale_id);

-- ===========================================================================
--  TRANSFERS  (Shop 1 -> Shop 2 etc.)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS transfers (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  transfer_no    TEXT NOT NULL,
  from_shop_id   TEXT NOT NULL REFERENCES shops(id),
  to_shop_id     TEXT NOT NULL REFERENCES shops(id),
  transfer_date  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'in_transit',
  total_units    INTEGER NOT NULL DEFAULT 0,
  total_value    REAL NOT NULL DEFAULT 0,
  notes          TEXT,
  created_by     TEXT,
  received_by    TEXT,
  received_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_transfers_date ON transfers(company_id, transfer_date);
CREATE INDEX IF NOT EXISTS ix_transfers_to ON transfers(to_shop_id, status);

CREATE TABLE IF NOT EXISTS transfer_items (
  id             TEXT PRIMARY KEY,
  transfer_id    TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  stock_unit_id  TEXT NOT NULL REFERENCES stock_units(id),
  cost_at_transfer REAL NOT NULL DEFAULT 0,
  transfer_price REAL NOT NULL DEFAULT 0,
  received       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_transfer_items_transfer ON transfer_items(transfer_id);

-- ===========================================================================
--  SALES
-- ===========================================================================
CREATE TABLE IF NOT EXISTS sales (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  customer_id    TEXT REFERENCES customers(id),
  invoice_no     TEXT NOT NULL,
  sale_date      TEXT NOT NULL,
  subtotal       REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  other_charges  REAL NOT NULL DEFAULT 0,
  round_off      REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  paid_amount    REAL NOT NULL DEFAULT 0,
  due_amount     REAL NOT NULL DEFAULT 0,
  payment_mode   TEXT,
  is_credit      INTEGER NOT NULL DEFAULT 0,
  due_date       TEXT,
  promised_note  TEXT,
  status         TEXT NOT NULL DEFAULT 'completed',
  total_cost     REAL NOT NULL DEFAULT 0,
  total_profit   REAL NOT NULL DEFAULT 0,
  notes          TEXT,
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sales_invoice ON sales(company_id, invoice_no);
CREATE INDEX IF NOT EXISTS ix_sales_date ON sales(company_id, sale_date);
CREATE INDEX IF NOT EXISTS ix_sales_shop_date ON sales(shop_id, sale_date);
CREATE INDEX IF NOT EXISTS ix_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS ix_sales_credit ON sales(company_id, is_credit, due_amount);

CREATE TABLE IF NOT EXISTS sale_items (
  id            TEXT PRIMARY KEY,
  sale_id       TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  stock_unit_id TEXT REFERENCES stock_units(id),
  model_id      TEXT NOT NULL REFERENCES models(id),
  imei1         TEXT,
  description   TEXT,
  qty           INTEGER NOT NULL DEFAULT 1,
  unit_price    REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  gst_rate      REAL NOT NULL DEFAULT 0,
  tax_amount    REAL NOT NULL DEFAULT 0,
  line_total    REAL NOT NULL DEFAULT 0,
  cost_price    REAL NOT NULL DEFAULT 0,
  profit        REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS ix_sale_items_model ON sale_items(model_id);

-- ===========================================================================
--  MONEY IN / OUT
-- ===========================================================================
CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shop_id      TEXT REFERENCES shops(id),
  direction    TEXT NOT NULL,            -- 'in' (from customer) | 'out' (to supplier)
  party_type   TEXT NOT NULL,            -- 'customer' | 'supplier'
  party_id     TEXT,
  sale_id      TEXT REFERENCES sales(id) ON DELETE CASCADE,
  purchase_id  TEXT REFERENCES purchases(id) ON DELETE CASCADE,
  amount       REAL NOT NULL,
  payment_date TEXT NOT NULL,
  mode         TEXT,
  reference    TEXT,
  notes        TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payments_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS ix_payments_party ON payments(party_type, party_id);
CREATE INDEX IF NOT EXISTS ix_payments_date ON payments(company_id, payment_date);

-- ===========================================================================
--  RECONCILIATION
-- ===========================================================================
CREATE TABLE IF NOT EXISTS recon_reasons (
  code       TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  direction  TEXT NOT NULL DEFAULT 'both',
  is_system  INTEGER NOT NULL DEFAULT 1,
  is_active  INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reconciliations (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shop_id        TEXT NOT NULL REFERENCES shops(id),
  title          TEXT,
  from_date      TEXT NOT NULL,
  to_date        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  scope          TEXT NOT NULL DEFAULT 'model',   -- 'model' | 'imei'
  notes          TEXT,
  total_variance INTEGER NOT NULL DEFAULT 0,
  variance_value REAL NOT NULL DEFAULT 0,
  created_by     TEXT,
  finalized_by   TEXT,
  finalized_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_recon_shop ON reconciliations(shop_id, to_date);

CREATE TABLE IF NOT EXISTS reconciliation_items (
  id                TEXT PRIMARY KEY,
  reconciliation_id TEXT NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  model_id          TEXT NOT NULL REFERENCES models(id),
  opening_qty       INTEGER NOT NULL DEFAULT 0,
  purchased_qty     INTEGER NOT NULL DEFAULT 0,
  transfer_in_qty   INTEGER NOT NULL DEFAULT 0,
  transfer_out_qty  INTEGER NOT NULL DEFAULT 0,
  sold_qty          INTEGER NOT NULL DEFAULT 0,
  adjusted_qty      INTEGER NOT NULL DEFAULT 0,
  expected_qty      INTEGER NOT NULL DEFAULT 0,
  physical_qty      INTEGER,
  variance          INTEGER NOT NULL DEFAULT 0,
  unit_cost         REAL NOT NULL DEFAULT 0,
  variance_value    REAL NOT NULL DEFAULT 0,
  reason_code       TEXT,
  reason_note       TEXT,
  missing_unit_ids  TEXT,
  counted_by        TEXT,
  counted_at        TEXT
);
CREATE INDEX IF NOT EXISTS ix_recon_items ON reconciliation_items(reconciliation_id);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  shop_id           TEXT REFERENCES shops(id),
  stock_unit_id     TEXT REFERENCES stock_units(id),
  model_id          TEXT REFERENCES models(id),
  qty               INTEGER NOT NULL DEFAULT 1,
  from_status       TEXT,
  to_status         TEXT,
  reason_code       TEXT,
  reason_note       TEXT,
  value_impact      REAL NOT NULL DEFAULT 0,
  reconciliation_id TEXT REFERENCES reconciliations(id) ON DELETE SET NULL,
  created_by        TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_adjust_shop ON stock_adjustments(shop_id, created_at);

-- ===========================================================================
--  SYSTEM
-- ===========================================================================
CREATE TABLE IF NOT EXISTS counters (
  id         TEXT PRIMARY KEY,          -- company:shop:kind:fy
  next_no    INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  company_id TEXT,
  shop_id    TEXT,
  user_id    TEXT,
  user_name  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  summary    TEXT,
  meta       TEXT,
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(company_id, at);

CREATE TABLE IF NOT EXISTS notifications (
  id                TEXT PRIMARY KEY,
  company_id        TEXT,
  shop_id           TEXT,
  user_id           TEXT,
  type              TEXT NOT NULL,
  severity          TEXT NOT NULL DEFAULT 'info',
  title             TEXT NOT NULL,
  body              TEXT,
  link              TEXT,
  entity            TEXT,
  entity_id         TEXT,
  due_at            TEXT,
  dedupe_key        TEXT,
  is_read           INTEGER NOT NULL DEFAULT 0,
  delivered_desktop INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notif_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_notif_unread ON notifications(company_id, is_read, created_at);
`

export const MIGRATIONS: Migration[] = [{ version: 1, name: 'initial schema', sql: V1 }]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
