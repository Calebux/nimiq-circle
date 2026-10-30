/**
 * Off-ramp providers pay naira into Nigerian banks, in one of two ways:
 * - 'float': out of a USDT balance we prefund; the treasury buys members' NIM (src/lib/treasury.ts).
 * - 'deposit': the pool sends the member's NIM to the provider, which pays the bank itself. NIM only.
 */
interface Common {
  readonly name: string
  resolveAccount(input: { bankCode: string; accountNumber: string }): Promise<{ accountName: string }>
  /** Banks it can pay, popular first. Null: no list, use ours (src/lib/constants.ts). */
  banks(): Promise<{ code: string; name: string }[] | null>
  /** NGN per unit, for "≈ ₦" estimates. Null when the provider has no rate for that currency. */
  rates(): Promise<{ ngnPerNim: number | null; ngnPerUsdt: number | null }>
  getPayout(id: string): Promise<OfframpPayout>
}

export interface FloatProvider extends Common {
  readonly model: 'float'
  /** USDT (6 decimals, "micro") → NGN at the provider's rate, after its fee. */
  quote(input: { usdtMicro: number }): Promise<{ rate: number; feeNgn: number; ngnOut: number }>
  /** Pay `ngn` from the prefunded USDT balance. Idempotent on `reference`. */
  createPayout(input: CreatePayoutInput): Promise<OfframpPayout>
}

export interface DepositProvider extends Common {
  readonly model: 'deposit'
  /** Test keys: nothing moves on chain or at a bank, so the pool must not send real NIM. */
  readonly sandbox: boolean
  quoteNim(input: { luna: number }): Promise<NimQuote>
  /** Lock the rate and get deposit instructions. Idempotent on `reference`. */
  createOfframp(input: CreateOfframpInput): Promise<OfframpOrder>
  /** Optional speed-up: the provider also finds the deposit on chain by its memo. */
  reportDeposit(id: string, txHash: string, reference: string): Promise<void>
  /** Sandbox only: pretend the deposit arrived. */
  simulateDeposit(id: string, reference: string): Promise<void>
}

export type OfframpProvider = FloatProvider | DepositProvider

export interface CreatePayoutInput {
  usdtMicro: number
  ngn: number
  bankCode: string
  accountNumber: string
  accountName: string
  /** Our idempotency key, e.g. "cp-<payout id>". */
  reference: string
}

export interface NimQuote {
  /** NGN per NIM before fees. */
  rate: number
  feeNgn: number
  ngnOut: number
  /** Why this amount cannot be cashed out right now, or null. */
  unavailable: string | null
}

export interface CreateOfframpInput {
  luna: number
  bankCode: string
  accountNumber: string
  reference: string
  /** Where a failed payout's NIM goes back to: the pool. */
  refundAddress: string
}

export interface OfframpOrder {
  id: string
  /** Send exactly `luna` to `address` with `memo` as the transaction message. */
  address: string
  memo: string
  luna: number
  ngn: number
  rate: number
  feeNgn: number
}

export interface OfframpPayout {
  id: string
  reference: string
  /** 'failed': the money came back (refunded to the pool), so the member can try again. */
  status: 'processing' | 'paid' | 'failed'
  ngn: number
  createdAt: number
  paidAt?: number
}
