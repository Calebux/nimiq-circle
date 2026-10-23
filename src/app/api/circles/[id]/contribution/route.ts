import { requireUser } from '@/lib/auth'
import { recordContribution } from '@/lib/circles'
import { errorResponse, readJsonBody } from '@/lib/errors'

/** Called after Nimiq Pay returns; poll until `confirmed`. `hint` is the wallet's return value. */
export async function POST(request: Request, ctx: RouteContext<'/api/circles/[id]/contribution'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    const hint = typeof b.hint === 'string' && b.hint.length <= 4096 ? b.hint : null
    return Response.json(await recordContribution(user, id, hint))
  } catch (err) {
    return errorResponse(err)
  }
}
