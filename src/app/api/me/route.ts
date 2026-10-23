import { currentUser, requireUser } from '@/lib/auth'
import { run } from '@/lib/db'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'

export async function GET() {
  try {
    return Response.json({ user: await currentUser() })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser()
    const body = await readJsonBody(request)
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 24) : ''
    if (!name) throw new ApiError('Tell us what to call you')
    await run('UPDATE users SET name = ? WHERE address = ?', [name, user.address])
    return Response.json({ user: { ...user, name } })
  } catch (err) {
    return errorResponse(err)
  }
}
