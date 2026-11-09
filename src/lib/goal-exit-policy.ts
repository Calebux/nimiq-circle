/** All money stays in integer smallest units until it reaches the UI. */
export type ExitFeeBasis = 'principal' | 'total'
export interface ExitFeePolicy { bps: number; basis: ExitFeeBasis }

/** An unset or invalid policy disables early exits; never silently choose a fee. */
export function exitFeePolicy(env: Record<string, string | undefined> = process.env): ExitFeePolicy | null {
  const raw = env.GOAL_BREAK_FEE_BPS?.trim()
  const basis = env.GOAL_BREAK_FEE_BASIS ?? 'principal'
  if (!raw || !/^\d+$/.test(raw) || !['principal', 'total'].includes(basis)) return null
  const bps = Number(raw)
  return Number.isInteger(bps) && bps > 0 && bps < 10_000 ? { bps, basis: basis as ExitFeeBasis } : null
}

export function exitAmounts(principal: number, bonus: number, policy: ExitFeePolicy) {
  if (![principal, bonus].every((n) => Number.isSafeInteger(n) && n >= 0) || principal <= 0) throw new Error('Invalid savings balance')
  if (!Number.isInteger(policy.bps) || policy.bps <= 0 || policy.bps >= 10_000 || !['principal', 'total'].includes(policy.basis)) throw new Error('Invalid early-exit fee')
  const gross = BigInt(principal) + BigInt(bonus)
  const base = policy.basis === 'total' ? gross : BigInt(principal)
  // Round down: never charge more than the disclosed percentage.
  const fee = base * BigInt(policy.bps) / BigInt(10_000)
  if (gross > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Savings balance is too large')
  return { principal, bonus, fee: Number(fee), net: Number(gross - fee) }
}
