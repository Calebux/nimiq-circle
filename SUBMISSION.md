# Nimiq Mini Apps Competition, Cycle III: submission draft

**Category:** Save
**Deadline:** 11 Nov 2026, 23:59 UTC. Submissions go public for community testing at the start of week 3 (≈ 28 Oct), so deploy before then.
**Lead:** Caleb Peterson ([@Calebux](https://github.com/Calebux)), payout wallet: _add_

**App:** Akilii · akilii.xyz
**Motto:** The all-in-one savings app.

## Description (≤ 250 words)

Akilii is the all-in-one savings app for Nimiq Pay. Every way people already save, in one place.

**Circles.** A billion people save this way: ajo or esusu in Nigeria, tanda in Mexico, chama in Kenya, susu or pardner in the Caribbean. Friends chip in the same amount every round and one person takes the pot. Akilii makes it trustless: every contribution is a memo-tagged payment to a public pool address, pots go out on the due date, and late payers owe whoever got a short pot.

**Goals with Akilii.** A jar for rent or Detty December, locked until your date. Idle NIM is staked, and a public proof-of-reserves page shows the pool against what members are owed.

**Goals in your wallet.** For people who want to keep their keys: savings are staked by your own Nimiq Pay wallet and Akilii never holds them. Under the 100 NIM minimum stake, they are simply set aside.

**Friends chip in** to any goal by link, and **weekly or monthly plans** remind you when it is your turn to save.

Save in NIM or USDT. When it is time, keep it in Nimiq Pay or cash out to any Nigerian bank in about a minute. Next: naira top-ups, then more currencies.

Built for Nimiq Pay: wallet-signature sign-in, `sendBasicTransactionWithData` for payments, and the SDK's staking calls.

## Checklist

- [ ] Public GitHub repo, MIT license (LICENSE present), no secrets in history (checked 24 Oct)
- [ ] Deployed at a permanent HTTPS URL, opened and tested inside Nimiq Pay on a phone
- [ ] Production env: `DEV_WALLET` off, `SESSION_SECRET` set, `AUTO_STAKE=on` once the plan looks right, `INSTANT_PAYOUTS` off, `DEMO_CADENCE` off (or on for the judges' demo circle)
- [ ] Real usage: run a real circle with friends before week 3; post it on the forum and X
- [ ] Demo video (optional, encouraged): see below
- [ ] Submission form: category, description, repo link, lead name + GitHub + Nimiq wallet

## Demo video (≈ 90 s)

1. Welcome → "Continue with Nimiq Pay" → sign (no money moves).
2. New circle: name, "Ajo", 25,000 NIM, 10-min demo cadence, 3 people → invite link → friends join.
3. Everyone chips in from Nimiq Pay; the pot fills, the dial turns.
4. Someone doesn't pay: late banner → nudge → grace ends → short pot goes out; they pay late and it lands with the person who was shorted.
5. Payout: confetti, "Cash out to bank", the NIM → USDT → ₦ quote, "Money landed".
6. Savings goal locked till 1 December; proof-of-reserves page on nimiq.watch.
7. Goal in your wallet: save 150 NIM, approve the stake in Nimiq Pay; set a weekly plan.
8. "Invite friends to chip in": a second phone opens the link and sends NIM straight to the owner's wallet.
