// Mock state for the design build. Replaced by chain + DB state once the core loop lands.

export type MemberStatus = 'paid' | 'waiting' | 'you'

/** Pastel seat colour behind each avatar, matched to their shirt. */
export type Tint = 'coral' | 'mint' | 'sun' | 'sky' | 'lilac'

export interface Member {
  id: string
  name: string
  avatar: string
  tint: Tint
  /** Round in which this member takes the pot (1-based). */
  turn: number
  status: MemberStatus
}

export interface Circle {
  id: string
  name: string
  /** What the members call it. Picked at creation. */
  localName: string
  cadence: string
  round: number
  /** Per member per round, in NIM. */
  contribution: number
  /** NIM earned from staking idle rounds so far. */
  earned: number
  payoutDate: string
  nextPayoutDate: string
  members: Member[]
}

/** Mock NGN per NIM for estimate lines. The real quote comes from the off-ramp provider. */
export const NGN_PER_NIM = 1.62

export const LOCAL_NAMES = ['Ajo', 'Esusu', 'Tanda', 'Susu', 'Chama', 'Pardner', 'Hui', 'Chit'] as const

export const CADENCES = ['Weekly', 'Every 2 weeks', 'Monthly'] as const

export const circle: Circle = {
  id: 'sunday-jollof',
  name: 'Sunday Jollof',
  localName: 'Ajo',
  cadence: 'Weekly',
  round: 3,
  contribution: 2500,
  earned: 38.42,
  payoutDate: 'Sun 26 Oct',
  nextPayoutDate: 'Sun 2 Nov',
  members: [
    { id: 'tolu', name: 'Tolu', avatar: '/art/avatars/1.webp', tint: 'coral', turn: 1, status: 'paid' },
    { id: 'baraka', name: 'Baraka', avatar: '/art/avatars/2.webp', tint: 'mint', turn: 2, status: 'paid' },
    { id: 'vale', name: 'Valentina', avatar: '/art/avatars/3.webp', tint: 'sun', turn: 3, status: 'paid' },
    { id: 'me', name: 'You', avatar: '/art/avatars/6.webp', tint: 'sky', turn: 4, status: 'you' },
    { id: 'arjun', name: 'Arjun', avatar: '/art/avatars/4.webp', tint: 'lilac', turn: 5, status: 'paid' },
    { id: 'shanice', name: 'Shanice', avatar: '/art/avatars/5.webp', tint: 'sky', turn: 6, status: 'waiting' },
  ],
}

/** The home list: the circle above plus one that is still filling up. */
export const myCircles = [
  { id: circle.id, href: '/circle', name: circle.name, localName: circle.localName, members: circle.members, round: circle.round, rounds: circle.members.length, contribution: circle.contribution, note: 'Chip in by Sun 26 Oct' },
  {
    id: 'naija-to-lisbon',
    href: '/circle/invite',
    name: 'Lisbon Rent',
    localName: 'Esusu',
    members: circle.members.slice(0, 3),
    round: 0,
    rounds: 5,
    contribution: 4000,
    note: '3 of 5 joined',
  },
]

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
