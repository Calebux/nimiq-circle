# Nimiq Mini Apps Competition, Cycle III: submission draft

**Category:** Save
**Deadline:** 11 Nov 2026, 23:59 UTC. Submissions go public for community testing at the start of week 3 (≈ 28 Oct), so deploy before then.
**Lead:** Caleb Peterson ([@Calebux](https://github.com/Calebux)), payout wallet: _add_

**App:** Akilii · akilii.xyz
**Motto:** The perfect money app.

## Description (≤ 250 words)

Akilii brings the savings circle to Nimiq Pay. A billion people already save this way. Nigerians call it ajo or esusu, Mexicans tanda, Kenyans chama, Caribbean families susu or pardner. Friends chip in the same amount every round, and each round one person takes the whole pot.

Akilii makes it trustless where it used to need trust. Every contribution is a NIM payment from Nimiq Pay to a public pool address, tagged with the circle and round, so anyone can check who paid. Pots go out automatically on the due date. Late payers get reminders, a grace period, and a debt that goes straight to whoever got a short pot when they settle it.

While money waits for its turn it is staked with a Nimiq validator, so later turns earn more, which finally makes being last in the circle fair. A public proof-of-reserves page shows the pool's on-chain balance against what members are owed.

Savings goals work the same way for one person: put NIM in a jar for rent or Detty December, and lock it until a date so you can't touch it.

When it's your turn, keep NIM in Nimiq Pay or cash out to any Nigerian bank in about a minute, at a rate locked for 90 seconds.

Built for Nimiq Pay: sign-in with the wallet's signature, payments with `sendBasicTransactionWithData`, and NIM staking for yield.

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
