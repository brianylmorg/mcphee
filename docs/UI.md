# McPhee UI

A concise, product-local UI card. Keep it small and current; it is not a design
system and it does not introduce new primitives.

## Authority

1. Explicit current user / product direction for this repo.
2. The existing tokens and roles in `src/app/globals.css`.
3. `AGRIPPA_UI.md` doctrine at
   `/home/cluser/.openclaw/workspace/AGRIPPA_UI.md` — reference only. Keep the
   source reference outside this repo; apply its relevant principles locally.

Borrow the useful patterns from the shared Agrippa doctrine and the curated
Distill pass: boring, predictable data-list and disclosure structures, a clear
text hierarchy, and a calm family-care tone. Do not copy government or
agent-workspace branding, or marketing motion.

## Fonts and themes

- Body: Instrument Sans. Display and card titles: Manrope. No new fonts.
- Default warm journal theme (cream / terracotta). Sick mode is a scoped
  blue-teal palette (`html[data-care-mode="sick"]`) that means "care episode",
  never fever severity or a safe/unsafe judgement.
- State colors only: awake is warm yellow, sleeping is a deeper blue in sick
  mode.

## Type and spacing roles

Semantic size tokens live in `:root` (`--type-*`); use them instead of one-off
sizes.

| Role | Size / line | Where |
| --- | --- | --- |
| Card title (`.glance-card-title`) | 16 / 20 | Health check-in, milk card, breastmilk bank, recent activity |
| Primary value (`.glance-primary-value`) | 24 / 28 | Milk total and other headline numbers |
| Label | 14 / 20 | Health labels and medication names |
| Reading | 16 / 22 | Temperature and pee values |
| Secondary | 13 / 18 | Health recency, milk breakdown / comparisons / legend, latest summaries |
| Metadata | 12 / 16 | Times, caregivers, units, section labels |

- Base spacing unit is 4px. Group rows/lines 4-6px apart, sections 8-12px apart,
  card padding 8-12px.
- Content grows the layout. Never hide critical data, safety warnings, or shrink
  text into illegibility; long content wraps instead of clipping.

## Progressive disclosure

- Latest diapers (health check-in) and latest feeds (milk card) are collapsed
  native `<details>` disclosures. The newest entry sits on the summary line
  (time + elapsed + contents / ml) with the chevron before it, and expanding
  reveals the last three records.
- The activity diary keeps every activity for the selected day; there is no
  per-item truncation.
- Empty states state what is missing ("No diapers logged yet", "Pee not
  recorded") and never report an unlogged value as zero.

## Interaction invariants

- Native `<details>`/`<summary>` handle keyboard Enter/Space; keep the visible
  `:focus-visible` ring.
- Interactive targets are at least 32px; compact row controls are 24-32px.
- Respect reduced motion (`prefers-reduced-motion`) and keep sufficient
  contrast.
- No external dependencies, services, or costs.
