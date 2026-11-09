// A goal's saving plan: "put X in every week/month". Pure, shared by server and client.
//
// Periods count from the moment the plan was set (the anchor), so a plan made on a Thursday
// runs Thursday to Thursday. Months keep the anchor's day, clamped to short months.

export const PLAN_CADENCES = ['weekly', 'monthly'] as const
export type PlanCadence = (typeof PLAN_CADENCES)[number]

export const isPlanCadence = (v: unknown): v is PlanCadence => v === 'weekly' || v === 'monthly'

const DAY = 86_400_000
const WEEK = 7 * DAY

/** Start of period `index` (0 = the one containing the anchor). */
export function periodStart(anchor: number, cadence: PlanCadence, index: number): number {
  if (cadence === 'weekly') return anchor + index * WEEK
  const a = new Date(anchor)
  const month = a.getMonth() + index
  const lastDay = new Date(a.getFullYear(), month + 1, 0).getDate()
  return new Date(a.getFullYear(), month, Math.min(a.getDate(), lastDay), a.getHours(), a.getMinutes(), a.getSeconds(), a.getMilliseconds()).getTime()
}

/** The period `now` falls in. Before the anchor counts as period 0. */
export function currentPeriod(anchor: number, cadence: PlanCadence, now: number) {
  let index = 0
  if (now > anchor) {
    if (cadence === 'weekly') index = Math.floor((now - anchor) / WEEK)
    else {
      const a = new Date(anchor)
      const n = new Date(now)
      index = (n.getFullYear() - a.getFullYear()) * 12 + n.getMonth() - a.getMonth()
      if (periodStart(anchor, cadence, index) > now) index--
    }
  }
  return { index, start: periodStart(anchor, cadence, index), end: periodStart(anchor, cadence, index + 1) }
}

/** How long before a period ends the owner gets a reminder. */
export const remindBefore = (cadence: PlanCadence) => (cadence === 'weekly' ? DAY : 3 * DAY)
