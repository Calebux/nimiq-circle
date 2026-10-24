import 'server-only'
import { createPublicClient, createWalletClient, decodeFunctionData, encodeFunctionData, erc20Abi, getAddress, http, isAddress, keccak256, parseEther, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { polygon } from 'viem/chains'
import { USDT_POLYGON } from '@/lib/currency'

/**
 * USDT on Polygon: reading deposits into the pool and paying out of it.
 *
 * A USDT transfer has no memo field, so the app appends the memo bytes after the ERC-20
 * `transfer` call data. The token contract ignores trailing bytes; we read them back here.
 *
 * Two keys, both server-only. EVM_POOL_PRIVATE_KEY holds members' USDT and only ever pays
 * members back. GAS_PRIVATE_KEY is a separate small wallet that only sends POL top-ups, so a
 * faucet bug or abuse can never reach members' money.
 */

/** Polygon validators refuse tips under 25 gwei; wallets often default lower. */
const MIN_TIP = BigInt(30_000_000_000)

const transport = () => http(process.env.POLYGON_RPC_URL || undefined, { timeout: 10_000 })
let pub: ReturnType<typeof createPublicClient> | undefined
const client = () => (pub ??= createPublicClient({ chain: polygon, transport: transport() }))

type KeyName = 'EVM_POOL_PRIVATE_KEY' | 'GAS_PRIVATE_KEY'

function accountFrom(name: KeyName) {
  const key = process.env[name]?.trim()
  if (!key) throw new Error(`${name} is not configured`)
  return privateKeyToAccount(key as Hex)
}

export function evmPoolAddress(): string | null {
  const a = process.env.EVM_POOL_ADDRESS?.trim()
  return a && isAddress(a) ? getAddress(a) : null
}

export const isEvmAddress = (v: unknown): v is string => typeof v === 'string' && isAddress(v)
export const sameEvm = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.toLowerCase() === b.toLowerCase())

export const memoHex = (memo: string) => toHex(new TextEncoder().encode(memo)).slice(2)

/** Fees that clear Polygon's minimum tip, for the pool's own sends and the member's wallet. */
export async function fees() {
  const f = await client().estimateFeesPerGas()
  const tip = f.maxPriorityFeePerGas > MIN_TIP ? f.maxPriorityFeePerGas : MIN_TIP
  const max = f.maxFeePerGas > tip * BigInt(2) ? f.maxFeePerGas : tip * BigInt(2)
  return { maxFeePerGas: max, maxPriorityFeePerGas: tip }
}

export interface UsdtDeposit {
  hash: string
  from: string
  to: string
  amount: number
  memo: string
  status: 'pending' | 'confirmed' | 'failed'
}

/** Read a member's USDT transfer by hash. Null if the network has not seen it (yet). */
export async function getUsdtDeposit(hash: string): Promise<UsdtDeposit | null> {
  const tx = await client().getTransaction({ hash: hash as Hex }).catch(() => null)
  if (!tx) return null
  if (!tx.to || tx.to.toLowerCase() !== USDT_POLYGON.toLowerCase()) throw new Error('not a USDT transfer')
  const call = tx.input.slice(0, 2 + 8 + 64 * 2)
  const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data: call as Hex })
  if (functionName !== 'transfer') throw new Error('not a USDT transfer')
  const [to, amount] = args as [string, bigint]
  const extra = tx.input.slice(call.length)
  const memo = extra ? new TextDecoder().decode(Buffer.from(extra, 'hex')) : ''
  const base = { hash: tx.hash, from: getAddress(tx.from), to: getAddress(to), amount: Number(amount), memo }
  if (!tx.blockNumber) return { ...base, status: 'pending' }
  // Credit only once Polygon calls the block final (a few seconds), so a reorg cannot undo it.
  const [receipt, finalized] = await Promise.all([client().getTransactionReceipt({ hash: tx.hash }).catch(() => null), client().getBlock({ blockTag: 'finalized' })])
  if (!receipt) return { ...base, status: 'pending' }
  if (receipt.status !== 'success') return { ...base, status: 'failed' }
  return { ...base, status: receipt.blockNumber <= finalized.number ? 'confirmed' : 'pending' }
}

export async function usdtBalance(address: string): Promise<number> {
  return Number(await client().readContract({ address: USDT_POLYGON, abi: erc20Abi, functionName: 'balanceOf', args: [getAddress(address)] }))
}

export async function polBalance(address: string): Promise<bigint> {
  return client().getBalance({ address: getAddress(address) })
}

/** Each wallet's sends go out one at a time, so two never pick the same nonce. */
const queues = new Map<KeyName, Promise<unknown>>()

/**
 * Sign, then broadcast. The hash is known before broadcasting, so if the broadcast errors
 * (a timeout after the node already took it) we ask the chain before reporting a failure:
 * a payout that did go out is never rolled back and paid a second time.
 */
function send(from: KeyName, tx: { to: string; data?: Hex; value?: bigint }): Promise<string> {
  const run = async () => {
    const account = accountFrom(from)
    const wallet = createWalletClient({ chain: polygon, transport: transport(), account })
    const request = await wallet.prepareTransactionRequest({ to: getAddress(tx.to), data: tx.data, value: tx.value ?? BigInt(0), ...(await fees()) })
    const signed = await wallet.signTransaction(request)
    const hash = keccak256(signed)
    try {
      await client().sendRawTransaction({ serializedTransaction: signed })
    } catch (err) {
      await new Promise((r) => setTimeout(r, 3_000))
      if (!(await client().getTransaction({ hash }).catch(() => null))) throw err
    }
    return hash
  }
  const next = (queues.get(from) ?? Promise.resolve()).then(run, run)
  queues.set(from, next.catch(() => undefined))
  return next
}

/** Pay USDT out of the pool, with a memo after the call data like members' deposits. */
export function sendUsdtFromPool(to: string, micro: number, memo: string): Promise<string> {
  const data = (encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [getAddress(to), BigInt(micro)] }) + memoHex(memo)) as Hex
  return send('EVM_POOL_PRIVATE_KEY', { to: USDT_POLYGON, data })
}

/** Send a little POL from the gas wallet so a member can pay the fee on their USDT transfer. */
export function sendPol(to: string, pol: number): Promise<string> {
  return send('GAS_PRIVATE_KEY', { to, value: parseEther(String(pol)) })
}

export const gasWalletConfigured = () => Boolean(process.env.GAS_PRIVATE_KEY?.trim())

/** Wait (briefly) until a pool transaction is mined; true if it succeeded. */
export async function waitMined(hash: string, timeoutMs = 60_000): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const receipt = await client().getTransactionReceipt({ hash: hash as Hex }).catch(() => null)
    if (receipt) return receipt.status === 'success'
    await new Promise((r) => setTimeout(r, 2_000))
  }
  return false
}
