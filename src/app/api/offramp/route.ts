import { requireUser } from '@/lib/auth'
import { LUNA } from '@/lib/db'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { offrampProvider } from '@/lib/offramp'
import { createQuote } from '@/lib/treasury'

/** Account-name lookup, and a locked NIM → NGN quote for the cash-out sheet. */
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const b = await readJsonBody(request)
    try {
      if (b.action === 'resolve') {
        if (typeof b.bankCode !== 'string' || typeof b.accountNumber !== 'string') throw new ApiError('Missing bank details')
        return Response.json(await offrampProvider().resolveAccount({ bankCode: b.bankCode, accountNumber: b.accountNumber }))
      }
      if (b.action === 'quote') {
        const nim = Number(b.amount)
        if (!(nim > 0)) throw new ApiError('Missing amount')
        return Response.json(await createQuote(user, Math.round(nim * LUNA)))
      }
      throw new ApiError('Unknown action')
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw new ApiError(err instanceof Error ? err.message : 'Provider error', 502)
    }
  } catch (err) {
    return errorResponse(err)
  }
}
