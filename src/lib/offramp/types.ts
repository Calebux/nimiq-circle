/**
 * The off-ramp provider pays naira into Nigerian banks out of a USDT balance we prefund.
 * Our treasury buys members' NIM and spends that float; see src/lib/treasury.ts.
 */
export interface OfframpProvider {
  readonly name: string
  resolveAccount(input: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }>
  /** USDT (6 decimals, "micro") → NGN at the provider's rate, after its fee. */
  quote(input: { usdtMicro: number }): Promise<{ rate: number; feeNgn: number; ngnOut: number }>
  /** Pay `ngn` from the prefunded USDT balance. Idempotent on `reference`. */
  createPayout(input: CreatePayoutInput): Promise<OfframpPayout>
  getPayout(id: string): Promise<OfframpPayout>
}

export interface CreatePayoutInput {
  usdtMicro: number
  ngn: number
  bankCode: string
  accountNumber: string
  accountName: string
  /** Our idempotency key, e.g. "cp-<payout id>". */
  reference: string
}

export interface OfframpPayout {
  id: string
  reference: string
  status: 'processing' | 'paid' | 'failed'
  ngn: number
  createdAt: number
  paidAt?: number
}
