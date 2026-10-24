#!/usr/bin/env node
// Polygon CLI for the pool's EVM wallets (USDT savings).
//
//   npm run evm -- status                   pool and gas wallet balances, what members are owed, the excess
//   npm run evm -- sweep [--go]             move USDT above (owed + float) to EVM_COLD_ADDRESS
//   npm run evm -- fund-gas <pol> [--go]    move POL from the pool to the gas wallet
//   npm run evm -- send <to> <usdt> [--go]  send operator USDT from the pool; refuses to dip into members' money
//   npm run evm -- swap <pol> [--go]        swap pool POL → USDT via KyberSwap (quote only without --go)
//
// Everything is a dry run without --go. Reads keys and POLYGON_RPC_URL from .env.local.

import path from 'node:path'
import { createClient } from '@libsql/client'
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, getAddress, http, isAddress, parseEther, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'

const USDT = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
const KYBER = 'https://aggregator-api.kyberswap.com/polygon/api/v1'
const SLIPPAGE_BPS = 50
/** POL the pool keeps for its own payout fees. */
const POOL_POL_RESERVE = parseEther('0.3')

if (!process.env.EVM_POOL_PRIVATE_KEY) throw new Error('EVM_POOL_PRIVATE_KEY is not set')
const account = privateKeyToAccount(process.env.EVM_POOL_PRIVATE_KEY)
const gasAddress = process.env.GAS_PRIVATE_KEY ? privateKeyToAccount(process.env.GAS_PRIVATE_KEY).address : null
const transport = http(process.env.POLYGON_RPC_URL || undefined)
const pub = createPublicClient({ chain: polygon, transport })
const wallet = createWalletClient({ chain: polygon, transport, account })

const ROOT = path.resolve(import.meta.dirname, '..')
const url = process.env.DATABASE_URL || 'file:data/circle.db'
const db = createClient({ url: url.startsWith('file:') ? `file:${path.resolve(ROOT, url.slice(5))}` : url, authToken: process.env.DATABASE_AUTH_TOKEN })

/** USDT owed to members, micro. Same rule as src/lib/yield.ts liabilities('USDT'). */
async function owed() {
  const { rows } = await db.execute(`SELECT
     (SELECT COALESCE(SUM(d.amount), 0) FROM deposits d JOIN users u ON u.address = d.address WHERE u.dev = 0 AND d.tx_hash NOT LIKE 'mock-%' AND d.currency = 'USDT')
   - (SELECT COALESCE(SUM(p.pot + p.bonus), 0) FROM payouts p JOIN users u ON u.address = p.address JOIN circles c ON c.id = p.circle_id
       WHERE u.dev = 0 AND p.status IN ('sent', 'cashing', 'cashed') AND c.currency = 'USDT')
   - (SELECT COALESCE(SUM(w.amount + w.bonus), 0) FROM withdrawals w JOIN users u ON u.address = w.address JOIN goals g ON g.id = w.goal_id
       WHERE u.dev = 0 AND w.status IN ('sent', 'cashing', 'cashed') AND g.currency = 'USDT')
   AS owed`)
  return BigInt(Number(rows[0].owed))
}

const float = () => parseUnits(String(Number(process.env.EVM_FLOAT_USDT ?? 1)), 6)
const usdt = (micro) => `${formatUnits(micro, 6)} USDT`
const pol = (wei) => `${Number(formatUnits(wei, 18)).toFixed(4)} POL`

async function balances() {
  const [polWei, usdtMicro, gasWei, owedMicro] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: USDT, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    gasAddress ? pub.getBalance({ address: gasAddress }) : Promise.resolve(0n),
    owed(),
  ])
  return { pol: polWei, usdt: usdtMicro, gas: gasWei, owed: owedMicro, spare: usdtMicro - owedMicro }
}

async function kyber(p, init) {
  const res = await fetch(`${KYBER}${p}`, { ...init, headers: { 'content-type': 'application/json', 'x-client-id': 'nimiq-circle', ...init?.headers } })
  const body = await res.json()
  if (body.code !== 0) throw new Error(`KyberSwap: ${body.message}`)
  return body.data
}

async function mined(hash) {
  // Poll by hand: public RPCs often refuse the block filters waitForTransactionReceipt sets up.
  let receipt = null
  while (!receipt) {
    await new Promise((r) => setTimeout(r, 2000))
    receipt = await pub.getTransactionReceipt({ hash }).catch(() => null)
  }
  console.log(`Status   ${receipt.status} in block ${receipt.blockNumber}`)
  return receipt
}

async function sendUsdt(to, micro) {
  const hash = await wallet.writeContract({ address: USDT, abi: erc20Abi, functionName: 'transfer', args: [getAddress(to), micro] })
  console.log(`Sent     ${hash}`)
  await mined(hash)
}

