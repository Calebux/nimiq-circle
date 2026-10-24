import 'server-only'
import { LUNA, newId, one, run } from './db'
import { serverConfig } from './env'
import { poolStaking } from './nimiq/pool-signer'
import { getBalance, getBlockNumber, getPolicy, getStaker } from './nimiq/rpc'

/**
 * Keep liquid what could be asked for in the next HORIZON; stake the rest.
 *
 * Liquid: unclaimed pots, this round's money for circles due soon, every flexible goal, locked
 * goals that open soon, and a buffer. Stakeable: locked goals far from their date, NIM the
 * treasury bought, the operator float. Unstaking takes 12-24 h (next election block plus one
 * epoch), so the horizon is 48 h.
 *
 * AUTO_STAKE=off (default) | dry (log the plan only) | on (send transactions).
 */

const HOUR = 3_600_000
const HORIZON = 48 * HOUR
/** Don't stake or unstake dust; one action per this long so a tx can land before the next. */
const MIN_MOVE = 100 * LUNA
const COOLDOWN = 10 * 60_000

const mode = () => (process.env.AUTO_STAKE === 'on' ? 'on' : process.env.AUTO_STAKE === 'dry' ? 'dry' : 'off')
const buffer = () => Math.round(Number(process.env.POOL_LIQUID_BUFFER_NIM ?? 50) * LUNA)

/** A ref is "real" if any of its deposits is on chain (dev wallets never are). */
const REAL = (kind: string, ref: string) => `EXISTS (SELECT 1 FROM deposits d WHERE d.kind = '${kind}' AND d.ref_id = ${ref} AND d.tx_hash NOT LIKE 'mock-%' AND d.currency = 'NIM')`

/** NIM that must be spendable within the horizon, in luna. */
export async function liquidNeeds() {
  const soon = Date.now() + HORIZON
  const row = await one<{ claimable: number; rounds: number; flexible: number; unlocking: number }>(
    `SELECT
      (SELECT COALESCE(SUM(pot + bonus), 0) FROM payouts p
        WHERE p.status IN ('claimable', 'sending') AND ${REAL('circle', 'p.circle_id')}) AS claimable,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deposits d JOIN circles c ON c.id = d.ref_id
        WHERE d.kind = 'circle' AND c.status = 'active' AND d.round = c.round AND d.tx_hash NOT LIKE 'mock-%' AND d.currency = 'NIM') AS rounds,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deposits d JOIN goals g ON g.id = d.ref_id
        WHERE d.kind = 'goal' AND g.status = 'open' AND g.unlock_at IS NULL AND d.tx_hash NOT LIKE 'mock-%' AND d.currency = 'NIM')
      - (SELECT COALESCE(SUM(w.amount), 0) FROM withdrawals w JOIN goals g ON g.id = w.goal_id
        WHERE g.unlock_at IS NULL AND g.currency = 'NIM' AND COALESCE(w.tx_hash, '') NOT LIKE 'mock-%') AS flexible,
      (SELECT COALESCE(SUM(d.amount), 0) FROM deposits d JOIN goals g ON g.id = d.ref_id
        WHERE d.kind = 'goal' AND g.status = 'open' AND g.unlock_at IS NOT NULL AND g.unlock_at <= ? AND d.tx_hash NOT LIKE 'mock-%' AND d.currency = 'NIM') AS unlocking`,
    [soon],
  )
  // Current-round money only has to wait if the round can close soon. (With INSTANT_PAYOUTS it
  // can close the moment the last person pays, so it always stays liquid.)
  const parts = { claimable: row?.claimable ?? 0, rounds: row?.rounds ?? 0, flexible: Math.max(0, row?.flexible ?? 0), unlocking: row?.unlocking ?? 0, buffer: buffer() }
  return { ...parts, total: Object.values(parts).reduce((a, b) => a + b, 0) }
}

export type StakePlan =
  | { action: 'none'; reason: string }
  | { action: 'retire' | 'remove' | 'unstake' | 'stake' | 'create'; amount: number; reason: string }

