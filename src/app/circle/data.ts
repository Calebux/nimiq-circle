// Mock circle for the design proof. Replaced by chain + DB state in the build.

export type MemberStatus = 'paid' | 'waiting' | 'you'

export interface Member {
  id: string
  name: string
  avatar: string
  /** Round in which this member takes the pot (1-based). */
  turn: number
  status: MemberStatus
}

export interface Circle {
  name: string
  /** What the members call it. Picked at creation: Ajo, Tanda, Susu, Chama, Pardner… */
  localName: string
  cadence: string
  round: number
  /** Per member per round, in NIM. */
  contribution: number
  /** NIM earned from staking idle rounds so far. */
  earned: number
  /** Mock NGN per NIM for the estimate line. */
  ngnPerNim: number
  payoutDate: string
  members: Member[]
}

export const circle: Circle = {
  name: 'Sunday Jollof',
  localName: 'Ajo',
  cadence: 'Weekly',
  round: 3,
  contribution: 2500,
  earned: 38.42,
  ngnPerNim: 1.62,
  payoutDate: 'Sun 26 Oct',
  members: [
    { id: 'tolu', name: 'Tolu', avatar: '/art/avatars/1.webp', turn: 1, status: 'paid' },
    { id: 'baraka', name: 'Baraka', avatar: '/art/avatars/2.webp', turn: 2, status: 'paid' },
    { id: 'vale', name: 'Valentina', avatar: '/art/avatars/3.webp', turn: 3, status: 'paid' },
    { id: 'me', name: 'You', avatar: '/art/avatars/6.webp', turn: 4, status: 'you' },
    { id: 'arjun', name: 'Arjun', avatar: '/art/avatars/4.webp', turn: 5, status: 'paid' },
    { id: 'shanice', name: 'Shanice', avatar: '/art/avatars/5.webp', turn: 6, status: 'waiting' },
  ],
}
