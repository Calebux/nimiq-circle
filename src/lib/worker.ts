import 'server-only'
import { activeCircleIds, advance, remind, settleCashingPayouts } from './circles'
import { syncGoals } from './goals'
import { manageStake } from './staking'

const EVERY_MS = 60_000

/**
 * One pass over everything time-based: close due rounds (including short ones after grace),
 * forward late money, send reminders, settle bank cash-outs, pick up unreported deposits,
 * and keep the pool's stake in line with what may be withdrawn soon.
 * Each step is independent: one failing never blocks the rest.
 */
export async function tick() {
  const results: Record<string, string> = {}
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const out = await fn()
      results[name] = out && typeof out === 'object' && 'action' in out ? String((out as { action: string }).action) : 'ok'
    } catch (err) {
      results[name] = `error: ${err instanceof Error ? err.message : String(err)}`
      console.error(`[worker] ${name}`, err)
    }
  }
  await step('circles', async () => {
    for (const id of await activeCircleIds()) {
      await advance(id)
      await remind(id)
    }
  })
  await step('cashouts', settleCashingPayouts)
  await step('goals', syncGoals)
  await step('stake', manageStake)
  return results
}

declare global {
  var circleWorker: ReturnType<typeof setInterval> | undefined
}

/** Start the loop once per server process (dev reloads re-run register). */
export function startWorker() {
  if (globalThis.circleWorker || process.env.WORKER === 'off') return
  let running = false
  globalThis.circleWorker = setInterval(async () => {
    if (running) return
    running = true
    try {
      await tick()
    } finally {
      running = false
    }
  }, EVERY_MS)
  console.log('[worker] started, every', EVERY_MS / 1000, 's')
}
