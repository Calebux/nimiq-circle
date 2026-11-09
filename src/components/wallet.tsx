'use client'

import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ExitFeePolicy } from '@/lib/goal-exit-policy'
import { CADENCES, NGN_PER_NIM } from '@/lib/constants'
import { UNIT, type Currency } from '@/lib/currency'
import { describeEvmError, evmAccount, hasEvmWallet, sendUsdt } from '@/lib/evm/client'
import { connectNimiq, describeWalletError } from '@/lib/nimiq/client'
import { naira } from './ui'

export interface Me {
  address: string
  name: string | null
  avatar: number
  dev: number
}

interface Config {
  poolAddress: string | null
  /** The pool's Polygon address, for USDT. */
  usdtPoolAddress: string | null
  network: string
  devWallet: boolean
  /** Live NIM → NGN for "≈ ₦" lines; cash-outs always use a locked quote. */
  ngnPerNim: number | null
  /** The provider's USDT → NGN, for estimates. */
  ngnPerUsdt: number | null
  /** Round lengths the server accepts (adds a 10-minute one in demo mode). */
  earlyExitPolicy: ExitFeePolicy | null
  cadences: string[]
}

type Phase = 'loading' | 'signed-out' | 'signing-in' | 'ready'

interface Wallet {
  phase: Phase
  me: Me | null
  inNimiqPay: boolean
  devWallet: boolean
  /** Live NGN per unit of each currency, for estimates. */
  ngnPer: Record<Currency, number>
  earlyExitPolicy: ExitFeePolicy | null
  cadences: string[]
  error: string | null
  /** Resolves true once signed in; false if cancelled or failed (the error is in `error`). */
  signIn: () => Promise<boolean>
  setMe: (me: Me) => void
  signOut: () => Promise<void>
  /**
   * Ask Nimiq Pay to pay the pool with `memo` (NIM on Nimiq, USDT on Polygon). Resolves with the
   * wallet's return value. `to` pays someone's own wallet instead (NIM only: wallet-goal gifts).
   */
  pay: (input: { amount: number; currency: Currency; memo: string; to?: string }) => Promise<string>
  /** Sign a staking transaction from the user's own wallet (wallet goals). Amounts in luna. */
  stake: (op: StakeOp) => Promise<string>
}

export type StakeOp =
  | { type: 'create'; value: number; delegation: string }
  | { type: 'add'; value: number }
  | { type: 'setActive'; value: number }
  | { type: 'retire'; value: number }
  | { type: 'remove'; value: number }

const WalletContext = createContext<Wallet | null>(null)

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json.error ?? `Something went wrong (${res.status})`), { status: res.status })
  return json as T
}

/** Fallback for "≈ ₦" on USDT until /api/config answers. */
const NGN_PER_USDT = 1_330

/**
 * USDT from the member's Polygon wallet in Nimiq Pay: check the balance, have the server top up
 * POL for the fee if they have none, then send. Resolves with the transaction hash.
 */
async function payUsdt({ amount, memo, to }: { amount: number; memo: string; to: string | null }) {
  if (!to) throw new Error('USDT payments are not set up yet')
  try {
    const from = await evmAccount()
    const micro = Math.round(amount * UNIT.USDT)
    // The server reads the balance from Polygon itself, and only tops up gas if the USDT is there.
    const g = await api<{ usdt: number; gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string }>('/api/gas', { body: { address: from, micro } })
    if (g.usdt < micro) throw new Error(`You have ${(g.usdt / UNIT.USDT).toFixed(2)} USDT on Polygon in Nimiq Pay. Add a bit more and try again.`)
    return await sendUsdt({ from, to, micro, memo, gas: { gas: g.gas, maxFeePerGas: g.maxFeePerGas, maxPriorityFeePerGas: g.maxPriorityFeePerGas } })
  } catch (err) {
    throw new Error(describeEvmError(err))
  }
}

