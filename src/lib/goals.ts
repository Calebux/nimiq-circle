import 'server-only'
import type { User } from './auth'
import { LIMITS, MIN_DEPOSIT, UNIT, type Currency } from './currency'
import { all, newId, one, run } from './db'
import { bankStatus, deliver, type BankDetails, type Method } from './delivery'
import { goalMemo, isSimulated, memoFor, reconcile, verifyDeposit, type DepositResult } from './deposits'
import { ApiError } from './errors'
import { sameAddress } from './nimiq/address'
import { invalidateYield, yieldShare } from './yield'
import { exitAmounts, exitFeePolicy, type ExitFeeBasis } from './goal-exit-policy'
import { serverConfig } from './env'
import { getBalance } from './nimiq/rpc'
import { goalExtras, notifyChipIn, parsePlan } from './goal-friends'
import { walletGoalBalance, walletGoalView } from './wallet-goals'

/** Smallest deposit worth a transaction, in the goal's smallest unit. */
const minDeposit = (currency: Currency) => Math.round(MIN_DEPOSIT[currency] * UNIT[currency])

interface GoalRow {
  id: string
  owner: string
  name: string
  target: number | null
  unlock_at: number | null
  status: 'open' | 'closed'
  currency: Currency
  created_at: number
  custody: 'pool' | 'wallet'
}

interface WithdrawalRow {
  id: string
  goal_id: string
  amount: number
  bonus: number
  fee: number
  fee_bps: number
  fee_basis: ExitFeeBasis | null
  early_exit: number
  status: 'sending' | 'sent' | 'cashing' | 'cashed'
  method: Method
  tx_hash: string | null
  bank: string | null
  ngn: number | null
  provider_id: string | null
  created_at: number
}

async function ownGoal(user: User, id: string): Promise<GoalRow> {
  const goal = await one<GoalRow>('SELECT * FROM goals WHERE id = ?', [id])
  if (!goal || !sameAddress(goal.owner, user.address)) throw new ApiError('Goal not found', 404)
  return goal
}

/** Deposits, exits and withdrawals through the pool. Wallet goals use src/lib/wallet-goals.ts. */
async function ownPoolGoal(user: User, id: string): Promise<GoalRow> {
  const goal = await ownGoal(user, id)
  if (goal.custody === 'wallet') throw new ApiError('This goal is kept in your wallet', 409)
  return goal
}

export async function createGoal(user: User, input: { name: string; target: number | null; unlockAt: number | null; currency: Currency; plan?: { cadence: unknown; amount: unknown }; custody?: 'pool' | 'wallet' }) {
  const name = input.name.trim().slice(0, 32)
  if (!name) throw new ApiError('Give your goal a name')
  const { max } = LIMITS[input.currency]
  if (input.target !== null && (!Number.isInteger(input.target) || input.target < 1 || input.target > max * 100)) throw new ApiError(`Targets are whole ${input.currency}`)
  if (input.unlockAt !== null && input.unlockAt < Date.now() + 86_400_000) throw new ApiError('Lock it for at least a day')
  const custody = input.custody === 'wallet' ? 'wallet' : 'pool'
  // Wallet goals stake from the owner's own wallet: NIM only, and nothing can be locked.
  if (custody === 'wallet' && input.currency !== 'NIM') throw new ApiError('Goals in your wallet save in NIM')
  if (custody === 'wallet' && input.unlockAt !== null) throw new ApiError('Goals in your wallet cannot be locked')
  const plan = input.plan ? parsePlan(input.plan, input.currency) : null
  const id = newId()
  const now = Date.now()
  await run("INSERT INTO goals (id, owner, name, target, unlock_at, status, currency, created_at, plan_cadence, plan_amount, plan_anchor, custody) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)", [
    id,
    user.address,
    name,
    input.target === null ? null : input.target * UNIT[input.currency],
    input.unlockAt,
    input.currency,
    now,
    plan?.cadence ?? null,
    plan?.amount ?? null,
    plan ? now : null,
    custody,
  ])
  return id
}

/** Credit payments tagged for this goal that the app never reported: the owner's, or a friend's chip-in. */
async function reconcileGoal(goal: GoalRow) {
  // USDT goals are reconciled from reported transfers instead (syncEvmPending). Wallet goals hold nothing in the pool.
  if (goal.currency !== 'NIM' || goal.custody === 'wallet') return
  const friends: { hash: string; payer: string; value: number }[] = []
  await reconcile('goal', goal.id, (_memo, payer, tx) => {
    if (tx.value < minDeposit('NIM')) return null
    if (!sameAddress(payer, goal.owner)) friends.push({ hash: tx.hash, payer, value: tx.value })
    return { round: null, address: payer }
  }).catch((err) => console.error('reconcile goal', goal.id, err))
  for (const f of friends) await notifyChipIn(goal, f.hash, f.payer, f.value).catch(() => undefined)
}

