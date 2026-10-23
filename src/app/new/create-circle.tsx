'use client'

import { Minus, Plus, Shuffle, UsersThree } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BackLink, BottomBar, PrimaryButton, Screen, naira, nim, useCountUp } from '@/components/ui'
import { CADENCES, LOCAL_NAMES, NGN_PER_NIM } from '@/lib/mock'

const PRESETS = [1000, 2500, 5000, 10000]
const MIN_PEOPLE = 3
const MAX_PEOPLE = 12

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="font-display text-lg font-bold tracking-tight">
        {label}
      </label>
      {children}
      {hint && <p className="text-sm text-ink-2">{hint}</p>}
    </section>
  )
}

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`press h-11 rounded-full px-4 text-[15px] font-semibold transition-colors duration-150 ${
        selected ? 'bg-ink text-white' : 'bg-white text-ink shadow-soft'
      }`}
    >
      {children}
    </button>
  )
}

export function CreateCircle() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [localName, setLocalName] = useState<string>('Ajo')
  const [amount, setAmount] = useState('2500')
  const [cadence, setCadence] = useState<string>('Weekly')
  const [people, setPeople] = useState(6)
  const [order, setOrder] = useState<'join' | 'shuffle'>('join')

  const contribution = Number(amount) || 0
  const pot = useCountUp(contribution * people, 400)
  const unit = cadence === 'Monthly' ? 'month' : cadence === 'Weekly' ? 'week' : 'fortnight'
  const ready = name.trim().length > 0 && contribution > 0

  function create() {
    const params = new URLSearchParams({ name: name.trim(), local: localName, amount: String(contribution), people: String(people) })
    router.push(`/circle/invite?${params}`)
  }

  return (
    <Screen>
      <header className="flex items-center gap-3">
        <BackLink href="/" />
        <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tight">New circle</h1>
      </header>

      {/* Live preview: what everyone will see. */}
      <section className="relative mt-6 overflow-hidden rounded-card bg-coral-soft p-5 shadow-soft">
        <Image src="/art/pot.webp" alt="" width={710} height={800} className="pointer-events-none absolute -right-3 -top-1 w-[104px]" />
        <p className="text-sm font-semibold text-coral-ink">{localName}</p>
        <p className="max-w-[70%] truncate font-display text-2xl font-extrabold tracking-tight">{name.trim() || 'Your circle'}</p>
        <p className="mt-3 font-display text-[40px] font-extrabold leading-none tracking-tight tabular-nums">{nim(pot)}</p>
        <p className="mt-1 text-[15px] text-ink-2">
          NIM pot each {unit} ≈ {naira(contribution * people * NGN_PER_NIM)}
        </p>
        <p className="mt-3 rounded-[var(--radius-inner)] bg-white/80 px-3 py-2 text-sm">
          {people} people chip in {nim(contribution)} NIM. Everyone takes the pot once, over {people} {unit}s.
        </p>
      </section>

      <div className="mt-7 flex flex-col gap-7">
        <Field label="Name it" htmlFor="name">
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 32))}
            placeholder="Sunday Jollof"
            autoComplete="off"
            enterKeyHint="done"
            className="h-14 rounded-[var(--radius-inner)] bg-white px-4 font-semibold shadow-soft outline-none placeholder:font-normal placeholder:text-ink-2/70 focus:ring-2 focus:ring-coral"
          />
        </Field>

        <Field label="What do you call it?" hint="Same idea everywhere, different names. Your circle sees the one you pick.">
          <div className="flex flex-wrap gap-2">
            {LOCAL_NAMES.map((n) => (
              <Pill key={n} selected={localName === n} onClick={() => setLocalName(n)}>
                {n}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="Each person chips in" htmlFor="amount">
          <div className="flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
            <input
              id="amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 7))}
              className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none"
            />
            <span className="font-semibold text-ink-2">NIM</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <Pill key={p} selected={contribution === p} onClick={() => setAmount(String(p))}>
                {nim(p)}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="How often">
          <div className="flex flex-wrap gap-2">
            {CADENCES.map((c) => (
              <Pill key={c} selected={cadence === c} onClick={() => setCadence(c)}>
                {c}
              </Pill>
            ))}
          </div>
        </Field>

        <Field label="How many people">
          <div className="flex items-center justify-between rounded-[var(--radius-inner)] bg-white p-2 shadow-soft">
            <button
              type="button"
              aria-label="Fewer people"
              disabled={people <= MIN_PEOPLE}
              onClick={() => setPeople((n) => n - 1)}
              className="press grid size-12 place-items-center rounded-full bg-blush disabled:opacity-40"
            >
              <Minus size={20} weight="bold" />
            </button>
            <p className="font-display text-3xl font-extrabold tabular-nums" aria-live="polite">
              {people}
            </p>
            <button
              type="button"
              aria-label="More people"
              disabled={people >= MAX_PEOPLE}
              onClick={() => setPeople((n) => n + 1)}
              className="press grid size-12 place-items-center rounded-full bg-blush disabled:opacity-40"
            >
              <Plus size={20} weight="bold" />
            </button>
          </div>
        </Field>

        <Field label="Who goes first">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'join', icon: UsersThree, title: 'Join order', body: 'First to join takes the first pot.' },
                { id: 'shuffle', icon: Shuffle, title: 'Shuffle', body: 'Random order once everyone is in.' },
              ] as const
            ).map(({ id, icon: Icon, title, body }) => (
              <button
                key={id}
                type="button"
                aria-pressed={order === id}
                onClick={() => setOrder(id)}
                className={`press rounded-[var(--radius-inner)] p-4 text-left transition-colors duration-150 ${
                  order === id ? 'bg-ink text-white' : 'bg-white shadow-soft'
                }`}
              >
                <Icon size={22} weight="bold" />
                <p className="mt-2 font-bold">{title}</p>
                <p className={`mt-0.5 text-sm leading-snug ${order === id ? 'text-white/75' : 'text-ink-2'}`}>{body}</p>
              </button>
            ))}
          </div>
        </Field>
      </div>

      <BottomBar>
        <PrimaryButton onClick={create} disabled={!ready}>
          {ready ? 'Create and invite' : 'Name your circle'}
        </PrimaryButton>
      </BottomBar>
    </Screen>
  )
}
