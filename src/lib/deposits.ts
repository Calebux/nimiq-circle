import 'server-only'
import { createHmac } from 'node:crypto'
import type { User } from './auth'
import type { Currency } from './currency'
import { all, newId, run } from './db'
import { serverConfig } from './env'
import { ApiError } from './errors'
import { evmPoolAddress, getUsdtDeposit, sameEvm } from './evm/polygon'
import { compactAddress, formatAddress, sameAddress } from './nimiq/address'
import { decodeData } from './nimiq/contribution'
import { getAccount, getTransaction, getTransactionsByAddress, type ChainTransaction } from './nimiq/rpc'

export type DepositKind = 'circle' | 'goal'

/** Memos stay well under Nimiq's 64-byte data limit. */
export const circleMemo = (circleId: string, round: number) => `cc:${circleId}:${round}`
export const goalMemo = (goalId: string) => `cg:${goalId}`

/**
 * USDT memos also carry a short tag derived from the member's Nimiq address. A Polygon
 * transfer is not signed by the Nimiq key, so the tag is what stops someone claiming another
 * member's transfer by its hash.
 */
function userTag(address: string) {
  const secret = serverConfig().sessionSecret
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return createHmac('sha256', secret).update(`usdt:${compactAddress(address)}`).digest('hex').slice(0, 8)
}
export const memoFor = (user: Pick<User, 'address'>, base: string, currency: Currency) => (currency === 'USDT' ? `${base}:${userTag(user.address)}` : base)

export interface DepositRow {
  tx_hash: string
  kind: DepositKind
  ref_id: string
  round: number | null
  address: string
  amount: number
  memo: string
  status: 'confirmed'
  currency: Currency
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
  // check 1 showed Nimiq Pay returns the tx hash; the memo scan covers anything else. With a
  // hash, wait for that exact transaction: goal top-ups share one memo, so a scan would find an
  // earlier top-up and report this one confirmed before it lands.
  if (hint && /^[0-9a-f]{64}$/i.test(hint)) return getTransaction(hint.toLowerCase())
  const known = new Set((await all<{ tx_hash: string }>('SELECT tx_hash FROM deposits WHERE memo = ?', [memo])).map((r) => r.tx_hash))
  return (await poolHistory()).find((tx) => decodeData(tx.recipientData) === memo && !known.has(tx.hash)) ?? null
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

async function insert(row: Omit<DepositRow, 'status' | 'created_at' | 'currency'> & { currency?: Currency }): Promise<DepositRow> {
  await run(
    `INSERT OR IGNORE INTO deposits (tx_hash, kind, ref_id, round, address, amount, memo, status, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
    [row.tx_hash, row.kind, row.ref_id, row.round, row.address, row.amount, row.memo, row.currency ?? 'NIM', Date.now()],
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
  currency: Currency
  /** Dev wallet only: amount the simulated payment carried. */
  devAmount?: number
  /** Practice circles: nothing is paid, record it as simulated for anyone. */
  simulated?: boolean
}): Promise<DepositResult> {
  const { user, kind, refId, round, memo, minAmount, hint, currency } = input

  if (input.simulated || hint?.startsWith('mock:')) {
    if (!input.simulated && (!user.dev || !serverConfig().devWallet)) throw new ApiError('Simulated payments are disabled')
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
      currency,
    })
    return { status: 'confirmed', deposit }
  }

  if (currency === 'USDT') {
    if (!hint || !/^0x[0-9a-f]{64}$/i.test(hint)) throw new ApiError('Missing the transfer from Nimiq Pay')
    const pending: EvmPendingRow = { tx_hash: hint.toLowerCase(), kind, ref_id: refId, round, address: user.address, memo, min_amount: minAmount, created_at: Date.now() }
    // Remember it first, so the worker can finish if the app closes before it confirms.
    await run('INSERT OR IGNORE INTO evm_pending (tx_hash, kind, ref_id, round, address, memo, min_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      pending.tx_hash, pending.kind, pending.ref_id, pending.round, pending.address, pending.memo, pending.min_amount, pending.created_at,
    ])
    return checkUsdt(pending)
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

interface EvmPendingRow {
  tx_hash: string
  kind: DepositKind
  ref_id: string
  round: number | null
  address: string
  memo: string
  min_amount: number
  created_at: number
}

/** Check a reported USDT transfer against what it was for; record it once confirmed. */
async function checkUsdt(p: EvmPendingRow): Promise<DepositResult> {
  const drop = () => run('DELETE FROM evm_pending WHERE tx_hash = ?', [p.tx_hash])
  let tx
  try {
    tx = await getUsdtDeposit(p.tx_hash)
  } catch {
    await drop()
    throw new ApiError('That payment was not a USDT transfer')
  }
  if (!tx) return { status: 'not_found' }
  const fail = async (message: string) => {
    await drop()
    throw new ApiError(message)
  }
  if (!sameEvm(tx.to, evmPoolAddress()) || tx.memo !== p.memo) return fail('That payment was not for this')
  if (tx.status === 'failed') return fail('That payment failed on the network')
  if (tx.amount < p.min_amount) return fail('That payment was less than the amount due')
  if (tx.status === 'pending') return { status: 'pending' }
  const deposit = await insert({ tx_hash: tx.hash.toLowerCase(), kind: p.kind, ref_id: p.ref_id, round: p.round, address: p.address, amount: tx.amount, memo: p.memo, currency: 'USDT' })
  // USDT payouts go back to the wallet the member pays from.
  await run('UPDATE users SET evm_address = ? WHERE address = ?', [tx.from, p.address])
  await drop()
  return { status: 'confirmed', deposit }
}

/** Worker: finish USDT transfers the app reported but stopped watching. Gives up after a day. */
export async function syncEvmPending() {
  const done: { kind: DepositKind; refId: string }[] = []
  for (const p of await all<EvmPendingRow>('SELECT * FROM evm_pending')) {
    if (Date.now() - p.created_at > 86_400_000) {
      await run('DELETE FROM evm_pending WHERE tx_hash = ?', [p.tx_hash])
      continue
    }
    const result = await checkUsdt(p).catch(() => null)
    if (result?.status === 'confirmed') done.push({ kind: p.kind, refId: p.ref_id })
  }
  return done
}

export const isSimulated = (txHash: string | null | undefined) => Boolean(txHash?.startsWith('mock-'))
