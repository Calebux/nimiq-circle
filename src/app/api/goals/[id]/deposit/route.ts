import { requireUser } from '@/lib/auth'
import { errorResponse, readJsonBody } from '@/lib/errors'
import { recordGoalDeposit } from '@/lib/goals'

export async function POST(request: Request, ctx: RouteContext<'/api/goals/[id]/deposit'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    const hint = typeof b.hint === 'string' && b.hint.length <= 4096 ? b.hint : null
    return Response.json(await recordGoalDeposit(user, id, hint, typeof b.amount === 'number' ? b.amount : undefined))
  } catch (err) {
    return errorResponse(err)
  }
}
