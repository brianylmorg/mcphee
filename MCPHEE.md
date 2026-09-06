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

## Features by Stage

### Stage 1 — Scaffold + Household Setup
- Welcome screen: create OR join household
- Baby profile form (name + optional birth date)
- Dashboard: baby name, age display, invite code
- Leave-household action

### Stage 1 — Scaffold + Household Setup ✅
- Welcome screen: create OR join household
- Baby profile form (name + optional birth date)
- Dashboard: baby name, age display, invite code
- Leave-household action

### Stage 2 — Core Logging ✅
- Bottlefeed (formula/breastmilk subtypes), Pump, Diaper activities
- Dashboard cards with time-since-last + predicted-next (median, 3+ entries)
- "Overdue" accent state (terracotta when past median × 1.2)
- Recent activity list (last 6, expand to all) + full history grouped by day
- Edit/delete entries, backfill timestamps
- "When" quick chips: Now / 5m / 15m / 30m / 1h / 2h + custom picker

### Stage 3 — Breastfeed Live Timer ✅
- Tap breastfeed card to start live timer (server-side active_timers row)
- Live elapsed time ticker (MM:SS or H:MM:SS)
- L/R side toggle — each switch appended to side_switches JSON array
- Safety prompt at 2h runtime (amber "Safety check" badge)
- Stop & log atomically creates activity entry with full side history

### Sleep state + breastmilk bank
- Sleep uses an `Awake | Sleeping` state control. Transitions are immediate; the 10-second undo token is accepted only while that exact transition remains the newest server-side sleep change.
- Breastmilk is replayed as an auditable FIFO ledger with separate **Available** and **Frozen** balances. Existing pump/feed/`bankadjust` history retains the prior non-negative balance behavior; no data migration is required. New writes remain strict.
- Pump and thaw batches expire from Available after 4 hours, but expired milk stays visible and requires confirmation when a bottle or freeze reaches it.
- `bankfreeze`, `bankthaw`, and `bankdiscard` activities are hidden from the baby timeline and shown in dedicated bank history. A freeze creates one indivisible packet; thaw and discard always address the whole packet.
- Frozen expiry is three calendar months from the recorded freeze time in `Asia/Singapore`. Month-end dates clamp to the target month’s last day (for example, 31 January → 30 April) while preserving local time.
- Frozen reconciliation is packet-based: add, correct, or safely remove explicit packets. Transfer edits replay all later events and are rejected if they make a balance or packet state impossible.

### Stage 4 — Growth Tracking
- Weight (g), length (mm), optional head (mm), backdatable
- Chart view (recharts)
- WHO percentile overlays (Day 2)

### Stage 5 — PWA + Push
- Manifest, service worker, standalone mode
- iOS HCTA prompt
- Push subscriptions per device
- Vercel Cron → check overdue → fire push notifications
- Rate-limit via `notification_log`

### Stage 6 — Nudges + Fussing Predictor
- Fussing button → ranked list by overdue score
- Post-log nudges (context-aware)
- Adaptive nudges (Day 2)

## Design
- Warm journal aesthetic, not clinical
- Light mode: cream/terracotta palette
- Dark mode: deep warm brown (NOT pure black — 3am friendly!)
- Display serif: **Fraunces** (headings)
- Body sans: **Instrument Sans**
- Generous whitespace, tabular numerics
- One-tap logging is #1 priority

## Activity Types
Main timeline: `bottlefeed` | `breastfeed` | `pump` | `diaper` | `vomit` | `sleep` | `note` | `temperature`

Bank-only ledger: `bankadjust` | `bankfreeze` | `bankthaw` | `bankdiscard`

## Database Schema
- `households`: id, invite_code (unique), created_at
- `babies`: id, household_id, name, birth_date, created_at
- `activities`: id, baby_id, type, started_at, ended_at, details (JSON), created_at, created_by
- `active_timers`: id, baby_id, type, started_at, current_side, side_switches (JSON), started_by
- `measurements`: id, baby_id, measured_at, weight_g, length_mm, head_mm, note, created_at
- `push_subscriptions`: id, household_id, endpoint, p256dh, auth, label
- `notification_log`: id, household_id, kind, sent_at
