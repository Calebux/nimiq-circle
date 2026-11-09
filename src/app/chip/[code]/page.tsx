import { ChipInScreen } from './chip-in'

export default async function ChipInPage({ params }: PageProps<'/chip/[code]'>) {
  const { code } = await params
  return <ChipInScreen code={decodeURIComponent(code)} />
}
