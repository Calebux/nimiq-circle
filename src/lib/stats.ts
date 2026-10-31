import 'server-only'
import { UNIT } from './currency'
import { one } from './db'

/**
 * Public usage numbers. Only real money counts: test wallets, bots, practice circles and
 * simulated (mock-) transactions are all left out.
 */
export async function publicStats() {
  const real = "u.dev = 0 AND COALESCE(x.tx_hash, '') NOT LIKE 'mock-%'"
  const row = await one<{
    circles: number
    goals: number
    savers: number
    nim: number
    usdt: number
    pots: number
    ngn: number
  }>(
    `SELECT
       (SELECT COUNT(*) FROM circles c JOIN users u ON u.address = c.created_by
         WHERE u.dev = 0 AND c.practice = 0 AND c.status IN ('active', 'done')) AS circles,
       (SELECT COUNT(*) FROM goals g JOIN users u ON u.address = g.owner WHERE u.dev = 0) AS goals,
       (SELECT COUNT(DISTINCT x.address) FROM deposits x JOIN users u ON u.address = x.address WHERE ${real}) AS savers,
       (SELECT COALESCE(SUM(x.amount), 0) FROM deposits x JOIN users u ON u.address = x.address WHERE ${real} AND x.currency = 'NIM') AS nim,
       (SELECT COALESCE(SUM(x.amount), 0) FROM deposits x JOIN users u ON u.address = x.address WHERE ${real} AND x.currency = 'USDT') AS usdt,
       (SELECT COUNT(*) FROM payouts x JOIN users u ON u.address = x.address JOIN circles c ON c.id = x.circle_id
         WHERE ${real} AND c.practice = 0 AND x.kind = 'pot' AND x.status IN ('sent', 'cashing', 'cashed')) AS pots,
       (SELECT COALESCE(SUM(x.ngn), 0) FROM payouts x JOIN users u ON u.address = x.address JOIN circles c ON c.id = x.circle_id
         WHERE ${real} AND c.practice = 0 AND x.status = 'cashed')
     + (SELECT COALESCE(SUM(x.ngn), 0) FROM withdrawals x JOIN users u ON u.address = x.address
         WHERE ${real} AND x.status = 'cashed') AS ngn`,
  )
  return {
    circles: row?.circles ?? 0,
    goals: row?.goals ?? 0,
    savers: row?.savers ?? 0,
    savedNim: (row?.nim ?? 0) / UNIT.NIM,
    savedUsdt: (row?.usdt ?? 0) / UNIT.USDT,
    potsPaid: row?.pots ?? 0,
    cashedOutNgn: row?.ngn ?? 0,
  }
}
export type PublicStats = Awaited<ReturnType<typeof publicStats>>
