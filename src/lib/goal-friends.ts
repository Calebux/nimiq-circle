import 'server-only'
import { displayName, usersByAddress, type User } from './auth'
import { LIMITS, MIN_DEPOSIT, UNIT, type Currency } from './currency'
import { all, newId, one, run } from './db'
import { goalMemo, memoFor, verifyDeposit, type DepositResult } from './deposits'
import { ApiError } from './errors'
import { currentPeriod, isPlanCadence, remindBefore, type PlanCadence } from './goal-plan'
import { sameAddress } from './nimiq/address'
import { notify } from './notices'
import { recordWalletGift, walletGoalBalance } from './wallet-goals'

/**
 * Two things around a savings goal:
 *  - Friends chip in by link. Their payment lands in the goal like any top-up and belongs to
 *    the owner from then on. The link only shows the goal's name, owner and progress.
 *  - A saving plan (X every week or month) with an in-app reminder near the end of each period.
 */

interface GoalRow {
  id: string
  owner: string
  name: string
  target: number | null
  unlock_at: number | null
  status: 'open' | 'closed'
  currency: Currency
  invite_code: string | null
  plan_cadence: PlanCadence | null
  plan_amount: number | null
  plan_anchor: number | null
  custody: 'pool' | 'wallet'
}

const money = (amount: number, currency: Currency) => `${(amount / UNIT[currency]).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`

async function goalByCode(code: string): Promise<GoalRow> {
  const clean = code.trim().toLowerCase()
  const goal = /^[a-z0-9]{6,16}$/.test(clean) ? await one<GoalRow>('SELECT * FROM goals WHERE invite_code = ?', [clean]) : null
  if (!goal) throw new ApiError('This invite link is not valid', 404)
  return goal
}

async function ownGoal(user: User, id: string): Promise<GoalRow> {
  const goal = await one<GoalRow>('SELECT * FROM goals WHERE id = ?', [id])
  if (!goal || !sameAddress(goal.owner, user.address)) throw new ApiError('Goal not found', 404)
  return goal
}

// --- Invite links ------------------------------------------------------------

/** The goal's invite code, made on first share. Unguessable: goals are private otherwise. */
export async function goalInviteCode(user: User, goalId: string) {
  const goal = await ownGoal(user, goalId)
  if (goal.status !== 'open') throw new ApiError('This goal is closed')
  if (goal.invite_code) return goal.invite_code
  const code = newId(12)
  await run('UPDATE goals SET invite_code = ? WHERE id = ? AND invite_code IS NULL', [code, goalId])
  return (await one<{ invite_code: string }>('SELECT invite_code FROM goals WHERE id = ?', [goalId]))!.invite_code
}

