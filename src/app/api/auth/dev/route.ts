import { devSignIn, startSession } from '@/lib/auth'
import { errorResponse } from '@/lib/errors'

/** Dev wallet sign-in (404 unless DEV_WALLET=1 outside production). */
export async function POST() {
  try {
    const user = await devSignIn()
    await startSession(user.address)
    return Response.json({ user })
  } catch (err) {
    return errorResponse(err)
  }
}
