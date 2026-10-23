import { requireUser } from '@/lib/auth'
import { parseBank } from '@/lib/delivery'
import { errorResponse, readJsonBody } from '@/lib/errors'
import { withdrawGoal } from '@/lib/goals'

export async function POST(request: Request, ctx: RouteContext<'/api/goals/[id]/withdraw'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    const method = b.method === 'bank' ? 'bank' : 'wallet'
    return Response.json(await withdrawGoal(user, id, method, method === 'bank' ? parseBank(b.bank) : undefined))
  } catch (err) {
    return errorResponse(err)
  }
}
