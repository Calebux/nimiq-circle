'use client'

import { Bank as BankIcon, CaretRight, Check, CircleNotch, MagnifyingGlass } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { BANKS, type Bank } from '@/lib/constants'
import { BottomBar, PrimaryButton, Screen, Sheet, naira, nim } from './ui'
import { api } from './wallet'

export interface BankChoice {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
}

function BankPicker({ onPick }: { onPick: (bank: Bank) => void }) {
  const [query, setQuery] = useState('')
  const results = BANKS.filter((b) => `${b.name} ${b.short}`.toLowerCase().includes(query.trim().toLowerCase()))
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

interface Quote {
  rate: number
  feeNgn: number
  ngnOut: number
}

/** Bank, account number (name looked up as soon as it has 10 digits), live quote, confirm. */
export function CashOutSheet({
  open,
  onOpenChange,
  amountNim,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  amountNim: number
  onConfirm: (bank: BankChoice) => Promise<void>
}) {
  const [picking, setPicking] = useState(false)
  const [bank, setBank] = useState<Bank>(BANKS[0])
  const [account, setAccount] = useState('')
  const [resolved, setResolved] = useState<{ key: string; name: string } | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const key = `${bank.code}:${account}`
  const name = resolved?.key === key ? resolved.name : null
  const resolving = account.length === 10 && !name && !error

  useEffect(() => {
    if (account.length !== 10) return
    let cancelled = false
    api<{ accountName: string }>('/api/offramp', { body: { action: 'resolve', bankCode: bank.code, accountNumber: account } }).then(
      (r) => !cancelled && setResolved({ key: `${bank.code}:${account}`, name: r.accountName }),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [bank, account])

  useEffect(() => {
    if (!open || amountNim <= 0) return
    let cancelled = false
    api<Quote>('/api/offramp', { body: { action: 'quote', amount: amountNim } }).then(
      (q) => !cancelled && setQuote(q),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [open, amountNim])

  async function send() {
    if (!name) return
    setSending(true)
    setError(null)
    try {
      await onConfirm({ bankCode: bank.code, bankName: bank.short, accountNumber: account, accountName: name })
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSending(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={picking ? 'Choose a bank' : 'Cash out to bank'}
      description={picking ? undefined : 'Naira lands in your account in about a minute.'}
    >
      {picking ? (
        <BankPicker
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
            <div className="flex justify-between text-[15px]">
              <span className="text-ink-2">You send</span>
              <span className="font-semibold tabular-nums">{nim(amountNim, 2)} NIM</span>
            </div>
            <div className="mt-2 flex justify-between text-[15px]">
              <span className="text-ink-2">Rate</span>
              <span className="font-semibold tabular-nums">{quote ? `1 NIM = ₦${quote.rate.toFixed(2)}` : '…'}</span>
            </div>
            <div className="mt-2 flex justify-between text-[15px]">
              <span className="text-ink-2">Fee</span>
              <span className="font-semibold tabular-nums">{quote ? naira(quote.feeNgn) : '…'}</span>
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="font-semibold">You get</span>
              <span className="font-display text-3xl font-extrabold tracking-tight tabular-nums">{quote ? naira(quote.ngnOut) : '…'}</span>
            </div>
          </div>

          {error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p>}

          <div className="mt-5">
            <PrimaryButton onClick={send} disabled={!name || !quote || sending}>
              {sending ? 'Sending…' : name && quote ? `Send ${naira(quote.ngnOut)}` : 'Enter account number'}
            </PrimaryButton>
          </div>
        </>
      )}
    </Sheet>
  )
}

/** After money leaves the pool: where it went and whether it has landed. */
export function Sent({
  method,
  nimAmount,
  ngn,
  bank,
  landed,
  simulated,
  backHref,
  backLabel,
}: {
  method: 'wallet' | 'bank'
  nimAmount: number
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
          {method === 'bank' && ngn !== null ? naira(ngn) : `${nim(nimAmount, 2)} NIM`}
        </p>
        {bank && <p className="mt-2 text-ink-2">to {bank.split(' · ')[1] ?? bank}</p>}
        {simulated && <p className="mt-2 text-xs text-ink-2">Test wallet: simulated, nothing moved on chain.</p>}
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