const commands = {
  async status() {
    const b = await balances()
    console.log(`Pool     ${account.address}`)
    console.log(`  USDT   ${usdt(b.usdt)}   owed to members ${usdt(b.owed)}   ${b.spare >= 0n ? `spare ${usdt(b.spare)}` : `SHORT ${usdt(-b.spare)}`}`)
    console.log(`  POL    ${pol(b.pol)}   (pays fees on payouts)`)
    console.log(`Gas      ${gasAddress ?? 'not configured'}`)
    if (gasAddress) console.log(`  POL    ${pol(b.gas)}   (member top-ups)${b.gas < parseEther('0.3') ? '   ← low, run fund-gas' : ''}`)
    console.log(`Cold     ${process.env.EVM_COLD_ADDRESS || 'not set (EVM_COLD_ADDRESS)'}`)
  },

  /** Keep only what members are owed plus a small float in the hot wallet. */
  async sweep(flag) {
    const cold = process.env.EVM_COLD_ADDRESS
    if (!cold || !isAddress(cold)) throw new Error('Set EVM_COLD_ADDRESS in .env.local to a Polygon address only you control')
    const b = await balances()
    const amount = b.usdt - b.owed - float()
    console.log(`Hold     ${usdt(b.usdt)} = owed ${usdt(b.owed)} + float ${usdt(float())} + sweepable ${usdt(amount > 0n ? amount : 0n)}`)
    if (amount <= 0n) return console.log('Nothing to sweep.')
    console.log(`Sweep    ${usdt(amount)} → ${cold}`)
    if (flag !== '--go') return console.log('Dry run. Add --go to sweep.')
    await sendUsdt(cold, amount)
    await commands.status()
  },

  async 'fund-gas'(amount, flag) {
    if (!gasAddress) throw new Error('GAS_PRIVATE_KEY is not set')
    const wei = parseEther(String(amount))
    if (!(wei > 0n)) throw new Error('Usage: fund-gas <pol> [--go]')
    const b = await balances()
    if (b.pol - wei < POOL_POL_RESERVE) throw new Error(`Pool has ${pol(b.pol)}; it keeps ${pol(POOL_POL_RESERVE)} for its own payout fees`)
    console.log(`Fund     ${pol(wei)} → gas wallet ${gasAddress}`)
    if (flag !== '--go') return console.log('Dry run. Add --go to send.')
    const hash = await wallet.sendTransaction({ to: gasAddress, value: wei })
    console.log(`Sent     ${hash}`)
    await mined(hash)
    await commands.status()
  },

  async send(to, amount, flag) {
    const micro = parseUnits(String(Number(amount)), 6)
    if (!to || !isAddress(to) || !(micro > 0n)) throw new Error('Usage: send <0x address> <usdt> [--go]')
    const b = await balances()
    if (b.usdt - micro < b.owed) throw new Error(`Refused: that would leave ${usdt(b.usdt - micro)} against ${usdt(b.owed)} owed to members. Spare is ${usdt(b.spare)}.`)
    console.log(`Send     ${usdt(micro)} → ${to}`)
    if (flag !== '--go') return console.log('Dry run. Add --go to send.')
    await sendUsdt(to, micro)
    await commands.status()
  },

  async swap(amount, flag) {
    const amountIn = parseEther(String(amount))
    if (!(amountIn > 0n)) throw new Error('Usage: swap <pol> [--go]')
    const { pol: have } = await balances()
    if (have < amountIn + POOL_POL_RESERVE) throw new Error(`Pool has ${pol(have)}; keep at least ${pol(POOL_POL_RESERVE)} for fees`)
    const { routeSummary, routerAddress } = await kyber(`/routes?tokenIn=${NATIVE}&tokenOut=${USDT}&amountIn=${amountIn}`)
    console.log(`Quote    ${amount} POL → ${formatUnits(BigInt(routeSummary.amountOut), 6)} USDT (≈ $${Number(routeSummary.amountOutUsd).toFixed(2)}, gas ≈ $${Number(routeSummary.gasUsd).toFixed(4)})`)
    if (flag !== '--go') return console.log('Quote only. Add --go to swap.')

    const built = await kyber('/route/build', {
      method: 'POST',
      body: JSON.stringify({ routeSummary, sender: account.address, recipient: account.address, slippageTolerance: SLIPPAGE_BPS }),
    })
    if (built.routerAddress.toLowerCase() !== routerAddress.toLowerCase()) throw new Error('Router address changed between quote and build')
    const hash = await wallet.sendTransaction({ to: built.routerAddress, data: built.data, value: amountIn })
    console.log(`Sent     ${hash}`)
    await mined(hash)
    await commands.status()
  },
}

const [name, ...args] = process.argv.slice(2)
if (!commands[name]) {
  console.log(`Commands: ${Object.keys(commands).join(', ')}`)
  process.exit(name ? 1 : 0)
}
try {
  await commands[name](...args)
  process.exit(0)
} catch (err) {
  console.error(`✗ ${err.shortMessage ?? err.message}`)
  process.exit(1)
}
