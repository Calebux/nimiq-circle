'use client'

import { Gift, LockSimple } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useState } from 'react'
import { Confetti } from '@/components/confetti'
import { Splash } from '@/components/gate'
import { Avatar, AvatarStack, BackLink, BottomBar, PrimaryButton, Screen, nim, shortDate } from '@/components/ui'
import { Ngn, api, useApi, usePayment, useWallet } from '@/components/wallet'
import { PRESETS } from '@/lib/currency'
import type { GoalPreview } from '@/lib/goal-friends'

function Hero({ goal }: { goal: GoalPreview }) {
  return (
    <section className="relative overflow-hidden rounded-card bg-sky-soft p-5 shadow-soft">
      <Image src="/art/jar.webp" alt="" width={502} height={600} priority className="pointer-events-none absolute -right-1 top-2 w-[104px]" />
      <div className="flex items-center gap-2">
        <Avatar avatar={goal.owner.avatar} size={36} />
        <p className="text-sm font-semibold text-ink-2">{goal.owner.name} is saving for</p>
      </div>
      <h1 className="mt-2 max-w-[68%] font-display text-[32px] font-extrabold leading-tight tracking-tight">{goal.name}</h1>
      {goal.progress !== null && (
        <>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white" aria-label={`${Math.round(goal.progress * 100)}% of target`}>
            <div className="h-full origin-left rounded-full bg-coral" style={{ transform: `scaleX(${goal.progress})` }} />
          </div>
          <p className="mt-1.5 text-sm text-ink-2 tabular-nums">
            {Math.round(goal.progress * 100)}% of {nim(goal.target!)} {goal.currency}
          </p>
        </>
      )}
      {goal.unlockAt && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-sm font-semibold">
          <LockSimple size={15} weight="bold" /> Locked until {shortDate(goal.unlockAt)}
        </p>
      )}
      {goal.friendCount > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <AvatarStack avatars={goal.friends.map((f) => f.avatar)} size={28} max={4} />
          <p className="text-sm text-ink-2">
            {goal.friendCount === 1 ? `${goal.friends[0].name} chipped in` : `${goal.friendCount} friends chipped in`}
          </p>
        </div>
      )}
    </section>
  )
}

function HowItWorks({ goal }: { goal: GoalPreview }) {
  return (
    <section className="rounded-card bg-white p-5 shadow-soft">
      <h2 className="font-display text-xl font-bold tracking-tight">What happens when you chip in</h2>
      <ol className="mt-3 flex flex-col gap-2.5 text-[15px] leading-snug">
        <li>1. You pick an amount and approve it in your Nimiq Pay wallet.</li>
        {goal.payTo ? (
          <li>2. It goes straight to {goal.owner.name}&apos;s own Nimiq Pay wallet, marked for {goal.name}. Akilii never holds it.</li>
        ) : (
          <li>2. It goes into {goal.owner.name}&apos;s {goal.name} savings on Akilii, where it earns staking rewards while it waits.</li>
        )}
        <li>3. {goal.owner.name} sees your name next to it.</li>
      </ol>
      <p className="mt-4 rounded-[var(--radius-inner)] bg-blush px-4 py-3 text-sm text-ink-2">
        It is a gift: once it is in, it belongs to {goal.owner.name} and cannot be sent back. Only chip in for people you know.
      </p>
    </section>
  )
}

function Thanks({ goal, amount }: { goal: GoalPreview; amount: number }) {
  return (
    <Screen>
      <Confetti />
      <section className="mt-10 rounded-card bg-sun-soft p-6 text-center shadow-soft">
        <span className="mx-auto grid size-16 place-items-center rounded-full bg-white text-coral">
          <Gift size={32} weight="fill" />
        </span>
        <h1 className="mt-4 font-display text-[28px] font-extrabold leading-tight tracking-tight">
          You chipped in {nim(amount, goal.currency === 'USDT' && amount % 1 ? 2 : 0)} {goal.currency}
        </h1>
        <p className="mt-2 text-[15px] text-sun-ink">{goal.owner.name} will see it in {goal.name}.</p>
      </section>
      <BottomBar>
        <PrimaryButton href="/goals/new">Start a goal of your own</PrimaryButton>
      </BottomBar>
    </Screen>
  )
}

