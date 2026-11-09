import { requireUser } from '@/lib/auth'
import { parseBank } from '@/lib/delivery'
import { errorResponse, readJsonBody } from '@/lib/errors'
import { quoteGoalExit, withdrawGoal } from '@/lib/goals'

export async function POST(request: Request, ctx: RouteContext<'/api/goals/[id]/withdraw'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    if (b.action === 'quote') return Response.json(await quoteGoalExit(user, id), { headers: { 'Cache-Control': 'no-store' } })
    const earlyExitQuoteId = typeof b.earlyExitQuoteId === 'string' ? b.earlyExitQuoteId : undefined
    const method = b.method === 'bank' ? 'bank' : 'wallet'
    const evmAddress = typeof b.evmAddress === 'string' ? b.evmAddress : undefined
    return Response.json(await withdrawGoal(user, id, method, method === 'bank' ? parseBank(b.bank) : undefined, evmAddress, earlyExitQuoteId))
  } catch (err) {
    return errorResponse(err)
  }
}
