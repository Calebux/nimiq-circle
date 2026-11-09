'use client'

import { LockSimple, LockSimpleOpen } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { CurrencyPicker } from '@/components/currency'
import { SignedIn } from '@/components/gate'
import { BackLink, BottomBar, PrimaryButton, Screen, nim, shortDate } from '@/components/ui'
import { Ngn, api, useWallet } from '@/components/wallet'
import { PRESETS, type Currency } from '@/lib/currency'
import type { PlanCadence } from '@/lib/goal-plan'

const IDEAS = ['Rent', 'Detty December', 'School fees', 'Emergency fund', 'New phone', 'Japa']
const DAY = 86_400_000

/** <input type="date"> speaks local calendar days; toISOString() would shift them to UTC. */
const toDateInput = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fromDateInput = (value: string) => {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function lockPresets(now: number) {
  const d = new Date(now)
  const dec1 = new Date(d.getFullYear() + (d.getMonth() === 11 ? 1 : 0), 11, 1).getTime()
  const midnight = (ms: number) => {
    const x = new Date(ms)
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  }
  return [
    { label: '1 month', at: midnight(now + 30 * DAY) },
    { label: '3 months', at: midnight(now + 91 * DAY) },
    { label: '6 months', at: midnight(now + 182 * DAY) },
    { label: '1 December', at: dec1 },
  ]
}

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`press h-11 rounded-full px-4 text-[15px] font-semibold transition-colors duration-150 ${selected ? 'bg-ink text-white' : 'bg-white text-ink shadow-soft'}`}
    >
      {children}
    </button>
  )
}

