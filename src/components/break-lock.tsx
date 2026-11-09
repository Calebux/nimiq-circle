'use client'

import { useEffect, useState } from 'react'
import type { GoalExitQuote } from '@/lib/goals'
import { PrimaryButton, SecondaryButton, Sheet } from './ui'

export function BreakLockSheet({ open, onOpenChange, quote, loading, busy, error, onRefresh, onWallet, onBank }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  quote: GoalExitQuote | null
  loading: boolean
  busy: boolean
  error: string | null
  onRefresh: () => void
  onWallet: () => void
  onBank: () => void
}) {
  const [accepted, setAccepted] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const expired = quote !== null && now >= quote.expiresAt
  const money = (amount: number) => `${amount.toLocaleString('en-US', { maximumFractionDigits: quote?.currency === 'USDT' ? 6 : 5 })} ${quote?.currency}`
  return (
    <Sheet open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value) }} title="Break your lock?" description="Withdraw everything early and close this savings plan.">
      {loading && <p className="py-4 text-ink-2" role="status">Calculating your break fee…</p>}
      {quote && !loading && <>
        <dl className="space-y-3 rounded-[var(--radius-inner)] bg-white p-4 text-sm">
          <div className="flex justify-between gap-3"><dt>Saved amount</dt><dd className="font-semibold tabular-nums">{money(quote.principal)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Earned rewards</dt><dd className="font-semibold tabular-nums">{money(quote.bonus)}</dd></div>
          <div className="flex justify-between gap-3 text-coral-ink"><dt>Break fee ({quote.feeBps / 100}%)</dt><dd className="font-semibold tabular-nums">−{money(quote.fee)}</dd></div>
          <div className="flex justify-between gap-3 border-t border-ink/10 pt-3 font-bold"><dt>You receive</dt><dd className="tabular-nums">{money(quote.net)}</dd></div>
        </dl>
        <p className="mt-3 text-sm text-ink-2">The fee applies to {quote.feeBasis === 'principal' ? 'your saved amount only. You keep your earned rewards.' : 'your saved amount and earned rewards.'} Waiting until your unlock date avoids this fee. Bank conversion fees are shown separately.</p>
        {quote.currency === 'NIM' && <p className="mt-2 text-sm text-ink-2">If your NIM is staked, funds may need 12–24 hours to become available. A failed withdrawal does not charge a break fee.</p>}
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[var(--radius-inner)] bg-lilac-soft p-4 text-sm font-semibold">
          <input type="checkbox" checked={accepted} disabled={busy || expired} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-coral" />
          I agree to the {money(quote.fee)} fee and closing this plan.
        </label>
      </>}
      {error && <p role="alert" className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft p-3 text-sm text-coral-ink">{error}</p>}
      {expired && <p role="status" className="mt-3 text-sm text-coral-ink">This quote expired. Refresh it to review the current amount.</p>}
      <div className="mt-5 flex flex-col gap-2">
        {(!quote || expired || error) && <SecondaryButton onClick={onRefresh} disabled={busy || loading}>Refresh fee quote</SecondaryButton>}
        <PrimaryButton onClick={onWallet} disabled={!quote || !accepted || expired || busy || loading}>{busy ? 'Sending…' : 'Break lock & send to wallet'}</PrimaryButton>
        <SecondaryButton onClick={onBank} disabled={!quote || !accepted || expired || busy || loading}>Break lock & cash out to bank</SecondaryButton>
        <button type="button" onClick={() => onOpenChange(false)} disabled={busy} className="press h-12 font-semibold text-ink-2">Keep saving</button>
      </div>
    </Sheet>
  )
}
