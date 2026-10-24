import { requireUser } from '@/lib/auth'
import { removeMember } from '@/lib/circles'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'

/** { address }: the creator removes someone, or a member removes themself (leave). */
export async function DELETE(request: Request, ctx: RouteContext<'/api/circles/[id]/members'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    if (typeof b.address !== 'string') throw new ApiError('Missing address')
    await removeMember(user, id, b.address)
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
