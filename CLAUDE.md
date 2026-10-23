@AGENTS.md

## Visual direction: "Sweet Pot"

Chunky clay friends around a warm pot; plum ink on blush, one coral action. Mobile-first (Nimiq Pay mini app). Tokens live in `src/app/globals.css` (`@theme`).

- **Colour has meaning:** coral = act / the pot · mint = yield earned · sun = payout + "your turn" · lilac = waiting · plum = text. Member avatars use the pastel set only.
- **Type:** Bricolage Grotesque (display, numbers), Figtree (text). No italics. Tabular numbers for money.
- **Shape:** cards 28px, inner 20px, everything tappable is a pill. Shadows are plum-tinted and soft, never grey/black.
- **Illustration:** generated soft-clay 3D (gpt-image-2 via stablestudio), flat #FFF6F1 bg knocked out to transparent PNG/WebP in `public/art/`. Characters are diverse; no text in art.
- **Motion:** press = scale .97 / 120ms ease-out. Pot fill + count-up only on first view; dial turns 600ms ease-in-out when a round advances. Always a reduced-motion version.
- **Don't:** em-dashes, gradients on text, grey shadows, a second accent for actions, hand-drawn SVG illustrations.
