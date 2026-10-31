'use client'

import { Ticket } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import Link from 'next/link'
import { Chip, PrimaryButton, Screen, SecondaryButton } from './ui'
import { useWallet } from './wallet'

export function Splash() {
  return (
    <div className="grid min-h-[100svh] place-items-center">
      <Image src="/art/pot.webp" alt="" width={710} height={800} priority className="w-[96px] animate-pulse" />
    </div>
  )
}

/** First run and signed-out state: what Akilii is, then one tap to sign in with the wallet. */
export function Welcome({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) {
  const { phase, signIn, error, inNimiqPay, devWallet } = useWallet()
  const canSignIn = inNimiqPay || devWallet
  return (
    <Screen bar={false}>
      <div className="flex min-h-[calc(100svh-40px)] flex-col">
        <p className="font-display text-2xl font-extrabold tracking-tight">Akilii</p>
        <div className="flex flex-1 flex-col justify-center">
          {children ?? (
            <>
              <Image src="/art/friends.webp" alt="" width={1200} height={714} priority className="mx-auto w-full max-w-[380px]" />
              <h1 className="mt-6 font-display text-[40px] font-extrabold leading-[1.02] tracking-tight">
                {title ?? (
                  <>
                    The perfect
                    <br />
                    money app.
                  </>
                )}
              </h1>
              <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
                Ajo, tanda, susu, chama with friends you trust: everyone chips in each round and one person takes the whole pot. Saving alone? Lock it away in a goal. Waiting money earns.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Chip tone="sun">Cash out in naira</Chip>
                <Chip tone="lilac">Naira top-ups soon</Chip>
                <Chip tone="lilac">More currencies soon</Chip>
              </div>
            </>
          )}
        </div>
        <div className="mt-8 flex flex-col gap-2">
          {error && <p className="rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}
          {canSignIn ? (
            <PrimaryButton onClick={signIn} disabled={phase === 'signing-in'}>
              {phase === 'signing-in' ? 'Check Nimiq Pay…' : inNimiqPay ? 'Continue with Nimiq Pay' : 'Continue with a test wallet'}
            </PrimaryButton>
          ) : (
            <SecondaryButton disabled>
              <Ticket size={20} weight="bold" /> Open this in Nimiq Pay
            </SecondaryButton>
          )}
          <p className="text-center text-xs text-ink-2">
            {inNimiqPay && 'You will sign a message to prove the wallet is yours. No money moves. '}
            <Link href="/privacy" className="underline underline-offset-2">
              What Akilii stores
            </Link>
            {' · '}
            <Link href="/pool" className="underline underline-offset-2">
              The pool on chain
            </Link>
            {' · '}
            <Link href="/stats" className="underline underline-offset-2">
              In numbers
            </Link>
          </p>
        </div>
      </div>
    </Screen>
  )
}

/** Renders children once signed in; splash while loading; welcome otherwise. */
export function SignedIn({ children, welcome }: { children: React.ReactNode; welcome?: React.ReactNode }) {
  const { phase } = useWallet()
  if (phase === 'loading') return <Splash />
  if (phase !== 'ready') return <>{welcome ?? <Welcome />}</>
  return <>{children}</>
}
