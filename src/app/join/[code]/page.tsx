import { JoinScreen } from './join'

export default async function JoinPage({ params }: PageProps<'/join/[code]'>) {
  const { code } = await params
  return <JoinScreen code={decodeURIComponent(code)} />
}
