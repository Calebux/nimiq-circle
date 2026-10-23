import { Invite } from './invite'

export default async function InvitePage({ searchParams }: PageProps<'/circle/invite'>) {
  const q = await searchParams
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  return (
    <Invite
      name={one(q.name) || 'Lisbon Rent'}
      localName={one(q.local) || 'Esusu'}
      amount={Number(one(q.amount)) || 4000}
      people={Math.min(12, Math.max(3, Number(one(q.people)) || 5))}
      fresh={Boolean(one(q.name))}
    />
  )
}
