import { requireUser } from '@/lib/auth'
import { errorResponse } from '@/lib/errors'
import { goalInviteCode } from '@/lib/goal-friends'

/** The goal's chip-in link code, made on first share. Owner only. */
export async function POST(_request: Request, ctx: RouteContext<'/api/goals/[id]/invite'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    return Response.json({ code: await goalInviteCode(user, id) })
  } catch (err) {
    return errorResponse(err)
  }
}
