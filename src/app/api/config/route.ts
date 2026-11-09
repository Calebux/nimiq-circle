import { exitFeePolicy } from '@/lib/goal-exit-policy'
import { cadences } from '@/lib/circles'
import { serverConfig } from '@/lib/env'
import { evmPoolAddress } from '@/lib/evm/polygon'
import { offrampProvider } from '@/lib/offramp'
import { nimUsd } from '@/lib/pricing'

/** What the client needs before it can pay, plus a live NIM → NGN rate for "≈ ₦" estimates. */
export async function GET() {
  const { nim, devWallet } = serverConfig()
  let ngnPerNim: number | null = null
  let ngnPerUsdt: number | null = null
  try {
    const rates = await offrampProvider().rates()
    ngnPerUsdt = rates.ngnPerUsdt
    ngnPerNim = rates.ngnPerNim ?? (rates.ngnPerUsdt ? (await nimUsd()) * rates.ngnPerUsdt : null)
  } catch {
    // Estimates fall back to the client constant; cash-out still gets a real quote.
  }
  return Response.json({ poolAddress: nim.poolAddress, usdtPoolAddress: evmPoolAddress(), network: nim.network, devWallet, ngnPerNim, ngnPerUsdt, cadences: cadences(), earlyExitPolicy: exitFeePolicy() })
}
