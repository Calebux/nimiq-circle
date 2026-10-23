import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { checkContribution } from '@/lib/nimiq/contribution'
import { appendLog } from '@/lib/nimiq/pool'

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request)
    if (typeof body.memo !== 'string' || body.memo.length > 64) throw new ApiError('Missing memo')
    // Whatever Nimiq Pay returned. Finding out what that is, is the point of check 1.
    const hint = typeof body.hint === 'string' && body.hint.length <= 4096 ? body.hint : null
    const check = await checkContribution(body.memo, hint)

    // Record the answer once, when the contribution first confirms.
    if (check.status === 'confirmed' && body.logOnConfirm === true && check.tx?.blockNumber) {
      await appendLog('contribution_confirmed', check.tx.blockNumber, {
        memo: body.memo,
        hintKind: check.hintKind,
        hintSample: hint?.slice(0, 80),
        foundByHash: check.foundByHash,
        txHash: check.tx.hash,
        luna: check.tx.value,
        msFromSubmit: typeof body.submittedAt === 'number' ? Date.now() - body.submittedAt : undefined,
      })
    }
    return Response.json(check)
  } catch (err) {
    return errorResponse(err)
  }
}
