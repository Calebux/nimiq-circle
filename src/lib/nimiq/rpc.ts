import 'server-only'
import { serverConfig } from '@/lib/env'

/** Subset of the Albatross RPC transaction object that we rely on. */
export interface ChainTransaction {
  hash: string
  from: string
  to: string
  /** Luna. */
  value: number
  fee: number
  /** Hex-encoded. */
  recipientData: string
  blockNumber?: number
  /** Milliseconds. */
  timestamp?: number
  confirmations?: number
  executionResult?: boolean
}

export interface ChainStaker {
  address: string
  /** Active stake in luna. Grows on its own with a restaking pool. */
  balance: number
  delegation?: string
  inactiveBalance: number
  /** Block the inactive balance became (or will become) inactive. */
  inactiveFrom?: number
  /** First block the inactive balance can be retired at. */
  inactiveRelease?: number
  retiredBalance: number
}

export interface PolicyConstants {
  blocksPerEpoch: number
  blocksPerBatch: number
  /** Milliseconds between micro blocks. */
  blockSeparationTime: number
  /** Luna. */
  minimumStake: number
  genesisBlockNumber: number
}

class RpcError extends Error {
  constructor(
    message: string,
    readonly data: unknown,
  ) {
    super(message)
  }
}

async function call<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(serverConfig().nim.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Nimiq RPC ${method} failed: HTTP ${res.status}`)
  const body = (await res.json()) as {
    result?: { data: T }
    error?: { message: string; data?: unknown }
  }
  if (body.error) throw new RpcError(`Nimiq RPC ${method}: ${body.error.message}`, body.error.data)
  if (!body.result) throw new Error(`Nimiq RPC ${method}: empty response`)
  return body.result.data
}

function isNotFound(err: unknown): boolean {
  return err instanceof RpcError && typeof err.data === 'string' && /not found|no staker/i.test(err.data)
}

/** Looks in the chain first, then the mempool. Returns null if unknown. */
export async function getTransaction(hash: string): Promise<ChainTransaction | null> {
  try {
    return await call<ChainTransaction>('getTransactionByHash', [hash])
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
  try {
    const tx = await call<ChainTransaction>('getTransactionFromMempool', [hash])
    return { ...tx, confirmations: 0 }
  } catch (err) {
    if (!isNotFound(err)) throw err
  }
  return null
}

/** Most recent mined transactions touching `address`, newest first. */
export function getTransactionsByAddress(address: string, max = 100): Promise<ChainTransaction[]> {
  return call<ChainTransaction[]>('getTransactionsByAddress', [address, max, null])
}

export function getBlockNumber(): Promise<number> {
  return call<number>('getBlockNumber', [])
}

/** Liquid balance in luna (0 for an unknown address). */
export async function getBalance(address: string): Promise<number> {
  const account = await call<{ balance: number }>('getAccountByAddress', [address])
  return account.balance
}

export async function getStaker(address: string): Promise<ChainStaker | null> {
  try {
    return await call<ChainStaker>('getStakerByAddress', [address])
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

let policy: Promise<PolicyConstants> | undefined
export function getPolicy(): Promise<PolicyConstants> {
  policy ??= call<PolicyConstants>('getPolicyConstants', []).catch((err) => {
    policy = undefined
    throw err
  })
  return policy
}

/** Broadcast a signed transaction. Returns the hash the node reports. */
export function sendRawTransaction(hex: string): Promise<string> {
  return call<string>('sendRawTransaction', [hex])
}