/** What the pool should do now. Pure read: nothing is sent. */
export async function planStaking(): Promise<StakePlan & { liquid: number; needs: Awaited<ReturnType<typeof liquidNeeds>>; staker: Awaited<ReturnType<typeof getStaker>> }> {
  const pool = serverConfig().nim.poolAddress
  if (!pool) throw new Error('POOL_ADDRESS is not configured')
  const [liquid, staker, needs, block, policy] = await Promise.all([getBalance(pool), getStaker(pool), liquidNeeds(), getBlockNumber(), getPolicy()])
  const base = { liquid, needs, staker }
  const nim = (l: number) => `${(l / LUNA).toFixed(0)} NIM`

  if (staker?.retiredBalance) return { ...base, action: 'remove', amount: staker.retiredBalance, reason: `${nim(staker.retiredBalance)} retired stake can come back` }
  const release = staker?.inactiveBalance && staker.inactiveFrom ? (staker.inactiveRelease ?? staker.inactiveFrom + policy.blocksPerEpoch + 1) : null
  if (staker?.inactiveBalance && release && block >= release) return { ...base, action: 'retire', amount: staker.inactiveBalance, reason: `${nim(staker.inactiveBalance)} inactive stake is released` }

  const deficit = needs.total - liquid
  if (deficit > 0) {
    const coming = staker?.inactiveBalance ?? 0
    if (coming >= deficit) return { ...base, action: 'none', reason: `short ${nim(deficit)}, ${nim(coming)} already unstaking` }
    const active = staker?.balance ?? 0
    if (active === 0) return { ...base, action: 'none', reason: `short ${nim(deficit)} with nothing staked: operator top-up needed` }
    let amount = Math.min(active, deficit - coming)
    // Never leave a stub under the network minimum.
    if (active - amount > 0 && active - amount < policy.minimumStake) amount = active
    return { ...base, action: 'unstake', amount, reason: `need ${nim(needs.total)} liquid within 48 h, have ${nim(liquid)}` }
  }

  const spare = liquid - needs.total
  if (spare < MIN_MOVE) return { ...base, action: 'none', reason: `${nim(spare)} spare, below the ${nim(MIN_MOVE)} minimum move` }
  if (staker?.inactiveBalance) return { ...base, action: 'none', reason: 'waiting for the current unstake to finish before staking again' }
  if (!staker) {
    if (spare < policy.minimumStake) return { ...base, action: 'none', reason: `${nim(spare)} spare, below the ${nim(policy.minimumStake)} minimum stake` }
    return { ...base, action: 'create', amount: spare, reason: `${nim(spare)} spare beyond the next 48 h` }
  }
  return { ...base, action: 'stake', amount: spare, reason: `${nim(spare)} spare beyond the next 48 h` }
}

/** Worker step: carry out the plan (or log it in dry mode), at most once per cooldown. */
export async function manageStake() {
  const m = mode()
  if (m === 'off') return null
  const last = await one<{ created_at: number }>('SELECT created_at FROM pool_actions ORDER BY created_at DESC LIMIT 1')
  if (last && Date.now() - last.created_at < COOLDOWN) return null

  const plan = await planStaking()
  if (plan.action === 'none') return plan
  const validator = serverConfig().nim.validator
  let hash: string | null = null
  if (m === 'on') {
    if (plan.action === 'remove') hash = await poolStaking.remove(plan.amount)
    else if (plan.action === 'retire') hash = await poolStaking.retire(plan.amount)
    else if (plan.action === 'unstake') hash = await poolStaking.setActive((plan.staker?.balance ?? 0) - plan.amount)
    else if (plan.action === 'stake') hash = await poolStaking.add(plan.amount)
    else if (plan.action === 'create') {
      if (!validator) throw new Error('STAKE_VALIDATOR is not set')
      hash = await poolStaking.create(plan.amount, validator)
    }
  }
  await run('INSERT INTO pool_actions (id, kind, amount, tx_hash, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    newId(10),
    m === 'on' ? plan.action : `dry:${plan.action}`,
    plan.amount,
    hash,
    plan.reason,
    Date.now(),
  ])
  console.log(`[stake] ${m === 'on' ? '' : '(dry) '}${plan.action} ${(plan.amount / LUNA).toFixed(0)} NIM: ${plan.reason}${hash ? ` ${hash}` : ''}`)
  return plan
}
