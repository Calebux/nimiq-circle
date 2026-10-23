import 'server-only'
import type { User } from './auth'
import { all, newId, run } from './db'
import { serverConfig } from './env'
import { ApiError } from './errors'
import { formatAddress, sameAddress } from './nimiq/address'
import { decodeData } from './nimiq/contribution'
import { getAccount, getTransaction, getTransactionsByAddress, type ChainTransaction } from './nimiq/rpc'

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

const HTLC = 2

/**
 * Who really paid. Nimiq Pay keeps funds in an HTLC whose `sender` is the user's own key
 * (the address listAccounts() returns first and sign() signs with), and pays out of that
 * HTLC. So for HTLC payments the owner is the HTLC's sender, read from chain.
 */
const owners = new Map<string, string | null>()
export async function payerOf(tx: ChainTransaction): Promise<string> {
  if (tx.fromType !== HTLC) return formatAddress(tx.from)
  if (!owners.has(tx.from)) {
    const account = await getAccount(tx.from).catch(() => null)
    owners.set(tx.from, account?.type === 'htlc' && account.sender ? formatAddress(account.sender) : null)
  }
  return owners.get(tx.from) ?? formatAddress(tx.from)
}

async function findTx(memo: string, hint: string | null): Promise<ChainTransaction | null> {
  // check 1 showed Nimiq Pay returns the tx hash; the memo scan covers anything else.
  if (hint && /^[0-9a-f]{64}$/i.test(hint)) {
    const tx = await getTransaction(hint.toLowerCase())
    if (tx) return tx
  }
  return (await poolHistory()).find((tx) => decodeData(tx.recipientData) === memo) ?? null
}

let history: { at: number; txs: Promise<ChainTransaction[]> } | null = null
/** Incoming pool transactions, newest first. Shared for a few seconds across requests. */
function poolHistory(): Promise<ChainTransaction[]> {
  const pool = serverConfig().nim.poolAddress
  if (!pool) throw new Error('POOL_ADDRESS is not configured')
  if (!history || Date.now() - history.at > 5_000) {
    history = { at: Date.now(), txs: getTransactionsByAddress(pool, 500).then((txs) => txs.filter((tx) => sameAddress(tx.to, pool))) }
  }
  return history.txs
}

function confirmed(tx: ChainTransaction) {
  return Boolean(tx.blockNumber) && (tx.confirmations ?? 0) >= serverConfig().nim.minConfirmations && tx.executionResult !== false
}

async function insert(row: Omit<DepositRow, 'status' | 'created_at'>): Promise<DepositRow> {
  await run(
    `INSERT OR IGNORE INTO deposits (tx_hash, kind, ref_id, round, address, amount, memo, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)`,
    [row.tx_hash, row.kind, row.ref_id, row.round, row.address, row.amount, row.memo, Date.now()],
  )
  return (await all<DepositRow>('SELECT * FROM deposits WHERE tx_hash = ?', [row.tx_hash]))[0]
}

/**
 * Record a deposit once it is on chain: right recipient, right memo, paid by the signed-in
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

  if (hint?.startsWith('mock:')) {
    if (!user.dev || !serverConfig().devWallet) throw new ApiError('Simulated payments are disabled')
    // One simulated payment per circle round per member; goals take any number of top-ups.
    const nonce = kind === 'goal' ? `-${newId(6)}` : ''
    const deposit = await insert({
      tx_hash: `mock-${memo}-${user.address.replace(/\s/g, '').slice(-6)}${nonce}`,
      kind,
      ref_id: refId,
      round,
      address: user.address,
      amount: input.devAmount ?? minAmount,
      memo,
    })
    return { status: 'confirmed', deposit }
  }

  const tx = await findTx(memo, hint)
  if (!tx) return { status: 'not_found' }
  const pool = serverConfig().nim.poolAddress!
  if (!sameAddress(tx.to, pool) || decodeData(tx.recipientData) !== memo) throw new ApiError('That payment was not for this')
  if (!sameAddress(await payerOf(tx), user.address)) throw new ApiError('That payment came from a different wallet')
  if (tx.executionResult === false) throw new ApiError('That payment failed on the network')
  if (tx.value < minAmount) throw new ApiError('That payment was less than the amount due')
  if (!confirmed(tx)) return { status: 'pending' }
  const deposit = await insert({ tx_hash: tx.hash, kind, ref_id: refId, round, address: user.address, amount: tx.value, memo })
  return { status: 'confirmed', deposit }
}

/**
 * Credit memo-tagged pool payments the app never reported (closed too early, network blip).
 * `accept` decides per payment, given its memo and verified payer; return null to skip.
 */
export async function reconcile(
  kind: DepositKind,
  refId: string,
  accept: (memo: string, payer: string, tx: ChainTransaction) => { round: number | null; address: string } | null,
) {
  const prefix = kind === 'circle' ? `cc:${refId}:` : goalMemo(refId)
  const candidates = (await poolHistory()).filter((tx) => {
    const memo = decodeData(tx.recipientData)
    return kind === 'circle' ? memo.startsWith(prefix) : memo === prefix
  })
  if (candidates.length === 0) return 0
  const known = new Set((await all<{ tx_hash: string }>('SELECT tx_hash FROM deposits WHERE kind = ? AND ref_id = ?', [kind, refId])).map((r) => r.tx_hash))
  let added = 0
  for (const tx of candidates) {
    if (known.has(tx.hash) || !confirmed(tx)) continue
    const memo = decodeData(tx.recipientData)
    const ok = accept(memo, await payerOf(tx), tx)
    if (!ok) continue
    await insert({ tx_hash: tx.hash, kind, ref_id: refId, round: ok.round, address: ok.address, amount: tx.value, memo })
    added++
  }
  return added
}

export const isSimulated = (txHash: string | null | undefined) => Boolean(txHash?.startsWith('mock-'))
