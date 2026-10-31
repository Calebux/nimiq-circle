'use client'

import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { Splash } from '@/components/gate'
import { BackLink, Screen, naira, nim, useCountUp } from '@/components/ui'
import { useApi } from '@/components/wallet'
import type { PublicStats } from '@/lib/stats'

function Tile({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-card p-4 shadow-soft ${tone}`}>
      <p className="text-sm font-semibold opacity-80">{label}</p>
      <p className="mt-1 font-display text-[30px] font-extrabold leading-none tracking-tight tabular-nums">{value}</p>
    </div>
  )
}

/** Public usage: real money only, read straight from the books. */
export function StatsScreen() {
  const { data } = useApi<PublicStats>('/api/stats', 60_000)
  const saved = useCountUp(data?.savedNim ?? 0, 1200)
  if (!data) return <Splash />

  return (
    <Screen bar={false}>
      <header className="flex items-center gap-3">
        <BackLink href="/" />
        <div>
          <p className="text-sm text-ink-2">Akilii in numbers</p>
          <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tight">Saving, together</h1>
        </div>
      </header>

      <section className="mt-6 rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
        <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-6px)] bg-coral-soft p-5">
          <Image src="/art/pot.webp" alt="" width={710} height={800} className="pointer-events-none absolute -right-2 -top-1 w-[96px]" />
          <p className="text-sm font-semibold text-coral-ink">Saved through Akilii</p>
          <p className="mt-1 font-display text-[44px] font-extrabold leading-none tracking-tight tabular-nums">{nim(saved)}</p>
          <p className="mt-1 text-[15px] text-ink-2">NIM{data.savedUsdt > 0 ? `, plus ${nim(data.savedUsdt, 2)} USDT` : ''}</p>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Tile label="Savers" value={nim(data.savers)} tone="bg-white" />
        <Tile label="Circles running" value={nim(data.circles)} tone="bg-lilac-soft text-lilac-ink" />
        <Tile label="Pots paid out" value={nim(data.potsPaid)} tone="bg-sun-soft text-sun-ink" />
        <Tile label="Savings goals" value={nim(data.goals)} tone="bg-sky-soft" />
      </div>

      <section className="mt-3 rounded-card bg-mint-soft p-5 text-mint-ink shadow-soft">
        <p className="text-sm font-semibold">Cashed out to Nigerian banks</p>
        <p className="mt-1 font-display text-[32px] font-extrabold leading-none tracking-tight tabular-nums">{naira(data.cashedOutNgn)}</p>
        <p className="mt-1 text-sm">Paid out by our partner KhalkosPay.</p>
      </section>

      <p className="mt-4 text-sm leading-snug text-ink-2">
        Real money only. Test wallets and practice circles are left out. Every contribution is also on the Nimiq chain, so you can check the pool yourself.
      </p>
      <Link href="/pool" className="press mt-3 flex items-center justify-between rounded-card bg-white p-4 font-bold shadow-soft">
        See the pool on chain <ArrowRight size={18} weight="bold" />
      </Link>
    </Screen>
  )
}
