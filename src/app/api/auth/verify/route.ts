import { startSession, verifySignIn } from '@/lib/auth'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { rateLimit } from '@/lib/security'

export async function POST(request: Request) {
  try {
    await rateLimit('verify', 20, 60_000)
    const body = await readJsonBody(request)
    const s = (k: string) => {
      if (typeof body[k] !== 'string' || !body[k]) throw new ApiError(`Missing ${k}`)
      return body[k] as string
    }
    const user = await verifySignIn({ address: s('address'), nonce: s('nonce'), publicKey: s('publicKey'), signature: s('signature') })
    await startSession(user.address)
    return Response.json({ user })
  } catch (err) {
    return errorResponse(err)
  }
}
