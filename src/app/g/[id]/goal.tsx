'use client'

import { ArrowDown, ArrowUp, CalendarDots, Check, Copy, CurrencyDollar, Gift, LockSimple, LockSimpleOpen, ShareNetwork, Sparkle, Wallet } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { CashOutSheet, Sent, type BankChoice } from '@/components/cashout'
import { Confetti } from '@/components/confetti'
import { ManualCopy, useCopy } from '@/components/share'
import { SignedIn, Splash } from '@/components/gate'
import { BackLink, BottomBar, PrimaryButton, Screen, SecondaryButton, Sheet, nim, shortDate, useCountUp } from '@/components/ui'
import { Ngn, api, payoutTarget, useApi, usePayment } from '@/components/wallet'
import { PRESETS } from '@/lib/currency'
import type { GoalView, PublicWithdrawal } from '@/lib/goals'
import type { PlanCadence } from '@/lib/goal-plan'

function JarCard({ goal }: { goal: GoalView }) {
  const balance = useCountUp(goal.balance)
  const progress = goal.target ? Math.min(1, goal.balance / goal.target) : 0
  const days = goal.daysLeft
  return (
    <section className="rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
      <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-6px)] bg-sky-soft px-5 pb-5 pt-5">
        <Image src="/art/jar.webp" alt="" width={502} height={600} priority className="pointer-events-none absolute -right-1 top-1 w-[112px]" />
        <p className="text-sm font-semibold text-ink-2">Saved so far</p>
        <p className="mt-1 font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">{nim(balance, goal.currency === 'USDT' && goal.balance % 1 ? 2 : 0)}</p>
        <p className="mt-1.5 text-[15px] text-ink-2">
          {goal.target ? `of ${nim(goal.target)} ${goal.currency}` : goal.currency} ≈ <Ngn amount={goal.balance} currency={goal.currency} />
        </p>
        {goal.target && (
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white" aria-label={`${Math.round(progress * 100)}% of target`}>
            <div className="h-full origin-left rounded-full bg-coral transition-transform duration-700 ease-[var(--ease-out)]" style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
        <p className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${goal.locked ? 'bg-lilac-soft text-lilac-ink' : 'bg-white text-ink'}`}>
          {goal.locked ? <LockSimple size={15} weight="bold" /> : <LockSimpleOpen size={15} weight="bold" />}
          {goal.locked ? `Locked until ${shortDate(goal.unlockAt!)} · ${days} ${days === 1 ? 'day' : 'days'} to go` : goal.unlockAt ? 'Unlocked. It is all yours.' : 'Flexible: take it out any time'}
        </p>
      </div>
    </section>
  )
}

function AddMoneySheet({ goal, open, onOpenChange, onDone }: { goal: GoalView; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const presets = PRESETS[goal.currency].deposit
  const [amount, setAmount] = useState(String(presets[1]))
  const payment = usePayment()
  const value = Number(amount) || 0
  const usdt = goal.currency === 'USDT'

  async function approve() {
    const ok = await payment.run({ amount: value, currency: goal.currency, memo: goal.memo, confirmUrl: `/api/goals/${goal.id}/deposit`, extra: { amount: value } })
    if (ok) {
      onOpenChange(false)
      onDone()
    }
  }

  const label =
    payment.state === 'approving' ? 'Approve in Nimiq Pay…' : payment.state === 'confirming' ? `Confirming on ${usdt ? 'Polygon' : 'Nimiq'}…` : `Add ${nim(value, usdt && value % 1 ? 2 : 0)} ${goal.currency}`
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Add to ${goal.name}`} description={goal.unlockAt ? `Locked with the rest until ${shortDate(goal.unlockAt)}.` : 'You can take it out any time.'}>
      <div className="flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
        <label htmlFor="add-amount" className="sr-only">
          Amount
        </label>
        <input
          id="add-amount"
          inputMode={usdt ? 'decimal' : 'numeric'}
          value={amount}
          onChange={(e) => setAmount(usdt ? e.target.value.replace(/[^\d.]/g, '').replace(/(\.\d{0,2}).*$/, '$1').slice(0, 8) : e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none"
        />
        <span className="font-semibold text-ink-2">{goal.currency}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {presets.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAmount(String(a))}
            className={`press h-11 rounded-full text-[15px] font-semibold ${value === a ? 'bg-ink text-white' : 'bg-white shadow-soft'}`}
          >
            {nim(a)}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-2">
        ≈ <Ngn amount={value} currency={goal.currency} />. {usdt ? 'Network fee: about a cent in POL. No POL? We top you up.' : 'Network fee: free.'}
      </p>
      {payment.error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{payment.error}</p>}
      <div className="mt-5">
        <PrimaryButton onClick={approve} disabled={value < goal.minDeposit || payment.state !== 'idle'}>
          {label}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

function WithdrawSheet({
  goal,
  open,
  onOpenChange,
  onWallet,
  onBank,
  busy,
}: {
  goal: GoalView
  open: boolean
  onOpenChange: (o: boolean) => void
  onWallet: () => void
  onBank: () => void
  busy: boolean
}) {
  const total = goal.balance + goal.earned
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Take it out" description={goal.currency === 'NIM' ? `${nim(total, 2)} NIM including ${nim(goal.earned, 2)} earned.` : `${nim(total, 2)} USDT.`}>
      <div className="flex flex-col gap-2">
        <PrimaryButton onClick={onBank} disabled={busy}>
          Cash out to bank
        </PrimaryButton>
        <SecondaryButton onClick={onWallet} disabled={busy}>
          <Wallet size={20} weight="bold" /> {busy ? 'Sending…' : 'Send to Nimiq Pay'}
        </SecondaryButton>
      </div>
    </Sheet>
  )
}

const per = (c: PlanCadence) => (c === 'weekly' ? 'week' : 'month')

/** "Your turn" (sun) until this period's saving is in, then done (mint). */
function PlanCard({ goal, onEdit }: { goal: GoalView; onEdit: () => void }) {
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

function PlanSheet({ goal, open, onOpenChange, onDone }: { goal: GoalView; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
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

function InviteSheet({ goal, open, onOpenChange }: { goal: GoalView; open: boolean; onOpenChange: (o: boolean) => void }) {
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
    <Sheet open={open} onOpenChange={onOpenChange} title="Invite friends to chip in" description="Anyone with the link can add to this goal from their Nimiq Pay wallet. It is a gift: it stays in your savings.">
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

function Goal({ goal, reload }: { goal: GoalView; reload: () => void }) {
  const [adding, setAdding] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [cashing, setCashing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<PublicWithdrawal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const earned = useCountUp(goal.earned, 1100)
  // Celebrate the day a locked goal opens.
  const justUnlocked = Boolean(goal.unlockAt && !goal.locked && goal.balance > 0)

  async function withdraw(method: 'wallet' | 'bank', bank?: BankChoice) {
    setBusy(true)
    setError(null)
    try {
      const target = method === 'wallet' ? await payoutTarget(goal.currency) : {}
      setSent(await api<PublicWithdrawal>(`/api/goals/${goal.id}/withdraw`, { body: { method, bank, ...target } }))
      setWithdrawing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (method === 'bank') throw e
    }
    setBusy(false)
  }

  if (sent) return <SentWithdrawal w={sent} goalId={goal.id} />

  const history = [
    ...goal.deposits.map((d) => ({ kind: 'in' as const, amount: d.amount, at: d.at, from: d.from })),
    ...goal.withdrawals.map((w) => ({ kind: 'out' as const, amount: w.amount + w.bonus, at: w.createdAt, from: null })),
  ].sort((a, b) => b.at - a.at)

  return (
    <Screen bar={goal.locked || goal.balance <= 0 ? true : 'tall'}>
      {justUnlocked && <Confetti />}
      <header className="flex items-center gap-3">
        <BackLink href="/" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-2">{goal.unlockAt ? 'Locked savings' : 'Savings'}</p>
          <h1 className="truncate font-display text-[28px] font-extrabold leading-none tracking-tight">{goal.name}</h1>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        <JarCard goal={goal} />

        <PlanCard goal={goal} onEdit={() => setPlanning(true)} />

        {goal.status === 'open' && (
          <button type="button" onClick={() => setInviting(true)} className="press flex items-center gap-3 rounded-card bg-lilac-soft p-4 text-left shadow-soft">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-lilac-ink">
              <Gift size={22} weight="bold" />
            </span>
            <span>
              <span className="block font-semibold">Invite friends to chip in</span>
              <span className="block text-sm text-lilac-ink">Share a link. Anyone in Nimiq Pay can add to {goal.name}.</span>
            </span>
          </button>
        )}

        {goal.currency === 'NIM' ? (
          <section className="flex items-center gap-3 rounded-card bg-mint-soft p-4 pr-5">
            <Image src="/art/sprout.webp" alt="" width={342} height={400} className="w-[60px] shrink-0" />
            <div>
              <p className="flex items-center gap-1 font-display text-2xl font-extrabold tracking-tight text-mint-ink tabular-nums">
                +{nim(earned, 2)} NIM
                <Sparkle size={16} weight="fill" className="text-mint" />
              </p>
              <p className="mt-0.5 text-sm leading-snug text-mint-ink">Staked while it waits. You get it with your savings.</p>
              <Link href="/pool" className="mt-1 inline-block text-sm font-bold text-mint-ink underline decoration-2 underline-offset-4">
                See the pool on chain
              </Link>
            </div>
          </section>
        ) : (
          <section className="flex items-center gap-3 rounded-card bg-white p-4 pr-5 shadow-soft">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-blush">
              <CurrencyDollar size={24} weight="bold" />
            </span>
            <div>
              <p className="font-semibold">Saved in USDT</p>
              <p className="mt-0.5 text-sm leading-snug text-ink-2">Holds its dollar value on Polygon. USDT savings do not earn rewards.</p>
              <Link href="/pool" className="mt-1 inline-block text-sm font-bold text-ink underline decoration-2 underline-offset-4">
                See the pool on chain
              </Link>
            </div>
          </section>
        )}

        <section className="rounded-card bg-white p-5 shadow-soft">
          <h2 className="font-display text-xl font-bold tracking-tight">Activity</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-[15px] text-ink-2">Nothing yet. Add your first {goal.currency} and watch the jar fill up.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {history.map((h, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className={`grid size-10 place-items-center rounded-full ${h.kind === 'in' ? 'bg-mint-soft text-mint-ink' : 'bg-sun-soft text-sun-ink'}`}>
                    {h.from ? <Gift size={18} weight="bold" /> : h.kind === 'in' ? <ArrowDown size={18} weight="bold" /> : <ArrowUp size={18} weight="bold" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{h.from ? `${h.from} chipped in` : h.kind === 'in' ? 'Added' : 'Taken out'}</p>
                    <p className="text-sm text-ink-2">{shortDate(h.at)}</p>
                  </div>
                  <p className="font-display text-lg font-extrabold tabular-nums">
                    {h.kind === 'in' ? '+' : '-'}
                    {nim(h.amount, 2)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
        {error && <p className="rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}
      </div>

      <BottomBar>
        {goal.status === 'open' && <PrimaryButton onClick={() => setAdding(true)}>Add money</PrimaryButton>}
        {goal.balance > 0 &&
          (goal.locked ? (
            <p className="flex h-12 items-center justify-center gap-1.5 text-sm font-semibold text-lilac-ink">
              <LockSimple size={15} weight="bold" /> Opens {shortDate(goal.unlockAt!)}
            </p>
          ) : (
            <SecondaryButton onClick={() => setWithdrawing(true)}>Take it out</SecondaryButton>
          ))}
      </BottomBar>

      <AddMoneySheet goal={goal} open={adding} onOpenChange={setAdding} onDone={reload} />
      <PlanSheet key={`${goal.plan?.cadence}-${goal.plan?.amount}-${planning}`} goal={goal} open={planning} onOpenChange={setPlanning} onDone={reload} />
      <InviteSheet goal={goal} open={inviting} onOpenChange={setInviting} />
      <WithdrawSheet
        goal={goal}
        open={withdrawing}
        onOpenChange={setWithdrawing}
        busy={busy}
        onWallet={() => withdraw('wallet')}
        onBank={() => {
          setWithdrawing(false)
          setCashing(true)
        }}
      />
      <CashOutSheet open={cashing} onOpenChange={setCashing} amount={goal.balance + goal.earned} currency={goal.currency} onConfirm={(bank) => withdraw('bank', bank)} />
    </Screen>
  )
}

function SentWithdrawal({ w, goalId }: { w: PublicWithdrawal; goalId: string }) {
  const { data: goal } = useApi<GoalView>(`/api/goals/${goalId}`, w.status === 'cashing' ? 3000 : false)
  const current = goal?.withdrawals.find((x) => x.id === w.id) ?? w
  return (
    <Sent
      method={current.method}
      amount={current.amount + current.bonus}
      currency={current.currency}
      ngn={current.ngn}
      bank={current.bank}
      landed={current.status !== 'cashing'}
      simulated={current.simulated}
      backHref="/"
      backLabel="Back home"
    />
  )
}

function GoalLoader({ id }: { id: string }) {
  const { data, error, reload } = useApi<GoalView>(`/api/goals/${id}`)
  if (error && !data) return <Screen bar={false}><BackLink href="/" /><p className="mt-10 text-center text-ink-2">{error}</p></Screen>
  if (!data) return <Splash />
  return <Goal goal={data} reload={reload} />
}

export function GoalScreen({ id }: { id: string }) {
  return (
    <SignedIn>
      <GoalLoader id={id} />
    </SignedIn>
  )
}
