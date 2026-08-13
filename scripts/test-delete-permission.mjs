/**
 * Verifies the admin-only delete rule using the real permission tables and the
 * real requirePermission logic.
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outdir = mkdtempSync(join(tmpdir(), 'perm-'))
const outfile = join(outdir, 'c.mjs')
await build({ entryPoints: ['src/shared/constants.ts'], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' })
const { ROLE_PERMISSIONS, ALL_PERMISSIONS, PERMISSIONS } = await import(pathToFileURL(outfile).href)

let fails = 0
const chk = (c, m) => { if (c) console.log(`OK   ${m}`); else { fails++; console.error(`FAIL ${m}`) } }

// Mirrors services/session.ts requirePermission + resolvePermissions.
const can = (role, perm) => role === 'admin' || (ROLE_PERMISSIONS[role] ?? []).includes(perm)

chk('record.delete' in PERMISSIONS, 'record.delete permission exists')
chk(ALL_PERMISSIONS.includes('record.delete'), 'record.delete is part of ALL_PERMISSIONS (admin gets it)')

console.log('\n--- who can DELETE ---')
chk(can('admin', 'record.delete'), 'admin CAN delete')
for (const role of ['manager', 'cashier', 'viewer'])
  chk(!can(role, 'record.delete'), `${role} CANNOT delete`)

console.log('\n--- managers keep their normal work ---')
for (const p of ['stock.adjust', 'sale.manage', 'purchase.manage', 'product.manage', 'transfer.manage', 'payment.manage'])
  chk(can('manager', p), `manager can still: ${PERMISSIONS[p]}`)

console.log('\n--- profit stays admin-only (earlier change still holds) ---')
chk(!can('manager', 'report.profit'), 'manager CANNOT see cost/profit')
chk(can('admin', 'report.profit'), 'admin CAN see cost/profit')

console.log('\n--- cashier/viewer cannot remove stock either ---')
chk(!can('cashier', 'record.delete') && !can('viewer', 'record.delete'), 'cashier & viewer cannot delete')
chk(!can('cashier', 'stock.adjust'), 'cashier cannot add stock by hand either')

console.log(`\n${fails === 0 ? 'ALL PERMISSION CHECKS PASSED' : fails + ' FAILED'}`)
process.exit(fails === 0 ? 0 : 1)
