import 'server-only'
import { AVATAR_COUNT, displayName, usersByAddress, type User } from './auth'
import { LIMITS, UNIT, type Currency } from './currency'
import { all, newId, one, run } from './db'
import { bankStatus, deliver, simulateDelivery, type BankDetails, type Method } from './delivery'
import { circleMemo, isSimulated, memoFor, reconcile, verifyDeposit, type DepositResult } from './deposits'
import { serverConfig } from './env'
import { ApiError } from './errors'
import { formatAddress, sameAddress } from './nimiq/address'
import { notify } from './notices'
import { yieldShare } from './yield'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Round length per cadence. "Every 10 min" exists only with DEMO_CADENCE=1, for demo videos;
 * "Practice" only on practice circles, which also pay out as soon as everyone is in.
 */
const CADENCE_MS: Record<string, number> = { Weekly: 7 * DAY, 'Every 2 weeks': 14 * DAY, Monthly: 30 * DAY, 'Every 10 min': 10 * MINUTE, Practice: 10 * MINUTE }

export function cadences(): string[] {
  const list = ['Weekly', 'Every 2 weeks', 'Monthly']
  return process.env.DEMO_CADENCE === '1' ? [...list, 'Every 10 min'] : list
}

const periodOf = (cadence: string) => CADENCE_MS[cadence] ?? 7 * DAY

/** After the due date, late payers get this long before the pot goes out with what is in. */
const graceOf = (cadence: string) => Math.min(DAY, Math.round(periodOf(cadence) * 0.3))

/** Reminders go out this long before a round is due. */
const remindBefore = (cadence: string) => Math.min(DAY, Math.round(periodOf(cadence) * 0.3))

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
  currency: Currency
  created_at: number
  /** 1: you plus two bots, every payment simulated. */
  practice: number
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
  kind: 'pot' | 'late'
  /** 'late' only: who paid the missed contribution. */
  from_address: string | null
}

interface MissRow {
  circle_id: string
  round: number
  address: string
  amount: number
  settled_tx: string | null
}

const dueAt = (c: Pick<CircleRow, 'started_at' | 'cadence'>, round: number) => (c.started_at ? c.started_at + round * periodOf(c.cadence) : null)

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

export interface CircleSettings {
  name: string
  localName: string
  cadence: string
  /** Whole units of `currency`. */
  contribution: number
  currency: Currency
  size: number
  order: 'join' | 'shuffle'
}

export const MIN_SIZE = 2
export const MAX_SIZE = 12

function validateSettings(input: CircleSettings) {
  const name = input.name.trim().slice(0, 32)
  if (!name) throw new ApiError('Give your circle a name')
  if (!cadences().includes(input.cadence)) throw new ApiError('Pick how often')
  const { min, max } = LIMITS[input.currency]
  if (!Number.isInteger(input.contribution) || input.contribution < min || input.contribution > max) throw new ApiError(`Pick an amount between ${min} and ${max.toLocaleString('en-US')} ${input.currency}`)
  if (!Number.isInteger(input.size) || input.size < MIN_SIZE || input.size > MAX_SIZE) throw new ApiError(`Circles have ${MIN_SIZE} to ${MAX_SIZE} people`)
  return { ...input, name, localName: input.localName.slice(0, 16) }
}

export async function createCircle(by: User, settings: CircleSettings) {
  const input = validateSettings(settings)
  const name = input.name

  const id = newId()
  const now = Date.now()
  await run(
    `INSERT INTO circles (id, name, local_name, cadence, contribution, size, order_mode, invite_code, status, round, created_by, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'filling', 0, ?, ?, ?)`,
    [id, name, input.localName, input.cadence, input.contribution * UNIT[input.currency], input.size, input.order, inviteCode(name), by.address, input.currency, now],
  )
  await run('INSERT INTO members (circle_id, address, turn, joined_at) VALUES (?, ?, 1, ?)', [id, by.address, now])
  return id
}

// --- Practice ------------------------------------------------------------------

