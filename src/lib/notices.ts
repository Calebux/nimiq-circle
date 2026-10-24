import 'server-only'
import type { User } from './auth'
import { all, newId, run } from './db'
import { formatAddress } from './nimiq/address'

export type NoticeKind = 'due_soon' | 'late' | 'nudge' | 'pot_ready' | 'missed' | 'late_money' | 'short_pot'

/**
 * Drop a notice in someone's in-app inbox. Mini apps cannot push to the phone, so this is what
 * Home shows. `key` makes it happen once: a reminder for round 3 is never sent twice.
 */
export async function notify(address: string, key: string, kind: NoticeKind, text: string, href: string) {
  await run('INSERT OR IGNORE INTO notices (id, key, address, kind, text, href, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    newId(10),
    key,
    formatAddress(address),
    kind,
    text,
    href,
    Date.now(),
  ])
}

export interface Notice {
  id: string
  kind: NoticeKind
  text: string
  href: string
  created_at: number
}

export function inbox(user: User) {
  return all<Notice>('SELECT id, kind, text, href, created_at FROM notices WHERE address = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT 20', [user.address])
}

export async function markRead(user: User, ids: string[] | 'all') {
  if (ids === 'all') return run('UPDATE notices SET read_at = ? WHERE address = ? AND read_at IS NULL', [Date.now(), user.address])
  if (ids.length === 0) return
  await run(`UPDATE notices SET read_at = ? WHERE address = ? AND id IN (${ids.map(() => '?').join(',')})`, [Date.now(), user.address, ...ids])
}
