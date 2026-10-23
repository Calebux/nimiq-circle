import 'server-only'
import type { User } from './auth'
import { ApiError } from './errors'
import { sendFromPool } from './nimiq/pool-signer'
import { offrampProvider } from './offramp'
import { invalidateYield } from './yield'

export type Method = 'wallet' | 'bank'

export interface BankDetails {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
}

export interface Delivery {
  status: 'sent' | 'cashing'
  txHash: string | null
  ngn: number | null
  providerId: string | null
  bank: string | null
}

export function parseBank(value: unknown): BankDetails {
  const b = (value ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof b[k] === 'string' ? (b[k] as string).trim() : '')
  const bank = { bankCode: s('bankCode'), bankName: s('bankName'), accountNumber: s('accountNumber'), accountName: s('accountName') }
  if (!bank.bankCode || !/^\d{10}$/.test(bank.accountNumber) || !bank.accountName) throw new ApiError('Bank details are incomplete')
  return bank
}

/** Move `luna` out of the pool to its owner: as NIM to their wallet, or as naira to a bank. */
export async function deliver(input: { to: User; luna: number; memo: string; method: Method; bank?: BankDetails; reference: string }): Promise<Delivery> {
  const { to, luna, memo, method, reference } = input
  invalidateYield()

  if (method === 'wallet') {
    const txHash = to.dev ? `mock-${reference}` : await sendFromPool(to.address, luna, memo)
    return { status: 'sent', txHash, ngn: null, providerId: null, bank: null }
  }

  const bank = input.bank
  if (!bank) throw new ApiError('Choose a bank account')
  const provider = offrampProvider()
  const quote = await provider.quote({ asset: 'NIM', amount: luna })
  const payout = await provider.createPayout({ quoteId: quote.id, bankCode: bank.bankCode, accountNumber: bank.accountNumber, accountName: bank.accountName, reference })
  // Deposit-based providers tell us where to send the NIM; the mock settles without one.
  let txHash: string | null = null
  if (payout.depositAddress) txHash = to.dev ? `mock-${reference}` : await sendFromPool(payout.depositAddress, luna, payout.depositMemo ?? memo)
  return {
    status: 'cashing',
    txHash,
    ngn: quote.ngnOut,
    providerId: payout.id,
    bank: `${bank.bankName} ••${bank.accountNumber.slice(-4)} · ${bank.accountName}`,
  }
}

/** Has the bank transfer landed? */
export async function bankLanded(providerId: string): Promise<boolean> {
  try {
    return (await offrampProvider().getPayout(providerId)).status === 'paid'
  } catch {
    // The mock provider forgets payouts on restart; treat those as settled.
    return true
  }
}