const PRACTICE_CONTRIBUTION = 5_000
const BOT_NAMES = ['Tunde', 'Kemi', 'Ada', 'Kofi', 'Wanjiru', 'Thabo', 'Amaka', 'Sipho']
/** Seconds into a round before each bot chips in, so you watch the pot fill. */
const BOT_DELAYS = [4, 12]

/**
 * A circle to try the whole loop alone: you take the first pot, two bots chip in on their
 * own, and nothing touches the chain or a bank. Reuses your open one if you have it.
 */
export async function createPractice(user: User) {
  const open = await one<{ id: string }>("SELECT id FROM circles WHERE created_by = ? AND practice = 1 AND status = 'active'", [user.address])
  if (open) return open.id

  const Nimiq = await import('@nimiq/core')
  const shuffle = <T,>(list: T[]) => [...list].sort(() => Math.random() - 0.5)
  const names = shuffle(BOT_NAMES)
  // Faces that differ from yours and from each other.
  const avatars = shuffle(Array.from({ length: AVATAR_COUNT }, (_, i) => i + 1).filter((a) => a !== user.avatar))
  const bots: string[] = []
  for (const i of BOT_DELAYS.keys()) {
    const address = Nimiq.KeyPair.generate().toAddress().toUserFriendlyAddress()
    await run('INSERT INTO users (address, name, avatar, dev, bot, created_at) VALUES (?, ?, ?, 1, 1, ?)', [address, names[i], avatars[i], Date.now()])
    bots.push(address)
  }

  const id = newId()
  const now = Date.now()
  await run(
    `INSERT INTO circles (id, name, local_name, cadence, contribution, size, order_mode, invite_code, status, round, started_at, created_by, currency, practice, created_at)
     VALUES (?, 'Practice circle', 'Ajo', 'Practice', ?, ?, 'join', ?, 'active', 1, ?, ?, 'NIM', 1, ?)`,
    [id, PRACTICE_CONTRIBUTION * UNIT.NIM, bots.length + 1, `PRACTICE-${newId(6).toUpperCase()}`, now, user.address, now],
  )
  for (const [i, address] of [user.address, ...bots].entries()) {
    await run('INSERT INTO members (circle_id, address, turn, joined_at) VALUES (?, ?, ?, ?)', [id, address, i + 1, now + i])
  }
  return id
}

