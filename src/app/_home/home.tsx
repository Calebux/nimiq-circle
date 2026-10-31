'use client'

import { BellRinging, CalendarDots, Gift, Hourglass, LockSimple, Plus, Sparkle, Ticket, UsersThree, X } from '@phosphor-icons/react/dist/ssr'
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
          <h2 className="font-display text-xl font-bold tracking-tight">First, what&apos;s your name?</h2>
          <p className="text-sm text-ink-2">How people in your circles will see you. You can change it later.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <label htmlFor="your-name" className="sr-only">
          Your first name
        </label>
        <input
          id="your-name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder="Your first name"
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

/** Name, picture, sign out. Opened from your avatar on Home. */
function ProfileSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { me, setMe, signOut } = useWallet()
  const [name, setName] = useState(me?.name ?? '')
  const [avatar, setAvatar] = useState(me?.avatar ?? 1)
  const [saving, setSaving] = useState(false)
  if (!me) return null
  async function save() {
    setSaving(true)
    try {
      const { user } = await api<{ user: NonNullable<typeof me> }>('/api/me', { method: 'PATCH', body: { name, avatar } })
      setMe(user)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }
  const short = me.address.replace(/\s/g, '')
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="You" description={`${short.slice(0, 4)} … ${short.slice(-4)} on Nimiq`}>
      <label htmlFor="profile-name" className="font-display text-base font-bold tracking-tight">
        Name
      </label>
      <input
        id="profile-name"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 24))}
        className="mt-2 h-12 w-full rounded-[var(--radius-inner)] bg-white px-4 font-semibold shadow-soft outline-none focus:ring-2 focus:ring-coral"
      />
      <p className="mt-5 font-display text-base font-bold tracking-tight">Picture</p>
      <div className="mt-2 grid grid-cols-6 gap-2">
        {[1, 2, 3, 4, 5, 6].map((a) => (
          <button key={a} onClick={() => setAvatar(a)} aria-label={`Picture ${a}`} aria-pressed={avatar === a} className="press grid place-items-center">
            <Avatar avatar={a} size={48} className={avatar === a ? 'ring-[3px] ring-coral' : ''} />
          </button>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <PrimaryButton onClick={save} disabled={!name.trim() || saving}>
          {saving ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <div className="flex items-center justify-center gap-5 py-2 text-sm font-semibold">
          <Link href="/privacy" className="text-ink-2 underline underline-offset-2">
            What Akilii stores
          </Link>
          <button onClick={signOut} className="text-coral-ink">
            Sign out
          </button>
        </div>
      </div>
    </Sheet>
  )
}

const NOTICE_ICON = {
  due_soon: CalendarDots,
  late: Hourglass,
  nudge: BellRinging,
  pot_ready: Gift,
  short_pot: Gift,
  late_money: Gift,
  missed: Hourglass,
} as const

interface Notice {
  id: string
  kind: keyof typeof NOTICE_ICON
  text: string
  href: string
}

/** Reminders, nudges, pots ready: the in-app stand-in for push notifications. */
function Inbox() {
  const { data, setData } = useApi<{ notices: Notice[] }>('/api/notices', 30_000)
  const notices = data?.notices ?? []
  if (notices.length === 0) return null
  function dismiss(ids: string[] | 'all') {
    setData({ notices: ids === 'all' ? [] : notices.filter((n) => !ids.includes(n.id)) })
    api('/api/notices', { body: ids === 'all' ? { all: true } : { ids } }).catch(() => undefined)
  }
  return (
    <section className="flex flex-col gap-2">
      {notices.slice(0, 3).map((n) => {
        const Icon = NOTICE_ICON[n.kind] ?? BellRinging
        const warm = n.kind === 'pot_ready' || n.kind === 'short_pot' || n.kind === 'late_money'
        return (
          <div key={n.id} className={`pop-in flex items-start gap-3 rounded-card p-4 shadow-soft ${warm ? 'bg-sun' : 'bg-white'}`}>
            <span className={`grid size-9 shrink-0 place-items-center rounded-full ${warm ? 'bg-white/70 text-coral' : 'bg-coral-soft text-coral-ink'}`}>
              <Icon size={18} weight="fill" />
            </span>
            <Link href={n.href} onClick={() => dismiss([n.id])} className="flex-1 text-[15px] leading-snug">
              {n.text}
            </Link>
            <button onClick={() => dismiss([n.id])} aria-label="Dismiss" className="press -m-1 grid size-8 place-items-center rounded-full text-ink-2">
              <X size={16} weight="bold" />
            </button>
          </div>
        )
      })}
      {notices.length > 3 && (
        <button onClick={() => dismiss('all')} className="self-end text-sm font-semibold text-ink-2">
          Clear all {notices.length}
        </button>
      )}
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
            <p className={`text-sm font-semibold ${filling ? 'text-lilac-ink' : done ? 'text-mint-ink' : 'text-coral-ink'}`}>{c.practice ? 'Practice · no real money' : c.localName}</p>
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
          <span className="text-ink-2">{filling ? `${nim(c.contribution)} ${c.currency} a round` : done ? 'Finished' : `Round ${c.round} of ${c.size}`}</span>
          {c.payoutReady ? (
            <Chip tone="sun">
              <Gift size={13} weight="fill" /> Money is waiting
            </Chip>
          ) : c.owes > 0 ? (
            <Chip tone="coral">You owe {c.owes === 1 ? 'a round' : `${c.owes} rounds`}</Chip>
          ) : c.late ? (
            <Chip tone="coral">Late: chip in now</Chip>
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
          {g.target ? ` of ${nim(g.target)}` : ''} {g.currency}
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
  const [practicing, setPracticing] = useState(false)
  async function practice() {
    setPracticing(true)
    try {
      const { id } = await api<{ id: string }>('/api/circles/practice', { method: 'POST' })
      router.push(`/c/${id}`)
    } catch {
      setPracticing(false)
    }
  }
  return (
    <>
      <section className="overflow-hidden rounded-card bg-white shadow-soft">
        <Image src="/art/friends.webp" alt="" width={1200} height={714} className="mx-auto -mb-2 mt-4 w-[82%]" />
        <div className="p-5 pt-3">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">{first ? 'Save with your people' : 'Start another circle'}</h2>
          <p className="mt-1 text-[15px] text-ink-2">A circle is for friends and family you trust. Everyone chips in each round and one person takes the whole pot, then the next.</p>
          <div className="mt-4 flex flex-col gap-2">
            <PrimaryButton href="/new">New circle</PrimaryButton>
            <button onClick={() => setJoining(true)} className="press flex h-12 items-center justify-center gap-2 rounded-full bg-blush font-bold">
              <Ticket size={18} weight="bold" /> Join with a code
            </button>
            <button onClick={practice} disabled={practicing} className="press mt-1 flex items-center justify-center gap-1.5 py-1 text-sm font-semibold text-lilac-ink disabled:opacity-60">
              <Sparkle size={15} weight="fill" /> {practicing ? 'Setting it up…' : 'New here? Try a practice circle, no real money'}
            </button>
          </div>
        </div>
      </section>

      <Link href="/goals/new" className="press flex items-center gap-4 rounded-card bg-sky-soft p-5 shadow-soft">
        <Image src="/art/jar.webp" alt="" width={502} height={600} className="w-[72px] shrink-0" />
        <span className="flex-1">
          <span className="block font-display text-xl font-extrabold tracking-tight">Save for a goal</span>
          <span className="mt-0.5 block text-[15px] text-ink-2">Rather save on your own? Just you, no circle. Lock it till a date so you can&apos;t touch it.</span>
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
  const [profile, setProfile] = useState(false)
  const { data, error } = useApi<HomeData>('/api/home')
  if (error && !data) return <Screen bar={false}><p className="mt-10 rounded-card bg-white p-6 text-center text-ink-2 shadow-soft">{error}</p></Screen>
  if (!data) return <Splash />
  const empty = data.circles.length === 0 && data.goals.length === 0
  return (
    <Screen bar={false}>
      <header className="flex items-center justify-between">
        <div>
          <p className="mb-2 font-display text-lg font-extrabold tracking-tight">Akilii</p>
          <p className="text-sm text-ink-2">
            {greeting()}
            {me?.name ? `, ${me.name}` : ''}
          </p>
          <h1 className="font-display text-[32px] font-extrabold leading-none tracking-tight">{empty ? 'Welcome' : 'Your savings'}</h1>
        </div>
        {me && (
          <button onClick={() => setProfile(true)} aria-label="Your profile" className="press rounded-full shadow-soft">
            <Avatar avatar={me.avatar} size={48} className="ring-2 ring-white" />
          </button>
        )}
      </header>

      <div className="mt-6 flex flex-col gap-4">
        <NamePrompt />
        <Inbox />
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
      <ProfileSheet key={`${me?.name}-${me?.avatar}-${profile}`} open={profile} onOpenChange={setProfile} />
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
