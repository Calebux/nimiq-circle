'use client'

import { Bank as BankIcon, CaretRight, Check, CircleNotch, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { BANKS, type Bank } from '@/lib/constants'
import type { Currency } from '@/lib/currency'
import { BottomBar, PrimaryButton, Screen, Sheet, naira, nim } from './ui'
import { api } from './wallet'

export interface BankChoice {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  /** The locked rate this cash-out must use. */
  quoteId: string
}

function BankPicker({ banks, onPick }: { banks: Bank[]; onPick: (bank: Bank) => void }) {
  const [query, setQuery] = useState('')
  const results = banks.filter((b) => `${b.name} ${b.short}`.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div>
      <div className="flex h-12 items-center gap-2 rounded-full bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
        <MagnifyingGlass size={18} className="text-ink-2" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search banks"
          aria-label="Search banks"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-2/70"
        />
      </div>
      <ul className="mt-3 flex flex-col">
        {results.map((bank) => (
          <li key={bank.code}>
            <button type="button" onClick={() => onPick(bank)} className="press flex w-full items-center gap-3 rounded-[var(--radius-inner)] px-2 py-3 text-left">
              <span className="grid size-10 place-items-center rounded-full bg-white font-display text-sm font-extrabold shadow-soft">{bank.short.slice(0, 2)}</span>
              <span className="flex-1 font-semibold">{bank.name}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-2 py-6 text-center text-ink-2">No bank called “{query}”</li>}
      </ul>
    </div>
  )
}

/** What the member sees and agrees to; locked server-side for a short time (src/lib/treasury.ts). */
interface Quote {
  id: string
  currency: Currency
  amount: number
  usdt: number
  ngn: number
  nimUsd: number
  usdtNgn: number
  rate: number
  feeNgn: number
  spreadBps: number
  expiresAt: number
  available: boolean
  unavailable: string | null
}

function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  return until ? Math.max(0, Math.round((until - now) / 1000)) : 0
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 flex justify-between gap-3 text-[15px] first:mt-0">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-semibold tabular-nums">{children}</span>
    </div>
  )
}

/** Bank, account number (name looked up at 10 digits), a locked rate with its breakdown, confirm. */
export function CashOutSheet({
  open,
  onOpenChange,
  amount,
  currency,
  onConfirm,
  practice = false,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** What is being cashed out, in whole units of `currency`. */
  amount: number
  currency: Currency
  onConfirm: (bank: BankChoice) => Promise<void>
  /** Practice circle: any account number works and nothing is sent; the rate is still live. */
  practice?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const [banks, setBanks] = useState<Bank[]>(BANKS)
  const [bank, setBank] = useState<Bank>(BANKS[0])
  const [account, setAccount] = useState('')
  const [resolved, setResolved] = useState<{ key: string; name: string } | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteTick, setQuoteTick] = useState(0)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const secondsLeft = useCountdown(quote?.expiresAt ?? null)

  const key = `${bank.code}:${account}`
  const name = practice && account.length === 10 ? 'Practice account' : resolved?.key === key ? resolved.name : null
  const resolving = account.length === 10 && !name && !error

  useEffect(() => {
    if (account.length !== 10) return
    if (practice) return
    let cancelled = false
    api<{ accountName: string }>('/api/offramp', { body: { action: 'resolve', bankCode: bank.code, accountNumber: account } }).then(
      (r) => !cancelled && setResolved({ key: `${bank.code}:${account}`, name: r.accountName }),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [bank, account, practice])

  // The provider's list, so nobody picks a bank it cannot pay.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api<{ banks: Bank[] }>('/api/offramp', { body: { action: 'banks' } }).then(
      (r) => {
        if (cancelled || r.banks.length === 0) return
        setBanks(r.banks)
        setBank((b) => r.banks.find((x) => x.code === b.code) ?? r.banks[0])
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [open])

  // Lock a rate when the sheet opens, and again whenever the last one runs out.
  useEffect(() => {
    if (!open || amount <= 0) return
    let cancelled = false
    api<Quote>('/api/offramp', { body: { action: 'quote', amount, currency } }).then(
      (q) => !cancelled && setQuote(q),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [open, amount, currency, quoteTick])
  const expired = Boolean(quote) && secondsLeft === 0
  // When the held rate runs out, lock a fresh one.
  useEffect(() => {
    if (!open || !quote) return
    const id = setTimeout(() => setQuoteTick((t) => t + 1), Math.max(0, quote.expiresAt - Date.now()) + 250)
    return () => clearTimeout(id)
  }, [open, quote])

  async function send() {
    if (!name || !quote) return
    setSending(true)
    setError(null)
    try {
      await onConfirm({ bankCode: bank.code, bankName: bank.short, accountNumber: account, accountName: name, quoteId: quote.id })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // A stale or spent rate: fetch a fresh one so the member can just tap again.
      setQuoteTick((t) => t + 1)
    }
    setSending(false)
  }

  const ready = Boolean(name && quote?.available && !expired)
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={picking ? 'Choose a bank' : 'Cash out to bank'}
      description={picking ? undefined : practice ? 'Practice: type any 10 digits. The rate is real, but nothing is sent.' : 'Naira lands in your account in about a minute.'}
    >
      {picking ? (
        <BankPicker
          banks={banks}
          onPick={(b) => {
            setBank(b)
            setError(null)
            setPicking(false)
          }}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setPicking(true)} className="press flex h-14 items-center gap-3 rounded-[var(--radius-inner)] bg-white px-4 text-left shadow-soft">
              <BankIcon size={22} weight="bold" className="text-ink-2" />
              <span className="flex-1 font-semibold">{bank.name}</span>
              <CaretRight size={18} weight="bold" className="text-ink-2" />
            </button>
            <label htmlFor="account" className="sr-only">
              Account number
            </label>
            <input
              id="account"
              inputMode="numeric"
              autoComplete="off"
              placeholder="10-digit account number"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value.replace(/\D/g, '').slice(0, 10))
                setError(null)
              }}
              className="h-14 rounded-[var(--radius-inner)] bg-white px-4 font-mono text-lg tracking-wider shadow-soft outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-ink-2/70 focus:ring-2 focus:ring-coral"
            />
            <div className="h-7 px-1 text-sm" aria-live="polite">
              {resolving && (
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <CircleNotch size={14} className="animate-spin" /> Checking account
                </span>
              )}
              {name && (
                <span className="inline-flex items-center gap-1.5 font-semibold text-mint-ink">
                  <Check size={14} weight="bold" /> {name}
                </span>
              )}
            </div>
          </div>

          <div className="mt-2 rounded-card bg-white p-5 shadow-soft">
            <Line label="You send">
              {nim(amount, 2)} {currency}
            </Line>
            {currency === 'NIM' && quote?.usdt !== 0 && <Line label="Changed to">{quote ? `${quote.usdt.toFixed(2)} USDT` : '…'}</Line>}
            <Line label="Rate">{quote ? `1 ${currency} = ₦${quote.rate.toFixed(currency === 'NIM' ? 3 : 2)}` : '…'}</Line>
            <Line label="Bank fee">{quote ? naira(quote.feeNgn) : '…'}</Line>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="font-semibold">You get</span>
              <span className="font-display text-3xl font-extrabold tracking-tight tabular-nums">{quote ? naira(quote.ngn) : '…'}</span>
            </div>
            <p className="mt-2 text-xs text-ink-2" aria-live="polite">
              {!quote ? 'Getting the best rate…' : expired ? 'Refreshing the rate…' : `Rate held for ${secondsLeft}s`}
            </p>
          </div>

          {quote && !quote.available && <p className="mt-3 rounded-[var(--radius-inner)] bg-sun-soft px-4 py-3 text-sm text-sun-ink">{quote.unavailable}</p>}
          {error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}

          <div className="mt-5">
            <PrimaryButton onClick={send} disabled={!ready || sending}>
              {sending ? 'Sending…' : !name ? 'Enter account number' : quote && !quote.available ? 'Cash-out unavailable' : quote ? `Send ${naira(quote.ngn)}` : 'Getting rate…'}
            </PrimaryButton>
          </div>
        </>
      )}
    </Sheet>
  )
}

/** After money leaves the pool: where it went and whether it has landed. */
export function Sent({
  breakFee,
  method,
  amount,
  currency,
  ngn,
  bank,
  landed,
  simulated,
  backHref,
  backLabel,
}: {
  breakFee?: number
  method: 'wallet' | 'bank'
  amount: number
  currency: Currency
  ngn: number | null
  bank: string | null
  landed: boolean
  simulated: boolean
  backHref: string
  backLabel: string
}) {
  const steps =
    method === 'wallet'
      ? [{ label: 'Sent to your Nimiq Pay wallet', done: true }]
      : [
          { label: 'Released from the pot', done: true },
          { label: 'Changed to naira', done: true },
          { label: `Sent to ${bank?.split(' · ')[0] ?? 'your bank'}`, done: landed },
        ]
  return (
    <Screen>
      <div className="pop-in pt-6 text-center">
        <Image src="/art/phone.webp" alt="" width={439} height={600} priority className="mx-auto w-[150px]" />
        <h1 className="mt-5 font-display text-[34px] font-extrabold leading-tight tracking-tight">{landed ? 'Money landed' : 'On its way'}</h1>
        <p className="mt-1 font-display text-[44px] font-extrabold leading-none tracking-tight tabular-nums text-coral-ink">
          {method === 'bank' && ngn !== null ? naira(ngn) : `${nim(amount, 2)} ${currency}`}
        </p>
        {breakFee !== undefined && <p className="mt-2 text-sm text-ink-2">After a break fee of {nim(breakFee, currency === 'USDT' ? 6 : 5)} {currency}. Your savings plan is closed.</p>}
        {bank && <p className="mt-2 text-ink-2">to {bank.split(' · ')[1] ?? bank}</p>}
        {simulated && <p className="mt-2 text-xs text-ink-2">Practice: nothing moved on chain or to a bank.</p>}
      </div>

      <ol className="mt-8 rounded-card bg-white p-5 shadow-soft">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center gap-3 py-2">
            <span className={`grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-300 ${s.done ? 'bg-mint text-white' : 'bg-lilac-soft text-lilac-ink'}`}>
              {s.done ? <Check size={14} weight="bold" /> : <CircleNotch size={14} weight="bold" className="animate-spin" />}
            </span>
            <span className={`flex-1 ${s.done ? 'font-semibold' : 'text-ink-2'}`}>{s.label}</span>
            {i === steps.length - 1 && !s.done && <span className="text-sm text-ink-2">about a minute</span>}
          </li>
        ))}
      </ol>

      <BottomBar>
        <PrimaryButton href={backHref}>{backLabel}</PrimaryButton>
      </BottomBar>
    </Screen>
  )
}
