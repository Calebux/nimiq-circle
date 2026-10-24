import { notFound } from 'next/navigation'
import { Spike } from './spike'

export default function SpikePage() {
  // Pre-build checks: development only, unless explicitly turned on.
  if (process.env.NODE_ENV === 'production' && process.env.SHOW_SPIKE !== '1') notFound()
  return <Spike />
}