async function balanceOf(goalId: string) {
  const row = await one<{ deposited: number; withdrawn: number; simulated: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE kind = 'goal' AND ref_id = ?1) AS deposited,
       (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE goal_id = ?1) AS withdrawn,
       (SELECT COUNT(*) FROM deposits WHERE kind = 'goal' AND ref_id = ?1 AND tx_hash LIKE 'mock-%') AS simulated`,
    [goalId],
  )
  const balance = (row?.deposited ?? 0) - (row?.withdrawn ?? 0)
  return { balance, simulated: (row?.simulated ?? 0) > 0 }
}

export async function recordGoalDeposit(user: User, goalId: string, hint: string | null, devAmount?: number): Promise<DepositResult> {
  const goal = await ownPoolGoal(user, goalId)
  if (goal.status !== 'open') throw new ApiError('This goal is closed')
  return verifyDeposit({
    user,
    kind: 'goal',
    refId: goalId,
    round: null,
    memo: memoFor(user, goalMemo(goalId), goal.currency),
    minAmount: minDeposit(goal.currency),
    hint,
    currency: goal.currency,
    devAmount: devAmount ? Math.round(devAmount * UNIT[goal.currency]) : undefined,
  })
}

interface ExitQuoteRow {
  id: string
  goal_id: string
  address: string
  principal: number
  bonus: number
  fee: number
  fee_bps: number
  fee_basis: ExitFeeBasis
  unlock_at: number
  expires_at: number
}

/** Quotes are bound to the owner, goal, balance and lock date. Creating one never moves money. */
export async function quoteGoalExit(user: User, goalId: string) {
  const goal = await ownPoolGoal(user, goalId)
  const policy = exitFeePolicy()
  if (!policy) throw new ApiError('Breaking a lock is not available yet', 403)
  if (goal.status !== 'open' || !goal.unlock_at || goal.unlock_at <= Date.now()) throw new ApiError('This goal is no longer locked. Refresh to withdraw without a break fee.', 409)
  await reconcileGoal(goal)
  const { balance, simulated } = await balanceOf(goalId)
  if (balance <= 0) throw new ApiError('Nothing to withdraw yet')
  const bonus = await yieldShare(balance, simulated, goal.currency)
  const amounts = exitAmounts(balance, bonus, policy)
  const id = newId(24)
  const expiresAt = Math.min(Date.now() + 10 * 60_000, goal.unlock_at)
  await run('DELETE FROM goal_exit_quotes WHERE expires_at < ?', [Date.now()])
  await run(`INSERT INTO goal_exit_quotes (id, goal_id, address, principal, bonus, fee, fee_bps, fee_basis, unlock_at, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, goalId, user.address, balance, bonus, amounts.fee, policy.bps, policy.basis, goal.unlock_at, expiresAt, Date.now()])
  const unit = UNIT[goal.currency]
  return { id, principal: balance / unit, bonus: bonus / unit, fee: amounts.fee / unit, net: amounts.net / unit, feeBps: policy.bps, feeBasis: policy.basis, currency: goal.currency, expiresAt }
}
export type GoalExitQuote = Awaited<ReturnType<typeof quoteGoalExit>>

