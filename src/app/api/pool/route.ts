import { all } from '@/lib/db'
import { errorResponse } from '@/lib/errors'
import { reserves, usdtReserves } from '@/lib/yield'

/** Public, no sign-in: anyone can check the pool against the chain. */
export async function GET() {
  try {
    const [r, u] = await Promise.all([reserves(), usdtReserves()])
    const nim = (l: number) => l / 1e5
    const actions = await all<{ kind: string; amount: number; tx_hash: string | null; created_at: number }>(
      "SELECT kind, amount, tx_hash, created_at FROM pool_actions WHERE kind NOT LIKE 'dry:%' ORDER BY created_at DESC LIMIT 8",
    )
    return Response.json({
      address: r.address,
      validator: r.validator,
      liquid: nim(r.liquid),
      stakedActive: nim(r.stakedActive),
      unstaking: nim(r.unstaking),
      total: nim(r.total),
      owedToMembers: nim(r.owedToMembers),
      operator: nim(r.operator),
      earned: nim(r.earned),
      covered: r.total >= r.owedToMembers,
      // The USDT side, on Polygon. `held` is null if Polygon could not be read just now.
      usdt: u && {
        address: u.address,
        held: u.held === null ? null : u.held / 1e6,
        owedToMembers: u.owedToMembers / 1e6,
        covered: u.held !== null && u.held >= u.owedToMembers,
      },
      actions: actions.map((a) => ({ kind: a.kind, amount: nim(a.amount), txHash: a.tx_hash, at: a.created_at })),
    })
  } catch (err) {
    return errorResponse(err)
  }
}
