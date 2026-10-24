'use client'

import { ArrowRight, Check, Gift, PencilSimple, Play, ShieldCheck, Sparkle, X } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { SignedIn, Splash } from '@/components/gate'
import { Avatar, AvatarStack, BackLink, BottomBar, Chip, PrimaryButton, Screen, Sheet, nim, shortDate, useCountUp, useReducedMotion } from '@/components/ui'
import { Ngn, useApi, usePayment } from '@/components/wallet'
import type { CircleView } from '@/lib/circles'
import { EditCircleSheet, RemoveSheet, StartNowSheet } from './manage'

type Member = CircleView['members'][number]

// --- Pot ---------------------------------------------------------------------

function PotCard({ circle }: { circle: CircleView }) {
  const paid = circle.members.filter((m) => m.paid).length
  const total = circle.size * circle.contribution
  const inPot = useCountUp(paid * circle.contribution)
  const full = paid === circle.size
  const recipient = circle.members.find((m) => m.turn === circle.round)

  return (
    <section className="rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
      <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-6px)] bg-coral-soft px-5 pb-5 pt-5">
        <Image src="/art/pot.webp" alt="" width={710} height={800} priority className="pointer-events-none absolute -right-2 -top-2 w-[124px] select-none" />

        <p className="text-sm font-semibold text-coral-ink">In the pot this round</p>
        <p className="mt-1 font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">{nim(inPot)}</p>
        <p className="mt-1.5 text-[15px] text-ink-2">
          of {nim(total)} NIM ≈ <Ngn nim={total} />
        </p>

        <div className="mt-4 flex gap-1.5" aria-label={`${paid} of ${circle.size} paid`}>
          {circle.members.map((member, i) => (
            <span key={member.address} className="h-2.5 flex-1 overflow-hidden rounded-full bg-white">
              <span
                className="block h-full origin-left rounded-full bg-coral transition-transform duration-500 ease-[var(--ease-out)]"
                style={{ transform: `scaleX(${i < paid ? 1 : 0})`, transitionDelay: `${i * 60}ms` }}
              />
            </span>
          ))}
        </div>

        {recipient && (
          <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-inner)] bg-white p-2.5 pr-3">
            <Avatar avatar={recipient.avatar} size={44} className="ring-[3px] ring-sun" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{recipient.isYou ? 'Goes to you' : `Goes to ${recipient.name}`}</p>
              <p className="text-sm text-ink-2">{circle.roundDueAt ? shortDate(circle.roundDueAt) : 'When everyone is in'}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors duration-300 ${full ? 'bg-sun text-ink' : 'bg-sun-soft text-sun-ink'}`}>
              {full ? 'Pot is full' : `Round ${circle.round}`}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

// --- Rotation dial -----------------------------------------------------------

const DIAL = 272
const SEAT = 54
const RADIUS = 104

function RotationDial({ circle }: { circle: CircleView }) {
  const reduce = useReducedMotion()
  const step = 360 / circle.size
  const target = -(circle.round - 1) * step
  // Arrive from last round's position: the dial turning is what tells you the round moved on.
  const [rotation, setRotation] = useState(target + step)
  useEffect(() => {
    const id = requestAnimationFrame(() => setRotation(target))
    return () => cancelAnimationFrame(id)
  }, [target])

  const transition = reduce ? 'none' : 'transform 800ms var(--ease-in-out) 150ms'
  const you = circle.members.find((m) => m.isYou)
  const next = circle.members.find((m) => m.turn === circle.round + 1)

  return (
    <section className="rounded-card bg-white p-5 shadow-soft">
      <h2 className="font-display text-xl font-bold tracking-tight">Who takes the pot</h2>

      <div className="relative mx-auto mt-3" style={{ width: DIAL, height: DIAL }}>
        <svg className="absolute inset-0" viewBox={`0 0 ${DIAL} ${DIAL}`} aria-hidden>
          <circle cx={DIAL / 2} cy={DIAL / 2} r={RADIUS} fill="none" stroke="var(--color-line)" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
        </svg>

        {/* Fixed marker: the top seat is always "now". */}
        <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1 rounded-full bg-sun px-2.5 py-0.5 text-xs font-bold text-ink shadow-soft">Now</span>

        <div className="absolute inset-0" style={{ transform: `rotate(${rotation}deg)`, transition }}>
          {circle.members.map((member) => {
            const angle = ((member.turn - 1) * step - 90) * (Math.PI / 180)
            const x = DIAL / 2 + RADIUS * Math.cos(angle) - SEAT / 2
            const y = DIAL / 2 + RADIUS * Math.sin(angle) - SEAT / 2
            const done = member.turn < circle.round || member.tookPot
            const current = member.turn === circle.round && circle.status === 'active'
            return (
              <div key={member.address} className="absolute" style={{ left: x, top: y, width: SEAT, height: SEAT, transform: `rotate(${-rotation}deg)`, transition }}>
                <Avatar
                  avatar={member.avatar}
                  size={SEAT}
                  className={current ? 'shadow-lift ring-4 ring-sun' : member.isYou ? 'ring-[3px] ring-coral' : done ? 'ring-[3px] ring-mint' : 'opacity-60 ring-2 ring-lilac-soft'}
                />
                {done && (
                  <span className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-mint text-white ring-2 ring-white">
                    <Check size={11} weight="bold" />
                  </span>
                )}
                <span className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-xs font-semibold ${current ? 'text-ink' : 'text-ink-2'}`}>{member.name}</span>
              </div>
            )
          })}
        </div>

        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="font-display text-[44px] font-extrabold leading-none tabular-nums">{circle.round}</p>
            <p className="mt-1 text-sm text-ink-2">of {circle.size} rounds</p>
          </div>
        </div>
      </div>

      {you && you.turn > circle.round && (
        <p className="mt-6 rounded-[var(--radius-inner)] bg-sun-soft px-4 py-3 text-[15px] text-sun-ink">
          {next?.isYou ? <strong className="font-bold">You&apos;re up next. </strong> : <strong className="font-bold">Your turn: </strong>}
          Round {you.turn}
          {circle.yourTurnDueAt ? `, ${shortDate(circle.yourTurnDueAt)}` : ''}.
        </p>
      )}
    </section>
  )
}