function Form() {
  const router = useRouter()
  const { earlyExitPolicy } = useWallet()
  const [now] = useState(() => Date.now())
  const presets = lockPresets(now)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<Currency>('NIM')
  const [target, setTarget] = useState('')
  const [locked, setLocked] = useState(true)
  const [unlockAt, setUnlockAt] = useState(presets[1].at)
  const [cadence, setCadence] = useState<PlanCadence | null>(null)
  const [planAmount, setPlanAmount] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targetNim = Number(target) || 0
  const planValue = Number(planAmount) || 0
  const per = cadence === 'monthly' ? 'month' : 'week'
  const days = Math.ceil((unlockAt - now) / DAY)

  async function create() {
    setCreating(true)
    setError(null)
    try {
      const { id } = await api<{ id: string }>('/api/goals', { body: { name: name.trim(), currency, target: targetNim || null, unlockAt: locked ? unlockAt : null, plan: cadence ? { cadence, amount: planValue } : null } })
      router.push(`/g/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }

  return (
    <Screen>
      <header className="flex items-center gap-3">
        <BackLink href="/" />
        <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tight">New goal</h1>
      </header>

      <section className="relative mt-6 overflow-hidden rounded-card bg-sky-soft p-5 shadow-soft">
        <Image src="/art/jar.webp" alt="" width={502} height={600} className="pointer-events-none absolute -right-2 top-2 w-[96px]" />
        <p className="text-sm font-semibold text-ink-2">Saving for</p>
        <p className="max-w-[68%] truncate font-display text-2xl font-extrabold tracking-tight">{name.trim() || 'Your goal'}</p>
        <p className="mt-3 font-display text-[36px] font-extrabold leading-none tracking-tight tabular-nums">{targetNim ? `${nim(targetNim)} ${currency}` : 'Any amount'}</p>
        {targetNim > 0 && (
          <p className="mt-1 text-[15px] text-ink-2">
            ≈ <Ngn amount={targetNim} currency={currency} />
          </p>
        )}
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-sm font-semibold">
          {locked ? <LockSimple size={15} weight="bold" /> : <LockSimpleOpen size={15} weight="bold" />}
          {locked ? `Locked until ${shortDate(unlockAt)} (${days} days)` : 'Take it out any time'}
        </p>
      </section>

      <div className="mt-7 flex flex-col gap-7">
        <section className="flex flex-col gap-2">
          <label htmlFor="goal-name" className="font-display text-lg font-bold tracking-tight">
            What are you saving for?
          </label>
          <input
            id="goal-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 32))}
            placeholder="Detty December"
            autoComplete="off"
            enterKeyHint="done"
            className="h-14 rounded-[var(--radius-inner)] bg-white px-4 font-semibold shadow-soft outline-none placeholder:font-normal placeholder:text-ink-2/70 focus:ring-2 focus:ring-coral"
          />
          <div className="flex flex-wrap gap-2">
            {IDEAS.map((idea) => (
              <Pill key={idea} selected={name === idea} onClick={() => setName(idea)}>
                {idea}
              </Pill>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <p className="font-display text-lg font-bold tracking-tight">Save in</p>
          <CurrencyPicker
            value={currency}
            onChange={(c) => {
              setCurrency(c)
              setTarget('')
              setPlanAmount('')
            }}
          />
        </section>

        <section className="flex flex-col gap-2">
          <label htmlFor="target" className="font-display text-lg font-bold tracking-tight">
            Target <span className="font-sans text-sm font-normal text-ink-2">(optional)</span>
          </label>
          <div className="flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
            <input
              id="target"
              inputMode="numeric"
              value={target}
              placeholder="0"
              onChange={(e) => setTarget(e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none placeholder:text-ink-2/40"
            />
            <span className="font-semibold text-ink-2">{currency}</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS[currency].target.map((t) => (
              <Pill key={t} selected={targetNim === t} onClick={() => setTarget(String(t))}>
                {nim(t)}
              </Pill>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <p className="font-display text-lg font-bold tracking-tight">
            Saving plan <span className="font-sans text-sm font-normal text-ink-2">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {([null, 'weekly', 'monthly'] as const).map((c) => (
              <Pill
                key={c ?? 'none'}
                selected={cadence === c}
                onClick={() => {
                  setCadence(c)
                  if (c && !planAmount) setPlanAmount(String(PRESETS[currency].deposit[1]))
                }}
              >
                {c === null ? 'No plan' : c === 'weekly' ? 'Every week' : 'Every month'}
              </Pill>
            ))}
          </div>
          {cadence && (
            <>
              <label htmlFor="plan-amount" className="sr-only">
                Amount each {per}
              </label>
              <div className="flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
                <input
                  id="plan-amount"
                  inputMode="numeric"
                  value={planAmount}
                  placeholder="0"
                  onChange={(e) => setPlanAmount(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none placeholder:text-ink-2/40"
                />
                <span className="font-semibold text-ink-2">{currency} a {per}</span>
              </div>
              <p className="text-sm text-ink-2">
                We remind you in Akilii when it is due.
                {targetNim > 0 && planValue > 0 ? ` About ${Math.ceil(targetNim / planValue)} ${per}s to reach ${nim(targetNim)} ${currency}.` : ''}
              </p>
            </>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <p className="font-display text-lg font-bold tracking-tight">Can you take it out early?</p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: true, icon: LockSimple, title: 'Lock it', body: earlyExitPolicy ? `Free to withdraw on your date. Break early for ${earlyExitPolicy.bps / 100}% of ${earlyExitPolicy.basis === 'principal' ? 'savings only' : 'savings + rewards'}.` : 'No withdrawals until the date. Future you will thank you.' },
                { id: false, icon: LockSimpleOpen, title: 'Flexible', body: 'Add or take out any time.' },
              ] as const
            ).map(({ id, icon: Icon, title, body }) => (
              <button
                key={title}
                type="button"
                aria-pressed={locked === id}
                onClick={() => setLocked(id)}
                className={`press rounded-[var(--radius-inner)] p-4 text-left transition-colors duration-150 ${locked === id ? 'bg-ink text-white' : 'bg-white shadow-soft'}`}
              >
                <Icon size={22} weight="bold" />
                <p className="mt-2 font-bold">{title}</p>
                <p className={`mt-0.5 text-sm leading-snug ${locked === id ? 'text-white/75' : 'text-ink-2'}`}>{body}</p>
              </button>
            ))}
          </div>
        </section>

        {locked && (
          <section className="flex flex-col gap-2">
            <p className="font-display text-lg font-bold tracking-tight">Unlock on</p>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <Pill key={p.label} selected={Math.abs(unlockAt - p.at) < DAY / 2} onClick={() => setUnlockAt(p.at)}>
                  {p.label}
                </Pill>
              ))}
            </div>
            <label htmlFor="unlock" className="sr-only">
              Pick a date
            </label>
            <input
              id="unlock"
              type="date"
              min={toDateInput(now + 2 * DAY)}
              value={toDateInput(unlockAt)}
              onChange={(e) => e.target.value && setUnlockAt(fromDateInput(e.target.value))}
              className="h-14 rounded-[var(--radius-inner)] bg-white px-4 font-semibold shadow-soft outline-none focus:ring-2 focus:ring-coral"
            />
          </section>
        )}
      </div>

      {error && <p className="mt-6 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}

      <BottomBar>
        <PrimaryButton onClick={create} disabled={!name.trim() || creating || (cadence !== null && planValue < 1)}>
          {creating ? 'Creating…' : name.trim() ? 'Start saving' : 'Name your goal'}
        </PrimaryButton>
      </BottomBar>
    </Screen>
  )
}

export function NewGoal() {
  return (
    <SignedIn>
      <Form />
    </SignedIn>
  )
}
