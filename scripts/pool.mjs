#!/usr/bin/env node
// Pool wallet CLI for the spike. Holds the only code path that touches POOL_PRIVATE_KEY.
//
//   npm run pool -- keygen                  create the pool wallet, write it to .env.local
//   npm run pool -- status                  liquid / active / inactive / retired + release ETAs
//   npm run pool -- validators              restaking pools you can delegate to
//   npm run pool -- stake <nim>             create the staker (first time) or add stake
//   npm run pool -- unstake <nim>           move active stake to inactive (starts the lock)
//   npm run pool -- retire [nim]            retire released inactive stake (default: all)
//   npm run pool -- remove [nim]            withdraw retired stake back to the pool (default: all)
//   npm run pool -- send <address> <nim> [memo]   pay out from the pool
//
// Every action is appended to data/spike-log.jsonl so the lock-up time can be read off afterwards.

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as Nimiq from '@nimiq/core'

const ROOT = path.resolve(import.meta.dirname, '..')
const LOG = path.join(ROOT, 'data', 'spike-log.jsonl')
const ENV_LOCAL = path.join(ROOT, '.env.local')

const RPC_URL = process.env.NIM_RPC_URL || 'https://rpc.nimiqwatch.com'
const NETWORK_ID = process.env.NIM_NETWORK === 'testnet' ? 5 : 24
const FEE = BigInt(process.env.POOL_TX_FEE_LUNA ?? 0)
const LUNA = 100_000

// --- RPC -------------------------------------------------------------------

async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await res.json()
  if (body.error) {
    const err = new Error(`${method}: ${body.error.message}${body.error.data ? ` (${body.error.data})` : ''}`)
    err.data = body.error.data
    throw err
  }
  return body.result.data
}

async function getStaker(address) {
  try {
    return await rpc('getStakerByAddress', [address])
  } catch (err) {
    if (/no staker/i.test(String(err.data))) return null
    throw err
  }
}

// --- helpers ---------------------------------------------------------------

const nim = (luna) => `${(luna / LUNA).toLocaleString('en-US', { maximumFractionDigits: 5 })} NIM`

