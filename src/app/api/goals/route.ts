import { requireUser } from '@/lib/auth'
import { asCurrency } from '@/lib/currency'
import { errorResponse, readJsonBody } from '@/lib/errors'
import { createGoal } from '@/lib/goals'

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const b = await readJsonBody(request)
    const id = await createGoal(user, {
      name: typeof b.name === 'string' ? b.name : '',
      currency: asCurrency(b.currency),
      target: b.target === null || b.target === undefined || b.target === '' ? null : Number(b.target),
      unlockAt: typeof b.unlockAt === 'number' ? b.unlockAt : null,
      plan: b.plan && typeof b.plan === 'object' ? (b.plan as { cadence: unknown; amount: unknown }) : undefined,
    })
    return Response.json({ id })
  } catch (err) {
    return errorResponse(err)
  }
}
