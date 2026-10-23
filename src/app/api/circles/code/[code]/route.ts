import { circlePreview } from '@/lib/circles'
import { errorResponse } from '@/lib/errors'

/** Public invite preview, so people see what they are joining before signing in. */
export async function GET(_request: Request, ctx: RouteContext<'/api/circles/code/[code]'>) {
  try {
    const { code } = await ctx.params
    return Response.json(await circlePreview(code))
  } catch (err) {
    return errorResponse(err)
  }
}
