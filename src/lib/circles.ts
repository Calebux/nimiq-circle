import 'server-only'
import { displayName, usersByAddress, type User } from './auth'
import { all, LUNA, newId, one, run } from './db'
import { bankLanded, deliver, type BankDetails, type Method } from './delivery'
import { circleMemo, isSimulated, reconcile, verifyDeposit, type DepositResult } from './deposits'
import { serverConfig } from './env'
import { ApiError } from './errors'
import { sameAddress } from './nimiq/address'
import { yieldShare } from './yield'

export const CADENCE_DAYS: Record<string, number> = { Weekly: 7, 'Every 2 weeks': 14, Monthly: 30 }
const DAY = 86_400_000

interface CircleRow {
  id: string
  name: string
  local_name: string
  cadence: string
  contribution: number
  size: number
  order_mode: 'join' | 'shuffle'
  invite_code: string
  status: 'filling' | 'active' | 'done'
  round: number
  started_at: number | null
  created_by: string
  created_at: number
}

interface MemberRow {
  circle_id: string
  address: string
  turn: number
}

interface PayoutRow {
  id: string
  circle_id: string
  round: number
  address: string
  pot: number
  bonus: number
  /** 'sending' only while a claim is in flight. */
  status: 'claimable' | 'sending' | 'sent' | 'cashing' | 'cashed'
  method: Method | null
  tx_hash: string | null
  bank: string | null
  ngn: number | null
  provider_id: string | null
  created_at: number
  settled_at: number | null
}

const dueAt = (c: Pick<CircleRow, 'started_at' | 'cadence'>, round: number) =>
  c.started_at ? c.started_at + round * (CADENCE_DAYS[c.cadence] ?? 7) * DAY : null

function inviteCode(name: string) {
  const word = name.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 6) || 'CIRCLE'
  return `${word}-${newId(4).toUpperCase()}`
}

async function getCircle(id: string): Promise<CircleRow> {
  const circle = await one<CircleRow>('SELECT * FROM circles WHERE id = ?', [id])
  if (!circle) throw new ApiError('Circle not found', 404)
  return circle
}

const membersOf = (id: string) => all<MemberRow>('SELECT * FROM members WHERE circle_id = ? ORDER BY turn', [id])

// --- Create / join -----------------------------------------------------------

export async function createCircle(by: User, input: { name: string; localName: string; cadence: string; contributionNim: number; size: number; order: 'join' | 'shuffle' }) {
  const name = input.name.trim().slice(0, 32)
  if (!name) throw new ApiError('Give your circle a name')
  if (!CADENCE_DAYS[input.cadence]) throw new ApiError('Pick how often')
  if (!Number.isInteger(input.contributionNim) || input.contributionNim < 1 || input.contributionNim > 1_000_000) throw new ApiError('Pick an amount between 1 and 1,000,000 NIM')
  if (!Number.isInteger(input.size) || input.size < 2 || input.size > 12) throw new ApiError('Circles have 2 to 12 people')

  const id = newId()
  const now = Date.now()
  await run(
    `INSERT INTO circles (id, name, local_name, cadence, contribution, size, order_mode, invite_code, status, round, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'filling', 0, ?, ?)`,
    [id, name, input.localName.slice(0, 16), input.cadence, input.contributionNim * LUNA, input.size, input.order, inviteCode(name), by.address, now],
  )
  await run('INSERT INTO members (circle_id, address, turn, joined_at) VALUES (?, ?, 1, ?)', [id, by.address, now])
  return id
}

export async function circleByCode(code: string) {
  const circle = await one<CircleRow>('SELECT * FROM circles WHERE invite_code = ?', [code.trim().toUpperCase()])
  if (!circle) throw new ApiError('No circle with that code', 404)
  return circle
}

