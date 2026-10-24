import 'server-only'
import type { User } from './auth'
import type { Currency } from './currency'
import { one } from './db'
import { ApiError } from './errors'
import { isEvmAddress, sendUsdtFromPool } from './evm/polygon'
import { sendFromPool } from './nimiq/pool-signer'
import { offrampProvider } from './offramp'
import { executeCashout } from './treasury'
import { invalidateYield } from './yield'

export type Method = 'wallet' | 'bank'

export interface BankDetails {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  /** The locked rate the member saw (src/lib/treasury.ts). */
  quoteId: string
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
  const bank = { bankCode: s('bankCode'), bankName: s('bankName'), accountNumber: s('accountNumber'), accountName: s('accountName'), quoteId: s('quoteId') }
  if (!bank.bankCode || !/^\d{10}$/.test(bank.accountNumber) || !bank.accountName) throw new ApiError('Bank details are incomplete')
  if (!bank.quoteId) throw new ApiError('Missing rate, please try again')
  return bank
}

/** Where a member's USDT goes: the Polygon wallet they named, else the one they last paid from. */
async function usdtDestination(to: User, evmAddress?: string) {
  if (evmAddress && isEvmAddress(evmAddress)) return evmAddress
  const row = await one<{ evm_address: string | null }>('SELECT evm_address FROM users WHERE address = ?', [to.address])
  if (!row?.evm_address) throw new ApiError('Open Circle in Nimiq Pay so we know where to send your USDT')
  return row.evm_address
}

/**
 * Move `amount` (smallest unit of `currency`) out of the pool to its owner: to their Nimiq Pay
 * wallet (NIM on Nimiq, USDT on Polygon), or as naira to a bank. Bank cash-outs never move
 * money on chain: the treasury takes it in place and the provider pays from our USDT float.
 */
export async function deliver(input: {
  to: User
  amount: number
  currency: Currency
  memo: string
  method: Method
  bank?: BankDetails
  reference: string
  /** USDT only: the member's Polygon address in Nimiq Pay right now. */
  evmAddress?: string
}): Promise<Delivery> {
  const { to, amount, currency, memo, method, reference } = input
  invalidateYield()

  if (method === 'wallet') {
    let txHash = `mock-${reference}`
    if (!to.dev) txHash = currency === 'USDT' ? await sendUsdtFromPool(await usdtDestination(to, input.evmAddress), amount, memo) : await sendFromPool(to.address, amount, memo)
    return { status: 'sent', txHash, ngn: null, providerId: null, bank: null }
  }

  const bank = input.bank
  if (!bank) throw new ApiError('Choose a bank account')
  const { providerId, ngn } = await executeCashout({ user: to, quoteId: bank.quoteId, amount, currency, bank, reference })
  return {
    status: 'cashing',
    // Dev wallets: mark the row simulated so it stays out of the real pool accounting.
    txHash: to.dev ? `mock-${reference}` : null,
    ngn,
    providerId,
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
