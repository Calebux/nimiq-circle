import 'server-only'
import { formatEther, parseEther } from 'viem'
import type { User } from '@/lib/auth'
import { newId, one, run } from '@/lib/db'
import { ApiError } from '@/lib/errors'
import { evmPoolAddress, fees, gasWalletConfigured, isEvmAddress, polBalance, sendPol, usdtBalance, waitMined } from './polygon'

/**
 * A member who holds USDT but no POL cannot pay the network fee on a USDT transfer, and the
 * wallet's "insufficient funds" is a dead end. So the pool tops them up with a few cents of POL
 * before they pay. It is a faucet, so it is mostly refusal: only members of a USDT circle or goal,
 * only when they are short, once a day each, a few times ever, under a daily budget.
 */

const env = (key: string, fallback: number) => {
  const v = Number(process.env[key])
  return Number.isFinite(v) && v > 0 ? v : fallback
}
/** An 80k-gas USDT transfer at a busy ~325 gwei is about 0.026 POL; the wallet checks for the full max fee. */
const NEED_POL = () => env('GAS_NEED_POL', 0.03)
const DRIP_POL = () => env('GAS_DRIP_POL', 0.05)
const DAILY_POL = () => env('GAS_DAILY_POL', 1)
const LIFETIME_DRIPS = 5
const DAY = 86_400_000

/** Gas settings for the member's own transfer, so Polygon does not refuse it as underpriced. */
export async function transferFees() {
  const f = await fees()
  return { maxFeePerGas: `0x${f.maxFeePerGas.toString(16)}`, maxPriorityFeePerGas: `0x${f.maxPriorityFeePerGas.toString(16)}`, gas: '0x13880' }
}

/** `micro`: the USDT about to be sent. No top-up unless the member actually holds it. */
export async function topUpGas(user: User, evmAddress: string, micro: number) {
  if (!isEvmAddress(evmAddress)) throw new ApiError('That is not a Polygon address')
  const usdt = await usdtBalance(evmAddress)
  const result = (sent: string | null) => transferFees().then((f) => ({ sent, usdt, ...f }))
  if (user.dev || !evmPoolAddress() || !gasWalletConfigured() || usdt < micro) return result(null)

  const have = await polBalance(evmAddress)
  if (have >= parseEther(String(NEED_POL()))) return result(null)

  const saver = await one<{ n: number }>(
    `SELECT
       (SELECT COUNT(*) FROM members m JOIN circles c ON c.id = m.circle_id WHERE m.address = ?1 AND c.currency = 'USDT' AND c.status != 'done')
     + (SELECT COUNT(*) FROM goals WHERE owner = ?1 AND currency = 'USDT' AND status = 'open') AS n`,
    [user.address],
  )
  if (!saver?.n) throw new ApiError('Gas top-ups are for USDT circles and goals')

  const since = Date.now() - DAY
  const usage = await one<{ mineToday: number; mineEver: number; today: number }>(
    `SELECT
       (SELECT COUNT(*) FROM gas_drips WHERE (address = ?1 OR lower(evm_address) = lower(?2)) AND created_at > ?3) AS mineToday,
       (SELECT COUNT(*) FROM gas_drips WHERE address = ?1 OR lower(evm_address) = lower(?2)) AS mineEver,
       (SELECT COALESCE(SUM(pol), 0) FROM gas_drips WHERE created_at > ?3) AS today`,
    [user.address, evmAddress, since],
  )
  const tooMuch = 'You need a little POL for the network fee, and our free top-ups are used up for now. Add about 0.05 POL to your Nimiq Pay wallet and try again.'
  if ((usage?.mineToday ?? 0) > 0 || (usage?.mineEver ?? 0) >= LIFETIME_DRIPS || (usage?.today ?? 0) + DRIP_POL() > DAILY_POL()) throw new ApiError(tooMuch, 429)

  const pol = Math.max(0, DRIP_POL() - Number(formatEther(have)))
  const hash = await sendPol(evmAddress, pol)
  await run('INSERT INTO gas_drips (id, address, evm_address, pol, tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', [newId(10), user.address, evmAddress, pol, hash, Date.now()])
  // The member's transfer would fail if it raced the top-up, so wait for it to land.
  if (!(await waitMined(hash))) throw new ApiError('The network is slow right now. Please try again in a minute.', 503)
  return result(hash)
}