export async function joinCircle(user: User, code: string) {
  const circle = await circleByCode(code)
  const members = await membersOf(circle.id)
  if (members.some((m) => sameAddress(m.address, user.address))) return circle.id
  if (circle.status !== 'filling' || members.length >= circle.size) throw new ApiError('This circle is already full')

  await run('INSERT INTO members (circle_id, address, turn, joined_at) VALUES (?, ?, ?, ?)', [circle.id, user.address, members.length + 1, Date.now()])
  if (members.length + 1 === circle.size) await startCircle(circle)
  return circle.id
}

async function startCircle(circle: CircleRow) {
  if (circle.order_mode === 'shuffle') {
    const members = await membersOf(circle.id)
    const turns = members.map((_, i) => i + 1)
    for (let i = turns.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
      ;[turns[i], turns[j]] = [turns[j], turns[i]]
    }
    // Two passes so the UNIQUE (circle_id, turn) constraint never sees a duplicate.
    for (const m of members) await run('UPDATE members SET turn = -turn WHERE circle_id = ? AND address = ?', [circle.id, m.address])
    for (const [i, m] of members.entries()) await run('UPDATE members SET turn = ? WHERE circle_id = ? AND address = ?', [turns[i], circle.id, m.address])
  }
  await run("UPDATE circles SET status = 'active', round = 1, started_at = ? WHERE id = ?", [Date.now(), circle.id])
}

// --- Rounds ------------------------------------------------------------------

async function paidThisRound(circleId: string, round: number) {
  const rows = await all<{ address: string }>("SELECT address FROM deposits WHERE kind = 'circle' AND ref_id = ? AND round = ?", [circleId, round])
  return rows.map((r) => r.address)
}

/** Money this circle holds in the pool right now (deposits minus pots that left). */
async function heldBalance(circleId: string) {
  const row = await one<{ held: number; simulated: number }>(
    `SELECT
       (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE kind = 'circle' AND ref_id = ?1)
     - (SELECT COALESCE(SUM(pot), 0) FROM payouts WHERE circle_id = ?1 AND status != 'claimable') AS held,
       (SELECT COUNT(*) FROM deposits WHERE kind = 'circle' AND ref_id = ?1 AND tx_hash LIKE 'mock-%') AS simulated`,
    [circleId],
  )
  return { held: row?.held ?? 0, simulated: (row?.simulated ?? 0) > 0 }
}

/**
 * Close every round that is fully paid and due: the pot (plus the yield it earned while it
 * waited) becomes claimable by that round's member. Safe to call on every read.
 */
export async function advance(circleId: string) {
  for (;;) {
    const circle = await getCircle(circleId)
    if (circle.status !== 'active') return
    const members = await membersOf(circleId)
    const before = await paidThisRound(circleId, circle.round)
    // Credit current-round payments the app never reported. A second payment from someone
    // who already paid is left unrecorded (it needs a refund, not a credit).
    const credited = [...before]
    await reconcile('circle', circleId, (memo, payer, tx) => {
      const member = members.find((m) => sameAddress(m.address, payer))
      const ok = member && memo === circleMemo(circleId, circle.round) && tx.value >= circle.contribution && !credited.some((a) => sameAddress(a, payer))
      if (!ok) return null
      credited.push(member.address)
      return { round: circle.round, address: member.address }
    }).catch((err) => console.error('reconcile circle', circleId, err))
    const paid = await paidThisRound(circleId, circle.round)
    if (!members.every((m) => paid.some((a) => sameAddress(a, m.address)))) return
    const due = dueAt(circle, circle.round)
    if (!serverConfig().instantPayouts && due && Date.now() < due) return

    const recipient = members.find((m) => m.turn === circle.round)!
    const { held, simulated } = await heldBalance(circleId)
    const bonus = await yieldShare(held, simulated)
    await run(
      `INSERT OR IGNORE INTO payouts (id, circle_id, round, address, pot, bonus, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'claimable', ?)`,
      [newId(), circleId, circle.round, recipient.address, circle.contribution * circle.size, bonus, Date.now()],
    )
    const next = circle.round + 1
    await run('UPDATE circles SET round = ?, status = ? WHERE id = ?', [Math.min(next, circle.size), next > circle.size ? 'done' : 'active', circleId])
    if (next > circle.size) return
  }
}

