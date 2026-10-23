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

/** Turns anything the SDK throws into a readable line, keeping the error type when there is one. */
export async function describeWalletError(err: unknown): Promise<string> {
  const { NimiqProviderError } = await import('@nimiq/mini-app-sdk')
  if (NimiqProviderError.is(err)) return `${err.type}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}
