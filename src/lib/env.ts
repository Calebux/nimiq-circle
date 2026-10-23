import 'server-only'
import { isValidNimiqAddress } from './nimiq/address'

export type NimNetwork = 'mainnet' | 'testnet'

export function serverConfig() {
  const network: NimNetwork = process.env.NIM_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
  const poolAddress = process.env.POOL_ADDRESS?.trim() ?? ''
  return {
    nim: {
      network,
      rpcUrl: process.env.NIM_RPC_URL || 'https://rpc.nimiqwatch.com',
      minConfirmations: Number(process.env.NIM_MIN_CONFIRMATIONS ?? 2),
      poolAddress: isValidNimiqAddress(poolAddress) ? poolAddress : null,
      validator: process.env.STAKE_VALIDATOR?.trim() || null,
    },
    offrampProvider: process.env.OFFRAMP_PROVIDER || 'mock',
  }
}
