import { requireUser } from '@/lib/auth'
import { circleView } from '@/lib/circles'
import { errorResponse } from '@/lib/errors'

export async function GET(_request: Request, ctx: RouteContext<'/api/circles/[id]'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    return Response.json(await circleView(user, id))
  } catch (err) {
    return errorResponse(err)
  }
}
