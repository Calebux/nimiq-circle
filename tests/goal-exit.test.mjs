import { after, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// All chain, payment and provider edges are mocked. Only the temporary SQLite DB is real.
const directory = await mkdtemp(join(tmpdir(), 'akilii-exit-'))
let liquid = 0, staked = 0, treasuryOwned = 0, deliveryError = false, providerState = 'processing'
let sends = []
const user = { address: 'owner', name: 'Saver', avatar: 1, dev: 0 }
const unit = 100_000
mock.module('../src/lib/env.ts', { namedExports: { serverConfig: () => ({ database: { url: `file:${directory}/test.db` }, nim: { poolAddress: 'pool' } }) } })
mock.module('../src/lib/nimiq/rpc.ts', { namedExports: {
  getBalance: async () => liquid,
  getStaker: async () => ({ balance: staked, inactiveBalance: 0, retiredBalance: 0 }),
  getBlockNumber: async () => 100, getPolicy: async () => ({ minimumStake: unit, blocksPerEpoch: 100 }),
} })
mock.module('../src/lib/evm/polygon.ts', { namedExports: { evmPoolAddress: () => 'pool-usdt', usdtBalance: async () => liquid } })
mock.module('../src/lib/treasury.ts', { namedExports: { floatStatus: async () => ({ nimLunaReal: treasuryOwned }) } })
mock.module('../src/lib/nimiq/pool-signer.ts', { namedExports: { poolStaking: {} } })
mock.module('../src/lib/deposits.ts', { namedExports: {
  reconcile: async () => {}, verifyDeposit: async () => { throw new Error('not used') },
  goalMemo: (id) => `cg:${id}`, memoFor: (_u, memo) => memo, isSimulated: (hash) => hash?.startsWith('mock-') ?? false,
} })
mock.module('../src/lib/goal-friends.ts', { namedExports: {
  goalExtras: async () => ({ plan: null, nameOf: () => 'Someone' }), notifyChipIn: async () => {}, parsePlan: () => null,
} })
mock.module('../src/lib/delivery.ts', { namedExports: {
  bankStatus: async () => providerState,
  deliver: async (input) => {
    if (deliveryError) throw new Error('Provider unavailable')
    sends.push(input)
    if (!input.to.dev) {
      if (input.method === 'wallet') liquid -= input.amount
      else if (input.currency === 'NIM') treasuryOwned += input.amount
    }
    return { status: input.method === 'bank' ? 'cashing' : 'sent', txHash: input.to.dev ? 'mock-tx' : input.method === 'bank' ? null : 'real-tx', bank: null, ngn: null, providerId: input.method === 'bank' ? 'provider-1' : null }
  },
} })
const { db, run, one } = await import('../src/lib/db.ts')
const { quoteGoalExit, withdrawGoal, goalView, settleWithdrawalByProvider } = await import('../src/lib/goals.ts')
const { invalidateYield, yieldShare, collectedGoalFees, reserves } = await import('../src/lib/yield.ts')
const { liquidNeeds } = await import('../src/lib/staking.ts')
const { exitAmounts, exitFeePolicy } = await import('../src/lib/goal-exit-policy.ts')

beforeEach(async () => {
  for (const table of ['withdrawals', 'deposits', 'goal_exit_quotes', 'goal_exit_liquidity', 'goals', 'users']) await run(`DELETE FROM ${table}`)
  process.env.GOAL_BREAK_FEE_BPS = '500' // Test policy only: production is disabled by default.
  process.env.GOAL_BREAK_FEE_BASIS = 'principal'
  process.env.POOL_FLOAT_NIM = '0'
  process.env.POOL_LIQUID_BUFFER_NIM = '0'
  liquid = 101 * unit; staked = 0; treasuryOwned = 0; deliveryError = false; providerState = 'processing'; sends = []
  invalidateYield()
  await run('INSERT INTO users (address, avatar, dev, created_at) VALUES (?, 1, 0, 0)', [user.address])
})
after(async () => { (await db()).close(); await rm(directory, { recursive: true, force: true }) })

async function seed({ id = 'goal', currency = 'NIM', unlock = Date.now() + 30 * 86_400_000, amount = 100 * unit } = {}) {
  await run("INSERT INTO goals (id, owner, name, unlock_at, status, currency, created_at) VALUES (?, ?, 'Rent', ?, 'open', ?, 0)", [id, user.address, unlock, currency])
  await run("INSERT INTO deposits (tx_hash, kind, ref_id, address, amount, memo, status, currency, created_at) VALUES (?, 'goal', ?, ?, ?, '', 'confirmed', ?, 0)", [`deposit-${id}`, id, user.address, amount, currency])
  return id
}
const withdraw = (quote, method = 'wallet', owner = user) => withdrawGoal(owner, 'goal', method, undefined, undefined, quote.id)

test('configuration fails closed; integer fees are rounded down for both currencies and both bases', () => {
  for (const value of [undefined, '', '0', '-1', '10000', '5.5', 'abc']) assert.equal(exitFeePolicy({ GOAL_BREAK_FEE_BPS: value }), null)
  assert.equal(exitFeePolicy({ GOAL_BREAK_FEE_BPS: '500', GOAL_BREAK_FEE_BASIS: 'typo' }), null)
  assert.deepEqual(exitAmounts(100_001, 10_001, { bps: 500, basis: 'principal' }), { principal: 100_001, bonus: 10_001, fee: 5000, net: 105_002 })
  assert.equal(exitAmounts(100_001, 10_001, { bps: 500, basis: 'total' }).fee, 5500)
  assert.equal(exitAmounts(1, 0, { bps: 1, basis: 'principal' }).fee, 0)
  assert.throws(() => exitAmounts(Number.MAX_SAFE_INTEGER, 1, { bps: 500, basis: 'principal' }))
})

test('owner-only quotes and withdrawals; locked goals require explicit acceptance', async () => {
  await seed()
  await assert.rejects(quoteGoalExit({ ...user, address: 'other' }, 'goal'), /not found/)
  await assert.rejects(withdrawGoal(user, 'goal', 'wallet'), /Review and accept/)
  const quote = await quoteGoalExit(user, 'goal')
  await assert.rejects(withdraw(quote, 'wallet', { ...user, address: 'other' }), /not found/)
  await assert.rejects(withdraw({ id: 'invented' }), /quote has changed/)
  assert.equal(sends.length, 0)
})

test('early payout deducts fee, closes the goal and excludes retained fees from yield', async () => {
  await seed()
  const quote = await quoteGoalExit(user, 'goal')
  assert.deepEqual([quote.principal, quote.bonus, quote.fee, quote.net], [100, 1, 5, 96])
  assert.equal(sends.length, 0)
  const result = await withdraw(quote)
  assert.deepEqual([result.net, result.fee, result.earlyExit], [96, 5, true])
  assert.equal(sends[0].amount, 96 * unit)
  assert.equal((await goalView(user, 'goal')).status, 'closed')
  assert.equal((await goalView(user, 'goal')).balance, 0)
  assert.equal(await collectedGoalFees(), 5 * unit)
  const proof = await reserves()
  assert.deepEqual([proof.owedToMembers, proof.operator, proof.earned], [0, 5 * unit, 0])
})

test('a paid reward reduces surplus rather than being paid again to another saver', async () => {
  await seed()
  await seed({ id: 'second' })
  liquid = 202 * unit
  const quote = await quoteGoalExit(user, 'goal')
  await withdraw(quote)
  assert.equal(await yieldShare(100 * unit, false), unit)
  assert.equal((await reserves()).owedToMembers, 100 * unit)
})

test('concurrent confirmations send only once', async () => {
  await seed()
  const quote = await quoteGoalExit(user, 'goal')
  const results = await Promise.allSettled([withdraw(quote), withdraw(quote)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(sends.length, 1)
  await assert.rejects(withdraw(quote), /closed/)
})

test('expired, wrong-goal and changed-balance quotes cannot move money', async () => {
  await seed()
  await seed({ id: 'other' })
  const wrong = await quoteGoalExit(user, 'other')
  await assert.rejects(withdraw(wrong), /quote has changed/)
  const quote = await quoteGoalExit(user, 'goal')
  await run('UPDATE goal_exit_quotes SET expires_at = 0 WHERE id = ?', [quote.id])
  await assert.rejects(withdraw(quote), /quote has changed/)
  const fresh = await quoteGoalExit(user, 'goal')
  await run('UPDATE deposits SET amount = amount + 1 WHERE ref_id = ?', ['goal'])
  await assert.rejects(withdraw(fresh), /quote has changed/)
  assert.equal(sends.length, 0)
})

test('maturity after quote requires a new free withdrawal', async () => {
  await seed()
  const quote = await quoteGoalExit(user, 'goal')
  await run('UPDATE goals SET unlock_at = 1 WHERE id = ?', ['goal'])
  await assert.rejects(withdraw(quote), /without a break fee/)
  const result = await withdrawGoal(user, 'goal', 'wallet')
  assert.equal(result.fee, 0)
  assert.equal(result.net, 101)
})

test('failed delivery restores savings without collecting a fee', async () => {
  await seed()
  const quote = await quoteGoalExit(user, 'goal')
  deliveryError = true
  await assert.rejects(withdraw(quote), /Provider unavailable/)
  const view = await goalView(user, 'goal')
  assert.deepEqual([view.status, view.balance, view.withdrawals.length], ['open', 100, 0])
  assert.equal(await collectedGoalFees(), 0)
})

test('bank conversion receives the net amount; a provider refund restores the full savings and fee', async () => {
  await seed()
  const quote = await quoteGoalExit(user, 'goal')
  const result = await withdraw(quote, 'bank')
  assert.equal(sends[0].amount, 96 * unit)
  assert.equal(result.status, 'cashing')
  assert.equal(await collectedGoalFees(), 5 * unit)
  assert.equal((await reserves()).earned, 0)
  providerState = 'failed'; treasuryOwned = 0
  await settleWithdrawalByProvider('provider-1')
  const view = await goalView(user, 'goal')
  assert.deepEqual([view.status, view.balance, view.withdrawals.length], ['open', 100, 0])
  assert.equal(await collectedGoalFees(), 0)
})

test('staked funds request liquidity without sending, charging or closing the goal', async () => {
  await seed()
  liquid = unit; staked = 100 * unit
  const quote = await quoteGoalExit(user, 'goal')
  await assert.rejects(withdraw(quote), /No fee was charged/)
  assert.equal((await liquidNeeds()).earlyExits, 96 * unit)
  assert.equal(sends.length, 0)
  assert.equal(await collectedGoalFees(), 0)
  assert.equal((await goalView(user, 'goal')).balance, 100)
  liquid += staked; staked = 0
  await withdraw(await quoteGoalExit(user, 'goal'))
  assert.equal((await liquidNeeds()).earlyExits, 0)
})

test('disabled policy prevents early exit, while flexible withdrawals remain free and open', async () => {
  await seed()
  const quote = await quoteGoalExit(user, 'goal')
  delete process.env.GOAL_BREAK_FEE_BPS
  await assert.rejects(quoteGoalExit(user, 'goal'), /not available/)
  await assert.rejects(withdraw(quote), /Review and accept/)
  await run('UPDATE goals SET unlock_at = NULL WHERE id = ?', ['goal'])
  const result = await withdrawGoal(user, 'goal', 'wallet')
  assert.deepEqual([result.net, result.fee, result.earlyExit], [101, 0, false])
  assert.equal((await goalView(user, 'goal')).status, 'open')
})

test('USDT uses micro-units, pays net and records the fee in its own currency', async () => {
  await seed({ currency: 'USDT', amount: 100_000_001 })
  const quote = await quoteGoalExit(user, 'goal')
  assert.equal(quote.fee, 5)
  assert.equal(quote.net, 95.000001)
  await withdraw(quote)
  assert.equal(sends[0].amount, 95_000_001)
  assert.equal(await collectedGoalFees('USDT'), 5_000_000)
  assert.equal(await collectedGoalFees('NIM'), 0)
})

test('simulated fees never become real operator revenue', async () => {
  await seed()
  await run('UPDATE users SET dev = 1 WHERE address = ?', [user.address])
  await run("UPDATE deposits SET tx_hash = 'mock-deposit'")
  const dev = { ...user, dev: 1 }
  const quote = await quoteGoalExit(dev, 'goal')
  await withdraw(quote, 'wallet', dev)
  assert.equal(await collectedGoalFees(), 0)
  assert.equal((await one('SELECT fee FROM withdrawals')).fee, 5 * unit)
})

test('total-basis fees include rewards and the accepted quote keeps its disclosed rate', async () => {
  await seed()
  process.env.GOAL_BREAK_FEE_BASIS = 'total'
  const quote = await quoteGoalExit(user, 'goal')
  assert.equal(quote.fee, 5.05)
  process.env.GOAL_BREAK_FEE_BPS = '1000'
  const result = await withdraw(quote)
  assert.equal(result.fee, 5.05)
  assert.equal(result.feeBps, 500)
  assert.equal(result.net, 95.95)
  assert.equal((await reserves()).earned, 0)
})

test('liquidity requests expire and do not double-count a goal nearing maturity', async () => {
  await seed()
  liquid = unit; staked = 100 * unit
  await assert.rejects(withdraw(await quoteGoalExit(user, 'goal')), /No fee was charged/)
  await run('UPDATE goal_exit_liquidity SET expires_at = 0')
  assert.equal((await liquidNeeds()).earlyExits, 0)
  await run('UPDATE goal_exit_liquidity SET expires_at = ?', [Date.now() + 86400000])
  await run('UPDATE goals SET unlock_at = ?', [Date.now() + 3600000])
  const needs = await liquidNeeds()
  assert.equal(needs.earlyExits, 0)
  assert.equal(needs.unlocking, 100 * unit)
})
