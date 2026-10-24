import { requireUser } from '@/lib/auth'
import { claimPayout, getPayout } from '@/lib/circles'
import { parseBank } from '@/lib/delivery'
import { errorResponse, readJsonBody } from '@/lib/errors'

export async function GET(_request: Request, ctx: RouteContext<'/api/payouts/[id]'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    return Response.json(await getPayout(user, id))
  } catch (err) {
    return errorResponse(err)
  }
}

/** Claim: { method: 'wallet', evmAddress? } or { method: 'bank', bank: {...} }. evmAddress: USDT payouts' Polygon wallet. */
export async function POST(request: Request, ctx: RouteContext<'/api/payouts/[id]'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    const method = b.method === 'bank' ? 'bank' : 'wallet'
    const evmAddress = typeof b.evmAddress === 'string' ? b.evmAddress : undefined
    return Response.json(await claimPayout(user, id, method, method === 'bank' ? parseBank(b.bank) : undefined, evmAddress))
  } catch (err) {
    return errorResponse(err)
  }
}
