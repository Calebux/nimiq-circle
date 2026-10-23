import 'server-only'
import { isValidNimiqAddress } from './nimiq/address'

export type NimNetwork = 'mainnet' | 'testnet'

export function serverConfig() {
  const network: NimNetwork = process.env.NIM_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
  const poolAddress = process.env.POOL_ADDRESS?.trim() ?? ''
  const production = process.env.NODE_ENV === 'production'
  return {
    nim: {
      network,
      networkId: network === 'testnet' ? 5 : 24,
      rpcUrl: process.env.NIM_RPC_URL || 'https://rpc.nimiqwatch.com',
      minConfirmations: Number(process.env.NIM_MIN_CONFIRMATIONS ?? 2),
      poolAddress: isValidNimiqAddress(poolAddress) ? poolAddress : null,
      poolPrivateKey: process.env.POOL_PRIVATE_KEY?.trim() || null,
      validator: process.env.STAKE_VALIDATOR?.trim() || null,
    },
    offrampProvider: process.env.OFFRAMP_PROVIDER || 'mock',
    sessionSecret: process.env.SESSION_SECRET || (production ? '' : 'dev-only-session-secret'),
    database: {
      url: process.env.DATABASE_URL || 'file:data/circle.db',
      authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
    },
    /** Fake wallet and simulated payments for desktop testing. Never on in production. */
    devWallet: !production && process.env.DEV_WALLET === '1',
    /** Pay a round out as soon as everyone has chipped in (demo), instead of on its due date. */
    instantPayouts: process.env.INSTANT_PAYOUTS === '1',
  }
}