/** Flexible/mature goals are free; an early exit requires explicit acceptance of a server quote. */
export async function withdrawGoal(user: User, goalId: string, method: Method, bank?: BankDetails, evmAddress?: string, earlyExitQuoteId?: string) {
  const goal = await ownPoolGoal(user, goalId)
  if (goal.status !== 'open') throw new ApiError('This goal is closed', 409)
  await reconcileGoal(goal)
  const locked = Boolean(goal.unlock_at && Date.now() < goal.unlock_at)
  if (locked && (!earlyExitQuoteId || !exitFeePolicy())) throw new ApiError('Review and accept the break fee before withdrawing early', 403)
  if (!locked && earlyExitQuoteId) throw new ApiError('Your goal has unlocked. Refresh to withdraw without a break fee.', 409)
  const { balance, simulated } = await balanceOf(goalId)
  if (balance <= 0) throw new ApiError('Nothing to withdraw yet')
  let bonus = await yieldShare(balance, simulated, goal.currency)
  let quote: ExitQuoteRow | null = null
  if (locked) {
    quote = await one<ExitQuoteRow>('SELECT * FROM goal_exit_quotes WHERE id = ?', [earlyExitQuoteId!])
    if (!quote || quote.goal_id !== goalId || !sameAddress(quote.address, user.address) || quote.principal !== balance || quote.unlock_at !== goal.unlock_at || quote.expires_at <= Date.now() || quote.bonus > bonus) {
      throw new ApiError('Your balance or quote has changed. Review the break fee again.', 409)
    }
    bonus = quote.bonus
  }
  const fee = quote?.fee ?? 0
  const net = balance + bonus - fee
  // Locked NIM may be staked. Reserve liquidity for the worker, without charging or closing
  // the goal. The owner returns to accept a fresh quote when funds are available.
  if (locked && goal.currency === 'NIM' && method === 'wallet' && !user.dev && !simulated) {
    const pool = serverConfig().nim.poolAddress
    if (!pool) throw new ApiError('Withdrawals are temporarily unavailable', 503)
    if (await getBalance(pool) < net) {
      await run(`INSERT INTO goal_exit_liquidity (goal_id, amount, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(goal_id) DO UPDATE SET amount = excluded.amount, expires_at = excluded.expires_at`, [goalId, net, Date.now() + 72 * 3_600_000])
      throw new ApiError('Your savings need available NIM before they can be sent. No fee was charged. Staked funds may take 12–24 hours to become available; try again later.', 409)
    }
  }

  const id = newId()
  // The balance and quote are checked in the same write that claims the funds.
  const claimed = await run(
    `INSERT INTO withdrawals (id, goal_id, address, amount, bonus, status, method, created_at, fee, fee_bps, fee_basis, early_exit, exit_quote_id)
     SELECT ?1, ?2, ?3, ?4, ?5, 'sending', ?6, ?7, ?8, ?9, ?10, ?11, ?12
     WHERE (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE kind = 'goal' AND ref_id = ?2)
         - (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE goal_id = ?2) = ?4
       AND EXISTS (SELECT 1 FROM goals WHERE id = ?2 AND status = 'open')
       AND (?12 IS NULL OR EXISTS (SELECT 1 FROM goal_exit_quotes WHERE id = ?12 AND expires_at > ?7 AND unlock_at > ?7))`,
    [id, goalId, user.address, balance, bonus, method, Date.now(), fee, quote?.fee_bps ?? 0, quote?.fee_basis ?? null, locked ? 1 : 0, quote?.id ?? null],
  )
  if (claimed.rowsAffected === 0) throw new ApiError('Your balance or quote changed. Refresh before trying again.', 409)
  try {
    const d = await deliver({ to: user, amount: net, currency: goal.currency, memo: `cw:${goalId}`, method, bank, reference: `cw-${id}`, evmAddress })
    await run('UPDATE withdrawals SET status = ?, tx_hash = ?, bank = ?, ngn = ?, provider_id = ? WHERE id = ?', [d.status, d.txHash, d.bank, d.ngn, d.providerId, id])
  } catch (err) {
    await run('DELETE FROM withdrawals WHERE id = ?', [id])
    invalidateYield()
    throw err
  }
  if (goal.unlock_at) await run("UPDATE goals SET status = 'closed' WHERE id = ?", [goalId])
  await run('DELETE FROM goal_exit_liquidity WHERE goal_id = ?', [goalId])
  invalidateYield()
  return publicWithdrawal((await one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', [id]))!, goal.currency)
}

async function settle(w: WithdrawalRow) {
  if (w.status !== 'cashing' || !w.provider_id) return w
  const status = await bankStatus(w.provider_id)
  if (status === 'paid') {
    await run("UPDATE withdrawals SET status = 'cashed' WHERE id = ?", [w.id])
    return { ...w, status: 'cashed' as const }
  }
  if (status === 'failed') {
    // The provider refunded the pool: drop the withdrawal so the money is back in the goal.
    await run('DELETE FROM withdrawals WHERE id = ?', [w.id])
    await run("UPDATE goals SET status = 'open' WHERE id = ?", [w.goal_id])
    invalidateYield()
    console.error('bank cash-out refunded', w.id)
    return null
  }
  return w
}

function publicWithdrawal(w: WithdrawalRow, currency: Currency) {
  return {
    id: w.id,
    amount: w.amount / UNIT[currency],
    bonus: w.bonus / UNIT[currency],
    fee: w.fee / UNIT[currency],
    net: (w.amount + w.bonus - w.fee) / UNIT[currency],
    feeBps: w.fee_bps,
    feeBasis: w.fee_basis,
    earlyExit: Boolean(w.early_exit),
    currency,
    status: w.status,
    method: w.method,
    txHash: w.tx_hash,
    simulated: isSimulated(w.tx_hash),
    bank: w.bank,
    ngn: w.ngn,
    createdAt: w.created_at,
  }
}
export type PublicWithdrawal = ReturnType<typeof publicWithdrawal>

/** The owner's goal page, either kind. */
export async function anyGoalView(user: User, goalId: string) {
  const goal = await ownGoal(user, goalId)
  if (goal.custody !== 'wallet') return goalView(user, goalId)
  const { plan } = await goalExtras(goalId, [])
  return walletGoalView(user, goalId, { plan })
}

export async function goalView(user: User, goalId: string) {
  const pending = await ownPoolGoal(user, goalId)
  await reconcileGoal(pending)
  for (const w of await all<WithdrawalRow>("SELECT * FROM withdrawals WHERE goal_id = ? AND status = 'cashing'", [goalId])) await settle(w)
  const goal = await ownGoal(user, goalId)
  const [{ balance, simulated }, deposits, withdrawals] = await Promise.all([
    balanceOf(goalId),
    all<{ tx_hash: string; address: string; amount: number; created_at: number }>("SELECT tx_hash, address, amount, created_at FROM deposits WHERE kind = 'goal' AND ref_id = ? ORDER BY created_at DESC", [goalId]),
    all<WithdrawalRow>('SELECT * FROM withdrawals WHERE goal_id = ? ORDER BY created_at DESC', [goalId]),
  ])
  const earned = await yieldShare(balance, simulated, goal.currency)
  const unit = UNIT[goal.currency]
  const { plan, nameOf } = await goalExtras(goal.id, deposits.filter((d) => !sameAddress(d.address, goal.owner)).map((d) => d.address))
  return {
    custody: 'pool' as const,
    id: goal.id,
    name: goal.name,
    currency: goal.currency,
    target: goal.target === null ? null : goal.target / unit,
    unlockAt: goal.unlock_at,
    locked: Boolean(goal.unlock_at && Date.now() < goal.unlock_at),
    daysLeft: goal.unlock_at ? Math.max(0, Math.ceil((goal.unlock_at - Date.now()) / 86_400_000)) : 0,
    status: goal.status,
    balance: balance / unit,
    earned: earned / unit,
    memo: memoFor(user, goalMemo(goal.id), goal.currency),
    minDeposit: MIN_DEPOSIT[goal.currency],
    earlyExitPolicy: exitFeePolicy(),
    deposits: deposits.map((d) => ({ amount: d.amount / unit, at: d.created_at, simulated: isSimulated(d.tx_hash), from: sameAddress(d.address, goal.owner) ? null : nameOf(d.address) })),
    plan,
    withdrawals: withdrawals.map((w) => publicWithdrawal(w, goal.currency)),
  }
}
export type GoalView = Awaited<ReturnType<typeof goalView>>

export async function myGoals(user: User) {
  const goals = await all<GoalRow>("SELECT * FROM goals WHERE owner = ? AND status = 'open' ORDER BY created_at DESC", [user.address])
  await Promise.all(goals.map(reconcileGoal))
  return Promise.all(
    goals.map(async (g) => ({
      id: g.id,
      name: g.name,
      currency: g.currency,
      target: g.target === null ? null : g.target / UNIT[g.currency],
      unlockAt: g.unlock_at,
      locked: Boolean(g.unlock_at && Date.now() < g.unlock_at),
      custody: g.custody,
      balance: g.custody === 'wallet' ? await walletGoalBalance(g.id) : (await balanceOf(g.id)).balance / UNIT[g.currency],
    })),
  )
}
export type GoalSummary = Awaited<ReturnType<typeof myGoals>>[number]

/** Webhook: settle the bank withdrawal for this provider order, if any. */
export async function settleWithdrawalByProvider(providerId: string) {
  for (const w of await all<WithdrawalRow>("SELECT * FROM withdrawals WHERE status = 'cashing' AND provider_id = ?", [providerId])) await settle(w)
}

/** Worker: credit unreported goal deposits and mark bank withdrawals that have landed. */
export async function syncGoals() {
  for (const goal of await all<GoalRow>("SELECT * FROM goals WHERE status = 'open'")) await reconcileGoal(goal)
  for (const w of await all<WithdrawalRow>("SELECT * FROM withdrawals WHERE status = 'cashing'")) await settle(w)
}
