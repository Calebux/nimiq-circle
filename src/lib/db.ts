import 'server-only'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createClient, type Client, type InArgs } from '@libsql/client'
import { serverConfig } from './env'

// Amounts are luna (1 NIM = 100,000 luna) stored as INTEGER. Times are ms since epoch.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    address    TEXT PRIMARY KEY,
    name       TEXT,
    avatar     INTEGER NOT NULL,
    -- Dev-wallet user: payments to and from them are simulated, never on chain.
    dev        INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS circles (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    local_name    TEXT NOT NULL,
    cadence       TEXT NOT NULL,
    contribution  INTEGER NOT NULL,
    size          INTEGER NOT NULL,
    order_mode    TEXT NOT NULL,
    invite_code   TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL,
    round         INTEGER NOT NULL DEFAULT 0,
    started_at    INTEGER,
    created_by    TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    circle_id  TEXT NOT NULL REFERENCES circles(id),
    address    TEXT NOT NULL,
    turn       INTEGER NOT NULL,
    joined_at  INTEGER NOT NULL,
    PRIMARY KEY (circle_id, address),
    UNIQUE (circle_id, turn)
  )`,
  // One row per on-chain deposit into the pool, for a circle round or a goal.
  `CREATE TABLE IF NOT EXISTS deposits (
    tx_hash    TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    ref_id     TEXT NOT NULL,
    round      INTEGER,
    address    TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    memo       TEXT NOT NULL,
    status     TEXT NOT NULL,
    block      INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS deposits_ref ON deposits (kind, ref_id, round)`,
  `CREATE TABLE IF NOT EXISTS payouts (
    id          TEXT PRIMARY KEY,
    circle_id   TEXT NOT NULL,
    round       INTEGER NOT NULL,
    address     TEXT NOT NULL,
    pot         INTEGER NOT NULL,
    bonus       INTEGER NOT NULL,
    status      TEXT NOT NULL,
    method      TEXT,
    tx_hash     TEXT,
    bank        TEXT,
    ngn         INTEGER,
    provider_id TEXT,
    created_at  INTEGER NOT NULL,
    settled_at  INTEGER,
    UNIQUE (circle_id, round)
  )`,
  `CREATE TABLE IF NOT EXISTS goals (
    id         TEXT PRIMARY KEY,
    owner      TEXT NOT NULL,
    name       TEXT NOT NULL,
    target     INTEGER,
    unlock_at  INTEGER,
    status     TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS withdrawals (
    id         TEXT PRIMARY KEY,
    goal_id    TEXT NOT NULL,
    address    TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    bonus      INTEGER NOT NULL,
    status     TEXT NOT NULL,
    method     TEXT NOT NULL,
    tx_hash    TEXT,
    bank        TEXT,
    ngn         INTEGER,
    provider_id TEXT,
    created_at  INTEGER NOT NULL
  )`,
  // A locked cash-out price: NIM -> USDT (market minus spread) -> NGN (provider). Used once.
  `CREATE TABLE IF NOT EXISTS quotes (
    id           TEXT PRIMARY KEY,
    address      TEXT NOT NULL,
    nim          INTEGER NOT NULL,
    usdt         INTEGER NOT NULL,
    ngn          INTEGER NOT NULL,
    nim_usd      REAL NOT NULL,
    usdt_ngn     REAL NOT NULL,
    fee_ngn      INTEGER NOT NULL,
    spread_bps   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    used_at      INTEGER,
    created_at   INTEGER NOT NULL
  )`,
  // Treasury books. usdt in micro-USDT, nim in luna, both signed: the float and the NIM we hold
  // are plain sums. Simulated rows (dev wallets) never touch the real totals.
  `CREATE TABLE IF NOT EXISTS treasury_ledger (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    usdt       INTEGER NOT NULL,
    nim        INTEGER NOT NULL,
    ref        TEXT,
    note       TEXT,
    simulated  INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS challenges (
    nonce      TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  )`,
]

let client: Promise<Client> | undefined

async function open(): Promise<Client> {
  const { url, authToken } = serverConfig().database
  if (url.startsWith('file:')) mkdirSync(path.dirname(path.resolve(url.slice(5))), { recursive: true })
  const db = createClient({ url, authToken })
  await db.batch(SCHEMA, 'write')
  return db
}

export function db(): Promise<Client> {
  client ??= open().catch((err) => {
    client = undefined
    throw err
  })
  return client
}

export async function all<T>(sql: string, args: InArgs = []): Promise<T[]> {
  const result = await (await db()).execute({ sql, args })
  return result.rows as unknown as T[]
}

export async function one<T>(sql: string, args: InArgs = []): Promise<T | null> {
  return (await all<T>(sql, args))[0] ?? null
}

export async function run(sql: string, args: InArgs = []) {
  return (await db()).execute({ sql, args })
}

/** Short, URL-safe, unambiguous id. */
export function newId(length = 8): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export const LUNA = 100_000
