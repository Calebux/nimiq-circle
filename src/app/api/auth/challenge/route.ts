import { createChallenge } from '@/lib/auth'
import { errorResponse } from '@/lib/errors'

export async function POST() {
  try {
    return Response.json(await createChallenge())
  } catch (err) {
    return errorResponse(err)
  }
}
