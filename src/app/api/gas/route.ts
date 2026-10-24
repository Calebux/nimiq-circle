import { requireUser } from '@/lib/auth'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { topUpGas } from '@/lib/evm/gas'
import { rateLimit } from '@/lib/security'

/** Before a USDT payment: top up the member's POL if they are short, and return gas settings. */
export async function POST(request: Request) {
  try {
    await rateLimit('gas', 6, 60_000)
    const user = await requireUser()
    const b = await readJsonBody(request)
    if (typeof b.address !== 'string') throw new ApiError('Missing address')
    const micro = Number(b.micro)
    if (!Number.isInteger(micro) || micro <= 0) throw new ApiError('Missing amount')
    return Response.json(await topUpGas(user, b.address, micro))
  } catch (err) {
    return errorResponse(err)
  }
}
