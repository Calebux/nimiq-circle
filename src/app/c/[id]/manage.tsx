'use client'

import { Minus, Plus, Shuffle, UsersThree } from '@phosphor-icons/react/dist/ssr'
import { useState } from 'react'
import { PrimaryButton, SecondaryButton, Sheet, naira, nim } from '@/components/ui'
import { api } from '@/components/wallet'
import type { CircleView } from '@/lib/circles'
import { CADENCES, LOCAL_NAMES, NGN_PER_NIM } from '@/lib/constants'

const MIN_SIZE = 2
const MAX_SIZE = 12
const PRESETS = [1000, 2500, 5000, 10000]

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`press h-10 rounded-full px-3.5 text-[15px] font-semibold transition-colors duration-150 ${selected ? 'bg-ink text-white' : 'bg-white text-ink shadow-soft'}`}
    >
      {children}
    </button>
  )
}

function Label({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="font-display text-base font-bold tracking-tight">
      {children}
    </label>
  )
}

function ErrorNote({ error }: { error: string | null }) {
  return error ? <p className="mt-3 rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">{error}</p> : null
}

/** Creator-only, while filling: every term, and the size down to whoever has joined. */
export function EditCircleSheet({ circle, open, onOpenChange, onSaved }: { circle: CircleView; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (c: CircleView) => void }) {
  const joined = circle.members.length
  const [name, setName] = useState(circle.name)
  const [localName, setLocalName] = useState(circle.localName)
  const [amount, setAmount] = useState(String(circle.contribution))
  const [cadence, setCadence] = useState(circle.cadence)
  const [size, setSize] = useState(circle.size)
  const [order, setOrder] = useState(circle.orderMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const contribution = Number(amount) || 0
  const minSize = Math.max(MIN_SIZE, joined)
  const startsNow = size === joined

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const updated = await api<CircleView>(`/api/circles/${circle.id}`, { method: 'PATCH', body: { name, localName, cadence, contribution, size, order } })
      onSaved(updated)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setSaving(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Edit circle" description="You can change anything until round 1 starts.">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <Label htmlFor="edit-name">Name</Label>
          <input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 32))}
            autoComplete="off"
            className="h-12 rounded-[var(--radius-inner)] bg-white px-4 font-semibold shadow-soft outline-none focus:ring-2 focus:ring-coral"
          />
          <div className="flex flex-wrap gap-2">
            {LOCAL_NAMES.map((n) => (
              <Pill key={n} selected={localName === n} onClick={() => setLocalName(n)}>
                {n}
              </Pill>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label>How many people</Label>
          <div className="flex items-center justify-between rounded-[var(--radius-inner)] bg-white p-2 shadow-soft">
            <button type="button" aria-label="Fewer people" disabled={size <= minSize} onClick={() => setSize((n) => n - 1)} className="press grid size-11 place-items-center rounded-full bg-blush disabled:opacity-40">
              <Minus size={18} weight="bold" />
            </button>
            <p className="font-display text-2xl font-extrabold tabular-nums" aria-live="polite">
              {size}
            </p>
            <button type="button" aria-label="More people" disabled={size >= MAX_SIZE} onClick={() => setSize((n) => n + 1)} className="press grid size-11 place-items-center rounded-full bg-blush disabled:opacity-40">
              <Plus size={18} weight="bold" />
            </button>
          </div>
          <p className="text-sm text-ink-2">
            {joined} joined so far, so {minSize} is the smallest it can go.
            {startsNow && <strong className="text-coral-ink"> Saving with {size} starts round 1 now.</strong>}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="edit-amount">Each person chips in</Label>
          <div className="flex h-14 items-center gap-2 rounded-[var(--radius-inner)] bg-white px-4 shadow-soft focus-within:ring-2 focus-within:ring-coral">
            <input
              id="edit-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 7))}
              className="min-w-0 flex-1 bg-transparent font-display text-2xl font-extrabold tabular-nums outline-none"
            />
            <span className="font-semibold text-ink-2">NIM</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <Pill key={p} selected={contribution === p} onClick={() => setAmount(String(p))}>
                {nim(p)}
              </Pill>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label>How often</Label>
          <div className="flex flex-wrap gap-2">
            {CADENCES.map((c) => (
              <Pill key={c} selected={cadence === c} onClick={() => setCadence(c)}>
                {c}
              </Pill>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label>Who goes first</Label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: 'join', icon: UsersThree, title: 'Join order' },
                { id: 'shuffle', icon: Shuffle, title: 'Shuffle' },
              ] as const
            ).map(({ id, icon: Icon, title }) => (
              <button
                key={id}
                type="button"
                aria-pressed={order === id}
                onClick={() => setOrder(id)}
                className={`press flex h-12 items-center justify-center gap-2 rounded-full font-bold transition-colors duration-150 ${order === id ? 'bg-ink text-white' : 'bg-white shadow-soft'}`}
              >
                <Icon size={18} weight="bold" /> {title}
              </button>
            ))}
          </div>
        </section>

        <p className="rounded-[var(--radius-inner)] bg-coral-soft px-4 py-3 text-sm text-coral-ink">
          Pot each round: <strong>{nim(contribution * size)} NIM</strong> ≈ {naira(contribution * size * NGN_PER_NIM)}
        </p>
      </div>

      <ErrorNote error={error} />
      <div className="mt-5">
        <PrimaryButton onClick={save} disabled={saving || !name.trim() || contribution < 1}>
          {saving ? 'Saving…' : startsNow ? `Save and start with ${size}` : 'Save changes'}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

/** Start with the people who are here; spells out the smaller pot first. */
export function StartNowSheet({ circle, open, onOpenChange, onStarted }: { circle: CircleView; open: boolean; onOpenChange: (o: boolean) => void; onStarted: (c: CircleView) => void }) {
  const joined = circle.members.length
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setStarting(true)
    setError(null)
    try {
      onStarted(await api<CircleView>(`/api/circles/${circle.id}/start`, { method: 'POST' }))
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setStarting(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Start with ${joined} people?`} description="Everyone who joined is in. The circle shrinks to fit them.">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[var(--radius-inner)] bg-white p-4 shadow-soft">
          <p className="text-xs font-semibold text-ink-2">Planned</p>
          <p className="font-display text-xl font-extrabold tabular-nums text-ink-2 line-through decoration-2">{nim(circle.contribution * circle.size)} NIM</p>
          <p className="text-sm text-ink-2">{circle.size} rounds</p>
        </div>
        <div className="rounded-[var(--radius-inner)] bg-coral-soft p-4 shadow-soft">
          <p className="text-xs font-semibold text-coral-ink">Each pot now</p>
          <p className="font-display text-xl font-extrabold tabular-nums">{nim(circle.contribution * joined)} NIM</p>
          <p className="text-sm text-ink-2">{joined} rounds</p>
        </div>
      </div>
      <p className="mt-4 text-[15px] text-ink-2">
        Everyone still chips in {nim(circle.contribution)} NIM {circle.cadence.toLowerCase()}. Round 1 starts now, and nobody else can join.
      </p>
      <ErrorNote error={error} />
      <div className="mt-5">
        <PrimaryButton onClick={start} disabled={starting}>
          {starting ? 'Starting…' : `Start with ${joined}`}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

/** Confirm removing someone (creator) or leaving (member). */
export function RemoveSheet({
  circle,
  member,
  onOpenChange,
  onDone,
}: {
  circle: CircleView
  member: CircleView['members'][number] | null
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const leaving = Boolean(member?.isYou)

  async function remove() {
    if (!member) return
    setBusy(true)
    setError(null)
    try {
      await api(`/api/circles/${circle.id}/members`, { method: 'DELETE', body: { address: member.address } })
      onOpenChange(false)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  return (
    <Sheet
      open={Boolean(member)}
      onOpenChange={onOpenChange}
      title={leaving ? `Leave ${circle.name}?` : `Remove ${member?.name}?`}
      description={leaving ? 'You have not paid anything yet, so nothing is lost. You can rejoin with the code while there is space.' : 'They have not paid anything yet. Their seat opens up again and turns move up.'}
    >
      <ErrorNote error={error} />
      <div className="flex flex-col gap-2">
        <PrimaryButton onClick={remove} disabled={busy}>
          {busy ? 'One moment…' : leaving ? 'Leave circle' : 'Remove'}
        </PrimaryButton>
        <SecondaryButton onClick={() => onOpenChange(false)}>Cancel</SecondaryButton>
      </div>
    </Sheet>
  )
}