export async function recordContribution(user: User, circleId: string, hint: string | null): Promise<DepositResult> {
  const circle = await getCircle(circleId)
  if (circle.status !== 'active') throw new ApiError('This circle is not collecting right now')
  const members = await membersOf(circleId)
  if (!members.some((m) => sameAddress(m.address, user.address))) throw new ApiError('You are not in this circle', 403)
  const result = await verifyDeposit({
    user,
    kind: 'circle',
    refId: circleId,
    round: circle.round,
    memo: circleMemo(circleId, circle.round),
    minAmount: circle.contribution,
    hint,
  })
  if (result.status === 'confirmed') await advance(circleId)
  return result
}

// --- Payouts -----------------------------------------------------------------

async function settle(payout: PayoutRow) {
  if (payout.status === 'cashing' && payout.provider_id && (await bankLanded(payout.provider_id))) {
    await run("UPDATE payouts SET status = 'cashed', settled_at = ? WHERE id = ?", [Date.now(), payout.id])
    return { ...payout, status: 'cashed' as const, settled_at: Date.now() }
  }
  return payout
}

export async function claimPayout(user: User, payoutId: string, method: Method, bank?: BankDetails) {
  const payout = await one<PayoutRow>('SELECT * FROM payouts WHERE id = ?', [payoutId])
  if (!payout || !sameAddress(payout.address, user.address)) throw new ApiError('Payout not found', 404)
  if (payout.status !== 'claimable') return publicPayout(await settle(payout))

  // Claim first so a double tap cannot send twice.
  const claimed = await run("UPDATE payouts SET status = 'sending' WHERE id = ? AND status = 'claimable'", [payoutId])
  if (claimed.rowsAffected === 0) throw new ApiError('This payout is already on its way')
  try {
    const d = await deliver({ to: user, luna: payout.pot + payout.bonus, memo: `cp:${payout.circle_id}:${payout.round}`, method, bank, reference: `cp-${payout.id}` })
    await run('UPDATE payouts SET status = ?, method = ?, tx_hash = ?, bank = ?, ngn = ?, provider_id = ?, settled_at = ? WHERE id = ?', [
      d.status,
      method,
      d.txHash,
      d.bank,
      d.ngn,
      d.providerId,
      d.status === 'sent' ? Date.now() : null,
      payoutId,
    ])
  } catch (err) {
    await run("UPDATE payouts SET status = 'claimable' WHERE id = ?", [payoutId])
    throw err
  }
  return publicPayout((await one<PayoutRow>('SELECT * FROM payouts WHERE id = ?', [payoutId]))!)
}

function publicPayout(p: PayoutRow) {
  return {
    id: p.id,
    circleId: p.circle_id,
    round: p.round,
    pot: p.pot / LUNA,
    bonus: p.bonus / LUNA,
    status: p.status,
    method: p.method,
    txHash: p.tx_hash,
    simulated: isSimulated(p.tx_hash),
    bank: p.bank,
    ngn: p.ngn,
    settledAt: p.settled_at,
  }
}
export type PublicPayout = ReturnType<typeof publicPayout>

export async function getPayout(user: User, payoutId: string) {
  const payout = await one<PayoutRow>('SELECT * FROM payouts WHERE id = ?', [payoutId])
  if (!payout || !sameAddress(payout.address, user.address)) throw new ApiError('Payout not found', 404)
  return publicPayout(await settle(payout))
}

// --- Views -------------------------------------------------------------------