function ChipIn({ code, goal: initial }: { code: string; goal: GoalPreview }) {
  const wallet = useWallet()
  const payment = usePayment()
  const [goal, setGoal] = useState(initial)
  const presets = PRESETS[goal.currency].deposit
  const [amount, setAmount] = useState(String(presets[0]))
  const [done, setDone] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const value = Number(amount) || 0
  const usdt = goal.currency === 'USDT'

  async function chipIn() {
    setError(null)
    try {
      let current = goal
      if (wallet.phase !== 'ready') {
        if (!(await wallet.signIn())) return
        // Signed in now: the memo (and "is this my own goal?") depends on who is paying.
        current = await api<GoalPreview>(`/api/chip/${encodeURIComponent(code)}`)
        setGoal(current)
        if (current.isOwner) return
      }
      if (!current.memo) throw new Error('Sign in to chip in')
      const ok = await payment.run({ amount: value, currency: current.currency, memo: current.memo, to: current.payTo ?? undefined, confirmUrl: `/api/chip/${encodeURIComponent(code)}`, extra: { amount: value } })
      if (ok) setDone(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (done !== null) return <Thanks goal={goal} amount={done} />

  const canPay = wallet.inNimiqPay || wallet.devWallet || wallet.phase === 'ready'
  const label =
    payment.state === 'approving' ? 'Approve in Nimiq Pay…' : payment.state === 'confirming' ? `Confirming on ${usdt ? 'Polygon' : 'Nimiq'}…` : `Chip in ${nim(value, usdt && value % 1 ? 2 : 0)} ${goal.currency}`

  return (
    <Screen>
      <BackLink href="/" />
      <div className="mt-4 flex flex-col gap-4">
        <Hero goal={goal} />

        {goal.isOwner ? (
          <section className="rounded-card bg-white p-5 shadow-soft">
            <p className="font-semibold">This is your goal.</p>
            <p className="mt-1 text-[15px] text-ink-2">This is the page your friends see when you share the link.</p>
          </section>
        ) : !goal.open ? (
          <p className="rounded-card bg-white p-5 text-center text-ink-2 shadow-soft">This goal is finished, so it is not taking gifts any more.</p>
        ) : (
          <>
            <section className="rounded-card bg-white/70 p-4 shadow-soft">
              <label htmlFor="chip-amount" className="font-display text-lg font-bold tracking-tight">
                How much?
              </label>
              <div className="mt-2 flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
                <input
                  id="chip-amount"
                  inputMode={usdt ? 'decimal' : 'numeric'}
                  value={amount}
                  onChange={(e) => setAmount(usdt ? e.target.value.replace(/[^\d.]/g, '').replace(/(\.\d{0,2}).*$/, '$1').slice(0, 8) : e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none"
                />
                <span className="font-semibold text-ink-2">{goal.currency}</span>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2">
                {presets.map((a) => (
                  <button key={a} type="button" onClick={() => setAmount(String(a))} className={`press h-11 rounded-full text-[15px] font-semibold ${value === a ? 'bg-ink text-white' : 'bg-white shadow-soft'}`}>
                    {nim(a)}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-sm text-ink-2">
                ≈ <Ngn amount={value} currency={goal.currency} />. {usdt ? 'Network fee: about a cent in POL.' : 'Network fee: free.'}
              </p>
            </section>
            <HowItWorks goal={goal} />
          </>
        )}
        {(error || payment.error || wallet.error) && <p className="rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error ?? payment.error ?? wallet.error}</p>}
      </div>

      <BottomBar>
        {goal.isOwner ? (
          <PrimaryButton href={goal.goalId ? `/g/${goal.goalId}` : '/'}>Back to your goal</PrimaryButton>
        ) : !goal.open ? (
          <PrimaryButton href="/goals/new">Start a goal of your own</PrimaryButton>
        ) : canPay ? (
          <PrimaryButton onClick={chipIn} disabled={value < goal.minDeposit || payment.state !== 'idle'}>
            {label}
          </PrimaryButton>
        ) : (
          <p className="py-4 text-center font-semibold text-ink-2">Open this link in Nimiq Pay to chip in</p>
        )}
      </BottomBar>
    </Screen>
  )
}

export function ChipInScreen({ code }: { code: string }) {
  const wallet = useWallet()
  // Wait for the session check so the preview knows who is looking (own goal, memo). Signing in
  // later refreshes it inside ChipIn, without remounting mid-payment.
  const { data, error } = useApi<GoalPreview>(wallet.phase === 'loading' ? null : `/api/chip/${encodeURIComponent(code)}`)
  if (error && !data) {
    return (
      <Screen bar={false}>
        <BackLink href="/" />
        <p className="mt-10 rounded-card bg-white p-6 text-center text-ink-2 shadow-soft">{error}</p>
      </Screen>
    )
  }
  if (!data) return <Splash />
  return <ChipIn code={code} goal={data} />
}
