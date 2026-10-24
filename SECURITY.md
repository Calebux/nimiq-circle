# Security

Circle has no smart contracts. Members' money sits in three ordinary wallets whose keys only the server holds:

| Wallet | Key | Holds | Sends |
|---|---|---|---|
| NIM pool | `POOL_PRIVATE_KEY` | Members' NIM (liquid and staked), operator float | Payouts and goal withdrawals to members; staking moves |
| USDT pool (Polygon) | `EVM_POOL_PRIVATE_KEY` | Members' USDT, about 0.3 POL for its own fees | Payouts and goal withdrawals to members |
| Gas wallet (Polygon) | `GAS_PRIVATE_KEY` | A few POL, nothing else | Small POL top-ups so members can pay USDT fees |

So the two things to protect are **the keys** and **the server code that decides when to pay**.

## What the code enforces

- **Sign-in** is a Nimiq signature over a single-use, 10-minute challenge. Sessions are HMAC-signed, `httpOnly`, `secure`, `SameSite=Lax` cookies.
- **Deposits** are only credited after the server reads them on chain: right recipient, right token, right memo, enough money, confirmed (Nimiq: 2 confirmations; Polygon: the block is `finalized`). Each transaction hash is credited once.
- **USDT memos carry a per-member tag** (HMAC of the member's Nimiq address with `SESSION_SECRET`), so nobody can claim someone else's transfer by its hash.
- **Withdrawals are claimed atomically**: the balance check and the withdrawal row are one SQL statement, and payouts move `claimable → sending` in one conditional update. Double taps pay once.
- **Sends never double-pay on a network error**: the transaction hash is computed before broadcasting; if the broadcast errors, the chain is asked about that hash before the payout is released for a retry. Polygon sends from each wallet are serialised so nonces never collide.
- **Locks are server-side**: a locked goal refuses to pay before its date whatever the client sends.
- **The gas faucet is bounded**: only members of an open USDT circle or goal, only if they hold the USDT they are about to send, once a day each, five times ever, 1 POL a day in total, and from its own wallet.
- **Requests**: JSON bodies only (blocks cross-site form posts), rate limits on sign-in, join, invite lookups, gas and bank lookups, `nosniff` / referrer / permissions headers, HSTS in production. Test endpoints (`/spike`, `/api/spike/*`) are off in production.
- **Startup guard**: in production the server refuses to start if `SESSION_SECRET` (32+ chars) or `CRON_SECRET` (24+) is weak or shared, if `DEV_WALLET` or `INSTANT_PAYOUTS` is on, or if two wallets share a key.

## Operator checklist before real users

1. **Server**: run the app as its own user (e.g. `circle`), never root. Put secrets in `/etc/circle/env`, owned `root:circle`, mode `640`, and load it with PM2 (`env_file`) or systemd (`EnvironmentFile`). Never put keys in the repo, the PM2 ecosystem file, or shell history.
2. **Fresh production secrets**: new `SESSION_SECRET` (`openssl rand -hex 32`) and `CRON_SECRET` (`openssl rand -hex 24`). Changing `SESSION_SECRET` later logs everyone out and breaks matching for USDT transfers still in flight, so set it once.
3. **Offline backup**: `npm run keys -- backup circle-keys.enc`, move the file off the machine (USB stick or password manager), store the passphrase separately, and run `npm run keys -- check` on the copy.
4. **Keep the hot wallets small**: set `EVM_COLD_ADDRESS` to a Polygon wallet only you control and run `npm run evm -- sweep` (dry run) then `--go` regularly. It keeps members' USDT plus `EVM_FLOAT_USDT` and moves the rest out. On the NIM side, operator NIM bought by cash-outs leaves through `npm run treasury -- rebalance --to <address>`; the rest of the pool is members' money and their staking rewards.
5. **Gas wallet**: keep 1 to 2 POL in it with `npm run evm -- fund-gas <pol>`. `npm run evm -- status` warns when it runs low.
6. **Watch**: `/pool` shows on-chain balances against what members are owed. If it ever says "Short", stop payouts and investigate.
7. **Before money grows**: get an independent review of `src/lib/deposits.ts`, `src/lib/delivery.ts`, `src/lib/goals.ts`, `src/lib/circles.ts` and `src/lib/evm/`.

## Reporting

Found something? Email the maintainer privately rather than opening a public issue.
