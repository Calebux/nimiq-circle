'use client'

import { Bank as BankIcon, CaretRight, Check, CircleNotch, MagnifyingGlass, Sparkle, Wallet } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { BackLink, BottomBar, PrimaryButton, Screen, SecondaryButton, Sheet, naira, nim, useCountUp, useReducedMotion } from '@/components/ui'
import { BANKS, NGN_PER_NIM, type Bank, type Circle } from '@/lib/mock'

/** Your share of staking yield for this round (mock). Later turns earn more. */
const YIELD_BONUS = 12.8
/** Mock provider fee, matching the spike's mock off-ramp. */
const FEE_RATE = 0.01
const MIN_FEE_NGN = 50

// --- Confetti ----------------------------------------------------------------

const CONFETTI_COLOURS = ['var(--color-coral-bright)', 'var(--color-mint)', 'var(--color-sun)', 'var(--color-lilac)', '#8ec5ff']

/** Deterministic pieces so server and client render the same markup. */
function confettiPieces(count: number) {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: count }, (_, i) => {
    const angle = rand() * Math.PI * 2
    const distance = 110 + rand() * 120
    // Whole numbers: server and client Math.cos can differ in the last digits and break hydration.
    return {
      id: i,
      colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance - 40),
      r: Math.round((rand() - 0.5) * 540),
      w: Math.round(6 + rand() * 6),
      delay: Math.round(rand() * 120),
    }
  })
}

