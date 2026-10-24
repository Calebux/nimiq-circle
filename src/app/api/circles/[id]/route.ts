import { requireUser } from '@/lib/auth'
import { circleView, updateCircle } from '@/lib/circles'
import { asCurrency } from '@/lib/currency'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'

export async function GET(_request: Request, ctx: RouteContext<'/api/circles/[id]'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    return Response.json(await circleView(user, id))
  } catch (err) {
    return errorResponse(err)
  }
}

/** Creator edits terms while the circle is still filling. */
export async function PATCH(request: Request, ctx: RouteContext<'/api/circles/[id]'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    if (typeof b.name !== 'string' || typeof b.localName !== 'string' || typeof b.cadence !== 'string') throw new ApiError('Missing details')
    await updateCircle(user, id, {
      name: b.name,
      localName: b.localName,
      cadence: b.cadence,
      contribution: Number(b.contribution),
      currency: asCurrency(b.currency),
      size: Number(b.size),
      order: b.order === 'shuffle' ? 'shuffle' : 'join',
    })
    return Response.json(await circleView(user, id))
  } catch (err) {
    return errorResponse(err)
  }
}