/** Nimiq Pay rejects payments until its wallet has synced (spike check 1). Wait up to ~15 s. */
async function waitForSync(nimiq: NimiqProvider) {
  for (let i = 0; i < 15; i++) {
    if (await nimiq.isConsensusEstablished().catch(() => false)) return
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Your wallet is still syncing. Check your connection and try again.')
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const [config, setConfig] = useState<Config | null>(null)
  const [nimiq, setNimiq] = useState<NimiqProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api<Config>('/api/config'), api<{ user: Me | null }>('/api/me'), connectNimiq()]).then(
      async ([cfg, { user }, provider]) => {
        if (cancelled) return
        setConfig(cfg)
        setNimiq(provider)
        // A session only counts if it belongs to the wallet that is open right now.
        let valid = Boolean(user)
        if (user && provider) {
          const accounts = await provider.listAccounts().catch(() => [] as string[])
          valid = accounts.some((a) => a.replace(/\s/g, '') === user.address.replace(/\s/g, ''))
        } else if (user?.dev && !cfg.devWallet) valid = false
        if (cancelled) return
        setMe(valid ? user : null)
        setPhase(valid ? 'ready' : 'signed-out')
      },
      (err: Error) => !cancelled && (setError(err.message), setPhase('signed-out')),
    )
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async () => {
    setError(null)
    setPhase('signing-in')
    try {
      if (nimiq) {
        const [address] = await nimiq.listAccounts()
        if (!address) throw new Error('No account in Nimiq Pay')
        const { nonce, message } = await api<{ nonce: string; message: string }>('/api/auth/challenge', { method: 'POST' })
        const { publicKey, signature } = await nimiq.sign(message)
        const { user } = await api<{ user: Me }>('/api/auth/verify', { body: { address, nonce, publicKey, signature } })
        setMe(user)
      } else if (config?.devWallet) {
        const { user } = await api<{ user: Me }>('/api/auth/dev', { method: 'POST' })
        setMe(user)
      } else {
        throw new Error('Open Akilii inside Nimiq Pay to continue')
      }
      setPhase('ready')
      return true
    } catch (err) {
      setError(nimiq ? (await describeWalletError(err)).text : err instanceof Error ? err.message : String(err))
      setPhase('signed-out')
      return false
    }
  }, [nimiq, config])

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setMe(null)
    setPhase('signed-out')
  }, [])

  const pay = useCallback(
    async ({ amount, currency, memo, to }: { amount: number; currency: Currency; memo: string; to?: string }) => {
      if (!nimiq) {
        if (me?.dev) return `mock:${memo}`
        throw new Error('Open Akilii inside Nimiq Pay to pay')
      }
      if (to && currency !== 'NIM') throw new Error('Gifts to a wallet are in NIM')
      if (currency === 'USDT') return payUsdt({ amount, memo, to: config?.usdtPoolAddress ?? null })
      const recipient = to ?? config?.poolAddress
      if (!recipient) throw new Error('Payments are not set up yet')
      await waitForSync(nimiq)
      try {
        return await nimiq.sendBasicTransactionWithData({ recipient, value: Math.round(amount * UNIT.NIM), data: memo })
      } catch (err) {
        const e = await describeWalletError(err)
        // Only a refusal or a rejected transaction means nothing was sent. Anything else (Nimiq Pay's
        // "transaction outcome unknown", a timeout) may still have gone out, so the caller checks the chain.
        const notSent = e.type === 'PERMISSION_DENIED' || e.type === 'INVALID_TRANSACTION' || e.type === 'UNKNOWN_REQUEST'
        throw Object.assign(new Error(e.text), { maybeSent: !notSent })
      }
    },
    [nimiq, me, config],
  )

  const stake = useCallback(
    async (op: StakeOp) => {
      if (!nimiq) {
        if (me?.dev) return `mock:${op.type}`
        throw new Error('Open Akilii inside Nimiq Pay to stake')
      }
      await waitForSync(nimiq)
      try {
        let result: string | { error?: unknown }
        if (op.type === 'create') result = await nimiq.sendNewStakerTransaction({ delegation: op.delegation, value: op.value })
        else if (op.type === 'add') result = await nimiq.sendStakeTransaction({ value: op.value })
        else if (op.type === 'setActive') result = await nimiq.sendSetActiveStakeTransaction({ newActiveBalance: op.value })
        else if (op.type === 'retire') result = await nimiq.sendRetireStakeTransaction({ retireStake: op.value })
        else result = await nimiq.sendRemoveStakeTransaction({ value: op.value })
        // The SDK resolves with an error object rather than throwing on some hosts.
        if (typeof result !== 'string') throw result
        return result
      } catch (err) {
        const e = await describeWalletError(err)
        const notSent = e.type === 'PERMISSION_DENIED' || e.type === 'INVALID_TRANSACTION' || e.type === 'UNKNOWN_REQUEST'
        throw Object.assign(new Error(e.text), { maybeSent: !notSent })
      }
    },
    [nimiq, me],
  )

  return (
    <WalletContext.Provider
      value={{ earlyExitPolicy: config?.earlyExitPolicy ?? null, phase, me, inNimiqPay: Boolean(nimiq), devWallet: Boolean(config?.devWallet), ngnPer: { NIM: config?.ngnPerNim ?? NGN_PER_NIM, USDT: config?.ngnPerUsdt ?? NGN_PER_USDT }, cadences: config?.cadences ?? [...CADENCES], error, signIn, signOut, setMe, pay, stake }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const wallet = useContext(WalletContext)
  if (!wallet) throw new Error('useWallet outside WalletProvider')
  return wallet
}

/** GET a JSON endpoint; `reload` refetches. Optional polling while `poll` is truthy. */
export function useApi<T>(url: string | null, poll?: number | false) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    if (!url) return
    let cancelled = false
    const load = () =>
      api<T>(url).then(
        (d) => !cancelled && (setData(d), setError(null)),
        (e: Error) => !cancelled && setError(e.message),
      )
    load()
    const timer = poll ? setInterval(load, poll) : undefined
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [url, poll, tick])
  return { data, error, reload, setData }
}

