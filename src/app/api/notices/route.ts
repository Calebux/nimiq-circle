import { requireUser } from '@/lib/auth'
import { errorResponse, readJsonBody } from '@/lib/errors'
import { inbox, markRead } from '@/lib/notices'

export async function GET() {
  try {
    return Response.json({ notices: await inbox(await requireUser()) })
  } catch (err) {
    return errorResponse(err)
  }
}

/** Dismiss: { ids: [...] } or { all: true }. */
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const b = await readJsonBody(request)
    await markRead(user, b.all === true ? 'all' : Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string') : [])
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
