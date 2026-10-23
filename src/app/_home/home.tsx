'use client'

import { Gift, LockSimple, Plus, Ticket, UsersThree } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { SignedIn, Splash } from '@/components/gate'
import { Avatar, AvatarStack, Chip, PrimaryButton, Screen, Sheet, nim, shortDate } from '@/components/ui'
import { api, useApi, useWallet } from '@/components/wallet'
import type { CircleSummary } from '@/lib/circles'
import type { GoalSummary } from '@/lib/goals'

interface HomeData {
  circles: CircleSummary[]
  goals: GoalSummary[]
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function NamePrompt() {
  const { me, setMe } = useWallet()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  if (!me || me.name) return null
  async function save() {
    setSaving(true)
    try {
      const { user } = await api<{ user: NonNullable<typeof me> }>('/api/me', { method: 'PATCH', body: { name } })
      setMe(user)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="pop-in flex flex-col gap-3 rounded-card bg-white p-5 shadow-soft">
      <div className="flex items-center gap-3">
        <Avatar avatar={me.avatar} size={52} />
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight">What should your circles call you?</h2>
          <p className="text-sm text-ink-2">Shown to people in your circles.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <label htmlFor="your-name" className="sr-only">
          Your name
        </label>
        <input
          id="your-name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder="Tolu"
          autoComplete="given-name"
          enterKeyHint="done"
          className="h-12 min-w-0 flex-1 rounded-full bg-blush px-4 font-semibold outline-none placeholder:font-normal placeholder:text-ink-2/70 focus:ring-2 focus:ring-coral"
        />
        <button onClick={save} disabled={!name.trim() || saving} className="press h-12 rounded-full bg-ink px-5 font-bold text-white disabled:opacity-40">
          Save
        </button>
      </div>
    </section>
  )
}

function CircleCard({ c }: { c: CircleSummary }) {
  const filling = c.status === 'filling'
  const done = c.status === 'done'
  return (
    <Link href={`/c/${c.id}`} className="press block rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
      <div className={`rounded-[calc(var(--radius-card)-6px)] p-4 ${filling ? 'bg-lilac-soft' : done ? 'bg-mint-soft' : 'bg-coral-soft'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${filling ? 'text-lilac-ink' : done ? 'text-mint-ink' : 'text-coral-ink'}`}>{c.localName}</p>
            <p className="truncate font-display text-2xl font-extrabold leading-tight tracking-tight">{c.name}</p>
          </div>
          <AvatarStack avatars={c.avatars} size={32} />
        </div>

        <div className="mt-4 flex gap-1" aria-hidden>
          {Array.from({ length: c.size }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${done || i < c.round - 1 ? 'bg-coral' : i === c.round - 1 && !filling ? 'bg-coral/40' : 'bg-white'}`} />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-ink-2">{filling ? `${nim(c.contribution)} NIM a round` : done ? 'Finished' : `Round ${c.round} of ${c.size}`}</span>
          {c.payoutReady ? (
            <Chip tone="sun">
              <Gift size={13} weight="fill" /> Your pot is ready
            </Chip>
          ) : filling ? (
            <Chip tone="lilac">
              {c.joined} of {c.size} joined
            </Chip>
          ) : done ? null : c.youPaid ? (
            <Chip tone="mint">Paid this round</Chip>
          ) : (
            <Chip tone="coral">Chip in{c.dueAt ? ` by ${shortDate(c.dueAt)}` : ''}</Chip>
          )}
        </div>
      </div>
    </Link>
  )
}

function GoalCard({ g }: { g: GoalSummary }) {
  const progress = g.target ? Math.min(1, g.balance / g.target) : 0
  return (
    <Link href={`/g/${g.id}`} className="press flex items-center gap-3 rounded-card bg-white p-4 shadow-soft">
      <span className="grid size-14 shrink-0 place-items-center rounded-[18px] bg-sky-soft">
        <Image src="/art/jar.webp" alt="" width={502} height={600} className="w-[40px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-extrabold tracking-tight">{g.name}</p>
        <p className="text-sm tabular-nums text-ink-2">
          {nim(g.balance)}
          {g.target ? ` of ${nim(g.target)}` : ''} NIM
        </p>
        {g.target && (
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-blush">
            <div className="h-full origin-left rounded-full bg-coral" style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
      </div>
      {g.locked ? (
        <Chip tone="lilac">
          <LockSimple size={12} weight="bold" /> {shortDate(g.unlockAt!)}
        </Chip>
      ) : g.unlockAt ? (
        <Chip tone="mint">Unlocked</Chip>
      ) : null}
    </Link>
  )
}

function StartCards({ first }: { first: boolean }) {
  const router = useRouter()
  const [joining, setJoining] = useState(false)
  const [code, setCode] = useState('')
  return (
    <>
      <section className="overflow-hidden rounded-card bg-white shadow-soft">
        <Image src="/art/friends.webp" alt="" width={1200} height={714} className="mx-auto -mb-2 mt-4 w-[82%]" />
        <div className="p-5 pt-3">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">{first ? 'Save with your people' : 'Start another circle'}</h2>
          <p className="mt-1 text-[15px] text-ink-2">Everyone chips in each round. One person takes the whole pot, then the next.</p>
          <div className="mt-4 flex flex-col gap-2">
            <PrimaryButton href="/new">New circle</PrimaryButton>
            <button onClick={() => setJoining(true)} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-blush font-bold">
              <Ticket size={18} weight="bold" /> Join with a code
            </button>
          </div>
        </div>
      </section>

      <Link href="/goals/new" className="press flex items-center gap-4 rounded-card bg-sky-soft p-5 shadow-soft">
        <Image src="/art/jar.webp" alt="" width={502} height={600} className="w-[72px] shrink-0" />
        <span className="flex-1">
          <span className="block font-display text-xl font-extrabold tracking-tight">Save for a goal</span>
          <span className="mt-0.5 block text-[15px] text-ink-2">Just you. Lock it till a date so you can&apos;t touch it.</span>
        </span>
        <Plus size={22} weight="bold" />
      </Link>

      <Sheet open={joining} onOpenChange={setJoining} title="Join a circle" description="Enter the code your friend shared.">
        <label htmlFor="code" className="sr-only">
          Invite code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16))}
          placeholder="JOLLOF-7KQ2"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="go"
          className="h-16 w-full rounded-[var(--radius-inner)] bg-white px-4 text-center font-display text-2xl font-extrabold tracking-wider shadow-soft outline-none placeholder:text-ink-2/30 focus:ring-2 focus:ring-coral"
        />
        <div className="mt-5">
          <PrimaryButton onClick={() => router.push(`/join/${encodeURIComponent(code)}`)} disabled={code.length < 4}>
            Find circle
          </PrimaryButton>
        </div>
      </Sheet>
    </>
  )
}

function HomeContent() {
  const { me } = useWallet()
  const { data, error } = useApi<HomeData>('/api/home')
  if (error && !data) return <Screen bar={false}><p className="mt-10 rounded-card bg-white p-6 text-center text-ink-2 shadow-soft">{error}</p></Screen>
  if (!data) return <Splash />
  const empty = data.circles.length === 0 && data.goals.length === 0
  return (
    <Screen bar={false}>
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-2">
            {greeting()}
            {me?.name ? `, ${me.name}` : ''}
          </p>
          <h1 className="font-display text-[32px] font-extrabold leading-none tracking-tight">{empty ? 'Welcome' : 'Your savings'}</h1>
        </div>
        <Link href="/new" aria-label="New circle" className="press grid size-12 place-items-center rounded-full bg-coral text-white shadow-lift">
          <Plus size={22} weight="bold" />
        </Link>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        <NamePrompt />
        {data.circles.length > 0 && (
          <>
            <h2 className="mt-1 flex items-center gap-2 font-display text-lg font-bold tracking-tight text-ink-2">
              <UsersThree size={18} weight="bold" /> Circles
            </h2>
            {data.circles.map((c) => (
              <CircleCard key={c.id} c={c} />
            ))}
          </>
        )}
        {data.goals.length > 0 && (
          <>
            <h2 className="mt-1 flex items-center gap-2 font-display text-lg font-bold tracking-tight text-ink-2">
              <LockSimple size={18} weight="bold" /> Goals
            </h2>
            {data.goals.map((g) => (
              <GoalCard key={g.id} g={g} />
            ))}
          </>
        )}
        <StartCards first={empty} />
      </div>
    </Screen>
  )
}

export function Home() {
  return (
    <SignedIn>
      <HomeContent />
    </SignedIn>
  )
}
