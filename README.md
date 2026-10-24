# Nimiq Circle

A savings circle (ajo / tanda / susu / chama) for Nimiq Pay: members contribute NIM each round, one member takes the pot in turn, idle NIM is staked, and payouts can be cashed out to a Nigerian bank.

## App

| Route | What |
|---|---|
| `/` | Your circles and goals (sign in with Nimiq Pay) |
| `/new`, `/c/[id]`, `/c/[id]/invite`, `/c/[id]/payout` | Create a circle, chip in, invite, take your pot (keep or cash out) |
| `/join/[code]` | Invite link landing |
| `/goals/new`, `/g/[id]` | Personal savings goal, flexible or locked until a date |
| `/spike` | The pre-build checks below |

**How money moves.** One pool wallet holds every circle and goal. Members pay it from Nimiq Pay with a memo (`cc:<circle>:<round>`, `cg:<goal>`); the server only counts a deposit once it is on chain, from the signed-in wallet, with the right memo and amount. Payouts and withdrawals are signed by the pool key on the server. Locked goals are enforced server-side. Idle NIM is staked; yield = what the pool really holds on chain minus what it owes minus `POOL_FLOAT_NIM`, shared by balance.

**Cash-out (float model).** The provider only takes USDT, so the app sits in the middle. The cash-out sheet locks a quote for 90 s: NIM → USDT at the CoinGecko price minus `TREASURY_SPREAD_BPS`, then USDT → NGN at the provider's rate. On confirm, the treasury buys the member's NIM where it sits in the pool and the provider pays the bank from our prefunded USDT float, so no swap is in the member's path. Converting held NIM back to USDT happens in batches. Guards: quote expiry, one use per quote, owner and amount checks, per-payout and daily caps, a minimum, and "float too low" (the pot stays claimable). Every movement is a row in `treasury_ledger`.

```bash
npm run treasury -- status            # float, NIM held, P&L
npm run treasury -- topup 100         # record USDT sent to the provider
npm run treasury -- rebalance --to <exchange address>   # swap held NIM back to USDT
```

**Sign-in.** Nimiq Pay `sign()` over a one-time challenge, verified with `@nimiq/core` (sha256 of the `\x16Nimiq Signed Message:\n` prefixed message, Ed25519), then an HMAC session cookie.

**Dev wallet.** With `DEV_WALLET=1` (never in production) a desktop browser gets a throwaway test wallet and simulated payments, so multi-person flows can be clicked through without phones. `INSTANT_PAYOUTS=1` pays a round as soon as everyone is in.

## Spike

Three checks that had to pass before the real build.

| # | Check | Answers |
|---|-------|---------|
| 1 | Contribute from Nimiq Pay | What `sendBasicTransactionWithData` returns (hash or serialized tx) and how fast a memo-tagged payment confirms |
| 2 | Stake the pool | How long NIM is locked between `unstake` and being payable again |
| 3 | Cash out | Whether the off-ramp provider can resolve an account, quote NIM → NGN and pay out, and how fast |

Why NIM and not USDT/Aave: `@nimiq/mini-app-sdk` (0.2.4) exposes NIM transfers, NIM staking and Lightning payments only, with no EVM/Polygon calls.

## Setup

```bash
npm install
npm run pool -- keygen     # creates the pool wallet in .env.local (gitignored)
npm run dev                # http://localhost:3300
npm run tunnel             # public https URL to open inside Nimiq Pay (spike lives at /spike)
```

Fund the pool address with ~110 NIM (100 NIM is the minimum stake).

## Running the checks

**1. Contribute**: open the tunnel URL in Nimiq Pay and send 1 NIM. The card shows the raw return value, whether the server found it by hash or had to scan for the memo, and the time to confirmation. The confirmed result is appended to `data/spike-log.jsonl`.

**2. Stake**: from the laptop:

```bash
npm run pool -- stake 100      # create staker, delegated to STAKE_VALIDATOR
npm run pool -- status         # watch active stake grow (restaking pool)
npm run pool -- unstake 100    # active → inactive; effective at next election block
npm run pool -- status         # shows the release block + ETA
npm run pool -- retire         # refuses until released
npm run pool -- remove         # retired → liquid in the pool
```

Each step is logged with its block, so lock-up = block of `remove` − block of `unstake` (one block ≈ 1 s).

**3. Cash out**: runs against `OFFRAMP_PROVIDER=mock`. The real provider goes in `src/lib/offramp/` behind the same `OfframpProvider` interface. `npm run pool -- send <address> <nim> [memo]` pays out from the pool if the provider is deposit-based.

## Layout

```
scripts/pool.mjs            only code that holds the pool key (signs with @nimiq/core)
src/lib/nimiq/rpc.ts        Albatross JSON-RPC reads
src/lib/nimiq/contribution  find a contribution by hash or memo
src/lib/nimiq/pool.ts       pool + staker status, spike log
src/lib/offramp/            provider interface + mock
src/app/spike.tsx           the three check cards
```

MIT licensed.
