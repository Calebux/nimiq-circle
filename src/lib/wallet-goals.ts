import 'server-only'
import { displayName, usersByAddress, type User } from './auth'
import { UNIT } from './currency'
import { all, LUNA, newId, one, run } from './db'
import { goalMemo, payerOf } from './deposits'
import { serverConfig } from './env'
import { ApiError } from './errors'
import { formatAddress, sameAddress } from './nimiq/address'
import { decodeData } from './nimiq/contribution'
import { getBlockNumber, getPolicy, getStaker, getTransaction, getTransactionsByAddress, type ChainStaker, type ChainTransaction } from './nimiq/rpc'
import { notify } from './notices'
import type { PlanStatus } from './goal-friends'

/**
 * Goals whose NIM never leaves the owner's wallet ("custody = wallet").
 *
 * Akilii only keeps a ledger. Savings are staked by the owner's own wallet (they sign every
 * transaction in Nimiq Pay), or, below the network's minimum stake, simply noted as set aside.
 * Friends' gifts are paid straight to the owner. Nothing here is in the pool, so none of it
 * touches the pool's liquidity planning or yield split (those read the `deposits` table only).
 *
 * Because the owner holds the keys, there is no lock and no break fee: they can unstake in
 * Nimiq Pay whenever they like. The goal page compares the ledger with the chain and says so
 * when the wallet's stake is lower than what the goal thinks it staked.
 */

export const STAKING_CONTRACT = 'NQ77 0000 0000 0000 0000 0000 0000 0000 0001'
const HOUR = 3_600_000

interface WalletGoalRow {
  id: string
  owner: string
  name: string
  target: number | null
  status: 'open' | 'closed'
  custody: 'pool' | 'wallet'
  exit_amount: number | null
  exit_started_at: number | null
  exit_retired: number
}

/**
 * One row per thing that changed the goal. `added` is new money for the goal (savings, gifts);
 * `staked` is how much of the goal's money moved into (+) or out of (-) the owner's stake.
 * So: saved = SUM(added), staked = SUM(staked), and the rest sits in the wallet.
 */
interface EntryRow {
  id: string
  goal_id: string
  address: string
  kind: 'stake' | 'note' | 'gift' | 'unstake' | 'withdraw'
  added: number
  staked: number
  tx_hash: string | null
  created_at: number
}

async function ownWalletGoal(user: User, id: string): Promise<WalletGoalRow> {
  const goal = await one<WalletGoalRow>('SELECT * FROM goals WHERE id = ?', [id])
  if (!goal || !sameAddress(goal.owner, user.address)) throw new ApiError('Goal not found', 404)
  if (goal.custody !== 'wallet') throw new ApiError('This goal is saved with Akilii, not in your wallet')
  return goal
}

const devMode = (user: Pick<User, 'dev'>) => Boolean(user.dev) && serverConfig().devWallet
const isHash = (h: unknown): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h)

async function totals(goalId: string) {
  const row = await one<{ saved: number; staked: number; mock: number }>(
    `SELECT COALESCE(SUM(added), 0) AS saved, COALESCE(SUM(staked), 0) AS staked,
       COUNT(CASE WHEN tx_hash LIKE 'mock-%' THEN 1 END) AS mock
     FROM wallet_goal_entries WHERE goal_id = ?`,
    [goalId],
  )
  const saved = row?.saved ?? 0
  const staked = Math.max(0, row?.staked ?? 0)
  return { saved, staked, inWallet: Math.max(0, saved - staked), simulated: (row?.mock ?? 0) > 0 }
}

