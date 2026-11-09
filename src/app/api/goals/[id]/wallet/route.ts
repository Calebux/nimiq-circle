import { requireUser } from '@/lib/auth'
import { ApiError, errorResponse, readJsonBody } from '@/lib/errors'
import { closeWalletGoal, prepareExit, prepareSave, recordExitStart, recordExitStep, recordNote, recordStake } from '@/lib/wallet-goals'

/**
 * Wallet goals (the NIM stays in the owner's wallet). The owner signs every transaction in
 * Nimiq Pay; these actions plan the next one and record it once it is on chain.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/goals/[id]/wallet'>) {
  try {
    const user = await requireUser()
    const { id } = await ctx.params
    const b = await readJsonBody(request)
    switch (b.action) {
      case 'prepare':
        return Response.json(await prepareSave(user, id, Number(b.amount)))
      case 'note':
        return Response.json(await recordNote(user, id, Number(b.amount)))
      case 'stake':
        return Response.json(await recordStake(user, id, { hint: b.hint, added: b.added, value: b.value }))
      case 'exit':
        return Response.json(await prepareExit(user, id))
      case 'exit-started':
        return Response.json(await recordExitStart(user, id, { hint: b.hint, amount: b.amount }))
      case 'exit-step':
        return Response.json(await recordExitStep(user, id, { step: b.step, hint: b.hint }))
      case 'close':
        await closeWalletGoal(user, id)
        return Response.json({ ok: true })
      default:
        throw new ApiError('Unknown action')
    }
  } catch (err) {
    return errorResponse(err)
  }
}
