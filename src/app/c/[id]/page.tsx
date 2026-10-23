import { CircleScreen } from './circle-home'

export default async function CirclePage({ params }: PageProps<'/c/[id]'>) {
  const { id } = await params
  return <CircleScreen id={id} />
}
