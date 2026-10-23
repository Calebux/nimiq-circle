# Nimiq Circle

A savings circle (ajo / tanda / susu / chama) for Nimiq Pay: members contribute NIM each round, one member takes the pot in turn, idle NIM is staked, and payouts can be cashed out to a Nigerian bank.

This repo currently holds the **spike**: three checks that have to pass before the real build.

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
