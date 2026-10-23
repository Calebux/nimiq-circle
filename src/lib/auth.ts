import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { all, newId, one, run } from './db'
import { serverConfig } from './env'
import { ApiError } from './errors'
import { compactAddress, formatAddress, isValidNimiqAddress, sameAddress } from './nimiq/address'

const COOKIE = 'circle_session'
const SESSION_DAYS = 30
const CHALLENGE_TTL_MS = 10 * 60_000
export const AVATAR_COUNT = 6

export interface User {
  address: string
  name: string | null
  avatar: number
  dev: number
}

// --- Users -------------------------------------------------------------------

function avatarFor(address: string) {
  const digest = createHash('sha256').update(compactAddress(address)).digest()
  return (digest[0] % AVATAR_COUNT) + 1
}

export async function ensureUser(address: string, dev = false): Promise<User> {
  const formatted = formatAddress(address)
  await run('INSERT OR IGNORE INTO users (address, name, avatar, dev, created_at) VALUES (?, NULL, ?, ?, ?)', [
    formatted,
    avatarFor(formatted),
    dev ? 1 : 0,
    Date.now(),
  ])
  return (await one<User>('SELECT address, name, avatar, dev FROM users WHERE address = ?', [formatted]))!
}

export async function usersByAddress(addresses: string[]): Promise<Map<string, User>> {
  if (addresses.length === 0) return new Map()
  const rows = await all<User>(`SELECT address, name, avatar, dev FROM users WHERE address IN (${addresses.map(() => '?').join(',')})`, addresses)
  return new Map(rows.map((u) => [u.address, u]))
}

export function displayName(user: Pick<User, 'name' | 'address'> | undefined, viewer?: string): string {
  if (!user) return 'Someone'
  if (viewer && sameAddress(user.address, viewer)) return 'You'
  if (user.name) return user.name
  const compact = compactAddress(user.address)
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`
}

// --- Sign-in -----------------------------------------------------------------

export function signInMessage(nonce: string) {
  return `Sign in to Circle\n\nThis proves you own this wallet. It does not move any money.\n\nCode: ${nonce}`
}

export async function createChallenge() {
  const nonce = newId(12)
  await run('DELETE FROM challenges WHERE created_at < ?', [Date.now() - CHALLENGE_TTL_MS])
  await run('INSERT INTO challenges (nonce, created_at) VALUES (?, ?)', [nonce, Date.now()])
  return { nonce, message: signInMessage(nonce) }
}

/**
 * Nimiq Pay's sign(): sha256("\x16Nimiq Signed Message:\n" + byteLength + message), signed with
 * Ed25519; returns hex publicKey + signature (nimiq-pay-app useMiniAppHost.ts).
 */
function signedMessageHash(message: string): Uint8Array {
  const body = Buffer.from(message, 'utf8')
  const prefix = Buffer.from(`\x16Nimiq Signed Message:\n${body.length}`, 'utf8')
  return createHash('sha256').update(Buffer.concat([prefix, body])).digest()
}

export async function verifySignIn(input: { address: string; nonce: string; publicKey: string; signature: string }): Promise<User> {
  if (!isValidNimiqAddress(input.address)) throw new ApiError('That is not a Nimiq address')
  const challenge = await one<{ created_at: number }>('SELECT created_at FROM challenges WHERE nonce = ?', [input.nonce])
  if (!challenge || Date.now() - challenge.created_at > CHALLENGE_TTL_MS) throw new ApiError('Sign-in expired, please try again', 401)
  await run('DELETE FROM challenges WHERE nonce = ?', [input.nonce])

  const Nimiq = await import('@nimiq/core')
  let ok = false
  try {
    const publicKey = Nimiq.PublicKey.fromHex(input.publicKey)
    ok =
      sameAddress(publicKey.toAddress().toUserFriendlyAddress(), input.address) &&
      publicKey.verify(Nimiq.Signature.fromHex(input.signature), signedMessageHash(signInMessage(input.nonce)))
  } catch {
    ok = false
  }
  if (!ok) throw new ApiError('That signature does not match this wallet', 401)
  return ensureUser(input.address)
}

/** Dev wallet: a throwaway address, no signature. Disabled outside development. */
export async function devSignIn(): Promise<User> {
  if (!serverConfig().devWallet) throw new ApiError('Not available', 404)
  const Nimiq = await import('@nimiq/core')
  return ensureUser(Nimiq.KeyPair.generate().toAddress().toUserFriendlyAddress(), true)
}

// --- Session -----------------------------------------------------------------

function sign(payload: string) {
  const secret = serverConfig().sessionSecret
  if (!secret) throw new Error('SESSION_SECRET is not set')
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export async function startSession(address: string) {
  const expires = Date.now() + SESSION_DAYS * 86_400_000
  const payload = `${compactAddress(address)}.${expires}`
  ;(await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
}

export async function endSession() {
  ;(await cookies()).delete(COOKIE)
}

export async function currentUser(): Promise<User | null> {
  const raw = (await cookies()).get(COOKIE)?.value
  if (!raw) return null
  const [address, expires, mac] = raw.split('.')
  if (!address || !expires || !mac || Number(expires) < Date.now()) return null
  const expected = Buffer.from(sign(`${address}.${expires}`))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return one<User>('SELECT address, name, avatar, dev FROM users WHERE address = ?', [formatAddress(address)])
}

export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) throw new ApiError('Please sign in again', 401)
  return user
}
