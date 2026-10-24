import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { requireSpike } from '@/lib/security'
import { appendLog } from '@/lib/nimiq/pool'
import { getBlockNumber } from '@/lib/nimiq/rpc'

const EVENTS = new Set(['wallet_error', 'evm_check'])

/** Client-reported spike events, e.g. errors Nimiq Pay returned before anything hit the chain. */
export async function POST(request: Request) {
  try {
    requireSpike()
    const body = await readJsonBody(request)
    if (typeof body.event !== 'string' || !EVENTS.has(body.event)) throw new ApiError('Unknown event')
    const detail = body.detail && typeof body.detail === 'object' ? (body.detail as Record<string, unknown>) : undefined
    if (JSON.stringify(detail ?? {}).length > 4096) throw new ApiError('Detail too large')
    await appendLog(body.event, await getBlockNumber().catch(() => 0), detail)
    return Response.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
