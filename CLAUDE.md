# mcphee — Baby Activity Tracker

## Context
- **Repo:** github.com/brianylmorg/mcphee
- **Host:** Vercel (Singapore region, sin1)
- **Database:** Turso (libSQL) — household_id scoped, 2 users max
- **Auth:** Household-code model (6-char invite code + signed HTTP-only cookie)
- **Stack:** Next.js 15 App Router + TypeScript, Tailwind, Drizzle ORM, Turso, pnpm
- **Timezone:** Asia/Singapore (SGT), all timestamps stored as UTC epoch ms integers

## Conventions
- Branch naming: `claude/<slug>`
- Conventional commits: `feat:`, `fix:`, `chore:`
- Lint via `pnpm build`
- After schema change → idempotent migration in `src/db/migrate.ts` → deploy → hit `/api/admin/migrate?key=$MIGRATION_KEY`
- **No user accounts** — household is the auth boundary
- Metric units only (ml, g, cm/mm)
- Prediction uses median of last 8 entries (robust to outlier cycles)
- All API routes that touch DB use `node` runtime (edge doesn't support libSQL)

## Dashboard polling (Turso read budget)
- The dashboard polls `/api/dashboard` every 30s. Each poll sends its last tag in `X-Dashboard-Tag`, because Vercel strips `If-None-Match`. While nothing changed, the API answers 204 after reading one row. A full answer costs ~5.6k rows; before this, every poll cost ~16k and nearly used up the Turso Starter quota (500M rows/month).
- The tag is built from `dashboard_version`, a counter that triggers bump on every write to the tables in `DASHBOARD_VERSION_TABLES` (`src/db/dashboard-version-schema.ts`). **If the dashboard API starts reading another table, add it there** and run the migration on preview and prod. The guard test in `src/app/api/dashboard/route.test.ts` fails until you do.
- If the response gains a new time-dependent value (something that changes with the clock, not with writes), add its next change time to `validUntil` in the route. The property test only catches what the fixture data exercises.
- Rebuilding a table (create, copy, drop, rename) drops its triggers. The API then stops handing out tags (full answer every poll) until migrations re-create them, so re-run the migration after any table rebuild.
- Vercel runs `pnpm test:dashboard` before every build (`vercel.json`), so a change that breaks these tests can't deploy.

## Preview environment
- **One preview database at a time.** Every preview deploy, whatever the branch, uses the single most recent copy of prod. Currently `mcphee-preview-childcare-20261016` (Turso, prod as of 2026-10-16, plus test data added on previews since).
- Don't make a new copy per branch or feature. When a fresher copy is needed, copy prod into a new dated database, repoint the Preview `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` at it, then delete the old copy (ask the user first), so only one exists.
- Previews must never point at the prod database (`mcphee`). Preview data is test data and never flows back to prod.
- The copy's data stops at its copy date, so time-based hints (milk glow, recent nap zones) need a backdated test entry to show on a preview.
- Release flow: the user checks the preview, then says "go live"; `main` is fast-forwarded and Vercel deploys prod. Prod database commands only with the user's explicit go-ahead.

## Feature map and verification

- Read FEATURES.md first for any bug or change: find the feature, read its traps, and choose its fixture.
- Run `pnpm verify:fast` for every change; run `pnpm verify:ui` for anything visible. UI verification uses a throwaway file DB and fixtures, with screenshots in `.verify/shots/` and evidence in `.verify/last.json`.
- Reproduce bugs with a fixture and a failing spec before fixing them.
- Update FEATURES.md when adding a page, API route or component; the feature-map check fails otherwise.

## Design
- Warm journal aesthetic, not clinical
- Light mode: cream/terracotta palette
- Dark mode: deep warm brown (NOT pure black — 3am friendly!)
- Display serif: **Fraunces** (headings)
- Body sans: **Instrument Sans**
- Generous whitespace, tabular numerics
- One-tap logging is #1 priority

## Activity Types
`bottlefeed` | `breastfeed` | `pump` | `diaper` | `vomit`

## Database Schema
- `households`: id, invite_code (unique), created_at
- `babies`: id, household_id, name, birth_date, created_at
- `activities`: id, baby_id, type, started_at, ended_at, details (JSON), created_at, created_by
- `active_timers`: id, baby_id, type, started_at, current_side, side_switches (JSON), started_by
- `measurements`: id, baby_id, measured_at, weight_g, length_mm, head_mm, note, created_at
- `push_subscriptions`: id, household_id, endpoint, p256dh, auth, label
- `notification_log`: id, household_id, kind, sent_at