/**
 * Pay with Nimiq Pay, then poll `confirmUrl` until the server sees the payment on chain.
 * The server checks recipient, memo, sender and amount; the client only reports the hint.
 */
export function usePayment() {
  const { pay } = useWallet()
  const [state, setState] = useState<'idle' | 'approving' | 'confirming' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (input: { amount: number; currency: Currency; memo: string; to?: string; confirmUrl: string; extra?: Record<string, unknown>; practice?: boolean }) => {
      setError(null)
      setState('approving')
      try {
        let hint: string | null
        let waitMs = 3 * 60_000
        try {
          // Practice circles: no wallet, the server records it as simulated.
          hint = input.practice ? 'practice' : await pay({ amount: input.amount, currency: input.currency, memo: input.memo, to: input.to })
        } catch (err) {
          if (!(err as { maybeSent?: boolean }).maybeSent) throw err
          // No hash to go on: the server finds the payment by its memo and sender instead.
          hint = null
          waitMs = 90_000
        }
        setState('confirming')
        const started = Date.now()
        while (Date.now() - started < waitMs) {
          const result = await api<{ status: string }>(input.confirmUrl, { body: { hint, ...input.extra } })
          if (result.status === 'confirmed') {
            setState('done')
            return true
          }
          await new Promise((r) => setTimeout(r, 3000))
        }
        throw new Error(
          hint
            ? 'Still waiting for the network. It will show up here once it confirms.'
            : 'We could not confirm the payment yet. If it left your wallet, it will show up here within a few minutes.',
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setState('idle')
        return false
      }
    },
    [pay],
  )

  return { state, error, run, reset: () => setState('idle') }
}

/** Where "Send to Nimiq Pay" pays out: USDT goes to the member's Polygon address in Nimiq Pay. */
export async function payoutTarget(currency: Currency): Promise<{ evmAddress?: string }> {
  if (currency !== 'USDT' || !hasEvmWallet()) return {}
  try {
    return { evmAddress: await evmAccount() }
  } catch (err) {
    throw new Error(describeEvmError(err))
  }
}

/** "₦1,234" for an amount of NIM or USDT at the live rate. Estimates only. */
export function Ngn({ amount, currency }: { amount: number; currency: Currency }) {
  return <>{naira(amount * useWallet().ngnPer[currency])}</>
}
