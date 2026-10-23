import 'server-only'
import { serverConfig } from '@/lib/env'
import { getBlockNumber, sendRawTransaction } from './rpc'

/**
 * Send NIM out of the pool (payouts, goal withdrawals, provider deposits).
 * The only server path that uses POOL_PRIVATE_KEY.
 */
export async function sendFromPool(to: string, luna: number, memo: string): Promise<string> {
  const { poolPrivateKey, networkId } = serverConfig().nim
  if (!poolPrivateKey) throw new Error('POOL_PRIVATE_KEY is not configured')
  const data = new TextEncoder().encode(memo)
  if (data.length > 64) throw new Error('Memo is limited to 64 bytes')

  const Nimiq = await import('@nimiq/core')
  const keyPair = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(poolPrivateKey))
  const height = await getBlockNumber()
  const tx = Nimiq.TransactionBuilder.newBasicWithData(
    keyPair.toAddress(),
    Nimiq.Address.fromUserFriendlyAddress(to),
    data,
    BigInt(luna),
    BigInt(0),
    height,
    networkId,
  )
  tx.sign(keyPair, undefined)
  await sendRawTransaction(tx.toHex())
  return tx.hash()
}
