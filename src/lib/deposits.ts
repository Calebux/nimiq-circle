import 'server-only'
import type { User } from './auth'
import { all, newId, run } from './db'
import { serverConfig } from './env'
import { ApiError } from './errors'
import { sameAddress } from './nimiq/address'
import { decodeData } from './nimiq/contribution'
import { getTransaction, getTransactionsByAddress, type ChainTransaction } from './nimiq/rpc'

export type DepositKind = 'circle' | 'goal'

/** Memos stay well under Nimiq's 64-byte data limit. */
export const circleMemo = (circleId: string, round: number) => `cc:${circleId}:${round}`
export const goalMemo = (goalId: string) => `cg:${goalId}`

export interface DepositRow {
  tx_hash: string
  kind: DepositKind
  ref_id: string
  round: number | null
  address: string
  amount: number
  memo: string
  status: 'confirmed'
  created_at: number
}

export type DepositResult = { status: 'confirmed'; deposit: DepositRow } | { status: 'pending' | 'not_found' }

async function findTx(memo: string, hint: string | null): Promise<ChainTransaction | null> {
  const pool = serverConfig().nim.poolAddress
  if (!pool) throw new Error('POOL_ADDRESS is not configured')
  // check 1 showed Nimiq Pay returns the tx hash; the memo scan covers anything else.
  if (hint && /^[0-9a-f]{64}$/i.test(hint)) {
    const tx = await getTransaction(hint.toLowerCase())
    if (tx) return tx
  }
  const history = await getTransactionsByAddress(pool)
  return history.find((tx) => sameAddress(tx.to, pool) && decodeData(tx.recipientData) === memo) ?? null
}

/**
 * Record a deposit once it is on chain: right recipient, right memo, from the signed-in
 * wallet, at least `minAmount`, confirmed. Idempotent on tx hash.
 */
export async function verifyDeposit(input: {
  user: User
  kind: DepositKind
  refId: string
  round: number | null
  memo: string
  minAmount: number
  hint: string | null
  /** Dev wallet only: amount the simulated payment carried. */
  devAmount?: number
}): Promise<DepositResult> {
  const { user, kind, refId, round, memo, minAmount, hint } = input

  let row: Omit<DepositRow, 'status' | 'created_at'>
  if (hint?.startsWith('mock:')) {
    if (!user.dev || !serverConfig().devWallet) throw new ApiError('Simulated payments are disabled')
    // One simulated payment per circle round per member; goals take any number of top-ups.
    const nonce = kind === 'goal' ? `-${newId(6)}` : ''
    row = { tx_hash: `mock-${memo}-${user.address.replace(/\s/g, '').slice(-6)}${nonce}`, kind, ref_id: refId, round, address: user.address, amount: input.devAmount ?? minAmount, memo }
  } else {
    const tx = await findTx(memo, hint)
    if (!tx) return { status: 'not_found' }
    const pool = serverConfig().nim.poolAddress!
    if (!sameAddress(tx.to, pool) || decodeData(tx.recipientData) !== memo) throw new ApiError('That payment was not for this')
    if (!sameAddress(tx.from, user.address)) throw new ApiError('That payment came from a different wallet')
    if (tx.executionResult === false) throw new ApiError('That payment failed on the network')
    if (tx.value < minAmount) throw new ApiError('That payment was less than the amount due')
    if (!tx.blockNumber || (tx.confirmations ?? 0) < serverConfig().nim.minConfirmations) return { status: 'pending' }
    row = { tx_hash: tx.hash, kind, ref_id: refId, round, address: user.address, amount: tx.value, memo }
  }

  await run(
    `INSERT OR IGNORE INTO deposits (tx_hash, kind, ref_id, round, address, amount, memo, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
    [row.tx_hash, row.kind, row.ref_id, row.round, row.address, row.amount, row.memo, Date.now()],
  )
  const [deposit] = await all<DepositRow>('SELECT * FROM deposits WHERE tx_hash = ?', [row.tx_hash])
  return { status: 'confirmed', deposit }
}

export const isSimulated = (txHash: string | null | undefined) => Boolean(txHash?.startsWith('mock-'))
