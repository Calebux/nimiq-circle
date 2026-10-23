import { PayoutScreen } from './payout'

export default async function PayoutPage({ params }: PageProps<'/c/[id]/payout'>) {
  const { id } = await params
  return <PayoutScreen id={id} />
}
