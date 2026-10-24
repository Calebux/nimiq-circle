import 'server-only'
import type { User } from './auth'
import { UNIT, type Currency } from './currency'
import { newId, one, run } from './db'
import { ApiError } from './errors'
import { sameAddress } from './nimiq/address'
import { offrampProvider } from './offramp'
import { nimUsd } from './pricing'

/**
 * The float model. A member cashes out NIM; the treasury buys that NIM (it stays in the pool,
 * now owned by us) and pays naira through the provider out of a USDT balance we prefunded.
 * Converting the NIM back to USDT happens later, in batches (`npm run treasury -- rebalance`),
 * so a member never waits on a swap.
 *
 * USDT savings skip the NIM leg: the member's USDT stays in the Polygon pool (now ours) and the
 * provider pays the same amount out of the float. No spread, no price risk.
 */

const USDT = 1_000_000 // micro-USDT per USDT

const env = (key: string, fallback: number) => {
  const v = Number(process.env[key])
  return Number.isFinite(v) && v >= 0 ? v : fallback
}
const settings = () => ({
  /** Our margin on the NIM leg, covering price moves until we rebalance. */
  spreadBps: env('TREASURY_SPREAD_BPS', 150),
  usdtSpreadBps: env('TREASURY_USDT_SPREAD_BPS', 0),
  quoteTtlMs: env('QUOTE_TTL_SECONDS', 90) * 1000,
  maxPerCashout: env('CASHOUT_MAX_USDT', 250) * USDT,
  maxPerDay: env('CASHOUT_DAILY_MAX_USDT', 1000) * USDT,
  /** Below this the provider's fixed fee eats the payout. */
  minNgn: env('CASHOUT_MIN_NGN', 200),
})

interface QuoteRow {
  id: string
  address: string
  /** Amount cashed out, in the smallest unit of `currency` (the column predates USDT). */
  nim: number
  currency: Currency
  usdt: number
  ngn: number
  nim_usd: number
  usdt_ngn: number
  fee_ngn: number
  spread_bps: number
  expires_at: number
  used_at: number | null
  created_at: number
}

export async function floatStatus() {
  const row = await one<{ float: number; nim: number; nimReal: number; today: number }>(
    `SELECT
       COALESCE(SUM(usdt), 0) AS float,
       COALESCE(SUM(nim), 0) AS nim,
       COALESCE(SUM(CASE WHEN simulated = 0 THEN nim END), 0) AS nimReal,
       COALESCE(-SUM(CASE WHEN kind = 'cashout' AND created_at > ? THEN usdt END), 0) AS today
     FROM treasury_ledger`,
    [Date.now() - 86_400_000],
  )
  return { floatMicro: row?.float ?? 0, nimLuna: row?.nim ?? 0, nimLunaReal: row?.nimReal ?? 0, todayMicro: row?.today ?? 0 }
}

/** Why a cash-out of `usdtMicro` cannot go ahead right now, or null if it can. */
async function blocker(usdtMicro: number, ngn: number): Promise<string | null> {
  const s = settings()
  if (ngn < s.minNgn) return `Cash-outs start at ₦${s.minNgn}. Add a bit more, or keep it in Nimiq Pay.`
  if (usdtMicro > s.maxPerCashout) return `That is above the ${s.maxPerCashout / USDT} USDT cash-out limit. Keep it in Nimiq Pay for now.`
  const status = await floatStatus()
  if (status.todayMicro + usdtMicro > s.maxPerDay) return 'Cash-outs have hit today’s limit. Try again tomorrow, or keep it in Nimiq Pay.'
  if (status.floatMicro < usdtMicro) return 'Cash-outs are topping up right now. Keep it in Nimiq Pay, or try again in a little while.'
  return null
}

function publicQuote(q: QuoteRow, unavailable: string | null) {
  return {
    id: q.id,
    currency: q.currency,
    amount: q.nim / UNIT[q.currency],
    usdt: q.usdt / USDT,
    ngn: q.ngn,
    nimUsd: q.nim_usd,
    usdtNgn: q.usdt_ngn,
    /** Effective NGN per unit (NIM or USDT) the member gets, all in. */
    rate: q.ngn / (q.nim / UNIT[q.currency]),
    feeNgn: q.fee_ngn,
    spreadBps: q.spread_bps,
    expiresAt: q.expires_at,
    available: unavailable === null,
    unavailable,
  }
}
export type PublicQuote = ReturnType<typeof publicQuote>

