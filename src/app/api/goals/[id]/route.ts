import { requireUser } from '@/lib/auth'
import { errorResponse } from '@/lib/errors'
import { goalView } from '@/lib/goals'

export async function GET(_request: Request, ctx: RouteContext<'/api/goals/[id]'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    return Response.json(await goalView(user, id))
  } catch (err) {
    return errorResponse(err)
  }
}
