import { requireUser } from '@/lib/auth'
import { joinCircle } from '@/lib/circles'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { rateLimit } from '@/lib/security'

export async function POST(request: Request) {
  try {
    await rateLimit('join', 20, 60_000)
    const user = await requireUser()
    const b = await readJsonBody(request)
    if (typeof b.code !== 'string' || !b.code.trim()) throw new ApiError('Enter the invite code')
    return Response.json({ id: await joinCircle(user, b.code) })
  } catch (err) {
    return errorResponse(err)
  }
}
