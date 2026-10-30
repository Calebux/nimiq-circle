// Browser-side USDT on Polygon, through the EIP-1193 wallet Nimiq Pay injects as window.ethereum
// (next to the Nimiq one). Spike check 3 showed it answers eth_requestAccounts, switches to
// Polygon, and reads balances.
import { POLYGON_CHAIN_ID, USDT_POLYGON } from '@/lib/currency'

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

export const hasEvmWallet = () => typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum)

function ethereum(): Eip1193 {
  const provider = (window as { ethereum?: Eip1193 }).ethereum
  if (!provider) throw new Error('Open Akilii inside Nimiq Pay to use USDT')
  return provider
}

/** Wallet errors in words a member can act on. */
export function describeEvmError(err: unknown): string {
  const e = err as { code?: number; message?: string }
  if (e?.code === 4001) return 'You cancelled in Nimiq Pay'
  if (/insufficient funds/i.test(e?.message ?? '')) return 'Not enough POL for the network fee. Please try again in a minute.'
  return e?.message ?? String(err)
}

const onPolygon = async (provider: Eip1193) => String(await provider.request({ method: 'eth_chainId' })).toLowerCase() === POLYGON_CHAIN_ID

/**
 * The member's Polygon address, with the wallet switched to Polygon. Nimiq Pay opens on Ethereum,
 * and right after a switch it can still answer for the old chain, so wait until it says Polygon.
 */
export async function evmAccount(): Promise<string> {
  const provider = ethereum()
  const [account] = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  if (!account) throw new Error('No Polygon account in Nimiq Pay')
  if (await onPolygon(provider)) return account
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: POLYGON_CHAIN_ID }] })
  for (let i = 0; i < 20; i++) {
    if (await onPolygon(provider)) return account
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('Nimiq Pay did not switch to Polygon. Please try again.')
}

const word = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')
const utf8Hex = (text: string) => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Send `micro` USDT to `to`, with `memo` appended after the transfer call data (the token
 * ignores it; the server reads it back). Resolves with the transaction hash.
 */
export async function sendUsdt(input: { from: string; to: string; micro: number; memo: string; gas: { gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string } }) {
  const data = `0xa9059cbb${word(input.to)}${word(BigInt(input.micro).toString(16))}${utf8Hex(input.memo)}`
  return (await ethereum().request({
    method: 'eth_sendTransaction',
    // chainId pins it to Polygon: a wallet that has not finished switching refuses instead of sending elsewhere.
    params: [{ from: input.from, to: USDT_POLYGON, value: '0x0', data, chainId: POLYGON_CHAIN_ID, ...input.gas }],
  })) as string
}
