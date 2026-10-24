import type { CreatePayoutInput, OfframpPayout, OfframpProvider } from './types'

const payouts = new Map<string, OfframpPayout>()

/** Mock NGN per USDT, a little under the market so the provider earns something. */
const MOCK_USDT_NGN = 1_330
const FEE_RATE = 0.005
const MIN_FEE_NGN = 50
const SETTLE_MS = 8_000

/** In-memory provider with the shape of a real USDT payout API. Payouts settle after a few seconds. */
export const mockProvider: OfframpProvider = {
  name: 'mock',

  async resolveAccount({ accountNumber }) {
    if (!/^\d{10}$/.test(accountNumber)) throw new Error('Account numbers are 10 digits')
    return { accountName: 'ADA OBI (TEST)' }
  },

  async quote({ usdtMicro }) {
    const gross = (usdtMicro / 1e6) * MOCK_USDT_NGN
    const feeNgn = Math.max(MIN_FEE_NGN, Math.round(gross * FEE_RATE))
    return { rate: MOCK_USDT_NGN, feeNgn, ngnOut: Math.max(0, Math.floor(gross - feeNgn)) }
  },

  async createPayout(input: CreatePayoutInput) {
    const existing = [...payouts.values()].find((p) => p.reference === input.reference)
    if (existing) return existing
    const payout: OfframpPayout = { id: `p_${crypto.randomUUID().slice(0, 8)}`, reference: input.reference, status: 'processing', ngn: input.ngn, createdAt: Date.now() }
    payouts.set(payout.id, payout)
    return payout
  },

  async getPayout(id) {
    const payout = payouts.get(id)
    if (!payout) throw new Error('Unknown payout')
    if (payout.status === 'processing' && Date.now() - payout.createdAt > SETTLE_MS) {
      payout.status = 'paid'
      payout.paidAt = Date.now()
    }
    return payout
  },
}
