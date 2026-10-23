'use client'

import { ArrowRight, Check, ShieldCheck, Sparkle } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Avatar, AvatarStack, BackLink, BottomBar, Chip, PrimaryButton, Screen, Sheet, naira, nim, useCountUp, useReducedMotion } from '@/components/ui'
import { NGN_PER_NIM, type Circle, type Member } from '@/lib/mock'

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
        <p className="mt-1 font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">{nim(inPot)}</p>
        <p className="mt-1.5 text-[15px] text-ink-2">
          of {nim(total)} NIM ≈ {naira(total * NGN_PER_NIM)}
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
            const isYou = member.id === 'me'
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
                      ? 'shadow-lift ring-4 ring-sun'
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
        <div className="mt-6 rounded-[var(--radius-inner)] bg-sun-soft px-4 py-3 text-[15px] text-sun-ink">
          {next.id === 'me' ? (
            <>
              <p>
                <strong className="font-bold">You&apos;re up next.</strong> Round {next.turn}, {circle.nextPayoutDate}.
              </p>
              <Link href="/circle/payout" className="mt-1 inline-flex items-center gap-1 font-bold underline decoration-2 underline-offset-4">
                Preview your payout <ArrowRight size={14} weight="bold" />
              </Link>
            </>
          ) : (
            <p>
              <strong className="font-bold">{next.name}</strong> is up next.
            </p>
          )}
        </div>
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
        <p className="mt-0.5 text-sm leading-snug text-mint-ink">Earned by staking the pot while it waits. Later turns get a little more.</p>
      </div>
    </section>
  )
}

// --- Members -----------------------------------------------------------------

function MembersCard({ members, paid }: { members: Member[]; paid: number }) {
  const ordered = useMemo(() => [...members].sort((a, b) => a.turn - b.turn), [members])
  return (
    <section className="rounded-card bg-white p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight">This round</h2>
        <p className="text-sm tabular-nums text-ink-2">
          {paid} of {members.length} paid
        </p>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {ordered.map((member) => (
          <li key={member.id} className="flex items-center gap-3">
            <Avatar member={member} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{member.name}</p>
              <p className="text-sm text-ink-2">Takes the pot in round {member.turn}</p>
            </div>
            {member.status === 'paid' ? (
              <Chip tone="mint">
                <Check size={13} weight="bold" /> Paid
              </Chip>
            ) : member.status === 'waiting' ? (
              <Chip tone="lilac">Waiting</Chip>
            ) : (
              <Chip tone="coral">Not yet</Chip>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// --- Chip in -----------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  )
}

function ChipInSheet({
  circle,
  open,
  onOpenChange,
  onPaid,
}: {
  circle: Circle
  open: boolean
  onOpenChange: (open: boolean) => void
  onPaid: () => void
}) {
  const [waiting, setWaiting] = useState(false)
  const recipient = circle.members.find((m) => m.turn === circle.round)

  function approve() {
    setWaiting(true)
    // Stand-in for Nimiq Pay's approval sheet and the memo-tagged payment proven in the spike.
    setTimeout(() => {
      setWaiting(false)
      onOpenChange(false)
      onPaid()
    }, 1200)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Chip in for round ${circle.round}`}
      description={`The pot goes to ${recipient?.name} on ${circle.payoutDate}.`}
    >
      <div className="rounded-card bg-white p-5 text-center shadow-soft">
        <p className="font-display text-[44px] font-extrabold leading-none tracking-tight tabular-nums">{nim(circle.contribution)}</p>
        <p className="mt-1 text-ink-2">NIM ≈ {naira(circle.contribution * NGN_PER_NIM)}</p>
      </div>

      <div className="mt-3 divide-y divide-line rounded-card bg-white px-5 py-1 shadow-soft">
        <Row label="To">{circle.name} pot</Row>
        <Row label="Network fee">Free</Row>
        <Row label="Reference">
          <span className="font-mono text-sm">
            circle:{circle.id.slice(0, 8)}:r{circle.round}
          </span>
        </Row>
      </div>

      <p className="mt-4 flex gap-2 text-sm leading-snug text-ink-2">
        <ShieldCheck size={20} weight="fill" className="shrink-0 text-mint" />
        Every contribution is a public Nimiq transaction with this reference, so anyone in the circle can check who paid.
      </p>

      <div className="mt-5">
        <PrimaryButton onClick={approve} disabled={waiting}>
          {waiting ? 'Waiting for Nimiq Pay…' : 'Approve in Nimiq Pay'}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

// --- Page --------------------------------------------------------------------

export function CircleHome({ circle: initial }: { circle: Circle }) {
  const [circle, setCircle] = useState(initial)
  const [sheet, setSheet] = useState(false)
  const paid = circle.members.filter((m) => m.status === 'paid').length
  const recipient = circle.members.find((m) => m.turn === circle.round) ?? circle.members[0]
  const youPaid = circle.members.find((m) => m.id === 'me')?.status === 'paid'

  return (
    <Screen>
      <header className="flex items-center gap-3">
        <BackLink href="/" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-2">
            {circle.localName} · {circle.cadence}
          </p>
          <h1 className="truncate font-display text-[28px] font-extrabold leading-none tracking-tight">{circle.name}</h1>
        </div>
        <Link href="/circle/invite" aria-label="Members and invite link" className="press">
          <AvatarStack members={circle.members} />
        </Link>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        <PotCard circle={circle} paid={paid} recipient={recipient} />
        <RotationDial circle={circle} />
        <EarnCard circle={circle} />
        <MembersCard members={circle.members} paid={paid} />
      </div>

      <BottomBar>
        {youPaid ? (
          <div className="flex h-14 items-center justify-center gap-2 rounded-full bg-mint-soft font-bold text-mint-ink">
            <span className="grid size-6 place-items-center rounded-full bg-mint text-white">
              <Check size={14} weight="bold" />
            </span>
            You&apos;re in for round {circle.round}
          </div>
        ) : (
          <PrimaryButton onClick={() => setSheet(true)}>Chip in {nim(circle.contribution)} NIM</PrimaryButton>
        )}
      </BottomBar>

      <ChipInSheet
        circle={circle}
        open={sheet}
        onOpenChange={setSheet}
        onPaid={() => setCircle((c) => ({ ...c, members: c.members.map((m) => (m.id === 'me' ? { ...m, status: 'paid' } : m)) }))}
      />
    </Screen>
  )
}
