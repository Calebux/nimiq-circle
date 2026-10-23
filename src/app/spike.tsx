'use client'

import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { connectNimiq, describeWalletError, hostNetwork } from '@/lib/nimiq/client'
import type { ContributionCheck } from '@/lib/nimiq/contribution'
import type { PoolStatus } from '@/lib/nimiq/pool'
import type { OfframpPayout, OfframpQuote } from '@/lib/offramp/types'

const LUNA = 100_000
const POLL_MS = 3_000
const POLL_LIMIT_MS = 3 * 60_000

const nim = (luna: number) => `${(luna / LUNA).toLocaleString('en-US', { maximumFractionDigits: 5 })} NIM`

function duration(seconds: number) {
  if (seconds <= 0) return 'now'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json as T
}

function Card({ n, title, question, children }: { n: number; title: string; question: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
      <p className="text-xs font-bold uppercase tracking-wide text-black/40">Check {n}</p>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mb-3 text-sm text-black/60">{question}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-black/50">{label}</span>
      <span className="min-w-0 break-all text-right font-mono">{children}</span>
    </div>
  )
}

const buttonClass = 'h-12 rounded-xl bg-black px-4 font-bold text-white transition active:scale-[0.99] disabled:opacity-30'
const inputClass = 'h-12 rounded-xl bg-black/5 px-3 font-mono outline-none'

// --- Check 1 ----------------------------------------------------------------

