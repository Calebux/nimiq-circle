import { requireUser } from '@/lib/auth'
import { createPractice } from '@/lib/circles'
import { errorResponse } from '@/lib/errors'
import { rateLimit } from '@/lib/security'

/** A practice circle: you plus two bots, nothing real moves. Returns your open one if any. */
export async function POST() {
  try {
    await rateLimit('practice', 10, 60_000)
    const user = await requireUser()
    return Response.json({ id: await createPractice(user) })
  } catch (err) {
    return errorResponse(err)
  }
}
