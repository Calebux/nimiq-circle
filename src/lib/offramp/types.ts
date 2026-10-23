/**
 * The off-ramp provider's job in the circle: turn a payout into naira in the
 * winner's bank. Real adapters go next to mock.ts once we know the provider.
 */
export interface OfframpProvider {
  readonly name: string
  /** What the provider takes in. Decides whether we need a NIM → stablecoin step first. */
  readonly accepts: readonly ('NIM' | 'USDT' | 'USDC')[]
  /** Look up the account name so the user can confirm before money moves. */
  resolveAccount(input: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }>
  quote(input: { asset: 'NIM'; amount: number }): Promise<OfframpQuote>
  createPayout(input: CreatePayoutInput): Promise<OfframpPayout>
  getPayout(id: string): Promise<OfframpPayout>
}

export interface OfframpQuote {
  id: string
  /** Asset units in, e.g. luna for NIM. */
  amountIn: number
  ngnOut: number
  rate: number
  feeNgn: number
  expiresAt: number
}

export interface CreatePayoutInput {
  quoteId: string
  bankCode: string
  accountNumber: string
  accountName: string
  /** Our idempotency key, e.g. "circle:abc:r3". */
  reference: string
}

export interface OfframpPayout {
  id: string
  reference: string
  status: 'awaiting_deposit' | 'processing' | 'paid' | 'failed'
  /** Where the pool must send the asset, if the provider is deposit-based. */
  depositAddress?: string
  depositMemo?: string
  ngnOut: number
  createdAt: number
  paidAt?: number
}
