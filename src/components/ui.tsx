'use client'

import { ArrowRight, CaretLeft } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Drawer } from 'vaul'
import type { Member, Tint } from '@/lib/mock'

export const nim = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const naira = (n: number) => `₦${Math.round(n).toLocaleString('en-US')}`

// --- Motion ------------------------------------------------------------------

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )
}

/** Counts from the shown value to `target`. First view and real changes only, never on a loop. */
export function useCountUp(target: number, duration = 900) {
  const reduce = useReducedMotion()
  const [value, setValue] = useState(0)
  const shown = useRef(0)
  useEffect(() => {
    const from = shown.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / duration)
      shown.current = from + (target - from) * (1 - Math.pow(1 - t, 3))
      setValue(shown.current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, reduce])
  return value
}

// --- Avatar ------------------------------------------------------------------

const TINT_BG: Record<Tint, string> = {
  coral: 'bg-coral-soft',
  mint: 'bg-mint-soft',
  sun: 'bg-sun-soft',
  sky: 'bg-sky-soft',
  lilac: 'bg-lilac-soft',
}

export function Avatar({ member, size, className = '' }: { member: Pick<Member, 'avatar' | 'tint'>; size: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-end justify-center overflow-hidden rounded-full ${TINT_BG[member.tint]} ${className}`}
      style={{ width: size, height: size }}
    >
      <Image src={member.avatar} alt="" width={size} height={size} className="translate-y-[5%] scale-[0.94]" />
    </span>
  )
}

export function AvatarStack({ members, size = 30, max = 3 }: { members: Member[]; size?: number; max?: number }) {
  const extra = members.length - max
  return (
    <div className="flex -space-x-2.5">
      {members.slice(0, max).map((m) => (
        <Avatar key={m.id} member={m} size={size} className="ring-2 ring-blush" />
      ))}
      {extra > 0 && (
        <span className="grid place-items-center rounded-full bg-white text-xs font-bold text-ink-2 ring-2 ring-blush" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </div>
  )
}

// --- Buttons -----------------------------------------------------------------

const primaryClass =
  'press group flex h-14 w-full items-center justify-between rounded-full bg-coral pl-6 pr-2 text-[17px] font-bold text-white shadow-lift disabled:opacity-60'

function ArrowNub() {
  return (
    <span className="grid size-10 place-items-center rounded-full bg-white/20 transition-transform duration-200 ease-[var(--ease-out)] group-active:translate-x-0.5">
      <ArrowRight size={18} weight="bold" />
    </span>
  )
}

/** Coral pill with the arrow nested in its own circle. The one action colour. */
export function PrimaryButton({ children, href, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { href?: string }) {
  if (href) {
    return (
      <Link href={href} className={primaryClass}>
        {children}
        <ArrowNub />
      </Link>
    )
  }
  return (
    <button {...props} className={primaryClass}>
      {children}
      <ArrowNub />
    </button>
  )
}

export function SecondaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`press flex h-14 w-full items-center justify-center gap-2 rounded-full bg-white text-[17px] font-bold text-ink shadow-soft ${className}`}>
      {children}
    </button>
  )
}

export function BackLink({ href, label = 'Back' }: { href: string; label?: string }) {
  return (
    <Link href={href} aria-label={label} className="press grid size-11 shrink-0 place-items-center rounded-full bg-white shadow-soft">
      <CaretLeft size={20} weight="bold" />
    </Link>
  )
}

// --- Layout ------------------------------------------------------------------

const SCREEN_BOTTOM = {
  none: 'pb-[calc(24px+env(safe-area-inset-bottom,0px))]',
  one: 'pb-[calc(120px+env(safe-area-inset-bottom,0px))]',
  tall: 'pb-[calc(184px+env(safe-area-inset-bottom,0px))]',
}

/** Page shell: safe areas, phone width, room for the bottom bar (`'tall'` when it holds two buttons). */
export function Screen({ children, bar = true }: { children: React.ReactNode; bar?: boolean | 'tall' }) {
  const bottom = bar === 'tall' ? SCREEN_BOTTOM.tall : bar ? SCREEN_BOTTOM.one : SCREEN_BOTTOM.none
  return (
    <main className={`mx-auto w-full max-w-[440px] px-4 pt-[calc(14px+env(safe-area-inset-top,0px))] ${bottom}`}>
      {children}
    </main>
  )
}

/** Thumb-reach action bar pinned to the bottom. */
export function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 bg-blush/85 px-4 pb-[calc(14px+env(safe-area-inset-bottom,0px))] pt-3 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[408px] flex-col gap-2">{children}</div>
    </div>
  )
}

// --- Sheet -------------------------------------------------------------------

/** Bottom sheet (Vaul): drag to dismiss, focus trapped, safe-area aware. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] max-w-[440px] flex-col rounded-t-[32px] bg-blush outline-none">
          <div className="mx-auto mt-3 h-1.5 w-11 shrink-0 rounded-full bg-ink/15" />
          <div className="overflow-y-auto overscroll-contain px-5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] pt-4">
            <Drawer.Title className="font-display text-2xl font-extrabold tracking-tight">{title}</Drawer.Title>
            {description ? (
              <Drawer.Description className="mt-1 text-[15px] text-ink-2">{description}</Drawer.Description>
            ) : (
              <Drawer.Description className="sr-only">{title}</Drawer.Description>
            )}
            <div className="mt-5">{children}</div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

/** Small pill label. `tone` follows the colour meanings in CLAUDE.md. */
export function Chip({ tone, children }: { tone: 'mint' | 'lilac' | 'coral' | 'sun'; children: React.ReactNode }) {
  const tones = {
    mint: 'bg-mint-soft text-mint-ink',
    lilac: 'bg-lilac-soft text-lilac-ink',
    coral: 'bg-coral-soft text-coral-ink',
    sun: 'bg-sun-soft text-sun-ink',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${tones[tone]}`}>{children}</span>
}
