import { errorResponse } from '@/lib/errors'
import { requireCron } from '@/lib/security'
import { tick } from '@/lib/worker'

/**
 * Run the worker once. For hosts without a long-lived process, call this from a cron with
 * `Authorization: Bearer $CRON_SECRET`. Also handy for checking what a pass does.
 */
export async function POST(request: Request) {
  try {
    requireCron(request)
    return Response.json(await tick())
  } catch (err) {
    return errorResponse(err)
  }
}

/** The staking plan right now, with the numbers behind it. Read-only. */
export async function GET(request: Request) {
  try {
    requireCron(request)
    const { planStaking } = await import('@/lib/staking')
    const plan = await planStaking()
    const nim = (l: number) => Math.round(l / 1e5)
    return Response.json({
      action: plan.action,
      amount: 'amount' in plan ? nim(plan.amount) : 0,
      reason: plan.reason,
      liquid: nim(plan.liquid),
      needs: Object.fromEntries(Object.entries(plan.needs).map(([k, v]) => [k, nim(v)])),
      staker: plan.staker && { active: nim(plan.staker.balance), inactive: nim(plan.staker.inactiveBalance), retired: nim(plan.staker.retiredBalance) },
    })
  } catch (err) {
    return errorResponse(err)
  }
}
