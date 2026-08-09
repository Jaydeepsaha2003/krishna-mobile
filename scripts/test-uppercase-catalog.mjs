/**
 * Verifies brand/model names normalise to uppercase and that duplicates are
 * still caught regardless of the case typed.
 */
import { build } from 'esbuild'
import { createClient } from '@libsql/client'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID as uid } from 'node:crypto'

const outdir = mkdtempSync(join(tmpdir(), 'upc-'))
const outfile = join(outdir, 'schema.mjs')
await build({ entryPoints: ['src/main/db/schema.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { MIGRATIONS } = await import(pathToFileURL(outfile).href)

const db = createClient({ url: `file:${join(outdir, 'u.db')}`, intMode: 'number' })
await db.execute('PRAGMA foreign_keys = ON')
for (const m of MIGRATIONS) await db.executeMultiple(m.sql)

const now = '2026-08-09T00:00:00.000Z'
const co = uid()
await db.execute({ sql: `INSERT INTO companies (id,name,invoice_prefix,fy_start_month,is_active,created_at,updated_at) VALUES (?,?,'INV',4,1,?,?)`, args: [co, 'Co', now, now] })

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

// Mirrors saveBrand's normalisation.
const normBrand = (s) => (s ?? '').trim().toUpperCase()
async function saveBrand(raw) {
  const name = normBrand(raw)
  if (!name) throw new Error('required')
  const clash = (await db.execute({ sql: `SELECT id FROM brands WHERE company_id=? AND lower(name)=lower(?)`, args: [co, name] })).rows[0]
  if (clash) throw new Error(`Brand "${name}" already exists.`)
  const id = uid()
  await db.execute({ sql: `INSERT INTO brands (id,company_id,name,is_active,created_at,updated_at) VALUES (?,?,?,1,?,?)`, args: [id, co, name, now, now] })
  return id
}

// typed in mixed case -> stored uppercase
const vivoId = await saveBrand('  vivo  ')
const stored = (await db.execute({ sql: `SELECT name FROM brands WHERE id=?`, args: [vivoId] })).rows[0].name
chk(stored === 'VIVO', `brand "  vivo  " stored as "VIVO" (got "${stored}")`)

// duplicate in any case is rejected
let rejected = false
try { await saveBrand('ViVo') } catch { rejected = true }
chk(rejected, 'duplicate brand typed as "ViVo" is rejected')
chk((await db.execute({ sql: `SELECT COUNT(*) n FROM brands WHERE company_id=?`, args: [co] })).rows[0].n === 1, 'only one VIVO brand exists')

// Mirrors saveModel's normalisation.
const upper = (v) => { const s = (v ?? '').trim(); return s === '' ? null : s.toUpperCase() }
const makeSku = (brand, name, ram, storage) => {
  const clean = (s) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
  return [clean(brand), clean(name), clean(ram), clean(storage)].filter(Boolean).join('-')
}
async function saveModel({ brandId, brandName, name, ram, storage, color, sku }) {
  const n = (name ?? '').trim().toUpperCase()
  const finalSku = (sku?.trim() || makeSku(brandName, n, ram, storage)).toUpperCase()
  const clash = (await db.execute({ sql: `SELECT id FROM models WHERE company_id=? AND lower(sku)=lower(?)`, args: [co, finalSku] })).rows[0]
  if (clash) throw new Error(`SKU "${finalSku}" already exists.`)
  const id = uid()
  await db.execute({
    sql: `INSERT INTO models (id,company_id,brand_id,name,sku,category,ram,storage,color,track_imei,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`,
    args: [id, co, brandId, n, finalSku, 'Smartphone', upper(ram), upper(storage), upper(color), now, now]
  })
  return id
}

const mId = await saveModel({ brandId: vivoId, brandName: 'VIVO', name: ' y29 4+128 ', ram: '4gb', storage: '128gb', color: 'midnight black' })
const m = (await db.execute({ sql: `SELECT name, sku, ram, storage, color FROM models WHERE id=?`, args: [mId] })).rows[0]
chk(m.name === 'Y29 4+128', `model name uppercased (got "${m.name}")`)
chk(m.ram === '4GB' && m.storage === '128GB', `ram/storage uppercased (${m.ram} / ${m.storage})`)
chk(m.color === 'MIDNIGHT BLACK', `colour uppercased (got "${m.color}")`)
chk(m.sku === 'VIVO-Y294128-4GB-128GB', `SKU generated uppercase (got "${m.sku}")`)

// duplicate SKU across cases rejected
let skuRejected = false
try { await saveModel({ brandId: vivoId, brandName: 'vivo', name: 'Y29 4+128', ram: '4GB', storage: '128GB' }) } catch { skuRejected = true }
chk(skuRejected, 'duplicate model SKU is rejected regardless of case typed')

// blank optional fields stay NULL (not "")
const m2 = await saveModel({ brandId: vivoId, brandName: 'VIVO', name: 'T3X', ram: '', storage: '', color: '' })
const r2 = (await db.execute({ sql: `SELECT ram, storage, color FROM models WHERE id=?`, args: [m2] })).rows[0]
chk(r2.ram === null && r2.storage === null && r2.color === null, 'empty optional fields stay NULL, not empty strings')

console.log(`\n${fails === 0 ? 'ALL UPPERCASE CHECKS PASSED' : fails + ' FAILED'}`)
db.close()
process.exit(fails === 0 ? 0 : 1)
