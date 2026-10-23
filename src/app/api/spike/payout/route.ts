import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { offrampProvider } from '@/lib/offramp'

function str(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new ApiError(`Missing ${field}`)
  return value
}

/** One route for the whole spike flow: resolve → quote → create → poll. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    const provider = offrampProvider()
    try {
      switch (body.action) {
        case 'resolve':
          return Response.json(
            await provider.resolveAccount({ bankCode: str(body.bankCode, 'bankCode'), accountNumber: str(body.accountNumber, 'accountNumber') }),
          )
        case 'quote': {
          const amount = Number(body.amount)
          if (!Number.isInteger(amount) || amount <= 0) throw new ApiError('amount must be whole luna')
          return Response.json({ provider: provider.name, accepts: provider.accepts, ...(await provider.quote({ asset: 'NIM', amount })) })
        }
        case 'create':
          return Response.json(
            await provider.createPayout({
              quoteId: str(body.quoteId, 'quoteId'),
              bankCode: str(body.bankCode, 'bankCode'),
              accountNumber: str(body.accountNumber, 'accountNumber'),
              accountName: str(body.accountName, 'accountName'),
              reference: str(body.reference, 'reference'),
            }),
          )
        case 'get':
          return Response.json(await provider.getPayout(str(body.id, 'id')))
        default:
          throw new ApiError('Unknown action')
      }
    } catch (err) {
      // Provider errors are shown as-is in the spike; the real app will map them.
      if (err instanceof ApiError) throw err
      throw new ApiError(err instanceof Error ? err.message : 'Provider error', 502)
    }
  } catch (err) {
    return errorResponse(err)
  }
}
