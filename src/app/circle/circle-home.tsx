'use client'

import { ArrowRight, CaretLeft, Check, Sparkle } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Circle, Member } from './data'

const nim = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

// Pastel seat colours, matched to each avatar's shirt.
const SEAT_BG: Record<string, string> = {
  tolu: 'bg-coral-soft',
  baraka: 'bg-mint-soft',
  vale: 'bg-sun-soft',
  me: 'bg-sky-soft',
  arjun: 'bg-lilac-soft',
  shanice: 'bg-sky-soft',
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )
}

/** Counts from the shown value to `target`. First view and real changes only, never on a loop. */
function useCountUp(target: number, duration = 900) {
  const reduce = useReducedMotion()
  const [value, setValue] = useState(0)
  const shown = useRef(0)
  useEffect(() => {
    const from = shown.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / duration)
      shown.current = from + (target - from) * (1 - Math.pow(1 - t, 3))
      setValue(shown.current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, reduce])
  return value
}

function Avatar({ member, size, className = '' }: { member: Member; size: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-end justify-center overflow-hidden rounded-full ${SEAT_BG[member.id] ?? 'bg-sky-soft'} ${className}`}
      style={{ width: size, height: size }}
    >
      <Image src={member.avatar} alt="" width={size} height={size} className="translate-y-[5%] scale-[0.94]" />
    </span>
  )
}

// --- Pot ---------------------------------------------------------------------

function PotCard({ circle, paid, recipient }: { circle: Circle; paid: number; recipient: Member }) {
  const total = circle.members.length * circle.contribution
  const inPot = useCountUp(paid * circle.contribution)
  const full = paid === circle.members.length

  return (
    <section className="rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
      <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-6px)] bg-coral-soft px-5 pb-5 pt-5">
        <Image
          src="/art/pot.webp"
          alt=""
          width={710}
          height={800}
          priority
          className="pointer-events-none absolute -right-2 -top-2 w-[124px] select-none"
        />

        <p className="text-sm font-semibold text-coral-ink">In the pot this round</p>
        <p className="mt-1 font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">
          {nim(inPot)}
        </p>
        <p className="mt-1.5 text-[15px] text-ink-2">
          of {nim(total)} NIM <span className="text-ink-2/80">≈ ₦{nim(total * circle.ngnPerNim)}</span>
        </p>

        <div className="mt-4 flex gap-1.5" aria-label={`${paid} of ${circle.members.length} paid`}>
          {circle.members.map((member, i) => (
            <span key={member.id} className="h-2.5 flex-1 overflow-hidden rounded-full bg-white">
              <span
                className="block h-full origin-left rounded-full bg-coral transition-transform duration-500 ease-[var(--ease-out)]"
                style={{ transform: `scaleX(${i < paid ? 1 : 0})`, transitionDelay: `${i * 60}ms` }}
              />
            </span>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-inner)] bg-white p-2.5 pr-3">
          <Avatar member={recipient} size={44} className="ring-[3px] ring-sun" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">Goes to {recipient.name}</p>
            <p className="text-sm text-ink-2">{circle.payoutDate}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-300 ${full ? 'bg-sun text-ink' : 'bg-sun-soft text-sun-ink'}`}
          >
            {full ? 'Pot is full' : `Round ${circle.round}`}
          </span>
        </div>
      </div>
    </section>
  )
}

// --- Rotation dial -----------------------------------------------------------

const DIAL = 272
const SEAT = 54
const RADIUS = 104

