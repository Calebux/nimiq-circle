import { requireUser } from '@/lib/auth'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { offrampProvider } from '@/lib/offramp'

/** Account-name lookup and NIM → NGN quote for the cash-out sheet. */
export async function POST(request: Request) {
  try {
    await requireUser()
    const b = await readJsonBody(request)
    const provider = offrampProvider()
    try {
      if (b.action === 'resolve') {
        if (typeof b.bankCode !== 'string' || typeof b.accountNumber !== 'string') throw new ApiError('Missing bank details')
        return Response.json(await provider.resolveAccount({ bankCode: b.bankCode, accountNumber: b.accountNumber }))
      }
      if (b.action === 'quote') {
        const nim = Number(b.amount)
        if (!(nim > 0)) throw new ApiError('Missing amount')
        const q = await provider.quote({ asset: 'NIM', amount: Math.round(nim * 100_000) })
        return Response.json({ rate: q.rate, feeNgn: q.feeNgn, ngnOut: q.ngnOut })
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