async function totals(goalId: string, owner: string) {
  const row = await one<{ deposited: number; withdrawn: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE kind = 'goal' AND ref_id = ?1) AS deposited,
       (SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE goal_id = ?1) AS withdrawn`,
    [goalId],
  )
  const friends = await all<{ address: string; amount: number; created_at: number }>(
    "SELECT address, amount, created_at FROM deposits WHERE kind = 'goal' AND ref_id = ? AND address != ? ORDER BY created_at DESC",
    [goalId, owner],
  )
  return { balance: (row?.deposited ?? 0) - (row?.withdrawn ?? 0), friends }
}

/** What a friend sees before chipping in. Public: name, owner, and progress toward the target if one is set. */
export async function goalPreview(code: string, viewer: User | null) {
  const goal = await goalByCode(code)
  const wallet = goal.custody === 'wallet'
  const { friends: poolFriends, balance: poolBalance } = await totals(goal.id, goal.owner)
  const friends = wallet
    ? await all<{ address: string; amount: number; created_at: number }>("SELECT address, added AS amount, created_at FROM wallet_goal_entries WHERE goal_id = ? AND kind = 'gift' ORDER BY created_at DESC", [goal.id])
    : poolFriends
  const balance = wallet ? Math.round((await walletGoalBalance(goal.id)) * UNIT.NIM) : poolBalance
  const addresses = [...new Set([goal.owner, ...friends.map((f) => f.address)])]
  const users = await usersByAddress(addresses)
  const owner = users.get(goal.owner)
  const chippedIn = [...new Set(friends.map((f) => f.address))]
  return {
    code: goal.invite_code!,
    name: goal.name,
    currency: goal.currency,
    open: goal.status === 'open',
    // Only while still locked; the page shows "Locked until".
    unlockAt: goal.unlock_at && goal.unlock_at > Date.now() ? goal.unlock_at : null,
    owner: { name: displayName(owner), avatar: owner?.avatar ?? 1 },
    isOwner: Boolean(viewer && sameAddress(viewer.address, goal.owner)),
    goalId: viewer && sameAddress(viewer.address, goal.owner) ? goal.id : null,
    progress: goal.target ? Math.min(1, Math.max(0, balance) / goal.target) : null,
    target: goal.target === null ? null : goal.target / UNIT[goal.currency],
    friends: chippedIn.slice(0, 8).map((a) => ({ name: displayName(users.get(a), viewer?.address), avatar: users.get(a)?.avatar ?? 1 })),
    friendCount: chippedIn.length,
    memo: viewer ? memoFor(viewer, goalMemo(goal.id), goal.currency) : null,
    // Wallet goals: gifts go straight to the owner's wallet, not to Akilii.
    custody: goal.custody,
    payTo: wallet ? goal.owner : null,
    minDeposit: MIN_DEPOSIT[goal.currency],
  }
}
export type GoalPreview = Awaited<ReturnType<typeof goalPreview>>

/** Record a friend's payment into the goal once it is on chain. */
export async function recordChipIn(user: User, code: string, hint: string | null, devAmount?: number): Promise<{ status: DepositResult['status'] }> {
  const goal = await goalByCode(code)
  if (goal.status !== 'open') throw new ApiError('This goal is closed')
  if (sameAddress(goal.owner, user.address)) throw new ApiError('This is your own goal. Add money from the goal page.')
  if (goal.custody === 'wallet') return recordWalletGift(user, goal, hint, devAmount)
  const result = await verifyDeposit({
    user,
    kind: 'goal',
    refId: goal.id,
    round: null,
    memo: memoFor(user, goalMemo(goal.id), goal.currency),
    minAmount: Math.round(MIN_DEPOSIT[goal.currency] * UNIT[goal.currency]),
    hint,
    currency: goal.currency,
    devAmount: devAmount ? Math.round(devAmount * UNIT[goal.currency]) : undefined,
  })
  if (result.status === 'confirmed') await notifyChipIn(goal, result.deposit.tx_hash, user.address, result.deposit.amount)
  return result
}

/** Tell the owner, once per payment. Also used for chip-ins the worker picks up. */
export async function notifyChipIn(goal: Pick<GoalRow, 'id' | 'owner' | 'name' | 'currency'>, txHash: string, from: string, amount: number) {
  const users = await usersByAddress([from])
  await notify(goal.owner, `chip:${txHash}`, 'chip_in', `${displayName(users.get(from))} chipped in ${money(amount, goal.currency)} to ${goal.name}.`, `/g/${goal.id}`)
}

// --- Saving plans ------------------------------------------------------------

/** Set, change or clear (cadence null) a goal's plan. Changing it starts a fresh period now. */
export async function setGoalPlan(user: User, goalId: string, input: { cadence: unknown; amount: unknown }) {
  const goal = await ownGoal(user, goalId)
  if (goal.status !== 'open') throw new ApiError('This goal is closed')
  const plan = parsePlan(input, goal.currency)
  await run('UPDATE goals SET plan_cadence = ?, plan_amount = ?, plan_anchor = ? WHERE id = ?', [
    plan?.cadence ?? null,
    plan?.amount ?? null,
    plan ? Date.now() : null,
    goalId,
  ])
}

/** Validate a plan from a request. Amount is in whole units; returns smallest units. */
export function parsePlan(input: { cadence: unknown; amount: unknown }, currency: Currency) {
  if (input.cadence === null || input.cadence === undefined || input.cadence === '') return null
  if (!isPlanCadence(input.cadence)) throw new ApiError('Pick weekly or monthly')
  const amount = Number(input.amount)
  if (!Number.isInteger(amount) || amount < Math.max(1, MIN_DEPOSIT[currency]) || amount > LIMITS[currency].max) throw new ApiError(`Plan amounts are whole ${currency}, up to ${LIMITS[currency].max.toLocaleString('en-US')}`)
  return { cadence: input.cadence, amount: amount * UNIT[currency] }
}

/** Where the owner stands this period. Only the owner's own top-ups count toward their plan. */
export async function planStatus(goal: Pick<GoalRow, 'id' | 'owner' | 'currency' | 'plan_cadence' | 'plan_amount' | 'plan_anchor' | 'custody'>, now = Date.now()) {
  if (!goal.plan_cadence || !goal.plan_amount || !goal.plan_anchor) return null
  const period = currentPeriod(goal.plan_anchor, goal.plan_cadence, now)
  const row = await one<{ saved: number }>(
    goal.custody === 'wallet'
      ? "SELECT COALESCE(SUM(added), 0) AS saved FROM wallet_goal_entries WHERE goal_id = ? AND address = ? AND kind IN ('stake', 'note') AND created_at >= ? AND created_at < ?"
      : "SELECT COALESCE(SUM(amount), 0) AS saved FROM deposits WHERE kind = 'goal' AND ref_id = ? AND address = ? AND created_at >= ? AND created_at < ?",
    [goal.id, goal.owner, period.start, period.end],
  )
  const saved = row?.saved ?? 0
  const unit = UNIT[goal.currency]
  return {
    cadence: goal.plan_cadence,
    amount: goal.plan_amount / unit,
    savedThisPeriod: saved / unit,
    done: saved >= goal.plan_amount,
    periodEnd: period.end,
    periodIndex: period.index,
  }
}
export type PlanStatus = NonNullable<Awaited<ReturnType<typeof planStatus>>>

/** Extra fields for the owner's goal page. */
export async function goalExtras(goalId: string, friendAddresses: string[]) {
  const goal = (await one<GoalRow>('SELECT * FROM goals WHERE id = ?', [goalId]))!
  const users = await usersByAddress([...new Set(friendAddresses)])
  return { plan: await planStatus(goal), nameOf: (address: string) => displayName(users.get(address)) }
}

/** Worker: remind owners whose plan period is ending without this period's saving. */
export async function remindPlans(now = Date.now()) {
  const goals = await all<GoalRow>("SELECT * FROM goals WHERE status = 'open' AND plan_cadence IS NOT NULL")
  for (const goal of goals) {
    const status = await planStatus(goal, now)
    if (!status || status.done || now < status.periodEnd - remindBefore(status.cadence)) continue
    if (goal.target !== null) {
      const balance = goal.custody === 'wallet' ? Math.round((await walletGoalBalance(goal.id)) * UNIT.NIM) : (await totals(goal.id, goal.owner)).balance
      if (balance >= goal.target) continue
    }
    const left = goal.plan_amount! - Math.round(status.savedThisPeriod * UNIT[goal.currency])
    const when = status.cadence === 'weekly' ? 'this week' : 'this month'
    await notify(goal.owner, `plan:${goal.id}:${goal.plan_anchor}:${status.periodIndex}`, 'plan_due', `${goal.name}: put in ${money(left, goal.currency)} ${when} to stay on plan.`, `/g/${goal.id}`)
  }
}
