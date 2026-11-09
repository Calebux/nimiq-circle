'use client'

import { CalendarDots, Check, Copy, ShareNetwork } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useState } from 'react'
import { ManualCopy, useCopy } from '@/components/share'
import { PrimaryButton, Sheet, nim, shortDate } from '@/components/ui'
import { Ngn, api } from '@/components/wallet'
import { PRESETS, type Currency } from '@/lib/currency'
import type { PlanStatus } from '@/lib/goal-friends'
import type { PlanCadence } from '@/lib/goal-plan'

/** What the plan and invite pieces need; both goal kinds (pool and wallet) have it. */
export interface GoalBasics {
  id: string
  name: string
  currency: Currency
  status: 'open' | 'closed'
  target: number | null
  balance: number
  plan: PlanStatus | null
  custody: 'pool' | 'wallet'
}

const per = (c: PlanCadence) => (c === 'weekly' ? 'week' : 'month')

/** "Your turn" (sun) until this period's saving is in, then done (mint). */
export function PlanCard({ goal, onEdit }: { goal: GoalBasics; onEdit: () => void }) {
  const plan = goal.plan
  if (!plan) {
    if (goal.status !== 'open') return null
    return (
      <button type="button" onClick={onEdit} className="press flex items-center gap-3 rounded-card bg-white p-4 text-left shadow-soft">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-sun-soft text-sun-ink">
          <CalendarDots size={22} weight="bold" />
        </span>
        <span>
          <span className="block font-semibold">Set a saving plan</span>
          <span className="block text-sm text-ink-2">Pick an amount for every week or month. We remind you when it is due.</span>
        </span>
      </button>
    )
  }
  const left = Math.max(0, plan.amount - plan.savedThisPeriod)
  return (
    <section className={`rounded-card p-4 pr-5 shadow-soft ${plan.done ? 'bg-mint-soft' : 'bg-sun-soft'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-semibold ${plan.done ? 'text-mint-ink' : 'text-sun-ink'}`}>Your plan</p>
          <p className="font-display text-xl font-extrabold tracking-tight tabular-nums">
            {nim(plan.amount)} {goal.currency} a {per(plan.cadence)}
          </p>
        </div>
        {goal.status === 'open' && (
          <button type="button" onClick={onEdit} className="press rounded-full bg-white/80 px-3 py-1.5 text-sm font-semibold">
            Change
          </button>
        )}
      </div>
      <p className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${plan.done ? 'text-mint-ink' : 'text-sun-ink'}`}>
        {plan.done ? (
          <>
            <Check size={15} weight="bold" /> Done for this {per(plan.cadence)}. Next one starts {shortDate(plan.periodEnd)}.
          </>
        ) : (
          <>
            Your turn: {nim(left, goal.currency === 'USDT' && left % 1 ? 2 : 0)} {goal.currency} by {shortDate(plan.periodEnd)}
          </>
        )}
      </p>
    </section>
  )
}

export function PlanSheet({ goal, open, onOpenChange, onDone }: { goal: GoalBasics; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [cadence, setCadence] = useState<PlanCadence>(goal.plan?.cadence ?? 'weekly')
  const [amount, setAmount] = useState(String(goal.plan?.amount ?? PRESETS[goal.currency].deposit[1]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = Number(amount) || 0

  async function save(clear = false) {
    setBusy(true)
    setError(null)
    try {
      await api(`/api/goals/${goal.id}/plan`, { body: clear ? { cadence: null } : { cadence, amount: value } })
      onOpenChange(false)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Saving plan" description="A steady amount adds up. We remind you in Akilii when it is due.">
      <div className="grid grid-cols-2 gap-2">
        {(['weekly', 'monthly'] as const).map((c) => (
          <button key={c} type="button" aria-pressed={cadence === c} onClick={() => setCadence(c)} className={`press h-12 rounded-full text-[15px] font-semibold ${cadence === c ? 'bg-ink text-white' : 'bg-white shadow-soft'}`}>
            Every {per(c)}
          </button>
        ))}
      </div>
      <label htmlFor="plan-amount" className="mt-4 block text-sm font-semibold text-ink-2">
        Amount each {per(cadence)}
      </label>
      <div className="mt-1 flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
        <input
          id="plan-amount"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none"
        />
        <span className="font-semibold text-ink-2">{goal.currency}</span>
      </div>
      <p className="mt-2 text-sm text-ink-2">
        ≈ <Ngn amount={value} currency={goal.currency} /> a {per(cadence)}.
        {goal.target && value > 0 ? ` About ${Math.ceil(Math.max(0, goal.target - goal.balance) / value)} ${per(cadence)}s to your target.` : ''}
      </p>
      {error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}
      <div className="mt-5 flex flex-col gap-2">
        <PrimaryButton onClick={() => save()} disabled={busy || value < 1}>
          {busy ? 'Saving…' : goal.plan ? 'Update plan' : 'Start plan'}
        </PrimaryButton>
        {goal.plan && (
          <button type="button" onClick={() => save(true)} disabled={busy} className="press h-12 text-[15px] font-semibold text-ink-2">
            Remove plan
          </button>
        )}
      </div>
    </Sheet>
  )
}

export function InviteSheet({ goal, open, onOpenChange }: { goal: GoalBasics; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { copied, manual, copy, share } = useCopy()

  async function getLink() {
    if (link) return link
    const { code } = await api<{ code: string }>(`/api/goals/${goal.id}/invite`, { body: {} })
    const url = `${window.location.origin}/chip/${code}`
    setLink(url)
    return url
  }

  async function run(action: 'share' | 'copy') {
    setError(null)
    try {
      const url = await getLink()
      const text = `I am saving for "${goal.name}" on Akilii in Nimiq Pay. Want to chip in? Any amount helps.`
      if (action === 'share') await share('link', { title: goal.name, text, url })
      else await copy('link', url)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Invite friends to chip in" description={goal.custody === 'wallet' ? 'Anyone with the link can send NIM from their Nimiq Pay wallet straight to yours, for this goal.' : 'Anyone with the link can add to this goal from their Nimiq Pay wallet. It is a gift: it stays in your savings.'}>
      <div className="rounded-card bg-lilac-soft p-4 text-center">
        <Image src="/art/friends.webp" alt="" width={1200} height={714} className="mx-auto w-[180px]" />
        <p className="mt-2 text-sm text-lilac-ink">Friends see the goal name, your name and, if you set a target, how close you are to it.</p>
      </div>
      {link && (
        <button type="button" onClick={() => run('copy')} className="press mt-3 flex w-full items-center justify-between gap-3 rounded-[var(--radius-inner)] bg-white px-4 py-3 text-left shadow-soft">
          <span className="min-w-0 truncate text-sm font-semibold">{link.replace(/^https?:\/\//, '')}</span>
          <span className={`grid size-9 shrink-0 place-items-center rounded-full ${copied === 'link' ? 'bg-mint text-white' : 'bg-blush'}`}>
            {copied === 'link' ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
          </span>
        </button>
      )}
      <p className="mt-2 min-h-5 text-sm text-ink-2" aria-live="polite">
        {copied === 'link' ? 'Link copied, paste it anywhere' : ''}
      </p>
      {manual && <div className="mt-2"><ManualCopy text={manual} /></div>}
      {error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}
      <div className="mt-3">
        <PrimaryButton onClick={() => run('share')}>
          <span className="flex items-center gap-2">
            <ShareNetwork size={20} weight="bold" /> Share link
          </span>
        </PrimaryButton>
      </div>
    </Sheet>
  )
}
