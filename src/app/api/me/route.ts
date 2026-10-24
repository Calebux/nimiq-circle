import { AVATAR_COUNT, currentUser, requireUser } from '@/lib/auth'
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
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 24) : user.name
    if (!name) throw new ApiError('Tell us what to call you')
    const avatar = Number.isInteger(body.avatar) && (body.avatar as number) >= 1 && (body.avatar as number) <= AVATAR_COUNT ? (body.avatar as number) : user.avatar
    await run('UPDATE users SET name = ?, avatar = ? WHERE address = ?', [name, avatar, user.address])
    return Response.json({ user: { ...user, name, avatar } })
  } catch (err) {
    return errorResponse(err)
  }
}
