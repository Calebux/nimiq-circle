// Fixed lists the UI picks from. Amount and payment state lives in the database.

/** Estimate only, for "≈ ₦" lines. Real numbers come from the off-ramp quote. */
export const NGN_PER_NIM = 1.6

export const LOCAL_NAMES = ['Ajo', 'Esusu', 'Tanda', 'Susu', 'Chama', 'Pardner', 'Hui', 'Chit'] as const

export const CADENCES = ['Weekly', 'Every 2 weeks', 'Monthly'] as const

export interface Bank {
  code: string
  name: string
  short: string
}

/** NIP bank codes. The provider's list replaces this. */
export const BANKS: Bank[] = [
  { code: '058', name: 'Guaranty Trust Bank', short: 'GTBank' },
  { code: '044', name: 'Access Bank', short: 'Access' },
  { code: '057', name: 'Zenith Bank', short: 'Zenith' },
  { code: '011', name: 'First Bank of Nigeria', short: 'First Bank' },
  { code: '033', name: 'United Bank for Africa', short: 'UBA' },
  { code: '50211', name: 'Kuda Microfinance Bank', short: 'Kuda' },
  { code: '999992', name: 'OPay', short: 'OPay' },
  { code: '50515', name: 'Moniepoint Microfinance Bank', short: 'Moniepoint' },
  { code: '999991', name: 'PalmPay', short: 'PalmPay' },
  { code: '232', name: 'Sterling Bank', short: 'Sterling' },
  { code: '035', name: 'Wema Bank', short: 'Wema' },
  { code: '214', name: 'First City Monument Bank', short: 'FCMB' },
]
