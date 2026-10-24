import { requireUser } from '@/lib/auth'
import { nudge } from '@/lib/circles'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'

/** { address }: remind someone in your circle to chip in. Returns text for the share sheet. */
export async function POST(request: Request, ctx: RouteContext<'/api/circles/[id]/nudge'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    if (typeof b.address !== 'string') throw new ApiError('Missing address')
    return Response.json(await nudge(user, id, b.address))
  } catch (err) {
    return errorResponse(err)
  }
}
