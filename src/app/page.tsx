import { Home } from './_home/home'

export default async function HomePage({ searchParams }: PageProps<'/'>) {
  // ?empty=1 shows the first-run state for the demo.
  const { empty } = await searchParams
  return <Home empty={empty === '1'} />
}
