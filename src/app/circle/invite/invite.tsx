'use client'

import { Check, Copy, Plus, ShareNetwork } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useState } from 'react'
import { Avatar, BackLink, BottomBar, PrimaryButton, Screen, nim } from '@/components/ui'
import { circle } from '@/lib/mock'

function codeFor(name: string) {
  const word = name.replace(/[^a-z]/gi, '').toUpperCase().slice(0, 6) || 'CIRCLE'
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return `${word}-${hash.toString(36).toUpperCase().slice(0, 3)}`
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600)
    } catch {
      // Clipboard can be blocked inside the host webview; the text stays selectable.
    }
  }
  return { copied, copy }
}

export function Invite({ name, localName, amount, people, fresh }: { name: string; localName: string; amount: number; people: number; fresh: boolean }) {
  const code = codeFor(name)
  const link = `https://circle.nim/j/${code.toLowerCase()}`
  const { copied, copy } = useCopy()
  // A brand-new circle only has you; the mock "Lisbon Rent" already has three.
  const joined = fresh ? [circle.members[3]] : [circle.members[3], circle.members[0], circle.members[2]]

  async function share() {
    const text = `Join "${name}", our ${localName} on Nimiq Pay. ${nim(amount)} NIM a round, ${people} of us. Code ${code}`
    if (navigator.share) {
      try {
        await navigator.share({ title: name, text, url: link })
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
        <BackLink href={fresh ? '/new' : '/'} />
        <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tight">Invite your people</h1>
      </header>

      <section className="mt-6 rounded-card bg-lilac-soft p-5 text-center shadow-soft">
        <Image src="/art/invite.webp" alt="" width={567} height={600} priority className="mx-auto w-[150px]" />
        <p className="mt-3 text-sm font-semibold text-lilac-ink">{localName}</p>
        <p className="font-display text-3xl font-extrabold tracking-tight">{name}</p>
        <p className="mt-1 text-[15px] text-ink-2">
          {nim(amount)} NIM a round · {people} people
        </p>

        <button
          type="button"
          onClick={() => copy('code', code)}
          className="press mt-5 flex w-full items-center justify-between rounded-[var(--radius-inner)] bg-white px-5 py-4 shadow-soft"
        >
          <span className="text-left">
            <span className="block text-xs font-semibold uppercase tracking-wider text-ink-2">Invite code</span>
            <span className="font-display text-2xl font-extrabold tracking-wide">{code}</span>
          </span>
          <span className={`grid size-10 place-items-center rounded-full transition-colors duration-200 ${copied === 'code' ? 'bg-mint text-white' : 'bg-blush text-ink'}`}>
            {copied === 'code' ? <Check size={18} weight="bold" /> : <Copy size={18} weight="bold" />}
          </span>
        </button>
        <p className="mt-2 text-sm text-ink-2" aria-live="polite">
          {copied === 'code' ? 'Code copied' : copied === 'link' ? 'Invite copied, paste it anywhere' : 'Friends open Nimiq Pay and enter this code'}
        </p>
      </section>

      <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-bold tracking-tight">Seats</h2>
          <p className="text-sm tabular-nums text-ink-2">
            {joined.length} of {people} joined
          </p>
        </div>
        <ul className={`mt-4 grid gap-x-2 gap-y-4 ${people === 5 ? 'grid-cols-5' : people === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
          {Array.from({ length: people }, (_, i) => {
            const member = joined[i]
            return (
              <li key={i} className="flex flex-col items-center gap-1.5">
                {member ? (
                  <Avatar member={member} size={56} className={member.id === 'me' ? 'ring-[3px] ring-coral' : ''} />
                ) : (
                  <span className="grid size-14 place-items-center rounded-full border-2 border-dashed border-line text-ink-2/60">
                    <Plus size={18} weight="bold" />
                  </span>
                )}
                <span className={`text-xs font-semibold ${member ? 'text-ink' : 'text-ink-2/70'}`}>{member ? member.name : `Turn ${i + 1}`}</span>
              </li>
            )
          })}
        </ul>
        <p className="mt-4 rounded-[var(--radius-inner)] bg-blush px-4 py-3 text-sm text-ink-2">
          Round 1 starts when every seat is taken. Nobody pays until then.
        </p>
      </section>

      <BottomBar>
        <PrimaryButton onClick={share}>
          <span className="flex items-center gap-2">
            <ShareNetwork size={20} weight="bold" /> Share invite
          </span>
        </PrimaryButton>
      </BottomBar>
    </Screen>
  )
}