/**
 * Lock a price for cashing out `amount` (smallest unit): NIM at market NIM/USD minus spread, USDT
 * one to one; then the provider's USDT → NGN.
 */
export async function createQuote(user: User, amount: number, currency: Currency) {
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError('Nothing to cash out')
  const s = settings()
  const price = currency === 'USDT' ? 1 : await nimUsd()
  const spread = currency === 'USDT' ? s.usdtSpreadBps : s.spreadBps
  const usdtMicro = Math.floor((amount / UNIT[currency]) * price * (1 - spread / 10_000) * USDT)
  const provider = await offrampProvider().quote({ usdtMicro })
  const row: QuoteRow = {
    id: newId(10),
    address: user.address,
    nim: amount,
    currency,
    usdt: usdtMicro,
    ngn: provider.ngnOut,
    nim_usd: price,
    usdt_ngn: provider.rate,
    fee_ngn: provider.feeNgn,
    spread_bps: spread,
    expires_at: Date.now() + s.quoteTtlMs,
    used_at: null,
    created_at: Date.now(),
  }
  await run(
    `INSERT INTO quotes (id, address, nim, currency, usdt, ngn, nim_usd, usdt_ngn, fee_ngn, spread_bps, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.address, row.nim, row.currency, row.usdt, row.ngn, row.nim_usd, row.usdt_ngn, row.fee_ngn, row.spread_bps, row.expires_at, row.created_at],
  )
  return publicQuote(row, await blocker(usdtMicro, provider.ngnOut))
}

/**
 * Spend a quote: the provider pays the bank from our float, and the treasury books the NIM it
 * bought. Throws (and moves nothing) if the quote is stale, someone else's, or the float is short.
 */
export async function executeCashout(input: {
  user: User
  quoteId: string
  amount: number
  currency: Currency
  bank: { bankCode: string; accountNumber: string; accountName: string }
  reference: string
}) {
  const q = await one<QuoteRow>('SELECT * FROM quotes WHERE id = ?', [input.quoteId])
  if (!q || !sameAddress(q.address, input.user.address)) throw new ApiError('That rate is not yours. Please try again.')
  if (q.currency !== input.currency) throw new ApiError('The amount changed. Please check the new rate.')
  // Yield can tick between quote and claim; allow a hair of drift, never more.
  if (Math.abs(q.nim - input.amount) > Math.max(UNIT[q.currency], q.nim * 0.005)) throw new ApiError('The amount changed. Please check the new rate.')
  if (q.expires_at < Date.now()) throw new ApiError('That rate expired. Here is a fresh one.', 409)
  const reason = await blocker(q.usdt, q.ngn)
  if (reason) throw new ApiError(reason, 409)

  // Spend the quote once, even if two requests race.
  const claimed = await run('UPDATE quotes SET used_at = ? WHERE id = ? AND used_at IS NULL', [Date.now(), q.id])
  if (claimed.rowsAffected === 0) throw new ApiError('That rate was already used')

  const payout = await offrampProvider().createPayout({ usdtMicro: q.usdt, ngn: q.ngn, ...input.bank, reference: input.reference })
  await run('INSERT INTO treasury_ledger (id, kind, usdt, nim, ref, note, simulated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    newId(10),
    'cashout',
    -q.usdt,
    // USDT cash-outs leave the member's USDT in the Polygon pool; the treasury holds no new NIM.
    q.currency === 'NIM' ? input.amount : 0,
    input.reference,
    q.currency === 'NIM' ? `₦${q.ngn} to ${input.bank.accountName} at ${q.nim_usd} USD/NIM` : `₦${q.ngn} to ${input.bank.accountName}, ${(input.amount / USDT).toFixed(2)} USDT kept in the Polygon pool`,
    input.user.dev ? 1 : 0,
    Date.now(),
  ])
  return { providerId: payout.id, ngn: q.ngn }
}
