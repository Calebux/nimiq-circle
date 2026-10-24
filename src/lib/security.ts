import 'server-only'
import { timingSafeEqual } from 'node:crypto'
import { headers } from 'next/headers'
import { ApiError } from './errors'

/** Constant-time string compare, for shared secrets. */
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** `Authorization: Bearer $CRON_SECRET`, compared in constant time. */
export function requireCron(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || !safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) throw new ApiError('Not allowed', 401)
}

/** The pre-build spike page and its APIs: development only, unless SHOW_SPIKE=1. */
export function requireSpike() {
  if (process.env.NODE_ENV === 'production' && process.env.SHOW_SPIKE !== '1') throw new ApiError('Not found', 404)
}

const buckets = new Map<string, { count: number; resetAt: number }>()

/**
 * Fixed-window limit per client IP (behind nginx: X-Real-IP / X-Forwarded-For). In memory,
 * so per server process; enough to stop scripts hammering sign-in, gas or bank lookups.
 */
export async function rateLimit(name: string, max: number, windowMs: number) {
  const h = await headers()
  const ip = h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  const key = `${name}:${ip}`
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
    return
  }
  if (++bucket.count > max) throw new ApiError('Too many tries. Please wait a minute and try again.', 429)
}

/**
 * Refuse to run in production with settings that would quietly weaken security.
 * Called once at startup (src/instrumentation.ts).
 */
export function checkProductionConfig() {
  if (process.env.NODE_ENV !== 'production') return
  const problems: string[] = []
  const secret = (name: string, min: number) => {
    const v = process.env[name] ?? ''
    if (v.length < min) problems.push(`${name} must be at least ${min} characters`)
    return v
  }
  const session = secret('SESSION_SECRET', 32)
  const cron = secret('CRON_SECRET', 24)
  if (session && session === cron) problems.push('SESSION_SECRET and CRON_SECRET must differ')
  if (process.env.DEV_WALLET === '1') problems.push('DEV_WALLET must be off')
  if (process.env.INSTANT_PAYOUTS === '1') problems.push('INSTANT_PAYOUTS must be off')
  const keys = ['POOL_PRIVATE_KEY', 'EVM_POOL_PRIVATE_KEY', 'GAS_PRIVATE_KEY'].map((k) => process.env[k]?.trim()).filter(Boolean)
  if (new Set(keys).size !== keys.length) problems.push('POOL_PRIVATE_KEY, EVM_POOL_PRIVATE_KEY and GAS_PRIVATE_KEY must all be different')
  if (problems.length) throw new Error(`Unsafe production config:\n- ${problems.join('\n- ')}`)
}
