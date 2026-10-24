import { cadences } from '@/lib/circles'
import { serverConfig } from '@/lib/env'
import { offrampProvider } from '@/lib/offramp'
import { nimUsd } from '@/lib/pricing'

/** What the client needs before it can pay, plus a live NIM → NGN rate for "≈ ₦" estimates. */
export async function GET() {
  const { nim, devWallet } = serverConfig()
  let ngnPerNim: number | null = null
  try {
    const [usd, provider] = await Promise.all([nimUsd(), offrampProvider().quote({ usdtMicro: 1_000_000 })])
    ngnPerNim = usd * provider.rate
  } catch {
    // Estimates fall back to the client constant; cash-out still gets a real quote.
  }
  return Response.json({ poolAddress: nim.poolAddress, network: nim.network, devWallet, ngnPerNim, cadences: cadences() })
}
