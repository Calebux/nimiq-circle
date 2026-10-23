'use client'

import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { connectNimiq, describeWalletError } from '@/lib/nimiq/client'

export interface Me {
  address: string
  name: string | null
  avatar: number
  dev: number
}

interface Config {
  poolAddress: string | null
  network: string
  devWallet: boolean
}

type Phase = 'loading' | 'signed-out' | 'signing-in' | 'ready'

interface Wallet {
  phase: Phase
  me: Me | null
  inNimiqPay: boolean
  devWallet: boolean
  error: string | null
  /** Resolves true once signed in; false if cancelled or failed (the error is in `error`). */
  signIn: () => Promise<boolean>
  setMe: (me: Me) => void
  /** Ask Nimiq Pay to send NIM to the pool with `memo`. Resolves with the wallet's return value. */
  pay: (input: { nim: number; memo: string }) => Promise<string>
}

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
        throw new Error('Open Circle inside Nimiq Pay to continue')
      }
      setPhase('ready')
      return true
    } catch (err) {
      setError(nimiq ? (await describeWalletError(err)).text : err instanceof Error ? err.message : String(err))
      setPhase('signed-out')
      return false
    }
  }, [nimiq, config])

  const pay = useCallback(
    async ({ nim, memo }: { nim: number; memo: string }) => {
      if (!nimiq) {
        if (me?.dev) return `mock:${memo}`
        throw new Error('Open Circle inside Nimiq Pay to pay')
      }
      if (!config?.poolAddress) throw new Error('Payments are not set up yet')
      await waitForSync(nimiq)
      try {
        return await nimiq.sendBasicTransactionWithData({ recipient: config.poolAddress, value: Math.round(nim * 100_000), data: memo })
      } catch (err) {
        throw new Error((await describeWalletError(err)).text)
      }
    },
    [nimiq, me, config],
  )

  return (
    <WalletContext.Provider value={{ phase, me, inNimiqPay: Boolean(nimiq), devWallet: Boolean(config?.devWallet), error, signIn, setMe, pay }}>
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
    async (input: { nim: number; memo: string; confirmUrl: string; extra?: Record<string, unknown> }) => {
      setError(null)
      setState('approving')
      try {
        const hint = await pay({ nim: input.nim, memo: input.memo })
        setState('confirming')
        const started = Date.now()
        while (Date.now() - started < 3 * 60_000) {
          const result = await api<{ status: string }>(input.confirmUrl, { body: { hint, ...input.extra } })
          if (result.status === 'confirmed') {
            setState('done')
            return true
          }
          await new Promise((r) => setTimeout(r, 3000))
        }
        throw new Error('Still waiting for the network. It will show up here once it confirms.')
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
