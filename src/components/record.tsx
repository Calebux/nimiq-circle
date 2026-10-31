import { ShieldCheck } from '@phosphor-icons/react/dist/ssr'
import type { TrackRecord } from '@/lib/circles'

/** "Paid 14 of 14 on time" across their real circles; the thing to check before trusting someone with a pot. */
export function Record({ member }: { member: { bot?: boolean; record: TrackRecord | null } }) {
  if (member.bot) return <p className="text-xs text-lilac-ink">Practice friend</p>
  const r = member.record
  if (!r || r.rounds === 0) return <p className="text-xs text-ink-2">New to Akilii circles</p>
  const all = r.onTime === r.rounds
  return (
    <p className={`inline-flex items-center gap-1 text-xs font-semibold ${all ? 'text-mint-ink' : 'text-sun-ink'}`}>
      <ShieldCheck size={13} weight="fill" /> Paid {r.onTime} of {r.rounds} on time
    </p>
  )
}
