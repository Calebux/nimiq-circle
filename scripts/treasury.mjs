#!/usr/bin/env node
// Treasury CLI: the operator side of the float model (src/lib/treasury.ts).
//
//   npm run treasury -- status                   float, NIM held, today's cash-outs, P&L
//   npm run treasury -- topup <usdt>             record USDT sent to the provider balance
//   npm run treasury -- rebalance [nim] [--to <address>]
//                                                swap held NIM back to USDT (simulated at market − 0.5%).
//                                                Real NIM must leave the pool: --to sends it on chain
//                                                (e.g. your exchange deposit address) before booking.
//   npm run treasury -- history [n]              latest ledger rows
//
// Mock provider only: top-ups and swaps are bookkeeping. With a real provider, `topup` records a
// transfer you made, and `rebalance` is replaced by the Fastspot / exchange converter.

import path from 'node:path'
import { createClient } from '@libsql/client'
import * as Nimiq from '@nimiq/core'

const ROOT = path.resolve(import.meta.dirname, '..')
const url = process.env.DATABASE_URL || 'file:data/circle.db'
const db = createClient({ url: url.startsWith('file:') ? `file:${path.resolve(ROOT, url.slice(5))}` : url, authToken: process.env.DATABASE_AUTH_TOKEN })
// Same table as src/lib/db.ts, so the CLI works before the app has ever opened the database.
await db.execute(`CREATE TABLE IF NOT EXISTS treasury_ledger (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, usdt INTEGER NOT NULL, nim INTEGER NOT NULL,
  ref TEXT, note TEXT, simulated INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`)
const USDT = 1_000_000
const LUNA = 100_000
const SWAP_SLIPPAGE = 0.005

const id = () => Math.random().toString(36).slice(2, 12)
const usd = (micro) => `${(micro / USDT).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`
const nim = (luna) => `${(luna / LUNA).toLocaleString('en-US', { maximumFractionDigits: 2 })} NIM`

async function price() {
  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd', { signal: AbortSignal.timeout(8000) })
  const value = (await res.json())?.['nimiq-2']?.usd
  if (!(value > 0)) throw new Error('No NIM price from CoinGecko')
  return value
}

async function totals() {
  const { rows } = await db.execute(`SELECT
    COALESCE(SUM(usdt), 0) AS float,
    COALESCE(SUM(nim), 0) AS nim,
    COALESCE(SUM(CASE WHEN simulated = 0 THEN nim END), 0) AS nimReal,
    COALESCE(SUM(CASE WHEN kind = 'topup' THEN usdt END), 0) AS topups,
    COALESCE(-SUM(CASE WHEN kind = 'cashout' THEN usdt END), 0) AS paidOut,
    COALESCE(SUM(CASE WHEN kind = 'cashout' THEN nim END), 0) AS bought,
    COUNT(CASE WHEN kind = 'cashout' THEN 1 END) AS cashouts
    FROM treasury_ledger`)
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]))
}

async function book(kind, usdt, nimLuna, note, simulated = 0, ref = null) {
  await db.execute({
    sql: 'INSERT INTO treasury_ledger (id, kind, usdt, nim, ref, note, simulated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    args: [id(), kind, usdt, nimLuna, ref, note, simulated, Date.now()],
  })
}

async function sendNim(to, luna, memo) {
  const keyPair = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(process.env.POOL_PRIVATE_KEY))
  const rpc = async (method, params = []) => {
    const res = await fetch(process.env.NIM_RPC_URL || 'https://rpc.nimiqwatch.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const body = await res.json()
    if (body.error) throw new Error(`${method}: ${body.error.message} ${body.error.data ?? ''}`)
    return body.result.data
  }
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    keyPair.toAddress(),
    Nimiq.Address.fromUserFriendlyAddress(to),
    new TextEncoder().encode(memo),
    BigInt(luna),
    0n,
    await rpc('getBlockNumber'),
    process.env.NIM_NETWORK === 'testnet' ? 5 : 24,
  )
  tx.sign(keyPair, undefined)
  await rpc('sendRawTransaction', [tx.toHex()])
  return tx.hash()
}

