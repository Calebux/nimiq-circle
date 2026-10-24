// What a circle or goal saves in. Shared by server and client.
//
// Amounts are stored as integers in the currency's smallest unit: luna for NIM (1 NIM = 100,000),
// micro for USDT (1 USDT = 1,000,000). A circle or goal never mixes the two.

export const CURRENCIES = ['NIM', 'USDT'] as const
export type Currency = (typeof CURRENCIES)[number]

export const UNIT: Record<Currency, number> = { NIM: 100_000, USDT: 1_000_000 }

export const isCurrency = (v: unknown): v is Currency => v === 'NIM' || v === 'USDT'
export const asCurrency = (v: unknown): Currency => (isCurrency(v) ? v : 'NIM')

/** Contribution and target limits, in whole units. */
export const LIMITS: Record<Currency, { min: number; max: number }> = {
  NIM: { min: 1, max: 1_000_000 },
  USDT: { min: 1, max: 10_000 },
}

/** Picker presets for a circle's contribution and a goal's target. */
export const PRESETS: Record<Currency, { contribution: number[]; target: number[]; deposit: number[] }> = {
  NIM: { contribution: [10_000, 25_000, 50_000, 100_000], target: [50_000, 100_000, 250_000, 500_000], deposit: [5_000, 10_000, 25_000, 50_000] },
  USDT: { contribution: [5, 10, 20, 50], target: [50, 100, 250, 500], deposit: [1, 5, 10, 20] },
}

/** Smallest goal deposit worth a transaction, in whole units. */
export const MIN_DEPOSIT: Record<Currency, number> = { NIM: 1, USDT: 0.5 }

/** USDT on Polygon PoS. */
export const POLYGON_CHAIN_ID = '0x89'
export const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F'