async function insertEntry(e: Omit<EntryRow, 'id' | 'created_at'>) {
  await run(
    `INSERT OR IGNORE INTO wallet_goal_entries (id, goal_id, address, kind, added, staked, tx_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.tx_hash ?? `note-${newId(10)}`, e.goal_id, formatAddress(e.address), e.kind, e.added, e.staked, e.tx_hash, Date.now()],
  )
}

/** The owner's staker, or a stand-in built from the ledger for dev wallets (never on chain). */
async function stakerOf(user: User): Promise<ChainStaker | null> {
  if (!devMode(user)) return getStaker(user.address)
  const row = await one<{ staked: number; inactive: number; retired: number }>(
    `SELECT COALESCE(SUM(e.staked), 0) AS staked,
       (SELECT COALESCE(SUM(exit_amount), 0) FROM goals WHERE owner = ?1 AND exit_amount IS NOT NULL AND exit_retired = 0) AS inactive,
       (SELECT COALESCE(SUM(exit_amount), 0) FROM goals WHERE owner = ?1 AND exit_amount IS NOT NULL AND exit_retired = 1) AS retired
     FROM wallet_goal_entries e JOIN goals g ON g.id = e.goal_id WHERE g.owner = ?1`,
    [user.address],
  )
  if (!row || (row.staked <= 0 && row.inactive <= 0 && row.retired <= 0)) return null
  // Dev: exits release at once, so the whole flow can be clicked through on a laptop.
  return { address: user.address, balance: Math.max(0, row.staked), inactiveBalance: row.inactive, inactiveFrom: 0, inactiveRelease: 0, retiredBalance: row.retired }
}

async function minimumStake(user: User) {
  return devMode(user) ? 100 * LUNA : (await getPolicy()).minimumStake
}

/** A staking transaction from the owner, confirmed: to the staking contract, at least `value`. */
async function checkStakeTx(user: User, hash: string, value: number) {
  const tx = await getTransaction(hash.toLowerCase())
  if (!tx) return 'not_found' as const
  if (!sameAddress(tx.to, STAKING_CONTRACT)) throw new ApiError('That was not a staking transaction')
  if (!sameAddress(await payerOf(tx), user.address)) throw new ApiError('That transaction came from a different wallet')
  if (tx.executionResult === false) throw new ApiError('That transaction failed on the network')
  if (tx.value < value) throw new ApiError('That stake was less than expected')
  if (!tx.blockNumber || (tx.confirmations ?? 0) < serverConfig().nim.minConfirmations) return 'pending' as const
  return 'confirmed' as const
}

/** Signed, confirmed staker update (set active / retire / remove carry no value): just that it landed. */
async function checkStakerUpdate(user: User, hash: string) {
  const tx = await getTransaction(hash.toLowerCase())
  if (!tx) return 'not_found' as const
  if (!sameAddress(tx.to, STAKING_CONTRACT) && !sameAddress(tx.from, STAKING_CONTRACT)) throw new ApiError('That was not a staking transaction')
  if (tx.executionResult === false) throw new ApiError('That transaction failed on the network')
  if (!sameAddress(await payerOf(tx), user.address) && !sameAddress(tx.to, user.address)) throw new ApiError('That transaction came from a different wallet')
  if (!tx.blockNumber || (tx.confirmations ?? 0) < serverConfig().nim.minConfirmations) return 'pending' as const
  return 'confirmed' as const
}

// --- Saving ------------------------------------------------------------------

export type SaveStep =
  | { mode: 'create'; value: number; delegation: string; added: number }
  | { mode: 'stake'; value: number; added: number }
  | { mode: 'note'; added: number; minimumStake: number }

/**
 * What saving `amount` NIM should do: add to the owner's stake, create one (folding in what is
 * already set aside, once it reaches the minimum), or just note it. Amounts in luna. Pure read.
 */
export async function prepareSave(user: User, goalId: string, amountNim: number): Promise<SaveStep> {
  const goal = await ownWalletGoal(user, goalId)
  if (goal.status !== 'open' || goal.exit_amount) throw new ApiError('This goal is closing')
  const added = Math.round(amountNim * LUNA)
  if (!Number.isFinite(added) || added < 0) throw new ApiError('Save at least 1 NIM')
  // 0: stake what the goal already has set aside in the wallet (notes, gifts).
  if (added === 0 && (await totals(goalId)).inWallet <= 0) throw new ApiError('Nothing set aside to stake')
  if (added > 0 && added < LUNA) throw new ApiError('Save at least 1 NIM')
  return saveStep(user, goalId, added)
}

async function saveStep(user: User, goalId: string, added: number): Promise<SaveStep> {
  const [staker, min, { inWallet }] = await Promise.all([stakerOf(user), minimumStake(user), totals(goalId)])
  if (staker) return { mode: 'stake', value: added + inWallet, added }
  if (added + inWallet < min) return { mode: 'note', added, minimumStake: min / LUNA }
  const delegation = devMode(user) ? STAKING_CONTRACT : serverConfig().nim.validator
  if (!delegation) throw new ApiError('Staking from your wallet is not set up yet', 503)
  return { mode: 'create', value: added + inWallet, delegation, added }
}

/** Record a note: savings set aside in the wallet, below the minimum stake. Nothing is sent. */
export async function recordNote(user: User, goalId: string, amountNim: number) {
  const step = await prepareSave(user, goalId, amountNim)
  if (step.mode !== 'note') throw new ApiError('This can be staked now. Refresh and try again.', 409)
  await insertEntry({ goal_id: goalId, address: user.address, kind: 'note', added: step.added, staked: 0, tx_hash: null })
  return { status: 'confirmed' as const }
}

/**
 * Record a stake the owner signed (new money `added`, all of `value` going into the stake).
 * Polled by the client until it is confirmed.
 */
export async function recordStake(user: User, goalId: string, input: { hint: unknown; added: unknown; value: unknown }) {
  const goal = await ownWalletGoal(user, goalId)
  if (goal.status !== 'open' || goal.exit_amount) throw new ApiError('This goal is closing')
  const added = Number(input.added)
  const value = Number(input.value)
  if (!Number.isSafeInteger(added) || !Number.isSafeInteger(value) || added < 0 || value <= 0 || added > value) throw new ApiError('Invalid stake')
  const { inWallet } = await totals(goalId)
  // Never count more than the new money plus what the goal already had set aside.
  if (value > added + inWallet) throw new ApiError('That is more than this goal holds')
  const hint = input.hint
  if (typeof hint === 'string' && hint.startsWith('mock:')) {
    if (!devMode(user)) throw new ApiError('Simulated payments are disabled')
    await insertEntry({ goal_id: goalId, address: user.address, kind: 'stake', added, staked: value, tx_hash: `mock-${newId(12)}` })
    return { status: 'confirmed' as const }
  }
  if (!isHash(hint)) throw new ApiError('Missing the transaction from Nimiq Pay. If it went through, it shows in your Nimiq Pay staking.')
  const state = await checkStakeTx(user, hint, value)
  if (state !== 'confirmed') return { status: state }
  await insertEntry({ goal_id: goalId, address: user.address, kind: 'stake', added, staked: value, tx_hash: hint.toLowerCase() })
  return { status: 'confirmed' as const }
}

// --- Gifts -------------------------------------------------------------------

/** A friend's payment straight to the owner's wallet, tagged with the goal's memo. */
export async function recordWalletGift(user: User, goal: { id: string; owner: string; name: string }, hint: string | null, devAmount?: number) {
  const memo = goalMemo(goal.id)
  const min = LUNA
  if (hint?.startsWith('mock:')) {
    if (!devMode(user)) throw new ApiError('Simulated payments are disabled')
    const amount = Math.max(min, Math.round((devAmount ?? 1) * LUNA))
    const hash = `mock-${newId(12)}`
    await insertEntry({ goal_id: goal.id, address: user.address, kind: 'gift', added: amount, staked: 0, tx_hash: hash })
    await notifyGift(goal, hash, user.address, amount)
    return { status: 'confirmed' as const }
  }
  let tx: ChainTransaction | null
  if (isHash(hint)) tx = await getTransaction(hint.toLowerCase())
  else {
    const known = new Set((await all<{ tx_hash: string }>('SELECT tx_hash FROM wallet_goal_entries WHERE goal_id = ? AND tx_hash IS NOT NULL', [goal.id])).map((r) => r.tx_hash))
    const history = await getTransactionsByAddress(goal.owner, 200)
    tx = null
    for (const t of history) {
      if (known.has(t.hash) || !sameAddress(t.to, goal.owner) || decodeData(t.recipientData) !== memo) continue
      if (sameAddress(await payerOf(t), user.address)) {
        tx = t
        break
      }
    }
  }
  if (!tx) return { status: 'not_found' as const }
  if (!sameAddress(tx.to, goal.owner) || decodeData(tx.recipientData) !== memo) throw new ApiError('That payment was not for this goal')
  if (!sameAddress(await payerOf(tx), user.address)) throw new ApiError('That payment came from a different wallet')
  if (tx.executionResult === false) throw new ApiError('That payment failed on the network')
  if (tx.value < min) throw new ApiError('Gifts are at least 1 NIM')
  if (!tx.blockNumber || (tx.confirmations ?? 0) < serverConfig().nim.minConfirmations) return { status: 'pending' as const }
  await insertEntry({ goal_id: goal.id, address: user.address, kind: 'gift', added: tx.value, staked: 0, tx_hash: tx.hash })
  await notifyGift(goal, tx.hash, user.address, tx.value)
  return { status: 'confirmed' as const }
}

async function notifyGift(goal: { id: string; owner: string; name: string }, hash: string, from: string, amount: number) {
  const users = await usersByAddress([from])
  const nim = (amount / LUNA).toLocaleString('en-US', { maximumFractionDigits: 2 })
  await notify(goal.owner, `chip:${hash}`, 'chip_in', `${displayName(users.get(from))} sent ${nim} NIM to your wallet for ${goal.name}.`, `/g/${goal.id}`)
}

// --- Taking it out -----------------------------------------------------------

/**
 * Start taking the goal's stake out: the new active balance for the owner's staker.
 * If what stays staked would fall under the network minimum, all of it has to unstake.
 */
export async function prepareExit(user: User, goalId: string) {
  const goal = await ownWalletGoal(user, goalId)
  if (goal.status !== 'open') throw new ApiError('This goal is closed')
  if (goal.exit_amount) throw new ApiError('Already unstaking', 409)
  const { staked } = await totals(goalId)
  if (staked <= 0) throw new ApiError('Nothing is staked for this goal')
  const [staker, min] = await Promise.all([stakerOf(user), minimumStake(user)])
  if (!staker || staker.balance <= 0) throw new ApiError('Your wallet has no active stake. It may already be unstaked in Nimiq Pay.', 409)
  const amount = Math.min(staked, staker.balance)
  let newActiveBalance = staker.balance - amount
  const all = newActiveBalance > 0 && newActiveBalance < min
  if (all) newActiveBalance = 0
  return { amount, newActiveBalance, unstakesOtherStake: all ? staker.balance - amount : 0 }
}

export async function recordExitStart(user: User, goalId: string, input: { hint: unknown; amount: unknown }) {
  const goal = await ownWalletGoal(user, goalId)
  if (goal.exit_amount) return { status: 'confirmed' as const }
  const amount = Number(input.amount)
  const { staked } = await totals(goalId)
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > staked) throw new ApiError('Invalid amount')
  const hint = input.hint
  let hash: string
  if (typeof hint === 'string' && hint.startsWith('mock:')) {
    if (!devMode(user)) throw new ApiError('Simulated payments are disabled')
    hash = `mock-${newId(12)}`
  } else {
    if (!isHash(hint)) throw new ApiError('Missing the transaction from Nimiq Pay')
    const state = await checkStakerUpdate(user, hint)
    if (state !== 'confirmed') return { status: state }
    hash = hint.toLowerCase()
  }
  await run('UPDATE goals SET exit_amount = ?, exit_started_at = ? WHERE id = ? AND exit_amount IS NULL', [amount, Date.now(), goalId])
  await insertEntry({ goal_id: goalId, address: user.address, kind: 'unstake', added: 0, staked: -amount, tx_hash: hash })
  return { status: 'confirmed' as const }
}

/**
 * Where an exit stands, read from the chain. Next step for the owner to sign:
 * wait (inactive, not released yet) → retire (released) → remove (retired, back to the wallet).
 */
async function exitStatus(user: User, goal: WalletGoalRow) {
  if (!goal.exit_amount) return null
  const dev = devMode(user)
  const [staker, block, policy] = await Promise.all([stakerOf(user), dev ? 0 : getBlockNumber(), dev ? null : getPolicy()])
  const inactive = staker?.inactiveBalance ?? 0
  const retired = staker?.retiredBalance ?? 0
  const release = staker?.inactiveRelease ?? (staker?.inactiveFrom && policy ? staker.inactiveFrom + policy.blocksPerEpoch + 1 : null)
  let next: 'wait' | 'retire' | 'remove' | 'done' = 'wait'
  if (retired > 0) next = 'remove'
  else if (inactive > 0 && release !== null && block >= release) next = 'retire'
  // Neither inactive nor retired left: it already came back (maybe finished in Nimiq Pay).
  else if (inactive === 0) next = 'done'
  // About one block a second on Albatross; good enough for "ready around".
  const readyAt = next === 'wait' ? (release ? Date.now() + Math.max(0, release - block) * 1000 : (goal.exit_started_at ?? Date.now()) + 24 * HOUR) : null
  return { amount: goal.exit_amount / LUNA, next, readyAt, retire: Math.min(goal.exit_amount, inactive), remove: Math.min(goal.exit_amount, retired) }
}
export type ExitStatus = NonNullable<Awaited<ReturnType<typeof exitStatus>>>

/** Owner signed a step of the exit: 'retire' (stake released) or 'remove' (back in the wallet, goal closes). */
export async function recordExitStep(user: User, goalId: string, input: { step: unknown; hint: unknown }) {
  const goal = await ownWalletGoal(user, goalId)
  if (!goal.exit_amount) throw new ApiError('Start taking it out first', 409)
  if (input.step !== 'retire' && input.step !== 'remove' && input.step !== 'done') throw new ApiError('Unknown step')
  if (input.step === 'done') {
    // Finished outside Akilii: only if the chain agrees nothing is left to bring back.
    const status = await exitStatus(user, goal)
    if (status?.next !== 'done') throw new ApiError('Your stake is still on its way back', 409)
    await closeGoal(goal, user, null)
    return { status: 'confirmed' as const }
  }
  const hint = input.hint
  let hash: string
  if (typeof hint === 'string' && hint.startsWith('mock:')) {
    if (!devMode(user)) throw new ApiError('Simulated payments are disabled')
    hash = `mock-${newId(12)}`
  } else {
    if (!isHash(hint)) throw new ApiError('Missing the transaction from Nimiq Pay')
    const state = await checkStakerUpdate(user, hint)
    if (state !== 'confirmed') return { status: state }
    hash = hint.toLowerCase()
  }
  if (input.step === 'retire') await run('UPDATE goals SET exit_retired = 1 WHERE id = ?', [goalId])
  else await closeGoal(goal, user, hash)
  return { status: 'confirmed' as const }
}

/** Nothing staked (or all back): stop tracking. The NIM is already in the owner's wallet. */
export async function closeWalletGoal(user: User, goalId: string) {
  const goal = await ownWalletGoal(user, goalId)
  if (goal.status !== 'open') return
  const { staked } = await totals(goalId)
  if (staked > 0) throw new ApiError('Unstake it first', 409)
  if (goal.exit_amount) throw new ApiError('Finish bringing it back first', 409)
  await closeGoal(goal, user, null)
}

async function closeGoal(goal: WalletGoalRow, user: User, hash: string | null) {
  const { saved } = await totals(goal.id)
  await insertEntry({ goal_id: goal.id, address: user.address, kind: 'withdraw', added: -saved, staked: 0, tx_hash: hash })
  await run("UPDATE goals SET status = 'closed', exit_amount = NULL, exit_retired = 0 WHERE id = ?", [goal.id])
}

// --- View ----------------------------------------------------------------------

export async function walletGoalView(user: User, goalId: string, extras: { plan: PlanStatus | null }) {
  const goal = await ownWalletGoal(user, goalId)
  const [{ saved, staked, inWallet, simulated }, entries, staker, exit] = await Promise.all([
    totals(goalId),
    all<EntryRow>('SELECT * FROM wallet_goal_entries WHERE goal_id = ? ORDER BY created_at DESC', [goalId]),
    stakerOf(user).catch(() => null),
    exitStatus(user, goal).catch(() => null),
  ])
  const users = await usersByAddress([...new Set(entries.filter((e) => !sameAddress(e.address, goal.owner)).map((e) => e.address))])
  const min = await minimumStake(user).catch(() => 100 * LUNA)
  const unit = UNIT.NIM
  // The wallet's stake, all of it (it can include stake made outside Akilii).
  const walletStake = (staker?.balance ?? 0) + (staker?.inactiveBalance ?? 0)
  return {
    custody: 'wallet' as const,
    id: goal.id,
    name: goal.name,
    currency: 'NIM' as const,
    target: goal.target === null ? null : goal.target / unit,
    status: goal.status,
    balance: saved / unit,
    staked: staked / unit,
    inWallet: inWallet / unit,
    walletStake: walletStake / unit,
    // The wallet unstaked some of it outside Akilii.
    stakeShort: !simulated && !exit && staked > 0 && (staker?.balance ?? 0) < staked,
    minimumStake: min / unit,
    exit,
    memo: goalMemo(goal.id),
    plan: extras.plan,
    history: entries
      .filter((e) => e.kind !== 'unstake')
      .map((e) => ({
        kind: e.kind,
        // New money for the goal, or for "staked what was set aside" the amount staked.
        amount: (e.kind === 'stake' && !e.added ? e.staked : Math.abs(e.added)) / unit,
        added: e.added / unit,
        at: e.created_at,
        from: sameAddress(e.address, goal.owner) ? null : displayName(users.get(e.address)),
      })),
  }
}
export type WalletGoalView = Awaited<ReturnType<typeof walletGoalView>>

export async function walletGoalBalance(goalId: string) {
  return (await totals(goalId)).saved / UNIT.NIM
}