function Confetti() {
  const reduce = useReducedMotion()
  const pieces = useMemo(() => confettiPieces(28), [])
  if (reduce) return null
  return (
    // Own clipped layer: finished pieces keep their end transform, which would otherwise widen the page.
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-[24%]">
        {pieces.map((p) => (
          <span
            key={p.id}
            className="absolute block rounded-full"
            style={
              {
                width: p.w,
                height: p.w * 2.2,
                backgroundColor: p.colour,
                '--x': `${p.x}px`,
                '--y': `${p.y}px`,
                '--r': `${p.r}deg`,
                animation: `confetti 1400ms var(--ease-out) ${p.delay}ms both`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}

// --- Cash out ----------------------------------------------------------------

type CashStep = 'details' | 'banks' | 'sending'

function BankPicker({ onPick }: { onPick: (bank: Bank) => void }) {
  const [query, setQuery] = useState('')
  const results = BANKS.filter((b) => `${b.name} ${b.short}`.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div>
      <div className="flex h-12 items-center gap-2 rounded-full bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
        <MagnifyingGlass size={18} className="text-ink-2" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search banks"
          aria-label="Search banks"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-2/70"
        />
      </div>
      <ul className="mt-3 flex flex-col">
        {results.map((bank) => (
          <li key={bank.code}>
            <button
              type="button"
              onClick={() => onPick(bank)}
              className="press flex w-full items-center gap-3 rounded-[var(--radius-inner)] px-2 py-3 text-left"
            >
              <span className="grid size-10 place-items-center rounded-full bg-white font-display text-sm font-extrabold shadow-soft">
                {bank.short.slice(0, 2)}
              </span>
              <span className="flex-1 font-semibold">{bank.name}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-2 py-6 text-center text-ink-2">No bank called “{query}”</li>}
      </ul>
    </div>
  )
}

function CashOutSheet({
  open,
  onOpenChange,
  amountNim,
  onSent,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  amountNim: number
  onSent: (r: Receipt) => void
}) {
  const [step, setStep] = useState<CashStep>('details')
  const [bank, setBank] = useState<Bank>(BANKS[0])
  const [account, setAccount] = useState('')
  const [resolved, setResolved] = useState<string | null>(null)

  const gross = amountNim * NGN_PER_NIM
  const fee = Math.max(MIN_FEE_NGN, Math.round(gross * FEE_RATE))
  const out = Math.max(0, gross - fee)
  const resolving = account.length === 10 && !resolved

  // Look the name up as soon as the number is complete, like every Nigerian bank app does.
  useEffect(() => {
    if (account.length !== 10) return
    const id = setTimeout(() => setResolved('EMEKA C. NWOSU'), 700)
    return () => clearTimeout(id)
  }, [account, bank])

  function send() {
    setStep('sending')
    setTimeout(() => {
      onOpenChange(false)
      onSent({ ngn: out, bank, account, name: resolved ?? '' })
      setStep('details')
    }, 1300)
  }

  const title = step === 'banks' ? 'Choose a bank' : 'Cash out to bank'
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} description={step === 'banks' ? undefined : 'Naira lands in your account in about a minute.'}>
      {step === 'banks' ? (
        <BankPicker
          onPick={(b) => {
            setBank(b)
            setResolved(null)
            setStep('details')
          }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setStep('banks')}
              className="press flex h-14 items-center gap-3 rounded-[var(--radius-inner)] bg-white px-4 text-left shadow-soft"
            >
              <BankIcon size={22} weight="bold" className="text-ink-2" />
              <span className="flex-1 font-semibold">{bank.name}</span>
              <CaretRight size={18} weight="bold" className="text-ink-2" />
            </button>
            <label htmlFor="account" className="sr-only">
              Account number
            </label>
            <input
              id="account"
              inputMode="numeric"
              autoComplete="off"
              placeholder="10-digit account number"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value.replace(/\D/g, '').slice(0, 10))
                setResolved(null)
              }}
              className="h-14 rounded-[var(--radius-inner)] bg-white px-4 font-mono text-lg tracking-wider shadow-soft outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-ink-2/70 focus:ring-2 focus:ring-coral"
            />
            <div className="h-7 px-1 text-sm" aria-live="polite">
              {resolving && (
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <CircleNotch size={14} className="animate-spin" /> Checking account
                </span>
              )}
              {resolved && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-mint-ink">
                  <Check size={14} weight="bold" /> {resolved}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 rounded-card bg-white p-5 shadow-soft">
            <div className="flex justify-between text-[15px]">
              <span className="text-ink-2">You send</span>
              <span className="font-semibold tabular-nums">{nim(amountNim, 2)} NIM</span>
            </div>
            <div className="mt-2 flex justify-between text-[15px]">
              <span className="text-ink-2">Rate</span>
              <span className="font-semibold tabular-nums">1 NIM = ₦{NGN_PER_NIM.toFixed(2)}</span>
            </div>
            <div className="mt-2 flex justify-between text-[15px]">
              <span className="text-ink-2">Fee</span>
              <span className="font-semibold tabular-nums">{naira(fee)}</span>
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="font-semibold">You get</span>
              <span className="font-display text-3xl font-extrabold tracking-tight tabular-nums">{naira(out)}</span>
            </div>
          </div>

          <div className="mt-5">
            <PrimaryButton onClick={send} disabled={!resolved || step === 'sending'}>
              {step === 'sending' ? 'Sending…' : resolved ? `Send ${naira(out)}` : 'Enter account number'}
            </PrimaryButton>
          </div>
        </>
      )}
    </Sheet>
  )
}

// --- Receipt -----------------------------------------------------------------

interface Receipt {
  ngn: number
  bank: Bank
  account: string
  name: string
}

function CashedOut({ receipt, circle }: { receipt: Receipt; circle: Circle }) {
  const [landed, setLanded] = useState(false)
  // Mock provider settles after a few seconds; the real one is polled.
  useEffect(() => {
    const id = setTimeout(() => setLanded(true), 3500)
    return () => clearTimeout(id)
  }, [])

  const steps = [
    { label: 'Pot released to you', done: true },
    { label: 'Changed to naira', done: true },
    {
      label: `Sent to ${receipt.bank.short} ••${receipt.account.slice(-4)}`,
      done: landed,
    },
  ]

  return (
    <Screen>
      <div className="pop-in pt-6 text-center">
        <Image src="/art/phone.webp" alt="" width={439} height={600} priority className="mx-auto w-[150px]" />
        <h1 className="mt-5 font-display text-[34px] font-extrabold leading-tight tracking-tight">{landed ? 'Money landed' : 'On its way'}</h1>
        <p className="mt-1 font-display text-[44px] font-extrabold leading-none tracking-tight tabular-nums text-coral-ink">{naira(receipt.ngn)}</p>
        <p className="mt-2 text-ink-2">
          to {receipt.name}, {receipt.bank.short}
        </p>
      </div>

      <ol className="mt-8 rounded-card bg-white p-5 shadow-soft">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3 py-2">
            <span
              className={`grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-300 ${s.done ? 'bg-mint text-white' : 'bg-lilac-soft text-lilac-ink'}`}
            >
              {s.done ? <Check size={14} weight="bold" /> : <CircleNotch size={14} weight="bold" className="animate-spin" />}
            </span>
            <span className={`flex-1 ${s.done ? 'font-semibold' : 'text-ink-2'}`}>{s.label}</span>
            {i === steps.length - 1 && !s.done && <span className="text-sm text-ink-2">about a minute</span>}
          </li>
        ))}
      </ol>

      <BottomBar>
        <PrimaryButton href="/circle">Back to {circle.name}</PrimaryButton>
      </BottomBar>
    </Screen>
  )
}

// --- Page --------------------------------------------------------------------

export function Payout({ circle }: { circle: Circle }) {
  const pot = circle.members.length * circle.contribution
  const total = pot + YIELD_BONUS
  const shown = useCountUp(total, 1400)
  const [sheet, setSheet] = useState(false)
  const [kept, setKept] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)

  if (receipt) return <CashedOut receipt={receipt} circle={circle} />

  return (
    <Screen bar={kept ? true : 'tall'}>
      <header className="flex items-center gap-3">
        <BackLink href="/circle" />
        <p className="text-sm text-ink-2">
          {circle.name} · round 4 of {circle.members.length}
        </p>
      </header>

      <div className="relative mt-4 text-center">
        <Confetti />
        <div className="pop-in">
          <Image src="/art/payout.webp" alt="" width={714} height={800} priority className="mx-auto w-[220px]" />
        </div>
        <h1 className="mt-4 font-display text-[36px] font-extrabold leading-tight tracking-tight">It&apos;s your turn!</h1>
        <p className="mt-1 text-ink-2">Everyone chipped in. The whole pot is yours.</p>
      </div>

      <section className="mt-6 rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
        <div className="rounded-[calc(var(--radius-card)-6px)] bg-sun-soft p-5 text-center">
          <p className="font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">{nim(shown, 2)}</p>
          <p className="mt-1.5 text-[15px] text-sun-ink">NIM ≈ {naira(total * NGN_PER_NIM)}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold">Pot {nim(pot)}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-mint-soft px-3 py-1 text-sm font-semibold text-mint-ink">
              <Sparkle size={13} weight="fill" /> +{nim(YIELD_BONUS, 2)} staking bonus
            </span>
          </div>
        </div>
      </section>

      {kept && (
        <p className="pop-in mt-4 flex items-center justify-center gap-2 rounded-full bg-mint-soft px-4 py-3 font-semibold text-mint-ink">
          <Wallet size={18} weight="bold" /> {nim(total, 2)} NIM is in your Nimiq Pay wallet
        </p>
      )}

      <BottomBar>
        {kept ? (
          <PrimaryButton href="/circle">Back to {circle.name}</PrimaryButton>
        ) : (
          <>
            <PrimaryButton onClick={() => setSheet(true)}>Cash out to bank</PrimaryButton>
            <SecondaryButton onClick={() => setKept(true)}>Keep it in Nimiq Pay</SecondaryButton>
          </>
        )}
      </BottomBar>

      <CashOutSheet open={sheet} onOpenChange={setSheet} amountNim={total} onSent={setReceipt} />
    </Screen>
  )
}
