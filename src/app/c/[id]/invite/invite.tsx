'use client'

import { Check, Copy, Plus, ShareNetwork } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { SignedIn, Splash } from '@/components/gate'
import { Avatar, BackLink, BottomBar, PrimaryButton, Screen, nim } from '@/components/ui'
import { useApi } from '@/components/wallet'
import type { CircleView } from '@/lib/circles'

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
    } catch {
      // Clipboard can be blocked inside the host webview; the code stays visible to type.
    }
  }
  return { copied, copy }
}

function Invite({ circle }: { circle: CircleView }) {
  const { copied, copy } = useCopy()
  const link = `${window.location.origin}/join/${circle.inviteCode}`
  const full = circle.members.length >= circle.size

  async function share() {
    const text = `Join "${circle.name}", our ${circle.localName} on Nimiq Pay. ${nim(circle.contribution)} NIM a round, ${circle.size} of us. Code ${circle.inviteCode}`
    if (navigator.share) {
      try {
        await navigator.share({ title: circle.name, text, url: link })
        return
      } catch {
        // Dismissed share sheet: fall through to copying.
      }
    }
    copy('link', `${text}\n${link}`)
  }

  return (
    <Screen>
      <header className="flex items-center gap-3">
        <BackLink href={`/c/${circle.id}`} />
        <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tight">{full ? 'Your circle' : 'Invite your people'}</h1>
      </header>

      <section className="mt-6 rounded-card bg-lilac-soft p-5 text-center shadow-soft">
        <Image src="/art/invite.webp" alt="" width={567} height={600} priority className="mx-auto w-[150px]" />
        <p className="mt-3 text-sm font-semibold text-lilac-ink">{circle.localName}</p>
        <p className="font-display text-3xl font-extrabold tracking-tight">{circle.name}</p>
        <p className="mt-1 text-[15px] text-ink-2">
          {nim(circle.contribution)} NIM a round · {circle.size} people
        </p>

        <button type="button" onClick={() => copy('code', circle.inviteCode)} className="press mt-5 flex w-full items-center justify-between rounded-[var(--radius-inner)] bg-white px-5 py-4 shadow-soft">
          <span className="text-left">
            <span className="block text-xs font-semibold uppercase tracking-wider text-ink-2">Invite code</span>
            <span className="font-display text-2xl font-extrabold tracking-wide">{circle.inviteCode}</span>
          </span>
          <span className={`grid size-10 place-items-center rounded-full transition-colors duration-200 ${copied === 'code' ? 'bg-mint text-white' : 'bg-blush text-ink'}`}>
            {copied === 'code' ? <Check size={18} weight="bold" /> : <Copy size={18} weight="bold" />}
          </span>
        </button>
        <p className="mt-2 text-sm text-ink-2" aria-live="polite">
          {copied === 'code' ? 'Code copied' : copied === 'link' ? 'Invite copied, paste it anywhere' : 'Friends open Circle in Nimiq Pay and enter this code'}
        </p>
      </section>

      <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">Seats</h2>
          <p className="text-sm tabular-nums text-ink-2">
            {circle.members.length} of {circle.size} joined
          </p>
        </div>
        <ul className={`mt-4 grid gap-x-2 gap-y-4 ${circle.size === 5 ? 'grid-cols-5' : circle.size === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
          {Array.from({ length: circle.size }, (_, i) => {
            const member = circle.members.find((m) => m.turn === i + 1)
            return (
              <li key={i} className="flex flex-col items-center gap-1.5">
                {member ? (
                  <Avatar avatar={member.avatar} size={56} className={member.isYou ? 'pop-in ring-[3px] ring-coral' : 'pop-in'} />
                ) : (
                  <span className="grid size-14 place-items-center rounded-full border-2 border-dashed border-line text-ink-2/60">
                    <Plus size={18} weight="bold" />
                  </span>
                )}
                <span className={`max-w-full truncate text-xs font-semibold ${member ? 'text-ink' : 'text-ink-2/70'}`}>{member ? member.name : `Turn ${i + 1}`}</span>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 rounded-[var(--radius-inner)] bg-blush px-4 py-3 text-sm text-ink-2">
          {full ? 'Everyone is in. The order above is who takes the pot each round.' : 'Round 1 starts when every seat is taken. Nobody pays until then.'}
        </p>
        {circle.isCreator && !full && (
          <Link href={`/c/${circle.id}`} className="mt-3 inline-block text-sm font-semibold text-coral-ink underline decoration-2 underline-offset-4">
            Not everyone coming? Change details or start early
          </Link>
        )}
      </section>

      <BottomBar>
        {full ? (
          <PrimaryButton href={`/c/${circle.id}`}>Go to the circle</PrimaryButton>
        ) : (
          <PrimaryButton onClick={share}>
            <span className="flex items-center gap-2">
              <ShareNetwork size={20} weight="bold" /> Share invite
            </span>
          </PrimaryButton>
        )}
      </BottomBar>
    </Screen>
  )
}

function InviteLoader({ id }: { id: string }) {
  // Poll so seats fill in as people join.
  const { data, error } = useApi<CircleView>(`/api/circles/${id}`, 5000)
  if (error && !data) return <Screen bar={false}><BackLink href="/" /><p className="mt-10 text-center text-ink-2">{error}</p></Screen>
  if (!data) return <Splash />
  return <Invite circle={data} />
}

export function InviteScreen({ id }: { id: string }) {
  return (
    <SignedIn>
      <InviteLoader id={id} />
    </SignedIn>
  )
}
