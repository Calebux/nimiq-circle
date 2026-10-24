import { createChallenge } from '@/lib/auth'
import { errorResponse } from '@/lib/errors'
import { rateLimit } from '@/lib/security'

export async function POST() {
  try {
    await rateLimit('challenge', 20, 60_000)
    return Response.json(await createChallenge())
  } catch (err) {
    return errorResponse(err)
  }
}
