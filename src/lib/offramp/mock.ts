import type { CreatePayoutInput, OfframpPayout, OfframpProvider, OfframpQuote } from './types'

const quotes = new Map<string, OfframpQuote>()
const payouts = new Map<string, OfframpPayout>()

/** Pretend NIM/NGN rate. Only the mock uses it. */
const MOCK_RATE_NGN = 1.6
const SETTLE_MS = 8_000

/** In-memory provider with the same shape as a real one. Payouts settle after a few seconds. */
export const mockProvider: OfframpProvider = {
  name: 'mock',
  accepts: ['NIM'],

  async resolveAccount({ accountNumber }) {
    if (!/^\d{10}$/.test(accountNumber)) throw new Error('Account numbers are 10 digits')
    return { accountName: 'ADA OBI (TEST)' }
  },

  async quote({ amount }) {
    const gross = (amount / 1e5) * MOCK_RATE_NGN
    const feeNgn = Math.max(50, Math.round(gross * 0.01))
    const quote: OfframpQuote = {
      id: `q_${crypto.randomUUID().slice(0, 8)}`,
      amountIn: amount,
      ngnOut: Math.max(0, Math.round(gross - feeNgn)),
      rate: MOCK_RATE_NGN,
      feeNgn,
      expiresAt: Date.now() + 5 * 60_000,
    }
    quotes.set(quote.id, quote)
    return quote
  },

  async createPayout(input: CreatePayoutInput) {
    const quote = quotes.get(input.quoteId)
    if (!quote || quote.expiresAt < Date.now()) throw new Error('Quote expired')
    const existing = [...payouts.values()].find((p) => p.reference === input.reference)
    if (existing) return existing
    const payout: OfframpPayout = {
      id: `p_${crypto.randomUUID().slice(0, 8)}`,
      reference: input.reference,
      status: 'processing',
      ngnOut: quote.ngnOut,
      createdAt: Date.now(),
    }
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
