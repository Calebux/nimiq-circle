import { GoalScreen } from './goal'

export default async function GoalPage({ params }: PageProps<'/g/[id]'>) {
  const { id } = await params
  return <GoalScreen id={id} />
}
