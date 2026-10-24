import 'server-only'
import type { User } from './auth'
import { all, LUNA, newId, one, run } from './db'
import { bankLanded, deliver, type BankDetails, type Method } from './delivery'
import { goalMemo, isSimulated, reconcile, verifyDeposit, type DepositResult } from './deposits'
import { ApiError } from './errors'
import { sameAddress } from './nimiq/address'
import { yieldShare } from './yield'

/** Smallest deposit worth a transaction. */
const MIN_DEPOSIT = 1 * LUNA

interface GoalRow {
  id: string
  owner: string
  name: string
  target: number | null
  unlock_at: number | null
  status: 'open' | 'closed'
  created_at: number
}

interface WithdrawalRow {
  id: string
  goal_id: string
  amount: number
  bonus: number
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

export async function createGoal(user: User, input: { name: string; targetNim: number | null; unlockAt: number | null }) {
  const name = input.name.trim().slice(0, 32)
  if (!name) throw new ApiError('Give your goal a name')
  if (input.targetNim !== null && (!Number.isInteger(input.targetNim) || input.targetNim < 1)) throw new ApiError('Targets are whole NIM')
  if (input.unlockAt !== null && input.unlockAt < Date.now() + 86_400_000) throw new ApiError('Lock it for at least a day')
  const id = newId()
  await run("INSERT INTO goals (id, owner, name, target, unlock_at, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)", [
    id,
    user.address,
    name,
    input.targetNim === null ? null : input.targetNim * LUNA,
    input.unlockAt,
    Date.now(),
  ])
  return id
}

/** Credit owner payments tagged for this goal that the app never reported. */
async function reconcileGoal(goal: GoalRow) {
  await reconcile('goal', goal.id, (_memo, payer, tx) =>
    sameAddress(payer, goal.owner) && tx.value >= MIN_DEPOSIT ? { round: null, address: goal.owner } : null,
  ).catch((err) => console.error('reconcile goal', goal.id, err))
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

export async function recordGoalDeposit(user: User, goalId: string, hint: string | null, devAmountNim?: number): Promise<DepositResult> {
  const goal = await ownGoal(user, goalId)
  if (goal.status !== 'open') throw new ApiError('This goal is closed')
  return verifyDeposit({
    user,
    kind: 'goal',
    refId: goalId,
    round: null,
    memo: goalMemo(goalId),
    minAmount: MIN_DEPOSIT,
    hint,
    devAmount: devAmountNim ? Math.round(devAmountNim * LUNA) : undefined,
  })
}

/** Locked goals refuse until their date; flexible goals pay out any time. Always withdraws everything. */
export async function withdrawGoal(user: User, goalId: string, method: Method, bank?: BankDetails) {
  const goal = await ownGoal(user, goalId)
  await reconcileGoal(goal)
  if (goal.unlock_at && Date.now() < goal.unlock_at) throw new ApiError(`Locked until ${new Date(goal.unlock_at).toDateString()}`, 403)
  const { balance, simulated } = await balanceOf(goalId)
  if (balance <= 0) throw new ApiError('Nothing to withdraw yet')
  const bonus = await yieldShare(balance, simulated)

  const id = newId()
  // Record before sending: the row holds the balance so a second tap finds nothing left.
  await run("INSERT INTO withdrawals (id, goal_id, address, amount, bonus, status, method, created_at) VALUES (?, ?, ?, ?, ?, 'sending', ?, ?)", [
    id,
    goalId,
    user.address,
    balance,
    bonus,
    method,
    Date.now(),
  ])
  try {
    const d = await deliver({ to: user, luna: balance + bonus, memo: `cw:${goalId}`, method, bank, reference: `cw-${id}` })
    await run('UPDATE withdrawals SET status = ?, tx_hash = ?, bank = ?, ngn = ?, provider_id = ? WHERE id = ?', [d.status, d.txHash, d.bank, d.ngn, d.providerId, id])
  } catch (err) {
    await run('DELETE FROM withdrawals WHERE id = ?', [id])
    throw err
  }
  if (goal.unlock_at) await run("UPDATE goals SET status = 'closed' WHERE id = ?", [goalId])
  return publicWithdrawal((await one<WithdrawalRow>('SELECT * FROM withdrawals WHERE id = ?', [id]))!)
}

async function settle(w: WithdrawalRow) {
  if (w.status === 'cashing' && w.provider_id && (await bankLanded(w.provider_id))) {
    await run("UPDATE withdrawals SET status = 'cashed' WHERE id = ?", [w.id])
    return { ...w, status: 'cashed' as const }
  }
  return w
}

function publicWithdrawal(w: WithdrawalRow) {
  return {
    id: w.id,
    amount: w.amount / LUNA,
    bonus: w.bonus / LUNA,
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

export async function goalView(user: User, goalId: string) {
  const goal = await ownGoal(user, goalId)
  await reconcileGoal(goal)
  const [{ balance, simulated }, deposits, withdrawals] = await Promise.all([
    balanceOf(goalId),
    all<{ tx_hash: string; amount: number; created_at: number }>("SELECT tx_hash, amount, created_at FROM deposits WHERE kind = 'goal' AND ref_id = ? ORDER BY created_at DESC", [goalId]),
    all<WithdrawalRow>('SELECT * FROM withdrawals WHERE goal_id = ? ORDER BY created_at DESC', [goalId]),
  ])
  const earned = await yieldShare(balance, simulated)
  return {
    id: goal.id,
    name: goal.name,
    target: goal.target === null ? null : goal.target / LUNA,
    unlockAt: goal.unlock_at,
    locked: Boolean(goal.unlock_at && Date.now() < goal.unlock_at),
    daysLeft: goal.unlock_at ? Math.max(0, Math.ceil((goal.unlock_at - Date.now()) / 86_400_000)) : 0,
    status: goal.status,
    balance: balance / LUNA,
    earned: earned / LUNA,
    memo: goalMemo(goal.id),
    deposits: deposits.map((d) => ({ amount: d.amount / LUNA, at: d.created_at, simulated: isSimulated(d.tx_hash) })),
    withdrawals: await Promise.all(withdrawals.map(async (w) => publicWithdrawal(await settle(w)))),
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
      target: g.target === null ? null : g.target / LUNA,
      unlockAt: g.unlock_at,
      locked: Boolean(g.unlock_at && Date.now() < g.unlock_at),
      balance: (await balanceOf(g.id)).balance / LUNA,
    })),
  )
}
export type GoalSummary = Awaited<ReturnType<typeof myGoals>>[number]

/** Worker: credit unreported goal deposits and mark bank withdrawals that have landed. */
export async function syncGoals() {
  for (const goal of await all<GoalRow>("SELECT * FROM goals WHERE status = 'open'")) await reconcileGoal(goal)
  for (const w of await all<WithdrawalRow>("SELECT * FROM withdrawals WHERE status = 'cashing'")) await settle(w)
}
