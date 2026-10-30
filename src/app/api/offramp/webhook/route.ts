import { createHmac, timingSafeEqual } from 'node:crypto'
import { settlePayoutByProvider } from '@/lib/circles'
import { settleWithdrawalByProvider } from '@/lib/goals'

/** Signatures older than this are replays. */
const TOLERANCE_S = 300

function verified(raw: string, header: string | null, secret: string) {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.trim().split('=') as [string, string]))
  const t = Number(parts.t)
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > TOLERANCE_S) return false
  const expected = createHmac('sha256', secret).update(`${parts.t}.${raw}`).digest()
  const given = Buffer.from(parts.v1, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * KhalkosPay events (offramp.paid, offramp.refunded, ...). Only a nudge: the order's status is
 * re-read from the API before anything changes, and the worker settles orders without it.
 */
export async function POST(request: Request) {
  const secret = process.env.KHALKOS_WEBHOOK_SECRET?.trim()
  if (!secret) return Response.json({ error: 'Webhooks are not set up' }, { status: 503 })
  const raw = await request.text()
  if (!verified(raw, request.headers.get('khalkospay-signature'), secret)) return Response.json({ error: 'Bad signature' }, { status: 401 })

  let event: { type?: string; sample?: boolean; data?: { id?: string } }
  try {
    event = JSON.parse(raw)
  } catch {
    return Response.json({ error: 'Bad body' }, { status: 400 })
  }
  const id = event.data?.id
  if (!event.sample && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
    try {
      await Promise.all([settleWithdrawalByProvider(id), settlePayoutByProvider(id)])
    } catch (err) {
      // Still 200: the worker retries every minute, and a 5xx would only make KhalkosPay resend.
      console.error('khalkos webhook', event.type, id, err)
    }
  }
  return Response.json({ received: true })
}
