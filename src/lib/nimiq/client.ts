// Browser-side access to the wallet injected by Nimiq Pay.
import type { NimiqProvider } from '@nimiq/mini-app-sdk'

let providerPromise: Promise<NimiqProvider | null> | undefined

/** Resolves to the provider inside Nimiq Pay, or null in a normal browser. */
export function connectNimiq(): Promise<NimiqProvider | null> {
  providerPromise ??= import('@nimiq/mini-app-sdk')
    .then(({ init }) => init({ timeout: 4_000 }))
    .catch(() => null)
  return providerPromise
}

export async function hostNetwork(): Promise<string | undefined> {
  const { getHostNetwork } = await import('@nimiq/mini-app-sdk')
  return getHostNetwork()
}

export interface WalletError {
  /** One readable line, keeping the SDK error type when there is one. */
  text: string
  type?: string
  code?: number
  data?: unknown
}

export async function describeWalletError(err: unknown): Promise<WalletError> {
  const { NimiqProviderError } = await import('@nimiq/mini-app-sdk')
  if (NimiqProviderError.is(err)) {
    return { text: `${err.type}: ${err.message}`, type: err.type, code: err.code, data: err.data }
  }
  return { text: err instanceof Error ? err.message : String(err) }
}
