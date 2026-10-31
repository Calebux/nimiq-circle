'use client'

import { Sparkle } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useState } from 'react'
import { CashOutSheet, Sent, type BankChoice } from '@/components/cashout'
import { Confetti } from '@/components/confetti'
import { SignedIn, Splash } from '@/components/gate'
import { BackLink, BottomBar, PrimaryButton, Screen, SecondaryButton, nim, useCountUp } from '@/components/ui'
import { Ngn, api, payoutTarget, useApi } from '@/components/wallet'
import type { CircleView, PublicPayout } from '@/lib/circles'

function Celebrate({ circle, payout, onClaimed }: { circle: CircleView; payout: PublicPayout; onClaimed: (p: PublicPayout) => void }) {
  const total = payout.pot + payout.bonus
  const shown = useCountUp(total, 1400)
  const [sheet, setSheet] = useState(false)
  const [keeping, setKeeping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function keep() {
    setKeeping(true)
    setError(null)
    try {
      onClaimed(await api<PublicPayout>(`/api/payouts/${payout.id}`, { body: { method: 'wallet', ...(await payoutTarget(payout.currency)) } }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setKeeping(false)
    }
  }

  async function cashOut(bank: BankChoice) {
    onClaimed(await api<PublicPayout>(`/api/payouts/${payout.id}`, { body: { method: 'bank', bank } }))
  }

  return (
    <Screen bar="tall">
      <header className="flex items-center gap-3">
        <BackLink href={`/c/${circle.id}`} />
        <p className="text-sm text-ink-2">
          {circle.name} · round {payout.round} of {circle.size}
        </p>
      </header>

      <div className="relative mt-4 text-center">
        <Confetti />
        <div className="pop-in">
          <Image src="/art/payout.webp" alt="" width={714} height={800} priority className="mx-auto w-[220px]" />
        </div>
        <h1 className="mt-4 font-display text-[36px] font-extrabold leading-tight tracking-tight">{payout.kind === 'late' ? 'Late money is here' : 'It’s your turn!'}</h1>
        <p className="mt-1 text-ink-2">
          {payout.kind === 'late'
            ? `${payout.fromName} paid what they owed for round ${payout.round}.`
            : payout.pot < circle.contribution * circle.size
              ? 'Not everyone paid in time. Here is what came in; the rest comes to you when they pay.'
              : 'Everyone chipped in. The whole pot is yours.'}
        </p>
      </div>

      <section className="mt-6 rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
        <div className="rounded-[calc(var(--radius-card)-6px)] bg-sun-soft p-5 text-center">
          <p className="font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">{nim(shown, 2)}</p>
          <p className="mt-1.5 text-[15px] text-sun-ink">
            {payout.currency} ≈ <Ngn amount={total} currency={payout.currency} />
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold">Pot {nim(payout.pot)}</span>
            {payout.bonus > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-mint-soft px-3 py-1 text-sm font-semibold text-mint-ink">
                <Sparkle size={13} weight="fill" /> +{nim(payout.bonus, 2)} staking bonus
              </span>
            )}
          </div>
        </div>
      </section>

      {error && <p className="mt-4 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}

      <BottomBar>
        <PrimaryButton onClick={() => setSheet(true)} disabled={keeping}>
          Cash out to bank
        </PrimaryButton>
        <SecondaryButton onClick={keep} disabled={keeping}>
          {keeping ? 'Sending to your wallet…' : 'Keep it in Nimiq Pay'}
        </SecondaryButton>
      </BottomBar>

      <CashOutSheet open={sheet} onOpenChange={setSheet} amount={total} currency={payout.currency} onConfirm={cashOut} practice={circle.practice} />
    </Screen>
  )
}

function Claimed({ circle, payout }: { circle: CircleView; payout: PublicPayout }) {
  // Poll the provider until the naira lands.
  const { data } = useApi<PublicPayout>(`/api/payouts/${payout.id}`, payout.status === 'cashing' ? 3000 : false)
  const p = data ?? payout
  return (
    <Sent
      method={p.method ?? 'wallet'}
      amount={p.pot + p.bonus}
      currency={p.currency}
      ngn={p.ngn}
      bank={p.bank}
      landed={p.status !== 'cashing'}
      simulated={p.simulated}
      backHref={`/c/${circle.id}`}
      backLabel={`Back to ${circle.name}`}
    />
  )
}

function PayoutLoader({ id }: { id: string }) {
  const { data: circle, error } = useApi<CircleView>(`/api/circles/${id}`)
  const [claimed, setClaimed] = useState<PublicPayout | null>(null)
  if (error) return <Screen bar={false}><BackLink href="/" /><p className="mt-10 text-center text-ink-2">{error}</p></Screen>
  if (!circle) return <Splash />
  const payout = claimed ?? circle.yourPayout
  if (!payout) {
    return (
      <Screen bar={false}>
        <BackLink href={`/c/${id}`} />
        <p className="mt-10 rounded-card bg-white p-6 text-center text-ink-2 shadow-soft">Your pot isn&apos;t ready yet. It arrives in round {circle.yourTurn}.</p>
      </Screen>
    )
  }
  if (payout.status === 'claimable') return <Celebrate circle={circle} payout={payout} onClaimed={setClaimed} />
  return <Claimed circle={circle} payout={payout} />
}

export function PayoutScreen({ id }: { id: string }) {
  return (
    <SignedIn>
      <PayoutLoader id={id} />
    </SignedIn>
  )
}
