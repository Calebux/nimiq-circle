import { requireUser } from '@/lib/auth'
import { errorResponse, readJsonBody } from '@/lib/errors'
import { setGoalPlan } from '@/lib/goal-friends'

/** Set, change or clear (cadence: null) the goal's saving plan. Owner only. */
export async function POST(request: Request, ctx: RouteContext<'/api/goals/[id]/plan'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    await setGoalPlan(user, id, { cadence: b.cadence, amount: b.amount })
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
