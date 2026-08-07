import { Notification, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { all, one, run } from '../db'
import { newId, nowIso, num, round2, today } from '../utils'
import { getSession } from './session'
import { APP_NAME } from '../../shared/constants'

export type NotifSeverity = 'info' | 'success' | 'warning' | 'danger'

interface NotifDraft {
  type: string
  severity: NotifSeverity
  title: string
  body: string
  link?: string
  entity?: string
  entityId?: string
  dueAt?: string
  dedupeKey: string
  shopId?: string | null
}

async function insert(companyId: string, n: NotifDraft): Promise<boolean> {
  const existing = await one<{ id: string }>('SELECT id FROM notifications WHERE dedupe_key = ?', [
    n.dedupeKey
  ])
  if (existing) return false
  await run(
    `INSERT INTO notifications (id, company_id, shop_id, user_id, type, severity, title, body,
       link, entity, entity_id, due_at, dedupe_key, is_read, delivered_desktop, created_at)
     VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?,?,0,0,?)`,
    [
      newId(),
      companyId,
      n.shopId ?? null,
      n.type,
      n.severity,
      n.title,
      n.body,
      n.link ?? null,
      n.entity ?? null,
      n.entityId ?? null,
      n.dueAt ?? null,
      n.dedupeKey,
      nowIso()
    ]
  )
  return true
}

/**
 * Rebuilds the reminder list. Safe to call often — every notification carries a
 * dedupe key so the same reminder is never raised twice on the same day.
 */
export async function scan(companyId: string): Promise<number> {
  const day = today()
  let created = 0

  /* ---- credit that is overdue ------------------------------------------- */
  const overdue = await all<any>(
    `SELECT s.id, s.invoice_no, s.due_amount, s.due_date, s.shop_id, c.name AS customer_name,
            c.phone_primary,
            CAST(julianday('now','localtime') - julianday(s.due_date) AS INTEGER) AS days
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.company_id = ? AND s.status <> 'cancelled' AND s.due_amount > 0.5
        AND s.due_date IS NOT NULL AND s.due_date < date('now','localtime')
      ORDER BY s.due_date LIMIT 100`,
    [companyId]
  )
  for (const s of overdue) {
    const days = num(s.days)
    const ok = await insert(companyId, {
      type: 'credit_overdue',
      severity: days > 7 ? 'danger' : 'warning',
      title: `Payment overdue — ${s.customer_name ?? 'Customer'}`,
      body: `₹${round2(num(s.due_amount))} on ${s.invoice_no} is ${days} day(s) past the promised date${
        s.phone_primary ? ` · ${s.phone_primary}` : ''
      }`,
      link: `/credit?sale=${s.id}`,
      entity: 'sale',
      entityId: s.id,
      dueAt: s.due_date,
      shopId: s.shop_id,
      dedupeKey: `credit_overdue:${s.id}:${day}`
    })
    if (ok) created++
  }

  /* ---- credit due today / tomorrow -------------------------------------- */
  const dueSoon = await all<any>(
    `SELECT s.id, s.invoice_no, s.due_amount, s.due_date, s.shop_id, c.name AS customer_name,
            c.phone_primary
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.company_id = ? AND s.status <> 'cancelled' AND s.due_amount > 0.5
        AND s.due_date IN (date('now','localtime'), date('now','localtime','+1 day'))
      ORDER BY s.due_date LIMIT 50`,
    [companyId]
  )
  for (const s of dueSoon) {
    const isToday = s.due_date === day
    const ok = await insert(companyId, {
      type: 'credit_due',
      severity: 'info',
      title: `Payment promised ${isToday ? 'today' : 'tomorrow'} — ${s.customer_name ?? 'Customer'}`,
      body: `₹${round2(num(s.due_amount))} on ${s.invoice_no}${
        s.phone_primary ? ` · ${s.phone_primary}` : ''
      }`,
      link: `/credit?sale=${s.id}`,
      entity: 'sale',
      entityId: s.id,
      dueAt: s.due_date,
      shopId: s.shop_id,
      dedupeKey: `credit_due:${s.id}:${s.due_date}`
    })
    if (ok) created++
  }

  /* ---- low stock --------------------------------------------------------- */
  const low = await all<any>(
    `SELECT * FROM (
       SELECT m.id, m.name, m.low_stock_alert, b.name AS brand_name, sh.id AS shop_id,
              sh.name AS shop_name,
              (SELECT COUNT(*) FROM stock_units su
                WHERE su.model_id = m.id AND su.current_shop_id = sh.id
                  AND su.status = 'in_stock') AS qty
         FROM models m
         JOIN brands b ON b.id = m.brand_id
         JOIN shops sh ON sh.company_id = m.company_id AND sh.is_active = 1
        WHERE m.company_id = ? AND m.is_active = 1 AND m.low_stock_alert > 0
     ) WHERE qty > 0 AND qty <= low_stock_alert
     LIMIT 60`,
    [companyId]
  )
  for (const m of low) {
    const ok = await insert(companyId, {
      type: 'low_stock',
      severity: 'warning',
      title: `Low stock — ${m.brand_name} ${m.name}`,
      body: `Only ${num(m.qty)} left at ${m.shop_name} (alert at ${num(m.low_stock_alert)})`,
      link: `/stock?model=${m.id}`,
      entity: 'model',
      entityId: m.id,
      shopId: m.shop_id,
      dedupeKey: `low_stock:${m.id}:${m.shop_id}:${day}`
    })
    if (ok) created++
  }

  /* ---- transfers waiting to be received --------------------------------- */
  const pending = await all<any>(
    `SELECT t.id, t.transfer_no, t.total_units, t.transfer_date, t.to_shop_id,
            f.name AS from_name, d.name AS to_name,
            CAST(julianday('now','localtime') - julianday(t.transfer_date) AS INTEGER) AS days
       FROM transfers t JOIN shops f ON f.id = t.from_shop_id JOIN shops d ON d.id = t.to_shop_id
      WHERE t.company_id = ? AND t.status = 'in_transit' LIMIT 30`,
    [companyId]
  )
  for (const t of pending) {
    const ok = await insert(companyId, {
      type: 'transfer_pending',
      severity: num(t.days) > 2 ? 'warning' : 'info',
      title: `Transfer waiting to be received`,
      body: `${t.transfer_no}: ${num(t.total_units)} unit(s) from ${t.from_name} → ${t.to_name}, sent ${num(t.days)} day(s) ago`,
      link: `/transfers?id=${t.id}`,
      entity: 'transfer',
      entityId: t.id,
      shopId: t.to_shop_id,
      dedupeKey: `transfer_pending:${t.id}:${day}`
    })
    if (ok) created++
  }

  /* ---- supplier bills due ------------------------------------------------ */
  const payable = await all<any>(
    `SELECT p.id, p.invoice_no, p.due_amount, p.due_date, p.shop_id, s.name AS supplier_name
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.company_id = ? AND p.status <> 'cancelled' AND p.due_amount > 0.5
        AND p.due_date IS NOT NULL AND p.due_date <= date('now','localtime','+2 day')
      LIMIT 40`,
    [companyId]
  )
  for (const p of payable) {
    const ok = await insert(companyId, {
      type: 'supplier_due',
      severity: p.due_date < day ? 'danger' : 'info',
      title: `Supplier payment due — ${p.supplier_name ?? 'Supplier'}`,
      body: `₹${round2(num(p.due_amount))} on ${p.invoice_no}, due ${p.due_date}`,
      link: `/purchases?id=${p.id}`,
      entity: 'purchase',
      entityId: p.id,
      dueAt: p.due_date,
      shopId: p.shop_id,
      dedupeKey: `supplier_due:${p.id}:${day}`
    })
    if (ok) created++
  }

  /* ---- stock sitting over 90 days ---------------------------------------- */
  const dead = await all<any>(
    `SELECT sh.id AS shop_id, sh.name AS shop_name, COUNT(*) AS n,
            COALESCE(SUM(su.cost_price),0) AS value
       FROM stock_units su JOIN shops sh ON sh.id = su.current_shop_id
      WHERE su.company_id = ? AND su.status = 'in_stock'
        AND julianday('now','localtime') - julianday(date(su.added_at)) > 90
      GROUP BY sh.id`,
    [companyId]
  )
  for (const d of dead) {
    const ok = await insert(companyId, {
      type: 'ageing_stock',
      severity: 'warning',
      title: `${num(d.n)} handset(s) unsold for 90+ days`,
      body: `₹${round2(num(d.value))} blocked at ${d.shop_name}. Consider a price drop or transfer.`,
      link: `/reports?tab=ageing`,
      entity: 'shop',
      entityId: d.shop_id,
      shopId: d.shop_id,
      dedupeKey: `ageing_stock:${d.shop_id}:${day}`
    })
    if (ok) created++
  }

  if (created > 0) log.info(`[notify] raised ${created} new reminder(s)`)
  return created
}

/* -------------------------------------------------------------------------- */
/*  Reading & delivery                                                         */
/* -------------------------------------------------------------------------- */

export async function list(companyId: string, params?: { unreadOnly?: boolean; limit?: number }) {
  return all<any>(
    `SELECT n.*, sh.name AS shop_name FROM notifications n
       LEFT JOIN shops sh ON sh.id = n.shop_id
      WHERE n.company_id = ? ${params?.unreadOnly ? 'AND n.is_read = 0' : ''}
      ORDER BY n.is_read, n.created_at DESC LIMIT ?`,
    [companyId, params?.limit ?? 100]
  ).then((rows) =>
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      title: r.title,
      body: r.body,
      link: r.link,
      entity: r.entity,
      entityId: r.entity_id,
      dueAt: r.due_at,
      shopName: r.shop_name,
      isRead: !!r.is_read,
      createdAt: r.created_at
    }))
  )
}

