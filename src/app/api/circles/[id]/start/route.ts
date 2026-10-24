import { requireUser } from '@/lib/auth'
import { circleView, startNow } from '@/lib/circles'
import { errorResponse } from '@/lib/errors'

/** Creator starts with whoever has joined. */
export async function POST(_request: Request, ctx: RouteContext<'/api/circles/[id]/start'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    await startNow(user, id)
    return Response.json(await circleView(user, id))
  } catch (err) {
    return errorResponse(err)
  }
}
