import { requireUser } from '@/lib/auth'
import { createCircle } from '@/lib/circles'
import { asCurrency } from '@/lib/currency'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const b = await readJsonBody(request)
    if (typeof b.name !== 'string' || typeof b.localName !== 'string' || typeof b.cadence !== 'string') throw new ApiError('Missing details')
    const id = await createCircle(user, {
      name: b.name,
      localName: b.localName,
      cadence: b.cadence,
      contribution: Number(b.contribution),
      currency: asCurrency(b.currency),
      size: Number(b.size),
      order: b.order === 'shuffle' ? 'shuffle' : 'join',
    })
    return Response.json({ id })
  } catch (err) {
    return errorResponse(err)
  }
}