export async function markRead(ids: string[]): Promise<void> {
  if (!ids.length) return
  await run(
    `UPDATE notifications SET is_read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  )
}

export async function markAllRead(companyId: string): Promise<void> {
  await run('UPDATE notifications SET is_read = 1 WHERE company_id = ? AND is_read = 0', [companyId])
}

export async function unreadCount(companyId: string): Promise<number> {
  const r = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM notifications WHERE company_id = ? AND is_read = 0',
    [companyId]
  )
  return num(r?.n)
}

/**
 * Fires native Windows toasts for anything not yet delivered, and pushes the
 * same items to the renderer so the in-app bell updates live.
 */
export async function deliverDesktop(companyId: string): Promise<void> {
  if (!Notification.isSupported()) return

  const pending = await all<any>(
    `SELECT * FROM notifications
      WHERE company_id = ? AND delivered_desktop = 0 AND is_read = 0
      ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at
      LIMIT 5`,
    [companyId]
  )
  if (!pending.length) return

  for (const n of pending) {
    try {
      const toast = new Notification({
        title: `${APP_NAME} — ${n.title}`,
        body: n.body ?? '',
        urgency: n.severity === 'danger' ? 'critical' : 'normal',
        timeoutType: n.severity === 'danger' ? 'never' : 'default'
      })
      toast.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
          win.webContents.send('notifications:open', { id: n.id, link: n.link })
        }
      })
      toast.show()
    } catch (err) {
      log.warn('[notify] desktop toast failed', err)
    }
  }

  await run(
    `UPDATE notifications SET delivered_desktop = 1 WHERE id IN (${pending.map(() => '?').join(',')})`,
    pending.map((p) => p.id)
  )

  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send('notifications:new', { count: pending.length })
}

/* -------------------------------------------------------------------------- */
/*  Background loop                                                            */
/* -------------------------------------------------------------------------- */

let timer: NodeJS.Timeout | null = null

export function startReminderLoop(intervalMinutes = 10): void {
  if (timer) return
  const tick = async () => {
    const s = getSession()
    if (!s?.companyId) return
    try {
      await scan(s.companyId)
      await deliverDesktop(s.companyId)
    } catch (err) {
      log.warn('[notify] scan failed', err)
    }
  }
  // First pass shortly after login, then on the interval.
  setTimeout(() => void tick(), 8000)
  timer = setInterval(() => void tick(), intervalMinutes * 60 * 1000)
}

export function stopReminderLoop(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** One-off toast raised directly by an action (e.g. "transfer received"). */
export function toast(title: string, body: string): void {
  if (!Notification.isSupported()) return
  try {
    new Notification({ title: `${APP_NAME} — ${title}`, body }).show()
  } catch {
    /* non-fatal */
  }
}
