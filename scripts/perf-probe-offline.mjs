/**
 * Tests libSQL offline-writes mode: are writes local/instant, and does sync()
 * push+pull? Uses a no-op write (0 rows) so nothing is modified on the primary.
 */
import { createClient } from '@libsql/client'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import dotenv from 'dotenv'

const env = dotenv.parse(readFileSync(new URL('../.env', import.meta.url)))
const noop = { sql: "UPDATE companies SET updated_at = updated_at WHERE id = '__none__'", args: [] }

async function time(label, fn, limit = 20000) {
  const t0 = performance.now()
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT >${limit}ms`)), limit))
    ])
    console.log(`${label.padEnd(40)} ${(performance.now() - t0).toFixed(1)}ms`)
  } catch (e) {
    console.log(`${label.padEnd(40)} ${e.message}`)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'perf-off-'))
const db = createClient({
  url: `file:${join(dir, 'r.db')}`,
  syncUrl: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
  offline: true,
  intMode: 'number'
})

console.log('=== EMBEDDED REPLICA with offline: true ===')
await time('initial sync (pull from primary)', () => db.sync())
await time('read: COUNT(*) customers', () => db.execute('SELECT COUNT(*) FROM customers'))
await time('1 local write', () => db.execute(noop))
await time('10 local writes (sequential)', async () => {
  for (let i = 0; i < 10; i++) await db.execute(noop)
})
await time('batch of 50 local writes', () => db.batch(Array.from({ length: 50 }, () => noop), 'write'))
await time('interactive transaction (8 writes) — like tx()', async () => {
  const t = await db.transaction('write')
  for (let i = 0; i < 8; i++) await t.execute(noop)
  await t.commit()
})
await time('sync() after writes (push+pull)', () => db.sync())

db.close()
process.exit(0)
