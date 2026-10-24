import 'server-only'

const CACHE_MS = 60_000
let cached: { at: number; usd: number } | null = null

/** NIM in USD (≈ USDT). CoinGecko, cached a minute; NIM_USD_FALLBACK if it is unreachable. */
export async function nimUsd(): Promise<number> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.usd
  try {
    const key = process.env.COINGECKO_API_KEY
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd', {
      headers: key ? { 'x-cg-demo-api-key': key } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
    const usd = (await res.json())?.['nimiq-2']?.usd
    if (typeof usd !== 'number' || !(usd > 0)) throw new Error('No NIM price')
    cached = { at: Date.now(), usd }
    return usd
  } catch (err) {
    if (cached) return cached.usd
    const fallback = Number(process.env.NIM_USD_FALLBACK)
    if (fallback > 0) return fallback
    throw err
  }
}
