import 'server-only'
import { serverConfig } from '@/lib/env'
import { getBlockNumber, getTransaction, sendRawTransaction } from './rpc'

type NimiqModule = typeof import('@nimiq/core')
type Built = ReturnType<NimiqModule['TransactionBuilder']['newBasic']>

/**
 * Build, sign with the pool key and broadcast. The only server path that uses
 * POOL_PRIVATE_KEY. Fee is zero, like every transaction the app sends. If the broadcast
 * errors, the chain (or mempool) is asked about the hash before reporting a failure, so a
 * payout that did go out is never rolled back and sent again.
 */
async function poolTx(build: (n: NimiqModule, pool: InstanceType<NimiqModule['Address']>, height: number, networkId: number) => Built): Promise<string> {
  const { poolPrivateKey, networkId } = serverConfig().nim
  if (!poolPrivateKey) throw new Error('POOL_PRIVATE_KEY is not configured')
  const Nimiq = await import('@nimiq/core')
  const keyPair = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(poolPrivateKey))
  const tx = build(Nimiq, keyPair.toAddress(), await getBlockNumber(), networkId)
  tx.sign(keyPair, undefined)
  const hash = tx.hash()
  try {
    await sendRawTransaction(tx.toHex())
  } catch (err) {
    await new Promise((r) => setTimeout(r, 3_000))
    if (!(await getTransaction(hash).catch(() => null))) throw err
  }
  return hash
}

const ZERO = BigInt(0)

/** Send NIM out of the pool (payouts, goal withdrawals). */
export function sendFromPool(to: string, luna: number, memo: string): Promise<string> {
  const data = new TextEncoder().encode(memo)
  if (data.length > 64) throw new Error('Memo is limited to 64 bytes')
  return poolTx((N, pool, height, net) => N.TransactionBuilder.newBasicWithData(pool, N.Address.fromUserFriendlyAddress(to), data, BigInt(luna), ZERO, height, net))
}

/** Staking moves for the worker (src/lib/staking.ts). */
export const poolStaking = {
  create: (luna: number, validator: string) =>
    poolTx((N, pool, height, net) => N.TransactionBuilder.newCreateStaker(pool, N.Address.fromUserFriendlyAddress(validator), BigInt(luna), ZERO, height, net)),
  add: (luna: number) => poolTx((N, pool, height, net) => N.TransactionBuilder.newAddStake(pool, pool, BigInt(luna), ZERO, height, net)),
  /** Lower active stake to `luna`; the rest turns inactive at the next election block. */
  setActive: (luna: number) => poolTx((N, pool, height, net) => N.TransactionBuilder.newSetActiveStake(pool, BigInt(luna), ZERO, height, net)),
  retire: (luna: number) => poolTx((N, pool, height, net) => N.TransactionBuilder.newRetireStake(pool, BigInt(luna), ZERO, height, net)),
  /** Retired stake back into the pool's liquid balance. */
  remove: (luna: number) => poolTx((N, _pool, height, net) => N.TransactionBuilder.newRemoveStake(_pool, BigInt(luna), ZERO, height, net)),
}
