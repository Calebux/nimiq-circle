import 'server-only'
import { one } from './db'
import { serverConfig } from './env'
import { getBalance, getStaker } from './nimiq/rpc'
import { floatStatus } from './treasury'

const CACHE_MS = 60_000
let cached: { at: number; surplus: number; liabilities: number } | null = null

/** Operator-owned NIM in the pool (test funding, fee float). Never paid out as yield. */
const floatLuna = () => Math.round(Number(process.env.POOL_FLOAT_NIM ?? 0) * 100_000)

/** NIM owed to members: real deposits minus real money already sent back out. Simulated rows are excluded. */
async function liabilities(): Promise<number> {
  const row = await one<{ owed: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE tx_hash NOT LIKE 'mock-%')
     - (SELECT COALESCE(SUM(pot + bonus), 0) FROM payouts WHERE status IN ('sent', 'cashing', 'cashed') AND COALESCE(tx_hash, '') NOT LIKE 'mock-%')
     - (SELECT COALESCE(SUM(amount + bonus), 0) FROM withdrawals WHERE status IN ('sent', 'cashing', 'cashed') AND COALESCE(tx_hash, '') NOT LIKE 'mock-%')
     AS owed`,
  )
  return row?.owed ?? 0
}

/**
 * Staking rewards not yet paid out: what the pool really holds (liquid + every staker bucket)
 * minus what it owes, the operator float, and NIM the treasury bought. Read from chain, cached for a minute.
 */
async function poolSurplus() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached
  const pool = serverConfig().nim.poolAddress
  const owed = await liabilities()
  if (!pool) return { at: Date.now(), surplus: 0, liabilities: owed }
  const [liquid, staker, treasury] = await Promise.all([getBalance(pool), getStaker(pool), floatStatus()])
  const assets = liquid + (staker ? staker.balance + staker.inactiveBalance + staker.retiredBalance : 0)
  // NIM the treasury bought from cash-outs still sits in the pool but is ours, not members'.
  const operator = floatLuna() + treasury.nimLunaReal
  cached = { at: Date.now(), surplus: Math.max(0, assets - owed - operator), liabilities: owed }
  return cached
}

/** This pot's share of the yield so far, in luna. Simulated (dev) pots earn nothing. */
export async function yieldShare(balanceLuna: number, simulated: boolean): Promise<number> {
  if (simulated || balanceLuna <= 0) return 0
  const { surplus, liabilities: total } = await poolSurplus()
  if (total <= 0) return 0
  return Math.floor((surplus * Math.min(balanceLuna, total)) / total)
}

export function invalidateYield() {
  cached = null
}
