import { serverConfig } from '@/lib/env'

/** What the client needs before it can pay: where the pool is and which network. */
export function GET() {
  const { nim, devWallet } = serverConfig()
  return Response.json({ poolAddress: nim.poolAddress, network: nim.network, devWallet })
}
