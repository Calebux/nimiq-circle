import { requireUser } from '@/lib/auth'
import { myCircles } from '@/lib/circles'
import { errorResponse } from '@/lib/errors'
import { myGoals } from '@/lib/goals'

export async function GET() {
  try {
    const user = await requireUser()
    const [circles, goals] = await Promise.all([myCircles(user), myGoals(user)])
    return Response.json({ user, circles, goals })
  } catch (err) {
    return errorResponse(err)
  }
}
