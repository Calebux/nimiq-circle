import { requireUser } from '@/lib/auth'
import { BANKS } from '@/lib/constants'
import { asCurrency, UNIT } from '@/lib/currency'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { offrampProvider } from '@/lib/offramp'
import { createQuote } from '@/lib/treasury'
import { rateLimit } from '@/lib/security'

/** Banks, account-name lookup, and a locked NIM/USDT → NGN quote for the cash-out sheet. */
export async function POST(request: Request) {
  try {
    await rateLimit('offramp', 30, 60_000)
    const user = await requireUser()
    const b = await readJsonBody(request)
    try {
      if (b.action === 'resolve') {
        if (typeof b.bankCode !== 'string' || typeof b.accountNumber !== 'string') throw new ApiError('Missing bank details')
        return Response.json(await offrampProvider().resolveAccount({ bankCode: b.bankCode, accountNumber: b.accountNumber }))
      }
      if (b.action === 'banks') {
        const list = await offrampProvider().banks()
        // Keep our short names for banks we know; the provider's order (popular first) wins.
        const banks = list?.map(({ code, name }) => BANKS.find((k) => k.code === code) ?? { code, name, short: name.replace(/\s*\(.*\)$/, '') }) ?? BANKS
        return Response.json({ banks })
      }
      if (b.action === 'quote') {
        const amount = Number(b.amount)
        const currency = asCurrency(b.currency)
        if (!(amount > 0)) throw new ApiError('Missing amount')
        return Response.json(await createQuote(user, Math.round(amount * UNIT[currency]), currency))
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
