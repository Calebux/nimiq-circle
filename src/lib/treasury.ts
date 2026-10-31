import 'server-only'
import type { User } from './auth'
import { UNIT, type Currency } from './currency'
import { newId, one, run } from './db'
import { ApiError } from './errors'
import { serverConfig } from './env'
import { sameAddress } from './nimiq/address'
import { sendFromPool } from './nimiq/pool-signer'
import { offrampProvider, type DepositProvider } from './offramp'
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
 * Lock a price for cashing out `amount` (smallest unit). Float providers: NIM at market NIM/USD
 * minus spread, USDT one to one, then the provider's USDT → NGN. Deposit providers quote NIM → NGN.
 */
export async function createQuote(user: User, amount: number, currency: Currency) {
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError('Nothing to cash out')
  const s = settings()
  const provider = offrampProvider()
  const base = { id: newId(10), address: user.address, nim: amount, currency, used_at: null, expires_at: Date.now() + s.quoteTtlMs, created_at: Date.now() }

  if (provider.model === 'deposit') {
    // The provider takes the NIM itself: no USDT leg, no spread of ours.
    if (currency !== 'NIM') {
      const row: QuoteRow = { ...base, usdt: 0, ngn: 0, nim_usd: 0, usdt_ngn: 0, fee_ngn: 0, spread_bps: 0 }
      return publicQuote(row, 'Bank cash-out for USDT savings is coming soon. Send it to Nimiq Pay for now.')
    }
    const q = await provider.quoteNim({ luna: amount })
    const row: QuoteRow = { ...base, usdt: 0, ngn: q.ngnOut, nim_usd: 0, usdt_ngn: q.rate, fee_ngn: q.feeNgn, spread_bps: 0 }
    await saveQuote(row)
    return publicQuote(row, q.unavailable)
  }

  const price = currency === 'USDT' ? 1 : await nimUsd()
  const spread = currency === 'USDT' ? s.usdtSpreadBps : s.spreadBps
  const usdtMicro = Math.floor((amount / UNIT[currency]) * price * (1 - spread / 10_000) * USDT)
  const quoted = await provider.quote({ usdtMicro })
  const row: QuoteRow = { ...base, usdt: usdtMicro, ngn: quoted.ngnOut, nim_usd: price, usdt_ngn: quoted.rate, fee_ngn: quoted.feeNgn, spread_bps: spread }
  await saveQuote(row)
  return publicQuote(row, await blocker(usdtMicro, quoted.ngnOut))
}

async function saveQuote(row: QuoteRow) {
  await run(
    `INSERT INTO quotes (id, address, nim, currency, usdt, ngn, nim_usd, usdt_ngn, fee_ngn, spread_bps, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.address, row.nim, row.currency, row.usdt, row.ngn, row.nim_usd, row.usdt_ngn, row.fee_ngn, row.spread_bps, row.expires_at, row.created_at],
  )
}

/** The member's own, unexpired quote for this amount, or a reason to fetch a fresh one. */
async function validQuote(input: { user: User; quoteId: string; amount: number; currency: Currency }) {
  const q = await one<QuoteRow>('SELECT * FROM quotes WHERE id = ?', [input.quoteId])
  if (!q || !sameAddress(q.address, input.user.address)) throw new ApiError('That rate is not yours. Please try again.')
  if (q.currency !== input.currency) throw new ApiError('The amount changed. Please check the new rate.')
  // Yield can tick between quote and claim; allow a hair of drift, never more.
  if (Math.abs(q.nim - input.amount) > Math.max(UNIT[q.currency], q.nim * 0.005)) throw new ApiError('The amount changed. Please check the new rate.')
  if (q.expires_at < Date.now()) throw new ApiError('That rate expired. Here is a fresh one.', 409)
  return q
}

/** Practice cash-outs: the quote is checked and used up like a real one, but nothing is paid. */
export async function spendPracticeQuote(input: { user: User; quoteId: string; amount: number; currency: Currency }) {
  const q = await validQuote(input)
  const claimed = await run('UPDATE quotes SET used_at = ? WHERE id = ? AND used_at IS NULL', [Date.now(), q.id])
  if (claimed.rowsAffected === 0) throw new ApiError('That rate was already used')
  return q.ngn
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
  const q = await validQuote(input)
  const provider = offrampProvider()
  if (provider.model === 'float') {
    const reason = await blocker(q.usdt, q.ngn)
    if (reason) throw new ApiError(reason, 409)
  } else if (q.currency !== 'NIM') {
    throw new ApiError('Bank cash-out for USDT savings is coming soon. Send it to Nimiq Pay for now.')
  }

  // Spend the quote once, even if two requests race.
  const claimed = await run('UPDATE quotes SET used_at = ? WHERE id = ? AND used_at IS NULL', [Date.now(), q.id])
  if (claimed.rowsAffected === 0) throw new ApiError('That rate was already used')

  if (provider.model === 'deposit') return depositCashout(provider, q, input)

  const payout = await provider.createPayout({ usdtMicro: q.usdt, ngn: q.ngn, ...input.bank, reference: input.reference })
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
  return { providerId: payout.id, ngn: q.ngn, txHash: null }
}

/**
 * Deposit providers: open an order, send it the member's NIM from the pool, report the hash.
 * The treasury takes nothing on; failed payouts are refunded to the pool.
 */
async function depositCashout(
  provider: DepositProvider,
  q: QuoteRow,
  input: { user: User; amount: number; bank: { bankCode: string; accountNumber: string; accountName: string }; reference: string },
) {
  const simulate = input.user.dev || provider.sandbox
  if (input.user.dev && !provider.sandbox) throw new ApiError('Test wallets cannot cash out for real')
  const pool = serverConfig().nim.poolAddress
  if (!pool) throw new Error('POOL_ADDRESS is not configured')

  let order
  let txHash: string
  try {
    order = await provider.createOfframp({ luna: input.amount, bankCode: input.bank.bankCode, accountNumber: input.bank.accountNumber, reference: input.reference, refundAddress: pool })
    if (order.luna !== input.amount) throw new Error(`${provider.name} asked for ${order.luna} luna, not ${input.amount}`)
    if (simulate) {
      await provider.simulateDeposit(order.id, input.reference)
      txHash = `mock-${input.reference}`
    } else {
      txHash = await sendFromPool(order.address, order.luna, order.memo)
    }
  } catch (err) {
    // Nothing left the pool: give the quote back so the member can retry with it.
    await run('UPDATE quotes SET used_at = NULL WHERE id = ?', [q.id])
    throw new ApiError(err instanceof Error ? err.message : 'Cash-out failed', 502)
  }
  if (!simulate) await provider.reportDeposit(order.id, txHash, input.reference).catch((err) => console.error('report deposit', order.id, err))

  await run('INSERT INTO treasury_ledger (id, kind, usdt, nim, ref, note, simulated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    newId(10),
    'cashout',
    0,
    0,
    input.reference,
    `₦${order.ngn} to ${input.bank.accountName} via ${provider.name}, ${input.amount / UNIT.NIM} NIM sent to ${order.address}`,
    simulate ? 1 : 0,
    Date.now(),
  ])
  return { providerId: order.id, ngn: order.ngn, txHash }
}
