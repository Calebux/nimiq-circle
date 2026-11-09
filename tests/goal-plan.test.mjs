import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentPeriod, periodStart } from '../src/lib/goal-plan.ts'

const DAY = 86_400_000

test('weekly periods run anchor to anchor', () => {
  const anchor = new Date(2026, 10, 5, 9).getTime()
  assert.deepEqual(currentPeriod(anchor, 'weekly', anchor + 3 * DAY), { index: 0, start: anchor, end: anchor + 7 * DAY })
  assert.equal(currentPeriod(anchor, 'weekly', anchor + 7 * DAY).index, 1)
  assert.equal(currentPeriod(anchor, 'weekly', anchor - DAY).index, 0)
})

test('monthly periods keep the day and clamp short months', () => {
  const anchor = new Date(2026, 0, 31, 12).getTime()
  assert.equal(new Date(periodStart(anchor, 'monthly', 1)).getDate(), 28)
  assert.equal(new Date(periodStart(anchor, 'monthly', 2)).getDate(), 31)
  const p = currentPeriod(anchor, 'monthly', new Date(2026, 1, 27).getTime())
  assert.equal(p.index, 0)
  assert.equal(currentPeriod(anchor, 'monthly', new Date(2026, 1, 28, 13).getTime()).index, 1)
  assert.equal(currentPeriod(anchor, 'monthly', new Date(2027, 0, 31, 12).getTime()).index, 12)
})
