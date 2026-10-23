import 'server-only'
import { serverConfig } from '@/lib/env'
import { mockProvider } from './mock'
import type { OfframpProvider } from './types'

export function offrampProvider(): OfframpProvider {
  const name = serverConfig().offrampProvider
  switch (name) {
    case 'mock':
      return mockProvider
    default:
      throw new Error(`Unknown OFFRAMP_PROVIDER "${name}"`)
  }
}

export type * from './types'