const commands = {
  async status() {
    const [t, p] = await Promise.all([totals(), price()])
    const { rows } = await db.execute({ sql: "SELECT COALESCE(-SUM(usdt), 0) AS today FROM treasury_ledger WHERE kind = 'cashout' AND created_at > ?", args: [Date.now() - 86_400_000] })
    const nimValue = Math.round((t.nim / LUNA) * p * USDT)
    const equity = t.float + nimValue
    console.log(`USDT float        ${usd(t.float)}${t.float < 20 * USDT ? '   ← low, top up' : ''}`)
    console.log(`NIM held          ${nim(t.nim)}  (${nim(t.nimReal)} real, in the pool)  ≈ ${usd(nimValue)} at $${p}`)
    console.log(`Cash-outs         ${t.cashouts} paid, ${usd(t.paidOut)} spent, ${nim(t.bought)} bought`)
    if (t.bought > 0) console.log(`Avg buy price     $${((t.paidOut / USDT) / (t.bought / LUNA)).toPrecision(4)} per NIM (market $${p})`)
    console.log(`Last 24h          ${usd(Number(rows[0].today))}`)
    console.log(`Topped up         ${usd(t.topups)}`)
    console.log(`P&L               ${usd(equity - t.topups)}  (float + NIM at market − top-ups)`)
  },

  async topup(amount) {
    const micro = Math.round(Number(amount) * USDT)
    if (!(micro > 0)) throw new Error('Usage: topup <usdt>')
    await book('topup', micro, 0, `Provider balance +${usd(micro)}`)
    console.log(`✓ Float +${usd(micro)}`)
    await commands.status()
  },

  async rebalance(...args) {
    const toIndex = args.indexOf('--to')
    const to = toIndex >= 0 ? args[toIndex + 1] : null
    const amountArg = args.find((a, i) => !a.startsWith('--') && i !== toIndex + 1)
    const t = await totals()
    const p = await price()
    const simulatedNim = t.nim - t.nimReal
    let realNim = amountArg ? Math.min(t.nimReal, Math.round(Number(amountArg) * LUNA)) : t.nimReal

    if (simulatedNim > 0) {
      const got = Math.floor((simulatedNim / LUNA) * p * (1 - SWAP_SLIPPAGE) * USDT)
      await book('rebalance', got, -simulatedNim, `Simulated swap ${nim(simulatedNim)} → ${usd(got)} at $${p}`, 1)
      console.log(`✓ Test-wallet NIM: ${nim(simulatedNim)} → ${usd(got)} (bookkeeping only)`)
    }
    if (realNim > 0 && !to) {
      console.log(`! ${nim(realNim)} real NIM is held in the pool. Pass --to <address> to move it out on chain (e.g. to your exchange) before it is booked as sold.`)
      realNim = 0
    }
    if (realNim > 0) {
      const hash = await sendNim(to, realNim, 'treasury:rebalance')
      const got = Math.floor((realNim / LUNA) * p * (1 - SWAP_SLIPPAGE) * USDT)
      await book('rebalance', got, -realNim, `Sent ${nim(realNim)} to ${to} (${hash.slice(0, 10)}…), booked at $${p}`, 0, hash)
      console.log(`✓ Real NIM: ${nim(realNim)} sent to ${to} (${hash}), booked ${usd(got)}`)
    }
    await commands.status()
  },

  async history(n = 15) {
    const { rows } = await db.execute({ sql: 'SELECT * FROM treasury_ledger ORDER BY created_at DESC LIMIT ?', args: [Number(n)] })
    for (const r of rows) {
      const when = new Date(Number(r.created_at)).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
      console.log(`${when}  ${String(r.kind).padEnd(9)} ${usd(Number(r.usdt)).padStart(14)}  ${nim(Number(r.nim)).padStart(16)}  ${r.simulated ? 'test ' : '     '}${r.note ?? ''}`)
    }
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
  console.error(`✗ ${err.message}`)
  process.exit(1)
}
