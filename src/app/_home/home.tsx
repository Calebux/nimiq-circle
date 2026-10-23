'use client'

import { Plus, Ticket } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { AvatarStack, Chip, PrimaryButton, Screen, SecondaryButton, nim } from '@/components/ui'
import { myCircles } from '@/lib/mock'

function CircleCard({ c }: { c: (typeof myCircles)[number] }) {
  const filling = c.round === 0
  return (
    <Link href={c.href} className="press block rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
      <div className={`rounded-[calc(var(--radius-card)-6px)] p-4 ${filling ? 'bg-lilac-soft' : 'bg-coral-soft'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${filling ? 'text-lilac-ink' : 'text-coral-ink'}`}>{c.localName}</p>
            <p className="truncate font-display text-2xl font-extrabold leading-tight tracking-tight">{c.name}</p>
          </div>
          <AvatarStack members={c.members} size={32} />
        </div>

        <div className="mt-4 flex gap-1" aria-hidden>
          {Array.from({ length: c.rounds }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < c.round ? 'bg-coral' : 'bg-white'}`} />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-ink-2">
            {filling ? `${nim(c.contribution)} NIM a round` : `Round ${c.round} of ${c.rounds}`}
          </span>
          <Chip tone={filling ? 'lilac' : 'coral'}>{c.note}</Chip>
        </div>
      </div>
    </Link>
  )
}

function StartCard() {
  return (
    <section className="overflow-hidden rounded-card bg-white shadow-soft">
      <Image src="/art/friends.webp" alt="" width={1200} height={714} className="mx-auto -mb-2 mt-4 w-[86%]" />
      <div className="p-5 pt-3">
        <h2 className="font-display text-2xl font-extrabold tracking-tight">Start another circle</h2>
        <p className="mt-1 text-[15px] text-ink-2">Pick an amount, invite your people, and take turns with the pot.</p>
        <div className="mt-4">
          <PrimaryButton href="/new">New circle</PrimaryButton>
        </div>
      </div>
    </section>
  )
}

function Welcome() {
  return (
    <div className="flex min-h-[calc(100svh-40px)] flex-col">
      <div className="flex flex-1 flex-col justify-center">
        <Image src="/art/friends.webp" alt="" width={1200} height={714} priority className="mx-auto w-full max-w-[380px]" />
        <h1 className="mt-6 font-display text-[40px] font-extrabold leading-[1.02] tracking-tight">
          Save together.
          <br />
          Take turns.
        </h1>
        <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
          Ajo, tanda, susu, chama. Everyone chips in each round and one person takes the whole pot, while the waiting money earns.
        </p>
      </div>
      <div className="mt-8 flex flex-col gap-2">
        <PrimaryButton href="/new">Start a circle</PrimaryButton>
        <SecondaryButton>
          <Ticket size={20} weight="bold" /> Join with a code
        </SecondaryButton>
      </div>
    </div>
  )
}

export function Home({ empty }: { empty: boolean }) {
  if (empty) {
    return (
      <Screen bar={false}>
        <Welcome />
      </Screen>
    )
  }
  return (
    <Screen bar={false}>
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-2">Good evening</p>
          <h1 className="font-display text-[32px] font-extrabold leading-none tracking-tight">Your circles</h1>
        </div>
        <Link href="/new" aria-label="New circle" className="press grid size-12 place-items-center rounded-full bg-coral text-white shadow-lift">
          <Plus size={22} weight="bold" />
        </Link>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        {myCircles.map((c) => (
          <CircleCard key={c.id} c={c} />
        ))}
        <StartCard />
      </div>
    </Screen>
  )
}