function RotationDial({ circle }: { circle: Circle }) {
  const reduce = useReducedMotion()
  const step = 360 / circle.members.length
  const target = -(circle.round - 1) * step
  // Arrive from last round's position: the dial turning is what tells you the round moved on.
  const [rotation, setRotation] = useState(target + step)
  useEffect(() => {
    const id = requestAnimationFrame(() => setRotation(target))
    return () => cancelAnimationFrame(id)
  }, [target])

  const next = circle.members.find((m) => m.turn === circle.round + 1)
  const transition = reduce ? 'none' : 'transform 800ms var(--ease-in-out) 150ms'

  return (
    <section className="rounded-card bg-white p-5 shadow-soft">
      <h2 className="font-display text-xl font-bold tracking-tight">Who takes the pot</h2>

      <div className="relative mx-auto mt-3" style={{ width: DIAL, height: DIAL }}>
        <svg className="absolute inset-0" viewBox={`0 0 ${DIAL} ${DIAL}`} aria-hidden>
          <circle cx={DIAL / 2} cy={DIAL / 2} r={RADIUS} fill="none" stroke="var(--color-line)" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
        </svg>

        {/* Fixed marker: the top seat is always "now". */}
        <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1 rounded-full bg-sun px-2.5 py-0.5 text-xs font-bold text-ink shadow-soft">
          Now
        </span>

        <div className="absolute inset-0" style={{ transform: `rotate(${rotation}deg)`, transition }}>
          {circle.members.map((member) => {
            const angle = ((member.turn - 1) * step - 90) * (Math.PI / 180)
            const x = DIAL / 2 + RADIUS * Math.cos(angle) - SEAT / 2
            const y = DIAL / 2 + RADIUS * Math.sin(angle) - SEAT / 2
            const done = member.turn < circle.round
            const current = member.turn === circle.round
            const isYou = member.status === 'you' || member.id === 'me'
            return (
              <div
                key={member.id}
                className="absolute"
                style={{ left: x, top: y, width: SEAT, height: SEAT, transform: `rotate(${-rotation}deg)`, transition }}
              >
                <Avatar
                  member={member}
                  size={SEAT}
                  className={
                    current
                      ? 'ring-4 ring-sun shadow-lift'
                      : isYou
                        ? 'ring-[3px] ring-coral'
                        : done
                          ? 'ring-[3px] ring-mint'
                          : 'opacity-60 ring-2 ring-lilac-soft'
                  }
                />
                {done && (
                  <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-mint text-white ring-2 ring-white">
                    <Check size={11} weight="bold" />
                  </span>
                )}
                <span className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-xs font-semibold ${current ? 'text-ink' : 'text-ink-2'}`}>
                  {member.name}
                </span>
              </div>
            )
          })}
        </div>

        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="font-display text-[44px] font-extrabold leading-none tabular-nums">{circle.round}</p>
            <p className="mt-1 text-sm text-ink-2">of {circle.members.length} rounds</p>
          </div>
        </div>
      </div>

      {next && (
        <p className="mt-6 rounded-[var(--radius-inner)] bg-sun-soft px-4 py-3 text-[15px] text-sun-ink">
          {next.id === 'me' ? (
            <>
              <strong className="font-bold">You&apos;re up next.</strong> Round {next.turn}, Sun 2 Nov.
            </>
          ) : (
            <>
              <strong className="font-bold">{next.name}</strong> is up next.
            </>
          )}
        </p>
      )}
    </section>
  )
}

// --- Earn --------------------------------------------------------------------

function EarnCard({ circle }: { circle: Circle }) {
  const earned = useCountUp(circle.earned, 1100)
  return (
    <section className="flex items-center gap-3 rounded-card bg-mint-soft p-4 pr-5">
      <Image src="/art/sprout.webp" alt="" width={342} height={400} className="w-[68px] shrink-0" />
      <div>
        <p className="flex items-center gap-1 font-display text-2xl font-extrabold tracking-tight text-mint-ink tabular-nums">
          +{nim(earned, 2)} NIM
          <Sparkle size={16} weight="fill" className="text-mint" />
        </p>
        <p className="mt-0.5 text-sm leading-snug text-mint-ink">
          Earned by staking the pot while it waits. Later turns get a little more.
        </p>
      </div>
    </section>
  )
}

// --- Members -----------------------------------------------------------------

const STATUS = {
  paid: { label: 'Paid', className: 'bg-mint-soft text-mint-ink' },
  waiting: { label: 'Waiting', className: 'bg-lilac-soft text-lilac-ink' },
  you: { label: 'Not yet', className: 'bg-coral-soft text-coral-ink' },
} as const

function MembersCard({ members, paid }: { members: Member[]; paid: number }) {
  const ordered = useMemo(() => [...members].sort((a, b) => a.turn - b.turn), [members])
  return (
    <section className="rounded-card bg-white p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight">This round</h2>
        <p className="text-sm text-ink-2 tabular-nums">
          {paid} of {members.length} paid
        </p>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {ordered.map((member) => {
          const status = STATUS[member.status]
          return (
            <li key={member.id} className="flex items-center gap-3">
              <Avatar member={member} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{member.name}</p>
                <p className="text-sm text-ink-2">Takes the pot in round {member.turn}</p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-300 ${status.className}`}>
                {member.status === 'paid' && <Check size={13} weight="bold" />}
                {status.label}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// --- Page --------------------------------------------------------------------

type PayState = 'idle' | 'waiting' | 'done'

export function CircleHome({ circle: initial }: { circle: Circle }) {
  const [circle, setCircle] = useState(initial)
  const [pay, setPay] = useState<PayState>('idle')
  const paid = circle.members.filter((m) => m.status === 'paid').length
  const recipient = circle.members.find((m) => m.turn === circle.round) ?? circle.members[0]
  const me = circle.members.find((m) => m.id === 'me')

  function chipIn() {
    if (pay !== 'idle') return
    setPay('waiting')
    // Stand-in for Nimiq Pay's approval sheet and the memo-tagged payment from the spike.
    setTimeout(() => {
      setCircle((c) => ({ ...c, members: c.members.map((m) => (m.id === 'me' ? { ...m, status: 'paid' } : m)) }))
      setPay('done')
    }, 1100)
  }

  return (
    <main className="mx-auto w-full max-w-[440px] px-4 pb-[calc(120px+env(safe-area-inset-bottom,0px))] pt-[calc(14px+env(safe-area-inset-top,0px))]">
      <header className="flex items-center gap-3">
        <button aria-label="Back" className="press grid size-11 shrink-0 place-items-center rounded-full bg-white shadow-soft">
          <CaretLeft size={20} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-2">
            {circle.localName} · {circle.cadence}
          </p>
          <h1 className="truncate font-display text-[28px] font-extrabold leading-none tracking-tight">{circle.name}</h1>
        </div>
        <div className="flex -space-x-2.5">
          {circle.members.slice(0, 3).map((m) => (
            <Avatar key={m.id} member={m} size={30} className="ring-2 ring-blush" />
          ))}
          <span className="grid size-[30px] place-items-center rounded-full bg-white text-xs font-bold text-ink-2 ring-2 ring-blush">
            +{circle.members.length - 3}
          </span>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        <PotCard circle={circle} paid={paid} recipient={recipient} />
        <RotationDial circle={circle} />
        <EarnCard circle={circle} />
        <MembersCard members={circle.members} paid={paid} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-blush/85 px-4 pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-xl">
        <div className="mx-auto max-w-[408px]">
          {pay === 'done' ? (
            <div className="flex h-14 items-center justify-center gap-2 rounded-full bg-mint-soft font-bold text-mint-ink">
              <span className="grid size-6 place-items-center rounded-full bg-mint text-white">
                <Check size={14} weight="bold" />
              </span>
              You&apos;re in for round {circle.round}
            </div>
          ) : (
            <button
              onClick={chipIn}
              disabled={pay === 'waiting' || !me}
              className="press group flex h-14 w-full items-center justify-between rounded-full bg-coral pl-6 pr-2 text-[17px] font-bold text-white shadow-lift disabled:opacity-80"
            >
              {pay === 'waiting' ? 'Waiting for Nimiq Pay…' : `Chip in ${nim(circle.contribution)} NIM`}
              <span className="grid size-10 place-items-center rounded-full bg-white/20 transition-transform duration-200 ease-[var(--ease-out)] group-active:translate-x-0.5">
                <ArrowRight size={18} weight="bold" />
              </span>
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
