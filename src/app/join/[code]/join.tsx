'use client'

import { Plus } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Splash } from '@/components/gate'
import { Record } from '@/components/record'
import { Avatar, BackLink, BottomBar, PrimaryButton, Screen, nim } from '@/components/ui'
import { Ngn, api, useApi, useWallet } from '@/components/wallet'
import type { CirclePreview } from '@/lib/circles'

export function JoinScreen({ code }: { code: string }) {
  const router = useRouter()
  const wallet = useWallet()
  const { data: circle, error } = useApi<CirclePreview>(`/api/circles/code/${encodeURIComponent(code)}`)
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<string | null>(null)

  async function join() {
    setJoinError(null)
    setJoining(true)
    try {
      if (wallet.phase !== 'ready' && !(await wallet.signIn())) {
        setJoining(false)
        return
      }
      const { id } = await api<{ id: string }>('/api/circles/join', { body: { code } })
      router.push(`/c/${id}/invite`)
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : String(e))
      setJoining(false)
    }
  }

  if (error) {
    return (
      <Screen bar={false}>
        <BackLink href="/" />
        <p className="mt-10 rounded-card bg-white p-6 text-center text-ink-2 shadow-soft">{error}</p>
      </Screen>
    )
  }
  if (!circle || wallet.phase === 'loading') return <Splash />

  const full = circle.status !== 'filling' || circle.members.length >= circle.size
  const canJoin = wallet.inNimiqPay || wallet.devWallet || wallet.phase === 'ready'
  return (
    <Screen>
      <BackLink href="/" />
      <section className="mt-4 rounded-card bg-lilac-soft p-6 text-center shadow-soft">
        <Image src="/art/invite.webp" alt="" width={567} height={600} priority className="mx-auto w-[140px]" />
        <p className="mt-3 text-sm font-semibold text-lilac-ink">{circle.localName} invite</p>
        <h1 className="font-display text-[32px] font-extrabold leading-tight tracking-tight">{circle.name}</h1>
        <div className="mt-4 grid grid-cols-2 gap-2 text-left">
          <div className="rounded-[var(--radius-inner)] bg-white p-3">
            <p className="text-xs font-semibold text-ink-2">Each round</p>
            <p className="font-display text-xl font-extrabold tabular-nums">{nim(circle.contribution)} {circle.currency}</p>
          </div>
          <div className="rounded-[var(--radius-inner)] bg-white p-3">
            <p className="text-xs font-semibold text-ink-2">Your pot</p>
            <p className="font-display text-xl font-extrabold tabular-nums">{nim(circle.contribution * circle.size)} {circle.currency}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-lilac-ink">
          {circle.cadence}, {circle.size} people. Your pot ≈ <Ngn amount={circle.contribution * circle.size} currency={circle.currency} />.
        </p>
        {circle.currency === 'USDT' && <p className="mt-1 text-sm text-lilac-ink">Saved in USDT on Polygon, paid from your Nimiq Pay wallet.</p>}
      </section>

      <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
        <h2 className="font-display text-xl font-bold tracking-tight">Who&apos;s in</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {circle.members.map((m) => (
            <li key={m.turn} className="flex items-center gap-3">
              <Avatar avatar={m.avatar} size={44} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.name}</p>
                <Record member={m} />
              </div>
            </li>
          ))}
          {Array.from({ length: Math.max(0, circle.size - circle.members.length) }, (_, i) => (
            <li key={`e${i}`} className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full border-2 border-dashed border-line text-ink-2/60">
                <Plus size={16} weight="bold" />
              </span>
              <span className="text-ink-2/70">Open seat</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-[var(--radius-inner)] bg-blush px-4 py-3 text-sm text-ink-2">
          Only join circles with people you know. Want to save on your own instead? Make a savings goal.
        </p>
      </section>

      {(joinError || wallet.error) && <p className="mt-4 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{joinError ?? wallet.error}</p>}

      <BottomBar>
        {full ? (
          <p className="py-4 text-center font-semibold text-ink-2">This circle is full</p>
        ) : canJoin ? (
          <PrimaryButton onClick={join} disabled={joining}>
            {joining ? 'Joining…' : 'Join this circle'}
          </PrimaryButton>
        ) : (
          <p className="py-4 text-center font-semibold text-ink-2">Open this link in Nimiq Pay to join</p>
        )}
      </BottomBar>
    </Screen>
  )
}
