'use client'

import { ArrowDown, ArrowUp, Gift, HourglassMedium, Sparkle, Wallet, Warning } from '@phosphor-icons/react/dist/ssr'
import Image from 'next/image'
import { useState } from 'react'
import { BackLink, BottomBar, PrimaryButton, Screen, SecondaryButton, Sheet, nim, shortDate, useCountUp } from '@/components/ui'
import { Ngn, api, useWallet, type StakeOp } from '@/components/wallet'
import { PRESETS } from '@/lib/currency'
import type { SaveStep, WalletGoalView } from '@/lib/wallet-goals'
import { InviteSheet, PlanCard, PlanSheet } from './goal-shared'

const LUNA = 100_000
const timeLabel = (ms: number) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * Sign a staking transaction in Nimiq Pay, then poll the server until it sees it on chain.
 * Like usePayment, for the owner's own stake.
 */
function useSigned() {
  const { stake } = useWallet()
  const [state, setState] = useState<'idle' | 'approving' | 'confirming'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function run(op: StakeOp, confirm: (hint: string) => Promise<{ status: string }>) {
    setError(null)
    setState('approving')
    try {
      let hint: string
      try {
        hint = await stake(op)
      } catch (err) {
        if ((err as { maybeSent?: boolean }).maybeSent) throw new Error('Nimiq Pay did not say whether it went through. Check your staking in Nimiq Pay, then come back here.')
        throw err
      }
      setState('confirming')
      const started = Date.now()
      while (Date.now() - started < 3 * 60_000) {
        if ((await confirm(hint)).status === 'confirmed') {
          setState('idle')
          return true
        }
        await new Promise((r) => setTimeout(r, 3000))
      }
      throw new Error('Still waiting for the network. It will show up here once it confirms.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState('idle')
      return false
    }
  }
  return { state, error, setError, run }
}

const signLabel = (state: 'idle' | 'approving' | 'confirming', idle: string) =>
  state === 'approving' ? 'Approve in Nimiq Pay…' : state === 'confirming' ? 'Confirming on Nimiq…' : idle

function Jar({ goal }: { goal: WalletGoalView }) {
  const balance = useCountUp(goal.balance)
  const progress = goal.target ? Math.min(1, goal.balance / goal.target) : 0
  return (
    <section className="rounded-card bg-white/70 p-1.5 shadow-soft ring-1 ring-white">
      <div className="relative overflow-hidden rounded-[calc(var(--radius-card)-6px)] bg-sky-soft px-5 pb-5 pt-5">
        <Image src="/art/jar.webp" alt="" width={502} height={600} priority className="pointer-events-none absolute -right-1 top-1 w-[112px]" />
        <p className="text-sm font-semibold text-ink-2">Saved so far</p>
        <p className="mt-1 font-display text-[52px] font-extrabold leading-none tracking-tight tabular-nums">{nim(balance)}</p>
        <p className="mt-1.5 text-[15px] text-ink-2">
          {goal.target ? `of ${nim(goal.target)} NIM` : 'NIM'} ≈ <Ngn amount={goal.balance} currency="NIM" />
        </p>
        {goal.target && (
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-white" aria-label={`${Math.round(progress * 100)}% of target`}>
            <div className="h-full origin-left rounded-full bg-coral transition-transform duration-700 ease-[var(--ease-out)]" style={{ transform: `scaleX(${progress})` }} />
          </div>
        )}
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold">
          <Wallet size={15} weight="bold" /> {goal.status === 'closed' ? 'Goal closed' : 'In your own wallet. Akilii never holds it.'}
        </p>
      </div>
    </section>
  )
}

/** Where the goal's NIM is right now: staked by the wallet, or just set aside in it. */
function Where({ goal, onStakeHeld, busy }: { goal: WalletGoalView; onStakeHeld: () => void; busy: boolean }) {
  const canStakeHeld = goal.status === 'open' && !goal.exit && goal.inWallet > 0 && (goal.staked > 0 || goal.inWallet >= goal.minimumStake)
  return (
    <section className="grid grid-cols-2 gap-2">
      <div className="rounded-card bg-mint-soft p-4">
        <p className="flex items-center gap-1 text-sm font-semibold text-mint-ink">
          Staked <Sparkle size={13} weight="fill" className="text-mint" />
        </p>
        <p className="font-display text-2xl font-extrabold tracking-tight tabular-nums">{nim(goal.staked, goal.staked % 1 ? 2 : 0)}</p>
        <p className="mt-0.5 text-xs leading-snug text-mint-ink">Earning rewards in your wallet&apos;s stake.</p>
      </div>
      <div className="rounded-card bg-lilac-soft p-4">
        <p className="text-sm font-semibold text-lilac-ink">Set aside</p>
        <p className="font-display text-2xl font-extrabold tracking-tight tabular-nums">{nim(goal.inWallet, goal.inWallet % 1 ? 2 : 0)}</p>
        {canStakeHeld ? (
          <button type="button" onClick={onStakeHeld} disabled={busy} className="press mt-1 rounded-full bg-white px-3 py-1 text-xs font-bold">
            Stake it
          </button>
        ) : (
          <p className="mt-0.5 text-xs leading-snug text-lilac-ink">
            {goal.staked > 0 || goal.inWallet === 0 ? 'Spendable in your wallet.' : `Staking starts at ${nim(goal.minimumStake)} NIM.`}
          </p>
        )}
      </div>
    </section>
  )
}

function ExitCard({ goal, reload }: { goal: WalletGoalView; reload: () => void }) {
  const signed = useSigned()
  const exit = goal.exit!
  async function step(kind: 'retire' | 'remove') {
    const value = Math.round((kind === 'retire' ? exit.retire : exit.remove))
    const ok = await signed.run({ type: kind, value }, (hint) => api(`/api/goals/${goal.id}/wallet`, { body: { action: 'exit-step', step: kind, hint } }))
    if (ok) reload()
  }
  async function finish() {
    try {
      await api(`/api/goals/${goal.id}/wallet`, { body: { action: 'exit-step', step: 'done' } })
      reload()
    } catch (e) {
      signed.setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <section className="rounded-card bg-sun-soft p-5 shadow-soft">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-sun-ink">
        <HourglassMedium size={16} weight="bold" /> Taking out {nim(exit.amount, exit.amount % 1 ? 2 : 0)} NIM
      </p>
      {exit.next === 'wait' ? (
        <>
          <p className="mt-1 font-display text-xl font-extrabold tracking-tight">Unstaking. Ready around {timeLabel(exit.readyAt!)}</p>
          <p className="mt-1 text-sm text-sun-ink">The Nimiq network releases stake at the end of an epoch, usually 12 to 24 hours. Come back then for two quick taps.</p>
        </>
      ) : exit.next === 'done' ? (
        <>
          <p className="mt-1 font-display text-xl font-extrabold tracking-tight">It is back in your wallet</p>
          <div className="mt-3">
            <PrimaryButton onClick={finish}>Close this goal</PrimaryButton>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 font-display text-xl font-extrabold tracking-tight">Ready. {exit.next === 'retire' ? 'Step 1 of 2' : 'Step 2 of 2'}</p>
          <p className="mt-1 text-sm text-sun-ink">{exit.next === 'retire' ? 'Release the unstaked NIM.' : 'Bring it back into your wallet. The goal closes after this.'}</p>
          <div className="mt-3">
            <PrimaryButton onClick={() => step(exit.next as 'retire' | 'remove')} disabled={signed.state !== 'idle'}>
              {signLabel(signed.state, exit.next === 'retire' ? 'Release it' : 'Bring it back')}
            </PrimaryButton>
          </div>
        </>
      )}
      {signed.error && <p className="mt-3 rounded-[var(--radius-inner)] bg-white px-4 py-3 text-sm text-coral-ink">{signed.error}</p>}
    </section>
  )
}

function SaveSheet({ goal, open, onOpenChange, onDone, holdOnly }: { goal: WalletGoalView; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void; holdOnly?: boolean }) {
  const presets = PRESETS.NIM.deposit
  const [amount, setAmount] = useState(holdOnly ? '0' : String(presets[1]))
  const [step, setStep] = useState<SaveStep | null>(null)
  const signed = useSigned()
  const value = Number(amount) || 0
  const body = (extra: Record<string, unknown>) => ({ body: { ...extra } })

  async function go() {
    signed.setError(null)
    try {
      const s = step ?? (await api<SaveStep>(`/api/goals/${goal.id}/wallet`, body({ action: 'prepare', amount: value })))
      if (s.mode === 'note') {
        if (!step) return setStep(s) // Show what "set aside" means before recording it.
        await api(`/api/goals/${goal.id}/wallet`, body({ action: 'note', amount: value }))
      } else {
        const op: StakeOp = s.mode === 'create' ? { type: 'create', value: s.value, delegation: s.delegation } : { type: 'add', value: s.value }
        const ok = await signed.run(op, (hint) => api(`/api/goals/${goal.id}/wallet`, body({ action: 'stake', hint, added: s.added, value: s.value })))
        if (!ok) return
      }
      onOpenChange(false)
      onDone()
    } catch (e) {
      signed.setError(e instanceof Error ? e.message : String(e))
    }
  }

  const note = step?.mode === 'note'
  const label = note ? `Set aside ${nim(value)} NIM` : signLabel(signed.state, holdOnly ? `Stake ${nim(goal.inWallet)} NIM` : `Save ${nim(value)} NIM`)
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={holdOnly ? 'Stake what is set aside' : `Save for ${goal.name}`}
      description={holdOnly ? `${nim(goal.inWallet)} NIM goes into your wallet's stake. You approve it in Nimiq Pay.` : 'It is staked by your own wallet. You approve it in Nimiq Pay, and you can unstake it any time.'}
    >
      {!holdOnly && !note && (
        <>
          <div className="flex h-16 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
            <label htmlFor="save-amount" className="sr-only">
              Amount
            </label>
            <input
              id="save-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 8))}
              className="min-w-0 flex-1 bg-transparent font-display text-3xl font-extrabold tabular-nums outline-none"
            />
            <span className="font-semibold text-ink-2">NIM</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {presets.map((a) => (
              <button key={a} type="button" onClick={() => setAmount(String(a))} className={`press h-11 rounded-full text-[15px] font-semibold ${value === a ? 'bg-ink text-white' : 'bg-white shadow-soft'}`}>
                {nim(a)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-2">
            ≈ <Ngn amount={value} currency="NIM" />. Network fee: free.
          </p>
        </>
      )}
      {note && step.mode === 'note' && (
        <p className="rounded-[var(--radius-inner)] bg-lilac-soft px-4 py-3 text-[15px] text-lilac-ink">
          Staking starts at {nim(step.minimumStake)} NIM, so for now we note {nim(value)} NIM as set aside for {goal.name}. It stays spendable in your wallet; nothing is sent. Once
          this goal has {nim(step.minimumStake)} NIM you can stake it all.
        </p>
      )}
      {signed.error && <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{signed.error}</p>}
      <div className="mt-5">
        <PrimaryButton onClick={go} disabled={(!holdOnly && value < 1) || signed.state !== 'idle'}>
          {label}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

function TakeOutSheet({ goal, open, onOpenChange, onDone }: { goal: WalletGoalView; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const signed = useSigned()
  const [busy, setBusy] = useState(false)
  // Set when unstaking this goal would also unstake the rest of the wallet's stake: asks first.
  const [warn, setWarn] = useState<{ amount: number; newActiveBalance: number; unstakesOtherStake: number } | null>(null)
  const nothingStaked = goal.staked <= 0

  async function close() {
    setBusy(true)
    try {
      await api(`/api/goals/${goal.id}/wallet`, { body: { action: 'close' } })
      onOpenChange(false)
      onDone()
    } catch (e) {
      signed.setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function unstake() {
    signed.setError(null)
    try {
      const plan = warn ?? (await api<{ amount: number; newActiveBalance: number; unstakesOtherStake: number }>(`/api/goals/${goal.id}/wallet`, { body: { action: 'exit' } }))
      if (plan.unstakesOtherStake > 0 && !warn) return setWarn(plan)
      const ok = await signed.run({ type: 'setActive', value: plan.newActiveBalance }, (hint) => api(`/api/goals/${goal.id}/wallet`, { body: { action: 'exit-started', hint, amount: plan.amount } }))
      if (ok) {
        onOpenChange(false)
        onDone()
      }
    } catch (e) {
      signed.setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Take it out"
      description={nothingStaked ? `Your ${nim(goal.balance)} NIM is already in your wallet. Closing the goal just stops tracking it.` : `Unstaking ${nim(goal.staked, 2)} NIM takes 12 to 24 hours. Then two taps bring it back to your wallet.`}
    >
      {!nothingStaked && goal.inWallet > 0 && <p className="mb-4 text-sm text-ink-2">The {nim(goal.inWallet)} NIM set aside is already spendable.</p>}
      {warn && (
        <p className="mb-4 rounded-[var(--radius-inner)] bg-sun-soft px-4 py-3 text-sm text-sun-ink">
          What would stay staked is under the network minimum, so your other {nim(warn.unstakesOtherStake / LUNA, 2)} NIM in staking unstakes too. It comes back to your wallet with this goal&apos;s NIM.
        </p>
      )}
      {signed.error && <p className="mb-4 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{signed.error}</p>}
      {nothingStaked ? (
        <PrimaryButton onClick={close} disabled={busy}>
          {busy ? 'Closing…' : 'Close this goal'}
        </PrimaryButton>
      ) : (
        <PrimaryButton onClick={unstake} disabled={signed.state !== 'idle'}>
          {signLabel(signed.state, warn ? 'Unstake all of it' : 'Start unstaking')}
        </PrimaryButton>
      )}
    </Sheet>
  )
}

export function WalletGoal({ goal, reload }: { goal: WalletGoalView; reload: () => void }) {
  const [saving, setSaving] = useState(false)
  const [stakingHeld, setStakingHeld] = useState(false)
  const [taking, setTaking] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [inviting, setInviting] = useState(false)
  const open = goal.status === 'open'

  return (
    <Screen bar={open && !goal.exit && goal.balance > 0 ? 'tall' : true}>
      <header className="flex items-center gap-3">
        <BackLink href="/" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-2">{open ? 'Savings in your wallet' : 'Closed savings'}</p>
          <h1 className="truncate font-display text-[28px] font-extrabold leading-none tracking-tight">{goal.name}</h1>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-4">
        <Jar goal={goal} />
        {goal.exit && <ExitCard goal={goal} reload={reload} />}
        {open && !goal.exit && goal.balance > 0 && <Where goal={goal} busy={stakingHeld} onStakeHeld={() => setStakingHeld(true)} />}
        {goal.stakeShort && (
          <p className="flex gap-2 rounded-card bg-coral-soft p-4 text-sm text-coral-ink">
            <Warning size={18} weight="bold" className="shrink-0" />
            Your wallet&apos;s active stake is lower than the {nim(goal.staked)} NIM this goal staked. Some of it may have been unstaked in Nimiq Pay.
          </p>
        )}
        {!goal.exit && <PlanCard goal={goal} onEdit={() => setPlanning(true)} />}
        {open && !goal.exit && (
          <button type="button" onClick={() => setInviting(true)} className="press flex items-center gap-3 rounded-card bg-lilac-soft p-4 text-left shadow-soft">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-lilac-ink">
              <Gift size={22} weight="bold" />
            </span>
            <span>
              <span className="block font-semibold">Invite friends to chip in</span>
              <span className="block text-sm text-lilac-ink">They send NIM straight to your wallet for {goal.name}.</span>
            </span>
          </button>
        )}

        <section className="rounded-card bg-white p-5 shadow-soft">
          <h2 className="font-display text-xl font-bold tracking-tight">Activity</h2>
          {goal.history.length === 0 ? (
            <p className="mt-2 text-[15px] text-ink-2">Nothing yet. Save your first NIM and watch the jar fill up.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {goal.history.map((h, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className={`grid size-10 place-items-center rounded-full ${h.kind === 'withdraw' ? 'bg-sun-soft text-sun-ink' : 'bg-mint-soft text-mint-ink'}`}>
                    {h.kind === 'gift' ? <Gift size={18} weight="bold" /> : h.kind === 'withdraw' ? <ArrowUp size={18} weight="bold" /> : <ArrowDown size={18} weight="bold" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">
                      {h.kind === 'gift' ? `${h.from} chipped in` : h.kind === 'note' ? 'Set aside' : h.kind === 'withdraw' ? 'Goal closed' : h.added ? 'Saved and staked' : 'Staked what was set aside'}
                    </p>
                    <p className="text-sm text-ink-2">{shortDate(h.at)}</p>
                  </div>
                  <p className="font-display text-lg font-extrabold tabular-nums">
                    {h.kind === 'withdraw' ? '' : '+'}
                    {nim(h.amount, 2)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {open && !goal.exit && (
        <BottomBar>
          <PrimaryButton onClick={() => setSaving(true)}>Save more</PrimaryButton>
          {goal.balance > 0 && <SecondaryButton onClick={() => setTaking(true)}>Take it out</SecondaryButton>}
        </BottomBar>
      )}

      <SaveSheet key={`save-${saving}`} goal={goal} open={saving} onOpenChange={setSaving} onDone={reload} />
      <SaveSheet key={`held-${stakingHeld}`} goal={goal} open={stakingHeld} onOpenChange={setStakingHeld} onDone={reload} holdOnly />
      <TakeOutSheet key={`take-${taking}`} goal={goal} open={taking} onOpenChange={setTaking} onDone={reload} />
      <PlanSheet key={`${goal.plan?.cadence}-${goal.plan?.amount}-${planning}`} goal={goal} open={planning} onOpenChange={setPlanning} onDone={reload} />
      <InviteSheet goal={goal} open={inviting} onOpenChange={setInviting} />
    </Screen>
  )
}
