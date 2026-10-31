import 'server-only'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { createClient, type Client, type InArgs } from '@libsql/client'
import { serverConfig } from './env'

// Amounts are INTEGER in the smallest unit of the circle's or goal's currency (src/lib/currency.ts):
// luna for NIM, micro for USDT. Times are ms since epoch.
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
    -- 'pot': the round's pot (one per round). 'late': a missed contribution paid afterwards,
    -- forwarded to the member who got that round's short pot.
    kind        TEXT NOT NULL DEFAULT 'pot',
    from_address TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_pot ON payouts (circle_id, round) WHERE kind = 'pot'`,
  // Someone did not pay before a round closed. Settled when they pay late.
  `CREATE TABLE IF NOT EXISTS misses (
    circle_id  TEXT NOT NULL,
    round      INTEGER NOT NULL,
    address    TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    settled_tx TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (circle_id, round, address)
  )`,
  // In-app inbox (mini apps cannot push). `key` makes each reminder happen once.
  `CREATE TABLE IF NOT EXISTS notices (
    id         TEXT PRIMARY KEY,
    key        TEXT NOT NULL UNIQUE,
    address    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    text       TEXT NOT NULL,
    href       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    read_at    INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS notices_inbox ON notices (address, read_at)`,
  // What the worker did to the pool's stake, so it never repeats itself within an epoch.
  `CREATE TABLE IF NOT EXISTS pool_actions (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    tx_hash    TEXT,
    note       TEXT,
    created_at INTEGER NOT NULL
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
  // USDT transfers a member reported that are not confirmed yet; the worker finishes them
  // if the app closes first (Polygon transfers carry no memo the pool history could be scanned for).
  `CREATE TABLE IF NOT EXISTS evm_pending (
    tx_hash    TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    ref_id     TEXT NOT NULL,
    round      INTEGER,
    address    TEXT NOT NULL,
    memo       TEXT NOT NULL,
    min_amount INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  // POL sent to members so they can pay the gas on a USDT transfer.
  `CREATE TABLE IF NOT EXISTS gas_drips (
    id          TEXT PRIMARY KEY,
    address     TEXT NOT NULL,
    evm_address TEXT NOT NULL,
    pol         REAL NOT NULL,
    tx_hash     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  )`,
]

/** Columns added after the first release, as [table, column, definition]. */
const COLUMNS: [string, string, string][] = [
  ['circles', 'currency', "TEXT NOT NULL DEFAULT 'NIM'"],
  ['goals', 'currency', "TEXT NOT NULL DEFAULT 'NIM'"],
  ['deposits', 'currency', "TEXT NOT NULL DEFAULT 'NIM'"],
  ['quotes', 'currency', "TEXT NOT NULL DEFAULT 'NIM'"],
  // The Polygon address a member last paid USDT from; USDT payouts go back there.
  ['users', 'evm_address', 'TEXT'],
  // Practice circles: you plus two bot members, every payment simulated (src/lib/circles.ts).
  ['circles', 'practice', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'bot', 'INTEGER NOT NULL DEFAULT 0'],
]

async function addColumns(db: Client) {
  for (const [table, column, definition] of COLUMNS) {
    const { rows } = await db.execute(`PRAGMA table_info(${table})`)
    if (!rows.some((r) => r.name === column)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

let client: Promise<Client> | undefined

/**
 * Databases made before late payments had UNIQUE (circle_id, round) on payouts. SQLite cannot
 * drop a table constraint, so rebuild the table once, keeping every row as a 'pot'.
 */
async function migratePayouts(db: Client) {
  const { rows } = await db.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payouts'")
  if (!String(rows[0]?.sql ?? '').includes('UNIQUE (circle_id, round)')) return
  const create = SCHEMA.find((q) => q.includes('CREATE TABLE IF NOT EXISTS payouts'))!.replace('payouts (', 'payouts_new (')
  await db.batch(
    [
      create,
      `INSERT INTO payouts_new (id, circle_id, round, address, pot, bonus, status, method, tx_hash, bank, ngn, provider_id, created_at, settled_at, kind)
       SELECT id, circle_id, round, address, pot, bonus, status, method, tx_hash, bank, ngn, provider_id, created_at, settled_at, 'pot' FROM payouts`,
      'DROP TABLE payouts',
      'ALTER TABLE payouts_new RENAME TO payouts',
    ],
    'write',
  )
}

async function open(): Promise<Client> {
  const { url, authToken } = serverConfig().database
  if (url.startsWith('file:')) mkdirSync(path.dirname(path.resolve(url.slice(5))), { recursive: true })
  const db = createClient({ url, authToken })
  const payoutsIndex = SCHEMA.findIndex((q) => q.includes('payouts_one_pot'))
  // Tables first, then migrate old payouts, then the index that needs the new column.
  await db.batch(SCHEMA.slice(0, payoutsIndex), 'write')
  await migratePayouts(db)
  await db.batch(SCHEMA.slice(payoutsIndex), 'write')
  await addColumns(db)
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
