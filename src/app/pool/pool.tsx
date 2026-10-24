'use client'

import { ArrowSquareOut, CheckCircle, Copy, Plant } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useState } from 'react'
import { Splash } from '@/components/gate'
import { BackLink, Screen, nim } from '@/components/ui'
import { useApi } from '@/components/wallet'

interface Pool {
  address: string
  validator: string | null
  liquid: number
  stakedActive: number
  unstaking: number
  total: number
  owedToMembers: number
  operator: number
  earned: number
  covered: boolean
  actions: { kind: string; amount: number; txHash: string | null; at: number }[]
  usdt: { address: string; held: number | null; owedToMembers: number; covered: boolean } | null
}

/** nimiq.watch takes `#NQ87+CJDL+…` for addresses and `#<hash>` for transactions. */
const explorer = (ref: string) => `https://nimiq.watch/#${ref.trim().replace(/\s+/g, '+')}`
const ACTION_LABEL: Record<string, string> = {
  create: 'Started staking',
  stake: 'Staked',
  unstake: 'Started unstaking',
  retire: 'Unstake released',
  remove: 'Back to liquid',
}

function Bar({ parts }: { parts: { value: number; className: string; label: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  return (
    <div className="flex h-4 overflow-hidden rounded-full bg-blush" role="img" aria-label={parts.map((p) => `${p.label} ${nim(p.value)} NIM`).join(', ')}>
      {parts.map((p) => (
        <span key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
      ))}
    </div>
  )
}

/** Public proof of reserves: the pool, read live from the Nimiq chain. */
export function PoolScreen() {
  const { data } = useApi<Pool>('/api/pool', 30_000)
  const [copied, setCopied] = useState(false)
  if (!data) return <Splash />
  const compact = data.address.replace(/\s/g, '')

  return (
    <Screen bar={false}>
      <header className="flex items-center gap-3">
        <BackLink href="/" />
        <div>
          <p className="text-sm text-ink-2">Proof of reserves</p>
          <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tight">The pool, on chain</h1>
        </div>
      </header>

      <section className="mt-6 rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
        <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-6px)] bg-mint-soft p-5">
          <Image src="/art/pot.webp" alt="" width={710} height={800} className="pointer-events-none absolute -right-2 -top-1 w-[96px]" />
          <p className="text-sm font-semibold text-mint-ink">Held on Nimiq</p>
          <p className="mt-1 font-display text-[44px] font-extrabold leading-none tracking-tight tabular-nums">{nim(data.total)}</p>
          <p className="mt-1 text-[15px] text-mint-ink">NIM, against {nim(data.owedToMembers)} NIM owed to members</p>
          <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${data.covered ? 'bg-white text-mint-ink' : 'bg-coral-soft text-coral-ink'}`}>
            <CheckCircle size={16} weight="fill" /> {data.covered ? 'Every member’s NIM is covered' : 'Short: the operator is topping up'}
          </p>
        </div>
      </section>

      {data.usdt && (
        <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
          <p className="text-sm font-semibold text-ink-2">Held on Polygon</p>
          <p className="mt-1 font-display text-[32px] font-extrabold leading-none tracking-tight tabular-nums">{data.usdt.held === null ? '…' : nim(data.usdt.held, 2)}</p>
          <p className="mt-1 text-[15px] text-ink-2">USDT, against {nim(data.usdt.owedToMembers, 2)} USDT owed to members</p>
          {data.usdt.held !== null && (
            <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold ${data.usdt.covered ? 'bg-mint-soft text-mint-ink' : 'bg-coral-soft text-coral-ink'}`}>
              <CheckCircle size={16} weight="fill" /> {data.usdt.covered ? 'Every member’s USDT is covered' : 'Short: the operator is topping up'}
            </p>
          )}
          <a
            href={`https://polygonscan.com/token/0xc2132D05D31c914a87C6611C10748AEb04B58e8F?a=${data.usdt.address}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center gap-1 text-sm font-semibold text-coral-ink underline decoration-2 underline-offset-4"
          >
            <span className="break-all font-mono">{data.usdt.address}</span> <ArrowSquareOut size={14} weight="bold" className="shrink-0" />
          </a>
        </section>
      )}

      <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
        <h2 className="font-display text-xl font-bold tracking-tight">Where it is</h2>
        <div className="mt-3">
          <Bar
            parts={[
              { value: data.liquid, className: 'bg-coral', label: 'Ready to pay out' },
              { value: data.stakedActive, className: 'bg-mint', label: 'Staked' },
              { value: data.unstaking, className: 'bg-lilac', label: 'Unstaking' },
            ]}
          />
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ['Ready', data.liquid, 'text-coral-ink'],
            ['Staked', data.stakedActive, 'text-mint-ink'],
            ['Unstaking', data.unstaking, 'text-lilac-ink'],
          ].map(([label, value, color]) => (
            <div key={label as string} className="rounded-[var(--radius-inner)] bg-blush p-3">
              <dt className={`text-xs font-semibold ${color}`}>{label}</dt>
              <dd className="font-display text-lg font-extrabold tabular-nums">{nim(value as number)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-sm leading-snug text-ink-2">
          Money that could be asked for in the next two days stays ready. The rest is staked with a Nimiq validator, and unstaking takes 12 to 24 hours, so it starts well before a payout or unlock date.
        </p>
      </section>

      <section className="mt-4 flex items-center gap-3 rounded-card bg-mint-soft p-4">
        <Plant size={28} weight="fill" className="shrink-0 text-mint" />
        <p className="text-[15px] text-mint-ink">
          <strong className="font-display text-lg font-extrabold">+{nim(data.earned, 2)} NIM</strong> earned from staking so far, shared with members by how much each pot holds.
        </p>
      </section>

      <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
        <h2 className="font-display text-xl font-bold tracking-tight">Check it yourself</h2>
        <button
          onClick={() => navigator.clipboard?.writeText(compact).then(() => setCopied(true), () => undefined)}
          className="press mt-3 flex w-full items-center gap-2 rounded-[var(--radius-inner)] bg-blush px-4 py-3 text-left font-mono text-sm"
        >
          <span className="flex-1 break-all">{data.address}</span>
          {copied ? <CheckCircle size={18} weight="fill" className="text-mint" /> : <Copy size={18} />}
        </button>
        <a href={explorer(data.address)} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-coral-ink underline decoration-2 underline-offset-4">
          Open the pool on nimiq.watch <ArrowSquareOut size={14} weight="bold" />
        </a>
        <p className="mt-3 text-sm text-ink-2">
          Every contribution is a public transaction to this address with a reference like <span className="font-mono">cc:circle:round</span>, so anyone can add it up.
          {data.operator > 0 && ` It also holds ${nim(data.operator)} NIM of the operator’s own money, which is never counted as members’ earnings.`}
        </p>
      </section>

      {data.actions.length > 0 && (
        <section className="mt-4 rounded-card bg-white p-5 shadow-soft">
          <h2 className="font-display text-xl font-bold tracking-tight">Recent staking moves</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {data.actions.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-[15px]">
                <span>{ACTION_LABEL[a.kind] ?? a.kind}</span>
                <span className="flex items-center gap-2 tabular-nums text-ink-2">
                  {nim(a.amount)} NIM
                  {a.txHash && (
                    <a href={explorer(a.txHash)} target="_blank" rel="noreferrer" aria-label="View transaction">
                      <ArrowSquareOut size={14} weight="bold" />
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}
