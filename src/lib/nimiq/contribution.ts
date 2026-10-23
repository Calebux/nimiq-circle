import 'server-only'
import { serverConfig } from '@/lib/env'
import { sameAddress } from './address'
import { getTransaction, getTransactionsByAddress, type ChainTransaction } from './rpc'

export function decodeData(hex: string): string {
  if (!hex || !/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) return hex
  return Buffer.from(hex, 'hex').toString('utf8')
}

/** How the wallet's return value related to the chain. This is what check 1 is answering. */
export type HintKind = 'tx-hash' | 'other' | 'none'

export type ContributionCheck = {
  hintKind: HintKind
  /** The hint was a hash and the node knew it. */
  foundByHash: boolean
  status: 'not_found' | 'wrong_recipient' | 'failed_onchain' | 'pending' | 'confirmed'
  tx?: ChainTransaction & { memo: string }
}

function describeHint(hint: string | null | undefined): HintKind {
  if (!hint) return 'none'
  return /^[0-9a-f]{64}$/i.test(hint) ? 'tx-hash' : 'other'
}

function evaluate(tx: ChainTransaction, pool: string): ContributionCheck['status'] {
  if (!sameAddress(tx.to, pool)) return 'wrong_recipient'
  if (tx.executionResult === false) return 'failed_onchain'
  if (!tx.blockNumber || (tx.confirmations ?? 0) < serverConfig().nim.minConfirmations) return 'pending'
  return 'confirmed'
}

/**
 * Find a contribution to the pool. `hint` is whatever Nimiq Pay returned from
 * sendBasicTransactionWithData; if it isn't a hash the node knows, fall back to
 * scanning the pool's history for the memo.
 */
export async function checkContribution(memo: string, hint?: string | null): Promise<ContributionCheck> {
  const pool = serverConfig().nim.poolAddress
  if (!pool) throw new Error('POOL_ADDRESS is not configured')
  const hintKind = describeHint(hint)

  if (hint && hintKind === 'tx-hash') {
    const tx = await getTransaction(hint.toLowerCase())
    if (tx) {
      return { hintKind, foundByHash: true, status: evaluate(tx, pool), tx: { ...tx, memo: decodeData(tx.recipientData) } }
    }
  }

  const history = await getTransactionsByAddress(pool)
  const tx = history.find((candidate) => sameAddress(candidate.to, pool) && decodeData(candidate.recipientData) === memo)
  if (!tx) return { hintKind, foundByHash: false, status: 'not_found' }
  return { hintKind, foundByHash: false, status: evaluate(tx, pool), tx: { ...tx, memo } }
}