function ContributeCheck({ pool }: { pool: PoolStatus | null }) {
  const [wallet, setWallet] = useState<NimiqProvider | null | undefined>(undefined)
  const [network, setNetwork] = useState<string>()
  const [account, setAccount] = useState<string>()
  const [amount, setAmount] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState<{ value: unknown; ms: number } | null>(null)
  const [check, setCheck] = useState<(ContributionCheck & { elapsed: number }) | null>(null)

  useEffect(() => {
    connectNimiq().then(async (provider) => {
      setWallet(provider)
      setNetwork(await hostNetwork())
      if (provider) provider.listAccounts().then((accounts) => setAccount(accounts[0]), () => undefined)
    })
  }, [])

  async function contribute() {
    if (!wallet || !pool) return
    setBusy(true)
    setError(null)
    setRaw(null)
    setCheck(null)
    const memo = `circle:spike:${crypto.randomUUID().slice(0, 6)}`
    const submittedAt = Date.now()
    let hint: string | null = null
    try {
      const value = await wallet.sendBasicTransactionWithData({ recipient: pool.address, value: Math.round(Number(amount) * LUNA), data: memo })
      setRaw({ value, ms: Date.now() - submittedAt })
      hint = typeof value === 'string' ? value : null
    } catch (err) {
      setError(await describeWalletError(err))
      setBusy(false)
      return
    }
    // Poll by hash/memo until it confirms, so we see both what the wallet returned and how long the chain takes.
    while (Date.now() - submittedAt < POLL_LIMIT_MS) {
      try {
        const result = await post<ContributionCheck>('/api/spike/contribution', { memo, hint, submittedAt, logOnConfirm: true })
        setCheck({ ...result, elapsed: Date.now() - submittedAt })
        if (result.status === 'confirmed' || result.status === 'failed_onchain' || result.status === 'wrong_recipient') break
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    setBusy(false)
  }

  const amountOk = Number(amount) > 0
  return (
    <Card n={1} title="Contribute from Nimiq Pay" question="What does sendBasicTransactionWithData return, and how fast can the server confirm a memo-tagged payment?">
      <Row label="Wallet">{wallet === undefined ? 'connecting…' : wallet ? 'Nimiq Pay ✓' : 'not in Nimiq Pay'}</Row>
      <Row label="Host network">{network ?? '—'}</Row>
      <Row label="Account">{account ?? '—'}</Row>
      <Row label="Pool">{pool?.address ?? '—'}</Row>
      {network && pool && network !== pool.network && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">Nimiq Pay is on {network} but the server is on {pool.network}.</p>
      )}
      <div className="flex gap-2">
        <input className={`${inputClass} w-24`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className={`${buttonClass} flex-1`} disabled={!wallet || !pool || busy || !amountOk} onClick={contribute}>
          {busy ? 'Working…' : `Send ${amount} NIM to pool`}
        </button>
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {raw && (
        <div className="rounded-xl bg-black/5 p-3">
          <Row label="Returned after">{raw.ms} ms</Row>
          <Row label="typeof">{typeof raw.value}</Row>
          <Row label="length">{typeof raw.value === 'string' ? raw.value.length : '—'}</Row>
          <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(raw.value)}</pre>
        </div>
      )}
      {check && (
        <div className="rounded-xl bg-black/5 p-3">
          <Row label="Status">{check.status}</Row>
          <Row label="Return value was">{check.hintKind}</Row>
          <Row label="Found by hash">{check.foundByHash ? 'yes' : 'no (memo scan)'}</Row>
          <Row label="Confirmations">{check.tx?.confirmations ?? '—'}</Row>
          <Row label="Elapsed">{(check.elapsed / 1000).toFixed(1)} s</Row>
          {check.tx && <Row label="Tx">{check.tx.hash}</Row>}
        </div>
      )}
    </Card>
  )
}

// --- Check 2 ----------------------------------------------------------------

function StakeCheck({ pool, error }: { pool: PoolStatus | null; error: string | null }) {
  const staker = pool?.staker
  return (
    <Card n={2} title="Stake the pool" question="How long is idle NIM locked between unstaking and being able to pay it out?">
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {pool && (
        <>
          <Row label="Block">{pool.block.toLocaleString()}</Row>
          <Row label="Liquid (payable now)">{nim(pool.liquid)}</Row>
          <Row label="Active stake">{staker ? nim(staker.balance) : 'no staker yet'}</Row>
          <Row label="Inactive">{staker ? nim(staker.inactiveBalance) : '—'}</Row>
          {pool.inactiveRelease && <Row label="Released in">{duration(pool.inactiveRelease.inSeconds)}</Row>}
          <Row label="Retired">{staker ? nim(staker.retiredBalance) : '—'}</Row>
          <Row label="Validator">{pool.validator ?? '—'}</Row>
          <Row label="Next election">{duration(pool.nextElection.inSeconds)}</Row>
          <Row label="Epoch length">{duration(pool.epochSeconds)}</Row>
          <Row label="Min stake">{nim(pool.minimumStake)}</Row>
          <p className="text-xs text-black/50">
            Run from the laptop: <code>npm run pool -- stake 100</code>, then <code>unstake</code>, <code>retire</code>, <code>remove</code>. Every step lands in the log below with its block.
          </p>
          {pool.log.length > 0 && (
            <ol className="flex flex-col gap-1 rounded-xl bg-black/5 p-3 text-xs">
              {pool.log.map((entry) => (
                <li key={`${entry.at}-${entry.event}`} className="flex justify-between gap-2 font-mono">
                  <span>{entry.event}</span>
                  <span className="text-black/50">
                    #{entry.block} · {new Date(entry.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  )
}

// --- Check 3 ----------------------------------------------------------------

function PayoutCheck() {
  const [bankCode, setBankCode] = useState('058')
  const [accountNumber, setAccountNumber] = useState('')
  const [accountName, setAccountName] = useState<string | null>(null)
  const [amount, setAmount] = useState('100')
  const [quote, setQuote] = useState<(OfframpQuote & { provider: string; accepts: string[] }) | null>(null)
  const [payout, setPayout] = useState<OfframpPayout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (step: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await step()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }, [])

  const payoutId = payout?.id
  const payoutDone = payout?.status === 'paid' || payout?.status === 'failed'
  useEffect(() => {
    if (!payoutId || payoutDone) return
    const timer = setInterval(() => post<OfframpPayout>('/api/spike/payout', { action: 'get', id: payoutId }).then(setPayout, () => undefined), POLL_MS)
    return () => clearInterval(timer)
  }, [payoutId, payoutDone])

  return (
    <Card n={3} title="Cash out to a bank" question="Does the provider resolve the account, quote NIM → NGN and pay out, and how long does the naira take to land?">
      <div className="flex gap-2">
        <input className={`${inputClass} w-20`} placeholder="Bank" value={bankCode} onChange={(e) => setBankCode(e.target.value)} />
        <input
          className={`${inputClass} min-w-0 flex-1`}
          placeholder="Account number"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => {
            setAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 10))
            setAccountName(null)
          }}
        />
      </div>
      <button
        className={buttonClass}
        disabled={busy || accountNumber.length !== 10}
        onClick={() => run(async () => setAccountName((await post<{ accountName: string }>('/api/spike/payout', { action: 'resolve', bankCode, accountNumber })).accountName))}
      >
        Resolve account
      </button>
      {accountName && <Row label="Account name">{accountName}</Row>}
      <div className="flex gap-2">
        <input className={`${inputClass} w-24`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button
          className={`${buttonClass} flex-1`}
          disabled={busy || !(Number(amount) > 0)}
          onClick={() => run(async () => setQuote(await post('/api/spike/payout', { action: 'quote', amount: Math.round(Number(amount) * LUNA) })))}
        >
          Quote {amount} NIM
        </button>
      </div>
      {quote && (
        <div className="rounded-xl bg-black/5 p-3">
          <Row label="Provider">{quote.provider}</Row>
          <Row label="Accepts">{quote.accepts.join(', ')}</Row>
          <Row label="Rate">₦{quote.rate} / NIM</Row>
          <Row label="Fee">₦{quote.feeNgn.toLocaleString()}</Row>
          <Row label="They receive">₦{quote.ngnOut.toLocaleString()}</Row>
        </div>
      )}
      <button
        className={buttonClass}
        disabled={busy || !quote || !accountName}
        onClick={() =>
          run(async () =>
            setPayout(
              await post('/api/spike/payout', {
                action: 'create',
                quoteId: quote?.id,
                bankCode,
                accountNumber,
                accountName,
                reference: `circle:spike:${Date.now()}`,
              }),
            ),
          )
        }
      >
        Send payout
      </button>
      {payout && (
        <div className="rounded-xl bg-black/5 p-3">
          <Row label="Status">{payout.status}</Row>
          {payout.depositAddress && <Row label="Pool must send to">{payout.depositAddress}</Row>}
          {payout.paidAt && <Row label="Landed after">{((payout.paidAt - payout.createdAt) / 1000).toFixed(1)} s</Row>}
        </div>
      )}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </Card>
  )
}

// --- Page -------------------------------------------------------------------

export function Spike() {
  const [pool, setPool] = useState<PoolStatus | null>(null)
  const [poolError, setPoolError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const load = () =>
      fetch('/api/spike/pool', { cache: 'no-store' })
        .then(async (res) => {
          const json = await res.json()
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
          return json as PoolStatus
        })
        .then(
          (status) => mounted.current && (setPool(status), setPoolError(null)),
          (err: Error) => mounted.current && setPoolError(err.message),
        )
    load()
    const timer = setInterval(load, 15_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [])

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <header>
        <h1 className="text-2xl font-extrabold">Circle spike</h1>
        <p className="text-sm text-black/60">Three checks before the build: contribute, stake, cash out.</p>
      </header>
      <ContributeCheck pool={pool} />
      <StakeCheck pool={pool} error={poolError} />
      <PayoutCheck />
    </main>
  )
}
