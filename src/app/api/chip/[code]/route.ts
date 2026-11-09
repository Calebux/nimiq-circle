import { currentUser, requireUser } from '@/lib/auth'
import { errorResponse, readJsonBody } from '@/lib/errors'
import { goalPreview, recordChipIn } from '@/lib/goal-friends'
import { rateLimit } from '@/lib/security'

/** Public preview of a goal a friend was invited to chip in to. */
export async function GET(_request: Request, ctx: RouteContext<'/api/chip/[code]'>) {
  try {
    await rateLimit('chip', 30, 60_000)
    const { code } = await ctx.params
    return Response.json(await goalPreview(code, await currentUser()))
  } catch (err) {
    return errorResponse(err)
  }
}

/** Confirm a friend's chip-in payment (polled by usePayment until it is on chain). */
export async function POST(request: Request, ctx: RouteContext<'/api/chip/[code]'>) {
  try {
    const user = await requireUser()
    const { code } = await ctx.params
    const b = await readJsonBody(request)
    const hint = typeof b.hint === 'string' && b.hint.length <= 4096 ? b.hint : null
    return Response.json(await recordChipIn(user, code, hint, typeof b.amount === 'number' ? b.amount : undefined))
  } catch (err) {
    return errorResponse(err)
  }
}
