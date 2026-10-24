import { circlePreview } from '@/lib/circles'
import { errorResponse } from '@/lib/errors'
import { rateLimit } from '@/lib/security'

/** Public invite preview, so people see what they are joining before signing in. */
export async function GET(_request: Request, ctx: RouteContext<'/api/circles/code/[code]'>) {
  try {
    await rateLimit('code', 30, 60_000)
    const { code } = await ctx.params
    return Response.json(await circlePreview(code))
  } catch (err) {
    return errorResponse(err)
  }
}
