import { InviteScreen } from './invite'

export default async function InvitePage({ params }: PageProps<'/c/[id]/invite'>) {
  const { id } = await params
  return <InviteScreen id={id} />
}