// --- Earn & members ----------------------------------------------------------

function EarnCard({ earned }: { earned: number }) {
  const shown = useCountUp(earned, 1100)
  return (
    <section className="flex items-center gap-3 rounded-card bg-mint-soft p-4 pr-5">
      <Image src="/art/sprout.webp" alt="" width={342} height={400} className="w-[68px] shrink-0" />
      <div>
        <p className="flex items-center gap-1 font-display text-2xl font-extrabold tracking-tight text-mint-ink tabular-nums">
          +{nim(shown, 2)} NIM
          <Sparkle size={16} weight="fill" className="text-mint" />
        </p>
        <p className="mt-0.5 text-sm leading-snug text-mint-ink">
          {earned > 0 ? 'Earned by staking the pot while it waits. It goes out with each pot.' : 'The pot is staked while it waits. Earnings show up here and go out with each pot.'}
        </p>
      </div>
    </section>
  )
}

function MembersCard({ circle }: { circle: CircleView }) {
  const ordered = useMemo(() => [...circle.members].sort((a, b) => a.turn - b.turn), [circle.members])
  const paid = circle.members.filter((m) => m.paid).length
  return (
    <section className="rounded-card bg-white p-5 shadow-soft">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight">This round</h2>
        <p className="text-sm tabular-nums text-ink-2">
          {paid} of {circle.size} paid
        </p>
      </div>
      <ul className="mt-3 flex flex-col gap-3">
        {ordered.map((m: Member) => (
          <li key={m.address} className="flex items-center gap-3">
            <Avatar avatar={m.avatar} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{m.name}</p>
              <p className="text-sm text-ink-2">{m.tookPot ? `Took the pot in round ${m.turn}` : `Takes the pot in round ${m.turn}`}</p>
            </div>
            {m.paid ? (
              <Chip tone="mint">
                <Check size={13} weight="bold" /> Paid
              </Chip>
            ) : m.isYou ? (
              <Chip tone="coral">Not yet</Chip>
            ) : (
              <Chip tone="lilac">Waiting</Chip>
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

function ChipInSheet({ circle, open, onOpenChange, onPaid }: { circle: CircleView; open: boolean; onOpenChange: (o: boolean) => void; onPaid: () => void }) {
  const payment = usePayment()
  const recipient = circle.members.find((m) => m.turn === circle.round)

  async function approve() {
    if (!circle.memo) return
    const ok = await payment.run({ nim: circle.contribution, memo: circle.memo, confirmUrl: `/api/circles/${circle.id}/contribution` })
    if (ok) {
      onOpenChange(false)
      onPaid()
    }
  }

  const label = payment.state === 'approving' ? 'Approve in Nimiq Pay…' : payment.state === 'confirming' ? 'Confirming on Nimiq…' : 'Approve in Nimiq Pay'
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Chip in for round ${circle.round}`}
      description={recipient ? `The pot goes to ${recipient.isYou ? 'you' : recipient.name}${circle.roundDueAt ? ` on ${shortDate(circle.roundDueAt)}` : ''}.` : undefined}
    >
      <div className="rounded-card bg-white p-5 text-center shadow-soft">
        <p className="font-display text-[44px] font-extrabold leading-none tracking-tight tabular-nums">{nim(circle.contribution)}</p>
        <p className="mt-1 text-ink-2">NIM ≈ <Ngn nim={circle.contribution} /></p>
      </div>

      <div className="mt-3 divide-y divide-line rounded-card bg-white px-5 py-1 shadow-soft">
        <Row label="To">{circle.name} pot</Row>
        <Row label="Network fee">Free</Row>
        <Row label="Reference">
          <span className="font-mono text-sm">{circle.memo}</span>
        </Row>
      </div>

      <p className="mt-4 flex gap-2 text-sm leading-snug text-ink-2">
        <ShieldCheck size={20} weight="fill" className="shrink-0 text-mint" />
        Every contribution is a public Nimiq transaction with this reference, so anyone in the circle can check who paid.
      </p>

      {payment.error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{payment.error}</p>}

      <div className="mt-5">
        <PrimaryButton onClick={approve} disabled={payment.state !== 'idle'}>
          {label}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

// --- States ------------------------------------------------------------------

function Header({ circle }: { circle: CircleView }) {
  return (
    <header className="flex items-center gap-3">
      <BackLink href="/" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-2">
          {circle.localName} · {circle.cadence}
        </p>
        <h1 className="truncate font-display text-[28px] font-extrabold leading-none tracking-tight">{circle.name}</h1>
      </div>
      <Link href={`/c/${circle.id}/invite`} aria-label="Members and invite" className="press">
        <AvatarStack avatars={circle.members.map((m) => m.avatar)} />
      </Link>
    </header>
  )
}

function PayoutBanner({ circle }: { circle: CircleView }) {
  const p = circle.yourPayout
  if (!p || p.status !== 'claimable') return null
  return (
    <Link href={`/c/${circle.id}/payout`} className="press pop-in flex items-center gap-3 rounded-card bg-sun p-4 shadow-lift">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white/70">
        <Gift size={22} weight="fill" className="text-coral" />
      </span>
      <span className="flex-1">
        <span className="block font-display text-lg font-extrabold leading-tight">Your pot is ready</span>
        <span className="text-sm text-sun-ink">{nim(p.pot + p.bonus, 2)} NIM is waiting for you</span>
      </span>
      <ArrowRight size={20} weight="bold" />
    </Link>
  )
}

function Filling({ circle, onChange, reload }: { circle: CircleView; onChange: (c: CircleView) => void; reload: () => void }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const joined = circle.members.length
  const missing = circle.size - joined
  const you = circle.members.find((m) => m.isYou)

  return (
    <Screen>
      <Header circle={circle} />
      <section className="mt-6 rounded-card bg-lilac-soft p-6 text-center shadow-soft">
        <Image src="/art/invite.webp" alt="" width={567} height={600} className="mx-auto w-[120px]" />
        <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight">
          Waiting for {missing} more {missing === 1 ? 'person' : 'people'}
        </h2>
        <p className="mt-1 text-[15px] text-lilac-ink">Round 1 starts when every seat is taken. Nobody pays until then.</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-left">
          {[
            ['NIM a round', nim(circle.contribution)],
            ['How often', circle.cadence],
            ['NIM a pot', nim(circle.contribution * circle.size)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[var(--radius-inner)] bg-white p-3">
              <p className="text-xs font-semibold text-ink-2">{label}</p>
              <p className="truncate font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {circle.isCreator && (
        <div className={`mt-3 grid gap-2 ${joined >= 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <button onClick={() => setEditing(true)} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-white font-bold shadow-soft">
            <PencilSimple size={18} weight="bold" /> Edit circle
          </button>
          {joined >= 2 && (
            <button onClick={() => setStarting(true)} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-ink font-bold text-white shadow-soft">
              <Play size={16} weight="fill" /> Start with {joined}
            </button>
          )}
        </div>
      )}

      <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">Who&apos;s in</h2>
          <p className="text-sm tabular-nums text-ink-2">
            {joined} of {circle.size}
          </p>
        </div>
        <ul className="mt-3 flex flex-col gap-3">
          {circle.members.map((m) => (
            <li key={m.address} className="flex items-center gap-3">
              <Avatar avatar={m.avatar} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.name}</p>
                <p className="text-sm text-ink-2">{m.startedIt ? 'Started the circle' : `Turn ${m.turn}`}</p>
              </div>
              {circle.isCreator && !m.isYou && (
                <button onClick={() => setRemoving(m)} aria-label={`Remove ${m.name}`} className="press grid size-9 place-items-center rounded-full bg-blush text-ink-2">
                  <X size={16} weight="bold" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {!circle.isCreator && you && (
          <button onClick={() => setRemoving(you)} className="mt-4 text-sm font-semibold text-coral-ink underline decoration-2 underline-offset-4">
            Leave this circle
          </button>
        )}
      </section>

      <BottomBar>
        <PrimaryButton href={`/c/${circle.id}/invite`}>Invite people</PrimaryButton>
      </BottomBar>

      {circle.isCreator && (
        <>
          {/* key: reopen with the latest terms after a save or someone joining */}
          <EditCircleSheet key={`${circle.size}-${circle.contribution}-${joined}-${editing}`} circle={circle} open={editing} onOpenChange={setEditing} onSaved={onChange} />
          <StartNowSheet circle={circle} open={starting} onOpenChange={setStarting} onStarted={onChange} />
        </>
      )}
      <RemoveSheet
        circle={circle}
        member={removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        onDone={() => (removing?.isYou ? router.push('/') : reload())}
      />
    </Screen>
  )
}

function Done({ circle }: { circle: CircleView }) {
  return (
    <Screen>
      <Header circle={circle} />
      <div className="mt-6 flex flex-col gap-4">
        <PayoutBanner circle={circle} />
        <section className="rounded-card bg-mint-soft p-6 text-center shadow-soft">
          <Image src="/art/friends.webp" alt="" width={1200} height={714} className="mx-auto w-[85%]" />
          <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight text-mint-ink">Everyone took their turn</h2>
          <p className="mt-1 text-[15px] text-mint-ink">
            {circle.size} rounds, {nim(circle.size * circle.size * circle.contribution)} NIM saved together.
          </p>
        </section>
        <MembersCard circle={circle} />
      </div>
      <BottomBar>
        <PrimaryButton href="/new">Start another circle</PrimaryButton>
      </BottomBar>
    </Screen>
  )
}

function Active({ circle, reload }: { circle: CircleView; reload: () => void }) {
  const [sheet, setSheet] = useState(false)
  return (
    <Screen>
      <Header circle={circle} />
      <div className="mt-6 flex flex-col gap-4">
        <PayoutBanner circle={circle} />
        <PotCard circle={circle} />
        <RotationDial circle={circle} />
        <EarnCard earned={circle.earned} />
        <MembersCard circle={circle} />
      </div>

      <BottomBar>
        {circle.youPaid ? (
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

      <ChipInSheet circle={circle} open={sheet} onOpenChange={setSheet} onPaid={reload} />
    </Screen>
  )
}

function CircleLoader({ id }: { id: string }) {
  // Poll so other members' payments and the round turning show up without a refresh.
  const { data, error, reload, setData } = useApi<CircleView>(`/api/circles/${id}`, 10_000)
  if (error && !data) {
    return (
      <Screen bar={false}>
        <BackLink href="/" />
        <p className="mt-10 rounded-card bg-white p-6 text-center text-ink-2 shadow-soft">{error}</p>
      </Screen>
    )
  }
  if (!data) return <Splash />
  if (data.status === 'filling') return <Filling circle={data} onChange={setData} reload={reload} />
  if (data.status === 'done') return <Done circle={data} />
  return <Active circle={data} reload={reload} />
}

export function CircleScreen({ id }: { id: string }) {
  return (
    <SignedIn>
      <CircleLoader id={id} />
    </SignedIn>
  )
}
