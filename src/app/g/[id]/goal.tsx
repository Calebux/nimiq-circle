'use client'

import { ArrowDown, ArrowUp, LockSimple, LockSimpleOpen, Sparkle, Wallet } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useState } from 'react'
import { CashOutSheet, Sent, type BankChoice } from '@/components/cashout'
import { Confetti } from '@/components/confetti'
import { SignedIn, Splash } from '@/components/gate'
import { BackLink, BottomBar, PrimaryButton, Screen, SecondaryButton, Sheet, naira, nim, shortDate, useCountUp } from '@/components/ui'
import { api, useApi, usePayment } from '@/components/wallet'
import type { GoalView, PublicWithdrawal } from '@/lib/goals'
import { NGN_PER_NIM } from '@/lib/constants'

const AMOUNTS = [500, 1000, 2500, 5000]

function JarCard({ goal }: { goal: GoalView }) {
  const balance = useCountUp(goal.balance)
  const progress = goal.target ? Math.min(1, goal.balance / goal.target) : 0
  const days = goal.daysLeft
  return (
    <section className="rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
      <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-6px)] bg-sky-soft px-5 pb-5 pt-5">
        <Image src="/art/jar.webp" alt="" width={502} height={600} priority className="pointer-events-none absolute -right-1 top-1 w-[112px]" />
        <p className="text-sm font-semibold text-ink-2">Saved so far</p>
        <p className="mt-1 font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">{nim(balance)}</p>
        <p className="mt-1.5 text-[15px] text-ink-2">
          {goal.target ? `of ${nim(goal.target)} NIM` : 'NIM'} ≈ {naira(goal.balance * NGN_PER_NIM)}
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
  const [amount, setAmount] = useState('1000')
  const payment = usePayment()
  const value = Number(amount) || 0

  async function approve() {
    const ok = await payment.run({ nim: value, memo: goal.memo, confirmUrl: `/api/goals/${goal.id}/deposit`, extra: { amount: value } })
    if (ok) {
      onOpenChange(false)
      onDone()
    }
  }

  const label = payment.state === 'approving' ? 'Approve in Nimiq Pay…' : payment.state === 'confirming' ? 'Confirming on Nimiq…' : `Add ${nim(value)} NIM`
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Add to ${goal.name}`} description={goal.unlockAt ? `Locked with the rest until ${shortDate(goal.unlockAt)}.` : 'You can take it out any time.'}>
      <div className="flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
        <label htmlFor="add-amount" className="sr-only">
          Amount
        </label>
        <input
          id="add-amount"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 8))}
          className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none"
        />
        <span className="font-semibold text-ink-2">NIM</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {AMOUNTS.map((a) => (
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
      <p className="mt-3 text-sm text-ink-2">≈ {naira(value * NGN_PER_NIM)}. Network fee: free.</p>
      {payment.error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{payment.error}</p>}
      <div className="mt-5">
        <PrimaryButton onClick={approve} disabled={value < 1 || payment.state !== 'idle'}>
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
    <Sheet open={open} onOpenChange={onOpenChange} title="Take it out" description={`${nim(total, 2)} NIM including ${nim(goal.earned, 2)} earned.`}>
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

function Goal({ goal, reload }: { goal: GoalView; reload: () => void }) {
  const [adding, setAdding] = useState(false)
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
      setSent(await api<PublicWithdrawal>(`/api/goals/${goal.id}/withdraw`, { body: { method, bank } }))
      setWithdrawing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (method === 'bank') throw e
    }
    setBusy(false)
  }

  if (sent) return <SentWithdrawal w={sent} goalId={goal.id} />

  const history = [
    ...goal.deposits.map((d) => ({ kind: 'in' as const, amount: d.amount, at: d.at })),
    ...goal.withdrawals.map((w) => ({ kind: 'out' as const, amount: w.amount + w.bonus, at: w.createdAt })),
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

        <section className="flex items-center gap-3 rounded-card bg-mint-soft p-4 pr-5">
          <Image src="/art/sprout.webp" alt="" width={342} height={400} className="w-[60px] shrink-0" />
          <div>
            <p className="flex items-center gap-1 font-display text-2xl font-extrabold tracking-tight text-mint-ink tabular-nums">
              +{nim(earned, 2)} NIM
              <Sparkle size={16} weight="fill" className="text-mint" />
            </p>
            <p className="mt-0.5 text-sm leading-snug text-mint-ink">Staked while it waits. You get it with your savings.</p>
          </div>
        </section>

        <section className="rounded-card bg-white p-5 shadow-soft">
          <h2 className="font-display text-xl font-bold tracking-tight">Activity</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-[15px] text-ink-2">Nothing yet. Add your first NIM and watch the jar fill up.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {history.map((h, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className={`grid size-10 place-items-center rounded-full ${h.kind === 'in' ? 'bg-mint-soft text-mint-ink' : 'bg-sun-soft text-sun-ink'}`}>
                    {h.kind === 'in' ? <ArrowDown size={18} weight="bold" /> : <ArrowUp size={18} weight="bold" />}
                  </span>
                  <div className="flex-1">
                    <p className="font-semibold">{h.kind === 'in' ? 'Added' : 'Taken out'}</p>
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
      <CashOutSheet open={cashing} onOpenChange={setCashing} amountNim={goal.balance + goal.earned} onConfirm={(bank) => withdraw('bank', bank)} />
    </Screen>
  )
}

function SentWithdrawal({ w, goalId }: { w: PublicWithdrawal; goalId: string }) {
  const { data: goal } = useApi<GoalView>(`/api/goals/${goalId}`, w.status === 'cashing' ? 3000 : false)
  const current = goal?.withdrawals.find((x) => x.id === w.id) ?? w
  return (
    <Sent
      method={current.method}
      nimAmount={current.amount + current.bonus}
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
