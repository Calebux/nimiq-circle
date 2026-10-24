'use client'

import { CurrencyDollar, Sparkle } from '@phosphor-icons/react/dist/ssr'
import type { Currency } from '@/lib/currency'

const OPTIONS = [
  { id: 'NIM', icon: Sparkle, title: 'NIM', body: 'Earns staking rewards while it waits.' },
  { id: 'USDT', icon: CurrencyDollar, title: 'USDT', body: 'Holds its dollar value. No rewards.' },
] as const

/** NIM or USDT, chosen once when a circle or goal is made. */
export function CurrencyPicker({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Save in">
      {OPTIONS.map(({ id, icon: Icon, title, body }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`press rounded-[var(--radius-inner)] p-4 text-left transition-colors duration-150 ${value === id ? 'bg-ink text-white' : 'bg-white shadow-soft'}`}
        >
          <Icon size={22} weight="bold" />
          <p className="mt-2 font-bold">{title}</p>
          <p className={`mt-0.5 text-sm leading-snug ${value === id ? 'text-white/75' : 'text-ink-2'}`}>{body}</p>
        </button>
      ))}
    </div>
  )
}
