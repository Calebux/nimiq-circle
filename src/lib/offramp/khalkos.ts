import 'server-only'
import type { DepositProvider, OfframpPayout } from './types'

/**
 * KhalkosPay: the pool sends the member's NIM to an order's deposit address and KhalkosPay pays
 * the bank. Docs: https://khalkospay-production.up.railway.app/v1/docs/
 * `kp_test_…` keys use its sandbox, `kp_live_…` keys move real money.
 */

const LUNA = 100_000

const config = () => ({
  url: (process.env.KHALKOS_API_URL || 'https://khalkospay-production.up.railway.app/v1').replace(/\/$/, ''),
  key: process.env.KHALKOS_SECRET_KEY?.trim() ?? '',
})

class KhalkosError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const { url, key } = config()
  if (!key) throw new Error('KHALKOS_SECRET_KEY is not set')
  const headers: Record<string, string> = { authorization: `Bearer ${key}` }
  if (method === 'POST') {
    headers['content-type'] = 'application/json'
    // Every POST needs one; retries with the same key get the first answer back.
    headers['idempotency-key'] = idempotencyKey ?? crypto.randomUUID()
  }
  const res = await fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
  if (!res.ok) throw new KhalkosError(json.error?.message ?? `KhalkosPay ${path} failed (${res.status})`, json.error?.code ?? 'unknown', res.status)
  return json as T
}

/** Luna as the API's decimal string, without float rounding: 2000000 → "20.00000". */
const nimString = (luna: number) => `${Math.floor(luna / LUNA)}.${String(luna % LUNA).padStart(5, '0')}`

interface Rate {
  rate: number
  available: boolean
  minPayoutNgn: number
  maxPayoutNgn: number
}

interface Quote {
  rateNgnPerNim: number
  feeNgn: number
  payoutNgn: number
  minNim: number
  maxNim: number
  belowMinimum: boolean
  aboveMaximum: boolean
}

type Status = 'awaiting_deposit' | 'confirming' | 'paying_out' | 'completed' | 'payout_failed' | 'refunding' | 'refunded' | 'rejected' | 'expired'

interface Offramp {
  id: string
  status: Status
  reference: string | null
  rateNgnPerNim: number
  feeNgn: number
  payoutNgn: number
  deposit: { address: string; memo: string; lunaAmount: string }
  paidAt: string | null
  createdAt: string
}

let rateCache: { at: number; rate: Promise<Rate> } | null = null
function currentRate(): Promise<Rate> {
  if (!rateCache || Date.now() - rateCache.at > 30_000) {
    const rate = call<Rate>('GET', '/rates')
    rate.catch(() => (rateCache = null))
    rateCache = { at: Date.now(), rate }
  }
  return rateCache.rate
}

export const khalkosProvider: DepositProvider = {
  name: 'khalkos',
  model: 'deposit',
  get sandbox() {
    return config().key.startsWith('kp_test_')
  },

  async resolveAccount({ bankCode, accountNumber }) {
    if (!/^\d{10}$/.test(accountNumber)) throw new Error('Account numbers are 10 digits')
    try {
      const account = await call<{ accountName: string }>('POST', '/bank-accounts/resolve', { bankCode, accountNumber }, `resolve-${bankCode}-${accountNumber}`)
      return { accountName: account.accountName }
    } catch (err) {
      if (err instanceof KhalkosError && err.status < 500) throw new Error('We could not find that account. Check the number and bank.')
      throw err
    }
  },

  async rates() {
    return { ngnPerNim: (await currentRate()).rate, ngnPerUsdt: null }
  },

  async quoteNim({ luna }) {
    const [rate, q] = await Promise.all([currentRate(), call<Quote>('POST', '/quotes', { nimAmount: nimString(luna) })])
    let unavailable: string | null = null
    if (!rate.available) unavailable = 'Bank cash-outs are paused right now. Keep it in Nimiq Pay, or try again later.'
    else if (q.belowMinimum) unavailable = `Cash-outs start at ${Math.ceil(q.minNim)} NIM. Add a bit more, or keep it in Nimiq Pay.`
    else if (q.aboveMaximum) unavailable = `That is above the ${Math.floor(q.maxNim)} NIM cash-out limit. Keep it in Nimiq Pay for now.`
    return { rate: q.rateNgnPerNim, feeNgn: q.feeNgn, ngnOut: q.payoutNgn, unavailable }
  },

  async createOfframp({ luna, bankCode, accountNumber, reference, refundAddress }) {
    const o = await call<Offramp>('POST', '/offramps', { nimAmount: nimString(luna), bankCode, accountNumber, reference, refundAddress }, `offramp-${reference}`)
    return { id: o.id, address: o.deposit.address, memo: o.deposit.memo, luna: Number(o.deposit.lunaAmount), ngn: o.payoutNgn, rate: o.rateNgnPerNim, feeNgn: o.feeNgn }
  },

  async reportDeposit(id, txHash, reference) {
    await call('POST', `/offramps/${id}/deposit`, { txHash }, `deposit-${reference}`)
  },

  async simulateDeposit(id, reference) {
    await call('POST', `/sandbox/offramps/${id}/deposit`, {}, `sandbox-${reference}`)
  },

  async getPayout(id) {
    const o = await call<Offramp>('GET', `/offramps/${id}`)
    // Only a finished refund puts the NIM back in the pool; until then the order is still in flight.
    const status: OfframpPayout['status'] = o.status === 'completed' ? 'paid' : o.status === 'refunded' ? 'failed' : 'processing'
    return { id: o.id, reference: o.reference ?? '', status, ngn: o.payoutNgn, createdAt: Date.parse(o.createdAt), paidAt: o.paidAt ? Date.parse(o.paidAt) : undefined }
  },
}