/** Bots chip in a few seconds after their round opens. */
async function botsPay(circle: CircleRow, members: MemberRow[]) {
  const bots = new Set((await all<{ address: string }>('SELECT address FROM users WHERE bot = 1 AND address IN (SELECT address FROM members WHERE circle_id = ?)', [circle.id])).map((b) => b.address))
  const lastPot = await one<{ at: number }>("SELECT MAX(created_at) AS at FROM payouts WHERE circle_id = ? AND kind = 'pot'", [circle.id])
  const openedAt = Math.max(circle.started_at ?? 0, lastPot?.at ?? 0)
  const paid = await paidThisRound(circle.id, circle.round)
  let i = 0
  for (const m of members) {
    if (!bots.has(m.address)) continue
    const delay = BOT_DELAYS[i++] ?? 20
    if (paid.includes(m.address) || Date.now() < openedAt + delay * 1000) continue
    const memo = circleMemo(circle.id, circle.round)
    await run(
      `INSERT OR IGNORE INTO deposits (tx_hash, kind, ref_id, round, address, amount, memo, status, currency, created_at)
       VALUES (?, 'circle', ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
      [`mock-${memo}-${m.address.replace(/\s/g, '').slice(-6)}`, circle.id, circle.round, m.address, circle.contribution, memo, circle.currency, Date.now()],
    )
  }
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

// --- Before round 1: the creator can still change things ----------------------

async function ownFilling(user: User, circleId: string) {
  const circle = await getCircle(circleId)
  if (!sameAddress(circle.created_by, user.address)) throw new ApiError('Only the person who started the circle can change it', 403)
  if (circle.status !== 'filling') throw new ApiError('This circle has started. Its terms can no longer change.')
  return circle
}

/** Close the turn gaps someone leaving creates, keeping join order. */
async function renumber(circleId: string) {
  const members = await all<MemberRow>('SELECT * FROM members WHERE circle_id = ? ORDER BY joined_at, turn', [circleId])
  for (const m of members) await run('UPDATE members SET turn = -turn WHERE circle_id = ? AND address = ?', [circleId, m.address])
  for (const [i, m] of members.entries()) await run('UPDATE members SET turn = ? WHERE circle_id = ? AND address = ?', [i + 1, circleId, m.address])
}

export async function updateCircle(user: User, circleId: string, settings: CircleSettings) {
  const circle = await ownFilling(user, circleId)
  const input = validateSettings(settings)
  const joined = (await membersOf(circleId)).length
  if (input.size < joined) throw new ApiError(`${joined} people have already joined. Remove someone first to go smaller.`)
  await run('UPDATE circles SET name = ?, local_name = ?, cadence = ?, contribution = ?, currency = ?, size = ?, order_mode = ? WHERE id = ?', [
    input.name,
    input.localName,
    input.cadence,
    input.contribution * UNIT[input.currency],
    input.currency,
    input.size,
    input.order,
    circleId,
  ])
  // Shrinking to exactly who is here means everyone is in: start.
  if (input.size === joined) await startCircle({ ...circle, order_mode: input.order })
}

/** Start with the people who joined; the circle and its pot shrink to match. */
export async function startNow(user: User, circleId: string) {
  const circle = await ownFilling(user, circleId)
  const joined = (await membersOf(circleId)).length
  if (joined < MIN_SIZE) throw new ApiError(`A circle needs at least ${MIN_SIZE} people`)
  await run('UPDATE circles SET size = ? WHERE id = ?', [joined, circleId])
  await startCircle(circle)
}

/** Creator removes someone, or a member leaves, before round 1. Nobody has paid yet. */
export async function removeMember(user: User, circleId: string, address: string) {
  const circle = await getCircle(circleId)
  if (circle.status !== 'filling') throw new ApiError('This circle has started. Members can no longer leave.')
  const self = sameAddress(address, user.address)
  if (sameAddress(address, circle.created_by)) throw new ApiError(self ? 'You started this circle, so you can\'t leave it. You can change it instead.' : 'The creator stays in the circle')
  if (!self && !sameAddress(circle.created_by, user.address)) throw new ApiError('Only the person who started the circle can remove people', 403)
  const result = await run('DELETE FROM members WHERE circle_id = ? AND address = ?', [circleId, formatAddress(address)])
  if (result.rowsAffected === 0) throw new ApiError('They are not in this circle', 404)
  await renumber(circleId)
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
  const rows = await all<{ address: string }>("SELECT DISTINCT address FROM deposits WHERE kind = 'circle' AND ref_id = ? AND round = ?", [circleId, round])
  return rows.map((r) => r.address)
}

const unsettledMisses = (circleId: string) => all<MissRow>('SELECT * FROM misses WHERE circle_id = ? AND settled_tx IS NULL', [circleId])

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

async function names(addresses: string[]) {
  const users = await usersByAddress(addresses)
  return (address: string) => displayName(users.get(address))
}

/**
 * Credit pool payments the app never reported: the current round from members who have not
 * paid it, and missed rounds from the member who missed them. Anything else (a second payment)
 * is left unrecorded: it needs a refund, not a credit.
 */
async function reconcileCircle(circle: CircleRow, members: MemberRow[]) {
  // USDT circles are reconciled from reported transfers instead (syncEvmPending).
  if (circle.currency !== 'NIM') return
  const paidNow = circle.status === 'active' ? await paidThisRound(circle.id, circle.round) : []
  const misses = await unsettledMisses(circle.id)
  const credited = new Set(paidNow.map((a) => `${circle.round}:${formatAddress(a)}`))
  await reconcile('circle', circle.id, (memo, payer, tx) => {
    const member = members.find((m) => sameAddress(m.address, payer))
    const round = Number(memo.split(':')[2])
    if (!member || tx.value < circle.contribution || !Number.isInteger(round)) return null
    const current = circle.status === 'active' && round === circle.round
    const late = misses.some((m) => m.round === round && sameAddress(m.address, member.address))
    const key = `${round}:${member.address}`
    if ((!current && !late) || credited.has(key)) return null
    credited.add(key)
    return { round, address: member.address }
  }).catch((err) => console.error('reconcile circle', circle.id, err))
}

/** A missed contribution that has now been paid goes to the member who got that round's short pot. */
async function settleLate(circle: CircleRow, members: MemberRow[]) {
  const misses = await unsettledMisses(circle.id)
  if (misses.length === 0) return
  const nameOf = await names(members.map((m) => m.address))
  for (const miss of misses) {
    const deposit = await one<{ tx_hash: string }>("SELECT tx_hash FROM deposits WHERE kind = 'circle' AND ref_id = ? AND round = ? AND address = ?", [circle.id, miss.round, miss.address])
    if (!deposit) continue
    const settled = await run('UPDATE misses SET settled_tx = ? WHERE circle_id = ? AND round = ? AND address = ? AND settled_tx IS NULL', [deposit.tx_hash, circle.id, miss.round, miss.address])
    if (settled.rowsAffected === 0) continue
    const recipient = members.find((m) => m.turn === miss.round)
    if (!recipient) continue
    const id = newId()
    await run(
      `INSERT INTO payouts (id, circle_id, round, address, pot, bonus, status, created_at, kind, from_address)
       VALUES (?, ?, ?, ?, ?, 0, 'claimable', ?, 'late', ?)`,
      [id, circle.id, miss.round, recipient.address, miss.amount, Date.now(), miss.address],
    )
    await notify(recipient.address, `late_money:${id}`, 'late_money', `${nameOf(miss.address)} paid what they owed for round ${miss.round} of ${circle.name}. ${money(miss.amount, circle.currency)} is yours.`, `/c/${circle.id}/payout`)
  }
}

/** "500 NIM", "10 USDT", for notices. */
const money = (amount: number, currency: Currency) => `${(amount / UNIT[currency]).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`

/** "Sat 24 Oct", or "Sat 14:05" for demo rounds that last minutes. Lagos time, like the app. */
function dayLabel(ms: number, cadence: string) {
  const short = periodOf(cadence) < DAY
  return new Date(ms).toLocaleString('en-GB', short ? { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' } : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })
}

/**
 * Close every round that is due. Fully paid: the pot (plus the yield it earned while it waited)
 * goes to that round's member. Not fully paid: unpaid members get a grace period, then the pot
 * goes out with what is in and the gap is recorded as a miss they can settle later.
 * Safe to call on every read; the worker calls it every minute.
 */
export async function advance(circleId: string) {
  for (;;) {
    const circle = await getCircle(circleId)
    if (circle.status === 'filling') return
    const members = await membersOf(circleId)
    await reconcileCircle(circle, members)
    await settleLate(circle, members)
    if (circle.status !== 'active') return
    if (circle.practice) await botsPay(circle, members)

    const paid = await paidThisRound(circleId, circle.round)
    const unpaid = members.filter((m) => !paid.some((a) => sameAddress(a, m.address)))
    const due = dueAt(circle, circle.round)
    const now = Date.now()
    if (unpaid.length === 0) {
      if (!serverConfig().instantPayouts && !circle.practice && due && now < due) return
    } else if (!due || now < due + graceOf(circle.cadence)) {
      return
    }

    const recipient = members.find((m) => m.turn === circle.round)!
    const nameOf = await names(members.map((m) => m.address))
    for (const m of unpaid) {
      await run('INSERT OR IGNORE INTO misses (circle_id, round, address, amount, created_at) VALUES (?, ?, ?, ?, ?)', [circleId, circle.round, m.address, circle.contribution, now])
      await notify(
        m.address,
        `missed:${circleId}:${circle.round}`,
        'missed',
        `Round ${circle.round} of ${circle.name} closed without your ${money(circle.contribution, circle.currency)}. Pay it any time and it goes straight to ${nameOf(recipient.address)}.`,
        `/c/${circleId}`,
      )
    }

    const collected = (members.length - unpaid.length) * circle.contribution
    if (collected > 0) {
      const { held, simulated } = await heldBalance(circleId)
      const bonus = await yieldShare(held, simulated, circle.currency)
      await run(
        `INSERT OR IGNORE INTO payouts (id, circle_id, round, address, pot, bonus, status, created_at, kind)
         VALUES (?, ?, ?, ?, ?, ?, 'claimable', ?, 'pot')`,
        [newId(), circleId, circle.round, recipient.address, collected, bonus, now],
      )
      await notify(
        recipient.address,
        `pot_ready:${circleId}:${circle.round}`,
        unpaid.length ? 'short_pot' : 'pot_ready',
        unpaid.length
          ? `Your ${circle.name} pot is ready: ${money(collected, circle.currency)}. ${unpaid.length} ${unpaid.length === 1 ? 'person still owes' : 'people still owe'}; it comes to you when they pay.`
          : `Your ${circle.name} pot is ready: ${money(collected, circle.currency)}.`,
        `/c/${circleId}/payout`,
      )
    }
    const next = circle.round + 1
    await run('UPDATE circles SET round = ?, status = ? WHERE id = ?', [Math.min(next, circle.size), next > circle.size ? 'done' : 'active', circleId])
    if (next > circle.size) return
  }
}

/**
 * Record a contribution for the current round, or with `round` set, a missed earlier round
 * (which then goes to whoever got that round's short pot).
 */
export async function recordContribution(user: User, circleId: string, hint: string | null, round?: number): Promise<DepositResult> {
  const circle = await getCircle(circleId)
  const members = await membersOf(circleId)
  if (!members.some((m) => sameAddress(m.address, user.address))) throw new ApiError('You are not in this circle', 403)

  let forRound = circle.round
  if (round !== undefined && round !== circle.round) {
    const miss = await one<MissRow>('SELECT * FROM misses WHERE circle_id = ? AND round = ? AND address = ? AND settled_tx IS NULL', [circleId, round, user.address])
    if (!miss) throw new ApiError('You do not owe anything for that round')
    forRound = round
  } else if (circle.status !== 'active') {
    throw new ApiError('This circle is not collecting right now')
  }

  const result = await verifyDeposit({
    user,
    kind: 'circle',
    refId: circleId,
    round: forRound,
    memo: memoFor(user, circleMemo(circleId, forRound), circle.currency),
    minAmount: circle.contribution,
    hint,
    currency: circle.currency,
    simulated: Boolean(circle.practice),
  })
  if (result.status === 'confirmed') await advance(circleId)
  return result
}

/** Any member can nudge someone who has not paid this round; once per pair per round. */
export async function nudge(user: User, circleId: string, address: string) {
  const circle = await getCircle(circleId)
  if (circle.status !== 'active') throw new ApiError('There is nothing to pay right now')
  const members = await membersOf(circleId)
  const from = members.find((m) => sameAddress(m.address, user.address))
  const to = members.find((m) => sameAddress(m.address, address))
  if (!from || !to) throw new ApiError('You are not both in this circle', 403)
  if (sameAddress(from.address, to.address)) throw new ApiError('You cannot nudge yourself')
  if ((await paidThisRound(circleId, circle.round)).some((a) => sameAddress(a, to.address))) throw new ApiError('They have already paid')
  const nameOf = await names([from.address, to.address])
  const due = dueAt(circle, circle.round)
  const text = `${nameOf(from.address)} is reminding you to chip in ${money(circle.contribution, circle.currency)} for ${circle.name}${due ? ` by ${dayLabel(due, circle.cadence)}` : ''}.`
  await notify(to.address, `nudge:${circleId}:${circle.round}:${from.address}:${to.address}`, 'nudge', text, `/c/${circleId}`)
  return { text: `Hey ${nameOf(to.address)}, quick reminder to chip in ${money(circle.contribution, circle.currency)} for ${circle.name} on Akilii 🙏` }
}

/** Worker: "due soon" and "you are late" reminders for everyone who has not paid this round. */
export async function remind(circleId: string) {
  const circle = await getCircle(circleId)
  if (circle.status !== 'active') return
  const due = dueAt(circle, circle.round)
  if (!due) return
  const now = Date.now()
  const members = await membersOf(circleId)
  const paid = await paidThisRound(circleId, circle.round)
  for (const m of members) {
    if (paid.some((a) => sameAddress(a, m.address))) continue
    if (now >= due) {
      await notify(m.address, `late:${circleId}:${circle.round}`, 'late', `You are late for round ${circle.round} of ${circle.name}. Chip in ${money(circle.contribution, circle.currency)} before the grace period ends.`, `/c/${circleId}`)
    } else if (now >= due - remindBefore(circle.cadence)) {
      await notify(m.address, `due:${circleId}:${circle.round}`, 'due_soon', `${circle.name}: chip in ${money(circle.contribution, circle.currency)} by ${dayLabel(due, circle.cadence)}.`, `/c/${circleId}`)
    }
  }
}

export const activeCircleIds = async () => (await all<{ id: string }>("SELECT id FROM circles WHERE status IN ('active', 'done')")).map((r) => r.id)

// --- Payouts -----------------------------------------------------------------

const currencyOf = async (circleId: string) => (await one<{ currency: Currency }>('SELECT currency FROM circles WHERE id = ?', [circleId]))?.currency ?? 'NIM'

async function settle(payout: PayoutRow) {
  if (payout.status !== 'cashing' || !payout.provider_id) return payout
  const status = await bankStatus(payout.provider_id)
  if (status === 'paid') {
    await run("UPDATE payouts SET status = 'cashed', settled_at = ? WHERE id = ?", [Date.now(), payout.id])
    return { ...payout, status: 'cashed' as const, settled_at: Date.now() }
  }
  if (status === 'failed') {
    // The provider refunded the pool: the pot is claimable again.
    await run("UPDATE payouts SET status = 'claimable', method = NULL, tx_hash = NULL, bank = NULL, ngn = NULL, provider_id = NULL WHERE id = ?", [payout.id])
    console.error('bank cash-out refunded', payout.id)
    return { ...payout, status: 'claimable' as const, method: null, tx_hash: null, bank: null, ngn: null, provider_id: null }
  }
  return payout
}

export async function claimPayout(user: User, payoutId: string, method: Method, bank?: BankDetails, evmAddress?: string) {
  const payout = await one<PayoutRow>('SELECT * FROM payouts WHERE id = ?', [payoutId])
  if (!payout || !sameAddress(payout.address, user.address)) throw new ApiError('Payout not found', 404)
  const currency = await currencyOf(payout.circle_id)
  if (payout.status !== 'claimable') return publicPayout(await settle(payout), currency)
  const practice = await one<{ practice: number }>('SELECT practice FROM circles WHERE id = ?', [payout.circle_id])

  // Claim first so a double tap cannot send twice.
  const claimed = await run("UPDATE payouts SET status = 'sending' WHERE id = ? AND status = 'claimable'", [payoutId])
  if (claimed.rowsAffected === 0) throw new ApiError('This payout is already on its way')
  try {
    const amount = payout.pot + payout.bonus
    const reference = `cp-${payout.id}`
    const d = practice?.practice
      ? await simulateDelivery({ to: user, amount, currency, method, bank, reference })
      : await deliver({ to: user, amount, currency, memo: `cp:${payout.circle_id}:${payout.round}`, method, bank, reference, evmAddress })
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
  return publicPayout((await one<PayoutRow>('SELECT * FROM payouts WHERE id = ?', [payoutId]))!, currency)
}

function publicPayout(p: PayoutRow, currency: Currency, fromName?: string) {
  return {
    id: p.id,
    circleId: p.circle_id,
    round: p.round,
    kind: p.kind,
    currency,
    /** 'late' payouts: who paid the missed contribution. */
    fromName: fromName ?? null,
    pot: p.pot / UNIT[currency],
    bonus: p.bonus / UNIT[currency],
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
  return publicPayout(
    await settle(payout),
    await currencyOf(payout.circle_id),
    payout.from_address ? displayName((await usersByAddress([payout.from_address])).get(payout.from_address)) : undefined,
  )
}

// --- Track record --------------------------------------------------------------

export interface TrackRecord {
  onTime: number
  rounds: number
}

/**
 * Rounds each person paid on time out of the rounds they had to pay, across real circles.
 * A late payment settles a miss, so it counts as a round but not as on time.
 */
async function trackRecords(addresses: string[]): Promise<Map<string, TrackRecord>> {
  const records = new Map(addresses.map((a) => [a, { onTime: 0, rounds: 0 }]))
  if (addresses.length === 0) return records
  const marks = addresses.map(() => '?').join(',')
  const [paid, missed] = await Promise.all([
    all<{ address: string; n: number }>(
      `SELECT d.address, COUNT(*) AS n FROM deposits d JOIN circles c ON c.id = d.ref_id
       WHERE d.kind = 'circle' AND c.practice = 0 AND d.address IN (${marks}) GROUP BY d.address`,
      addresses,
    ),
    all<{ address: string; n: number; settled: number }>(
      `SELECT m.address, COUNT(*) AS n, SUM(m.settled_tx IS NOT NULL) AS settled FROM misses m JOIN circles c ON c.id = m.circle_id
       WHERE c.practice = 0 AND m.address IN (${marks}) GROUP BY m.address`,
      addresses,
    ),
  ])
  for (const p of paid) {
    const r = records.get(p.address)
    if (!r) continue
    r.onTime += p.n
    r.rounds += p.n
  }
  for (const m of missed) {
    const r = records.get(m.address)
    if (!r) continue
    r.onTime -= m.settled
    r.rounds += m.n - m.settled
  }
  return records
}

// --- Views -------------------------------------------------------------------

export async function circleView(user: User, circleId: string) {
  await advance(circleId)
  const circle = await getCircle(circleId)
  const members = await membersOf(circleId)
  const you = members.find((m) => sameAddress(m.address, user.address))
  if (!you) throw new ApiError('You are not in this circle', 403)

  const [users, paid, payouts, balance, misses, records] = await Promise.all([
    usersByAddress(members.map((m) => m.address)),
    circle.status === 'active' ? paidThisRound(circleId, circle.round) : Promise.resolve([] as string[]),
    all<PayoutRow>('SELECT * FROM payouts WHERE circle_id = ? ORDER BY round, created_at', [circleId]),
    heldBalance(circleId),
    unsettledMisses(circleId),
    trackRecords(members.map((m) => m.address)),
  ])
  const earned = await yieldShare(balance.held, balance.simulated, circle.currency)
  const unit = UNIT[circle.currency]
  // Show what is waiting first (a pot or late money), else the latest one.
  const mine = payouts.filter((p) => sameAddress(p.address, user.address))
  const yourPayout = mine.find((p) => p.status === 'claimable') ?? mine.at(-1)
  const due = circle.status === 'active' ? dueAt(circle, circle.round) : null
  const now = Date.now()
  const late = Boolean(due && now >= due)
  const nameOf = (address: string) => displayName(users.get(address), user.address)

  return {
    id: circle.id,
    name: circle.name,
    localName: circle.local_name,
    cadence: circle.cadence,
    currency: circle.currency,
    contribution: circle.contribution / unit,
    size: circle.size,
    status: circle.status,
    round: circle.round,
    inviteCode: circle.invite_code,
    orderMode: circle.order_mode,
    practice: Boolean(circle.practice),
    isCreator: sameAddress(circle.created_by, user.address),
    roundDueAt: due,
    /** Past the due date with someone unpaid. */
    late: late && paid.length < members.length,
    /** When the pot goes out with what is in. */
    graceEndsAt: due ? due + graceOf(circle.cadence) : null,
    /** Rounds you missed and can still pay; the money goes to that round's member. */
    yourMisses: misses
      .filter((m) => sameAddress(m.address, user.address))
      .map((m) => ({ round: m.round, amount: m.amount / unit, memo: memoFor(user, circleMemo(circleId, m.round), circle.currency), to: nameOf(members.find((x) => x.turn === m.round)?.address ?? '') })),
    yourTurn: you.turn,
    yourTurnDueAt: dueAt(circle, you.turn),
    youPaid: paid.some((a) => sameAddress(a, user.address)),
    memo: circle.status === 'active' ? memoFor(user, circleMemo(circle.id, circle.round), circle.currency) : null,
    earned: earned / unit,
    members: members.map((m) => {
      const u = users.get(m.address)
      return {
        address: m.address,
        name: displayName(u, user.address),
        avatar: u?.avatar ?? 1,
        turn: m.turn,
        isYou: sameAddress(m.address, user.address),
        startedIt: sameAddress(m.address, circle.created_by),
        paid: paid.some((a) => sameAddress(a, m.address)),
        late: late && !paid.some((a) => sameAddress(a, m.address)),
        owes: misses.filter((x) => sameAddress(x.address, m.address)).map((x) => x.round),
        tookPot: payouts.some((p) => p.kind === 'pot' && p.round === m.turn),
        bot: Boolean(u?.bot),
        record: u?.bot ? null : (records.get(m.address) ?? null),
      }
    }),
    yourPayout: yourPayout ? publicPayout(await settle(yourPayout), circle.currency, yourPayout.from_address ? nameOf(yourPayout.from_address) : undefined) : null,
  }
}
export type CircleView = Awaited<ReturnType<typeof circleView>>

export async function circlePreview(code: string) {
  const circle = await circleByCode(code)
  const members = await membersOf(circle.id)
  const [users, records] = await Promise.all([usersByAddress(members.map((m) => m.address)), trackRecords(members.map((m) => m.address))])
  return {
    id: circle.id,
    name: circle.name,
    localName: circle.local_name,
    cadence: circle.cadence,
    currency: circle.currency,
    contribution: circle.contribution / UNIT[circle.currency],
    size: circle.size,
    status: circle.status,
    inviteCode: circle.invite_code,
    members: members.map((m) => ({ name: displayName(users.get(m.address)), avatar: users.get(m.address)?.avatar ?? 1, turn: m.turn, record: records.get(m.address) ?? null })),
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
      const owes = await one<{ n: number }>('SELECT COUNT(*) AS n FROM misses WHERE circle_id = ? AND address = ? AND settled_tx IS NULL', [c.id, user.address])
      const due = fresh.status === 'active' ? dueAt(fresh, fresh.round) : null
      return {
        id: c.id,
        name: c.name,
        localName: c.local_name,
        currency: c.currency,
        contribution: c.contribution / UNIT[c.currency],
        size: c.size,
        status: fresh.status,
        round: fresh.round,
        joined: members.length,
        avatars: members.map((m) => users.get(m.address)?.avatar ?? 1),
        youPaid: paid.some((a) => sameAddress(a, user.address)),
        dueAt: due,
        late: Boolean(due && Date.now() >= due && !paid.some((a) => sameAddress(a, user.address))),
        owes: owes?.n ?? 0,
        payoutReady: Boolean(claimable),
        practice: Boolean(c.practice),
      }
    }),
  )
}
export type CircleSummary = Awaited<ReturnType<typeof myCircles>>[number]

/** Webhook: settle the bank cash-out for this provider order, if any. */
export async function settlePayoutByProvider(providerId: string) {
  for (const p of await all<PayoutRow>("SELECT * FROM payouts WHERE status = 'cashing' AND provider_id = ?", [providerId])) await settle(p)
}

/** Worker: mark bank cash-outs that have landed. */
export async function settleCashingPayouts() {
  for (const p of await all<PayoutRow>("SELECT * FROM payouts WHERE status = 'cashing'")) await settle(p)
}