export async function circleView(user: User, circleId: string) {
  await advance(circleId)
  const circle = await getCircle(circleId)
  const members = await membersOf(circleId)
  const you = members.find((m) => sameAddress(m.address, user.address))
  if (!you) throw new ApiError('You are not in this circle', 403)

  const [users, paid, payouts, balance] = await Promise.all([
    usersByAddress(members.map((m) => m.address)),
    circle.status === 'active' ? paidThisRound(circleId, circle.round) : Promise.resolve([] as string[]),
    all<PayoutRow>('SELECT * FROM payouts WHERE circle_id = ? ORDER BY round', [circleId]),
    heldBalance(circleId),
  ])
  const earned = await yieldShare(balance.held, balance.simulated)
  const yourPayout = payouts.filter((p) => sameAddress(p.address, user.address)).at(-1)

  return {
    id: circle.id,
    name: circle.name,
    localName: circle.local_name,
    cadence: circle.cadence,
    contribution: circle.contribution / LUNA,
    size: circle.size,
    status: circle.status,
    round: circle.round,
    inviteCode: circle.invite_code,
    roundDueAt: circle.status === 'active' ? dueAt(circle, circle.round) : null,
    yourTurn: you.turn,
    yourTurnDueAt: dueAt(circle, you.turn),
    youPaid: paid.some((a) => sameAddress(a, user.address)),
    memo: circle.status === 'active' ? circleMemo(circle.id, circle.round) : null,
    earned: earned / LUNA,
    members: members.map((m) => {
      const u = users.get(m.address)
      return {
        address: m.address,
        name: displayName(u, user.address),
        avatar: u?.avatar ?? 1,
        turn: m.turn,
        isYou: sameAddress(m.address, user.address),
        paid: paid.some((a) => sameAddress(a, m.address)),
        tookPot: payouts.some((p) => p.round === m.turn),
      }
    }),
    yourPayout: yourPayout ? publicPayout(await settle(yourPayout)) : null,
  }
}
export type CircleView = Awaited<ReturnType<typeof circleView>>

export async function circlePreview(code: string) {
  const circle = await circleByCode(code)
  const members = await membersOf(circle.id)
  const users = await usersByAddress(members.map((m) => m.address))
  return {
    id: circle.id,
    name: circle.name,
    localName: circle.local_name,
    cadence: circle.cadence,
    contribution: circle.contribution / LUNA,
    size: circle.size,
    status: circle.status,
    inviteCode: circle.invite_code,
    members: members.map((m) => ({ name: displayName(users.get(m.address)), avatar: users.get(m.address)?.avatar ?? 1, turn: m.turn })),
  }
}
export type CirclePreview = Awaited<ReturnType<typeof circlePreview>>

export async function myCircles(user: User) {
  const rows = await all<CircleRow & { turn: number }>(
    `SELECT c.*, m.turn FROM circles c JOIN members m ON m.circle_id = c.id WHERE m.address = ? ORDER BY c.created_at DESC`,
    [user.address],
  )
  return Promise.all(
    rows.map(async (c) => {
      await advance(c.id)
      const fresh = await getCircle(c.id)
      const members = await membersOf(c.id)
      const users = await usersByAddress(members.map((m) => m.address))
      const paid = fresh.status === 'active' ? await paidThisRound(c.id, fresh.round) : []
      const claimable = await one<{ id: string }>("SELECT id FROM payouts WHERE circle_id = ? AND address = ? AND status = 'claimable'", [c.id, user.address])
      return {
        id: c.id,
        name: c.name,
        localName: c.local_name,
        contribution: c.contribution / LUNA,
        size: c.size,
        status: fresh.status,
        round: fresh.round,
        joined: members.length,
        avatars: members.map((m) => users.get(m.address)?.avatar ?? 1),
        youPaid: paid.some((a) => sameAddress(a, user.address)),
        dueAt: fresh.status === 'active' ? dueAt(fresh, fresh.round) : null,
        payoutReady: Boolean(claimable),
      }
    }),
  )
}
export type CircleSummary = Awaited<ReturnType<typeof myCircles>>[number]
