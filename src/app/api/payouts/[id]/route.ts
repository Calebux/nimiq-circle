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

/** Claim: { method: 'wallet' } or { method: 'bank', bank: {...} }. */
export async function POST(request: Request, ctx: RouteContext<'/api/payouts/[id]'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    const method = b.method === 'bank' ? 'bank' : 'wallet'
    return Response.json(await claimPayout(user, id, method, method === 'bank' ? parseBank(b.bank) : undefined))
  } catch (err) {
    return errorResponse(err)
  }
}
