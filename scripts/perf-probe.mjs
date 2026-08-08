/**
 * Measures write latency. NO-OP writes (0 rows changed) so nothing is modified.
 * Every op is guarded by a timeout so a hang is reported, not waited on.
 */
import { createClient } from '@libsql/client'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import dotenv from 'dotenv'

const env = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)))
const url = env.TURSO_DATABASE_URL
const token = env.TURSO_AUTH_TOKEN
const noop = { sql: "UPDATE companies SET updated_at = updated_at WHERE id = '__none__'", args: [] }

const withTimeout = (p, msLimit, label) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT >${msLimit}ms`)), msLimit))
  ]).catch((e) => ({ __err: e.message, __label: label }))

async function time(label, fn, limit = 15000) {
  const t0 = performance.now()
  const r = await withTimeout(Promise.resolve().then(fn), limit, label)
  const dt = performance.now() - t0
  if (r && r.__err) console.log(`${label.padEnd(44)} ${r.__err}`)
  else console.log(`${label.padEnd(44)} ${dt.toFixed(0)}ms`)
  return dt
}

const remote = createClient({ url, authToken: token, intMode: 'number' })
console.log('=== DIRECT REMOTE connection ===')
await time('SELECT 1 (warm-up)', () => remote.execute('SELECT 1'))
await time('1 no-op write', () => remote.execute(noop))
await time('1 no-op write again', () => remote.execute(noop))
await time('batch of 50 no-op writes', () => remote.batch(Array.from({ length: 50 }, () => noop), 'write'))

const dir = mkdtempSync(join(tmpdir(), 'perf-'))
const replica = createClient({ url: `file:${join(dir, 'r.db')}`, syncUrl: url, authToken: token, intMode: 'number' })
console.log('\n=== EMBEDDED REPLICA (how the app runs now) ===')
await time('initial sync', () => replica.sync(), 20000)
await time('1 no-op write', () => replica.execute(noop))
await time('batch of 50 no-op writes', () => replica.batch(Array.from({ length: 50 }, () => noop), 'write'))

remote.close()
replica.close()
process.exit(0)
