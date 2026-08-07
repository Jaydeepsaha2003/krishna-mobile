import log from 'electron-log/main'
import { connect, migrate, startAutoSync } from './db'
import { seed } from './db/seed'

/**
 * Opens the database, applies migrations and seeds first-run data.
 * Safe to call again from the UI when the first attempt failed (no internet,
 * bad credentials) — `connect()` is idempotent once a client exists.
 */
export async function startDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    await connect()
    const applied = await migrate()
    await seed()
    startAutoSync()
    log.info(`[main] database ready (${applied} migration(s) applied)`)
    return { ok: true }
  } catch (err: any) {
    const message = err?.message ?? String(err)
    log.error('[main] database start-up failed', err)
    return { ok: false, error: message }
  }
}
