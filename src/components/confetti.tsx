'use client'

import { useMemo } from 'react'
import { useReducedMotion } from './ui'

const CONFETTI_COLOURS = ['var(--color-coral-bright)', 'var(--color-mint)', 'var(--color-sun)', 'var(--color-lilac)', '#8ec5ff']

/** Deterministic pieces so server and client render the same markup. */
function confettiPieces(count: number) {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: count }, (_, i) => {
    const angle = rand() * Math.PI * 2
    const distance = 110 + rand() * 120
    // Whole numbers: server and client Math.cos can differ in the last digits and break hydration.
    return {
      id: i,
      colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance - 40),
      r: Math.round((rand() - 0.5) * 540),
      w: Math.round(6 + rand() * 6),
      delay: Math.round(rand() * 120),
    }
  })
}

export function Confetti() {
  const reduce = useReducedMotion()
  const pieces = useMemo(() => confettiPieces(28), [])
  if (reduce) return null
  return (
    // Own clipped layer: finished pieces keep their end transform, which would otherwise widen the page.
    <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-[24%]">
        {pieces.map((p) => (
          <span
            key={p.id}
            className="absolute block rounded-full"
            style={
              {
                width: p.w,
                height: p.w * 2.2,
                backgroundColor: p.colour,
                '--x': `${p.x}px`,
                '--y': `${p.y}px`,
                '--r': `${p.r}deg`,
                animation: `confetti 1400ms var(--ease-out) ${p.delay}ms both`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </div>
  )
}