function toLuna(arg, name = 'amount') {
  const value = Number(arg)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive NIM amount`)
  return BigInt(Math.round(value * LUNA))
}

function duration(seconds) {
  if (seconds <= 0) return 'now'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

async function log(event, detail) {
  const block = await rpc('getBlockNumber')
  await mkdir(path.dirname(LOG), { recursive: true })
  await appendFile(LOG, JSON.stringify({ at: new Date().toISOString(), block, event, detail }) + '\n')
}

function poolKey() {
  const hex = process.env.POOL_PRIVATE_KEY
  if (!hex) throw new Error('POOL_PRIVATE_KEY is not set. Run `npm run pool -- keygen` first.')
  const keyPair = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(hex))
  return { keyPair, address: keyPair.toAddress() }
}

/** Sign, broadcast and wait until the tx is mined, so the log records real block heights. */
async function submit(event, keyPair, tx, detail) {
  tx.sign(keyPair, undefined)
  const hash = tx.hash()
  console.log(`→ ${event}: broadcasting ${hash}`)
  await rpc('sendRawTransaction', [tx.toHex()])

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2_000))
    try {
      const mined = await rpc('getTransactionByHash', [hash])
      if (mined.executionResult === false) {
        await log(`${event}_failed`, { hash, ...detail })
        throw new Error(`${event} was mined but FAILED on chain (block ${mined.blockNumber}). Check status for why.`)
      }
      console.log(`✓ mined in block ${mined.blockNumber}`)
      await log(event, { hash, minedIn: mined.blockNumber, ...detail })
      return
    } catch (err) {
      if (!/not found/i.test(String(err.data))) throw err
    }
  }
  throw new Error(`${hash} not mined after 2 minutes; check status before retrying`)
}

async function txBase() {
  const { keyPair, address } = poolKey()
  const height = await rpc('getBlockNumber')
  return { keyPair, address, height }
}

// --- commands --------------------------------------------------------------

const commands = {
  async keygen() {
    let env = ''
    try {
      env = await readFile(ENV_LOCAL, 'utf8')
    } catch {
      env = await readFile(path.join(ROOT, '.env.example'), 'utf8')
    }
    if (/^POOL_PRIVATE_KEY=\S+/m.test(env)) throw new Error('.env.local already has a POOL_PRIVATE_KEY; refusing to replace it.')
    const keyPair = Nimiq.KeyPair.generate()
    const address = keyPair.toAddress().toUserFriendlyAddress()
    const set = (text, key, value) =>
      new RegExp(`^${key}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`
    env = set(set(env, 'POOL_ADDRESS', address), 'POOL_PRIVATE_KEY', keyPair.privateKey.toHex())
    await writeFile(ENV_LOCAL, env, { mode: 0o600 })
    console.log(`Pool wallet: ${address}\nSaved to .env.local (gitignored). Fund it with ~110 NIM to test staking (100 NIM minimum stake + contributions).`)
  },

  async status() {
    const address = process.env.POOL_ADDRESS
    if (!address) throw new Error('POOL_ADDRESS is not set')
    const [block, policy, account, staker] = await Promise.all([
      rpc('getBlockNumber'),
      rpc('getPolicyConstants'),
      rpc('getAccountByAddress', [address]),
      getStaker(address),
    ])
    const secs = (target) => ((target - block) * policy.blockSeparationTime) / 1000
    const nextElection = Math.ceil((block + 1) / policy.blocksPerEpoch) * policy.blocksPerEpoch
    console.log(`Pool       ${address}  (block ${block})`)
    console.log(`Liquid     ${nim(account.balance)}`)
    if (!staker) {
      console.log(`Staker     none yet. Minimum stake is ${nim(policy.minimumStake)}.`)
    } else {
      console.log(`Delegation ${staker.delegation ?? '—'}`)
      console.log(`Active     ${nim(staker.balance)}`)
      console.log(`Inactive   ${nim(staker.inactiveBalance)}`)
      if (staker.inactiveBalance) {
        console.log(`  inactive from block ${staker.inactiveFrom} (${duration(secs(staker.inactiveFrom))})`)
        console.log(`  released at  block ${staker.inactiveRelease} (${duration(secs(staker.inactiveRelease))})`)
      }
      console.log(`Retired    ${nim(staker.retiredBalance)}  (removable now)`)
    }
    console.log(`Next election block ${nextElection} in ${duration(secs(nextElection))}; epoch ≈ ${duration((policy.blocksPerEpoch * policy.blockSeparationTime) / 1000)}`)
  },

  async validators() {
    const res = await fetch('https://validators-api-main.je-cf9.workers.dev/api/v1/validators', { signal: AbortSignal.timeout(20_000) })
    const list = await res.json()
    for (const v of list.filter((v) => v.payoutType === 'restake').sort((a, b) => a.fee - b.fee)) {
      console.log(`${String(v.fee * 100).padStart(5)}%  ${v.address}  ${v.name}  (${v.payoutSchedule || 'no schedule'})`)
    }
  },

  async stake(amountArg) {
    const value = toLuna(amountArg)
    const { keyPair, address, height } = await txBase()
    const staker = await getStaker(address.toUserFriendlyAddress())
    if (staker) {
      const tx = Nimiq.TransactionBuilder.newAddStake(address, address, value, FEE, height, NETWORK_ID)
      return submit('add_stake', keyPair, tx, { luna: Number(value) })
    }
    const validator = process.env.STAKE_VALIDATOR
    if (!validator) throw new Error('STAKE_VALIDATOR is not set')
    const tx = Nimiq.TransactionBuilder.newCreateStaker(address, Nimiq.Address.fromUserFriendlyAddress(validator), value, FEE, height, NETWORK_ID)
    return submit('create_staker', keyPair, tx, { luna: Number(value), validator })
  },

  async unstake(amountArg) {
    const value = toLuna(amountArg)
    const { keyPair, address, height } = await txBase()
    const staker = await getStaker(address.toUserFriendlyAddress())
    if (!staker) throw new Error('The pool has no stake')
    const newActive = BigInt(staker.balance) - value
    if (newActive < 0n) throw new Error(`Only ${nim(staker.balance)} is active`)
    const tx = Nimiq.TransactionBuilder.newSetActiveStake(address, newActive, FEE, height, NETWORK_ID)
    return submit('unstake', keyPair, tx, { luna: Number(value), newActive: Number(newActive) })
  },

  async retire(amountArg) {
    const { keyPair, address, height } = await txBase()
    const staker = await getStaker(address.toUserFriendlyAddress())
    if (!staker?.inactiveBalance) throw new Error('Nothing inactive to retire')
    if (staker.inactiveRelease && height < staker.inactiveRelease) {
      throw new Error(`Inactive stake is locked until block ${staker.inactiveRelease} (${staker.inactiveRelease - height} blocks)`)
    }
    const value = amountArg ? toLuna(amountArg) : BigInt(staker.inactiveBalance)
    const tx = Nimiq.TransactionBuilder.newRetireStake(address, value, FEE, height, NETWORK_ID)
    return submit('retire', keyPair, tx, { luna: Number(value) })
  },

  async remove(amountArg) {
    const { keyPair, address, height } = await txBase()
    const staker = await getStaker(address.toUserFriendlyAddress())
    if (!staker?.retiredBalance) throw new Error('Nothing retired to remove')
    const value = amountArg ? toLuna(amountArg) : BigInt(staker.retiredBalance)
    const tx = Nimiq.TransactionBuilder.newRemoveStake(address, value, FEE, height, NETWORK_ID)
    return submit('remove', keyPair, tx, { luna: Number(value) })
  },

  async send(to, amountArg, memo = '') {
    if (!to) throw new Error('Usage: send <address> <nim> [memo]')
    const value = toLuna(amountArg)
    const { keyPair, address, height } = await txBase()
    const data = new TextEncoder().encode(memo)
    if (data.length > 64) throw new Error('Memo is limited to 64 bytes')
    const recipient = Nimiq.Address.fromUserFriendlyAddress(to)
    const tx = Nimiq.TransactionBuilder.newBasicWithData(address, recipient, data, value, FEE, height, NETWORK_ID)
    return submit('payout', keyPair, tx, { to, luna: Number(value), memo })
  },
}

const [name, ...args] = process.argv.slice(2)
const command = commands[name]
if (!command) {
  console.log(`Commands: ${Object.keys(commands).join(', ')}`)
  process.exit(name ? 1 : 0)
}
try {
  await command(...args)
  process.exit(0)
} catch (err) {
  console.error(`✗ ${err.message}`)
  process.exit(1)
}
