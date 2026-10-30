import { BackLink, Screen } from '@/components/ui'

export const metadata = { title: 'What Akilii stores' }

const ITEMS: [string, string][] = [
  ['Your Nimiq address', 'To know which circles and goals are yours. You prove it by signing a message in Nimiq Pay; no money moves.'],
  ['The name and picture you choose', 'Shown to people in the same circle, nowhere else.'],
  ['Your circles, goals and payments', 'Which round you paid, what you saved, what you took out. The payments themselves are public on the Nimiq blockchain anyway, tagged with a reference like cc:circle:round.'],
  ['Bank details, only when you cash out', 'We send the account number and name to our payout provider to pay you naira. We keep the bank name, the last 4 digits and the account name on the receipt, not the full number.'],
  ['A session cookie', 'So you stay signed in. No tracking or ad cookies.'],
]

/** Plain-language data disclosure (competition rules ask for clear, informed consent). */
export default function PrivacyPage() {
  return (
    <Screen bar={false}>
      <BackLink href="/" />
      <h1 className="mt-4 font-display text-[32px] font-extrabold leading-tight tracking-tight">What Akilii stores</h1>
      <p className="mt-2 text-[17px] text-ink-2">Only what it needs to run your circles and goals. Nothing is sold or shared for ads.</p>
      <ul className="mt-6 flex flex-col gap-3">
        {ITEMS.map(([title, body]) => (
          <li key={title} className="rounded-card bg-white p-5 shadow-soft">
            <p className="font-display text-lg font-bold tracking-tight">{title}</p>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-2">{body}</p>
          </li>
        ))}
      </ul>
      <section className="mt-4 rounded-card bg-sun-soft p-5 text-[15px] leading-relaxed text-sun-ink">
        <p className="font-display text-lg font-bold">Who holds the money</p>
        <p className="mt-1">
          Akilii is custodial: contributions and savings sit in one pool wallet that the Akilii server controls, so it can pay out pots and enforce goal locks. You can check its balance against what it owes members at any time on the pool page.
        </p>
      </section>
      <p className="mt-6 text-sm text-ink-2">Want your data deleted? Ask in the Akilii thread on the Nimiq forum and we will remove everything that is not needed to settle money you are owed or owe.</p>
    </Screen>
  )
}
