import { ApiError, errorResponse } from '@/lib/errors'
import { serverConfig } from '@/lib/env'
import { isValidNimiqAddress } from '@/lib/nimiq/address'
import { getPolicy, getStaker, getTransaction } from '@/lib/nimiq/rpc'
import { requireSpike } from '@/lib/security'

/** Check 4: a wallet's own staker (and, with ?tx=, the staking transaction it just sent). Read-only. */
export async function GET(request: Request) {
  try {
    requireSpike()
    const url = new URL(request.url)
    const address = url.searchParams.get('address') ?? ''
    if (!isValidNimiqAddress(address)) throw new ApiError('Invalid address')
    const tx = url.searchParams.get('tx')
    const [staker, policy, transaction] = await Promise.all([
      getStaker(address),
      getPolicy(),
      tx && /^[0-9a-f]{64}$/i.test(tx) ? getTransaction(tx.toLowerCase()) : Promise.resolve(null),
    ])
    return Response.json({ staker, minimumStake: policy.minimumStake, validator: serverConfig().nim.validator, transaction })
  } catch (err) {
    return errorResponse(err)
  }
}
