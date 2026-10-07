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
- Schema changes require an explicitly selected database, a verified recovery snapshot, and an idempotent migration. For sick mode, apply only `applySickModeSchema` from `src/db/sick-mode-schema.ts`. Do not use the legacy `/api/admin/migrate` endpoint for this release: it also rewrites activity creators and deletes duplicate users.
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
- Sleep uses an `Awake | Sleeping` state control. Transitions are immediate; Undo is visible for 5 seconds. The server retains its 10-second safety limit and accepts a token only while that exact transition remains the newest server-side sleep change.
- `Naps today` uses Singapore time: counting begins at the first recorded wake from 05:00, includes ongoing daytime naps, and stops at the first sleep beginning from 18:00. Overnight sleep is excluded; a late nap beginning from 18:00 is treated as bedtime. The counter resets at Singapore midnight and waits for the next qualifying recorded wake.
- Breastmilk is replayed as an auditable FIFO ledger with separate **Available** and **Frozen** balances. Existing pump/feed/`bankadjust` history retains the prior non-negative balance behavior; no data migration is required. New writes remain strict.
- Available refrigerated milk has no in-app expiry; physical expiry is managed offline. Pump and thaw batches remain in Available until consumed, frozen, or reconciled.
- `bankfreeze`, `bankthaw`, and `bankdiscard` events appear in the activity diary and dedicated bank history. Their diary actions use the existing bank editor/API and retain ledger replay guards. A freeze creates one indivisible packet; thaw and discard always address the whole packet.
- Frozen expiry is three calendar months from the recorded freeze time in `Asia/Singapore`. Month-end dates clamp to the target month’s last day (for example, 31 January → 30 April) while preserving local time.
- Frozen reconciliation is packet-based: add, correct, or safely remove explicit packets. Transfer edits replay all later events and are rejected if they make a balance or packet state impossible.

### Sick mode
- Recorded medication doses appear in the activity diary and CSV export, including doses from ended episodes. The diary reads the existing dose records without copying them into activities; edits and soft deletions use the existing revision-checked dose API. Prescriptions alone are configuration, not administered-dose entries.
- Reviewed historical medication/procedure notes can be imported as standalone diary activities without inventing sick-mode episodes or prescriptions. Reviewed notes within an existing episode can instead become canonical doses under an existing prescription, after checking its revision and episode boundaries. Imports preserve source notes, timestamps and caregivers, carry versioned provenance, and use deterministic identities for duplicate-safe retries. Explicitly reviewed canonical matches reuse the existing dose; any text correction is revision-checked and preserves its timestamp and caregiver. Historical edits/deletions use a separate household-scoped revision-checked API; procedures have no medication amount. Soft-deleted imports are excluded from the timeline and CSV. The manifest importer supports a guarded explicit rollback that refuses changed records and requires exact apply-time fingerprints for newly imported canonical doses.
- Tap the baby name at the top to open care settings and start/end sick mode. Active health readouts stay on the dashboard. A scoped blue-teal care palette applies throughout the app until the episode is manually ended, including across navigation and refreshes; it is not a fever severity or safe/unsafe indicator.
- Sick mode is manually started and ended per baby, shared across household caregivers, and retained as episode history. Its usual daily milk baseline is frozen from the seven completed Singapore calendar days before activation; incomplete history must be confirmed or replaced with a clearly labelled manual baseline. Sick-mode days remain in history but are excluded from normal seven-day medians.
- An active episode’s start can be corrected from the baby-name care menu. Same-Singapore-day edits preserve its frozen baseline; changing the date recalculates the preceding seven-day window while excluding other sick episodes. An existing manual baseline keeps its amount. New incomplete calculated windows require confirmation or a manual fallback. Start edits cannot overlap another episode or move past a retained medication dose; they never rewrite activity, bank, prescription or dose history. `updateStart` captures `expectedStartedAt` to reject stale edits, and retries already matching the saved start are idempotent no-ops.
- An accidentally ended episode can be reopened with **Resume episode** in Past sick-mode episodes in the baby-name care menu, never the dashboard. Resuming reopens the same episode, treats the time since it ended as continuous sick mode, and preserves its frozen baseline, prescriptions and recorded doses without rewriting activity, bank, prescription or dose history; the baseline holds until an explicit start edit. Resumption is offered only for an ended episode that no other episode overlaps. The archived episode’s captured `expectedStartedAt`/`expectedEndedAt` are sent, so a stale capture is rejected with 409 `STALE_EPISODE`, a continuous overlap with 409 `EPISODE_OVERLAP`, and an exact retry of the already-reopened episode is an idempotent 200; a failed attempt retries the same frozen capture rather than substituted timestamps.
- The milk card uses selected-baby consumed breastmilk + formula during an active episode. Three marks share a true ml scale: 50% of the frozen pre-sickness full-day baseline, that baseline itself, and the existing latest-weight estimate (150 ml/kg/day). Calculated pre-sickness medians and approved manual baselines are labelled distinctly; missing weight leaves Expected pending. Expected is a guide, not a prescribed requirement, and a partial day is not presented as an automatic emergency result. The three latest consumed feeds remain visible.
- The health check-in shows temperature recency (overdue only after 60 minutes from the measurement), today’s pee units and wet-diaper count, the last wet diaper, and three latest diapers. Missing logs are stated as missing rather than interpreted as zero.
- Medications are caregiver-entered free text with prescribed dose text and as-needed status. Adding or editing a scheduled medication (as-needed off) requires an explicit “Every (hours)” interval; as-needed medications may leave intervals blank. An optional latest interval preserves prescribed ranges. Onboarding validates prescriptions before starting an episode. Every concurrent medication remains visible as a compact row; dose/window details expand. Next entered times use the last recorded dose plus the caregiver-entered interval. McPhee never chooses an interval, calculates a dose, or presents an entered interval as a safe-to-dose recommendation. Existing prescriptions and recorded doses are not rewritten. Dose logging is idempotent, caregiver-attributed, editable, and protected against stale concurrent changes.
- Each active medication has a direct pencil edit action; prescription name, dose text, entered intervals, and as-needed status can be changed mid-episode without rewriting recorded doses. Episode lifecycle/archive controls are in the baby-name care menu.
- Add-prescription and new-dose entry use one mutually exclusive dashboard-owned flow. Expanded dose history has no duplicate new-dose form; prescription and historical-dose edits remain available. Drafts survive stale refreshes with saving paused. Ordinary dismissal confirms before discarding dirty entries, and a partial multi-prescription save retries only the unconfirmed remainder. Start-mode partial failures hand off the remaining prescriptions after closing baby settings, without stacking dialogs.
- Prescription adds require a stable `requestId`, retained across ordinary retries and onboarding recovery. Exact replays return the same household/baby/episode-scoped medication without creating a second row; changed payloads using that identity are rejected. Existing prescriptions and dose history need no backfill.
- During sick mode, the sleeping card is a deeper blue than the page canvas; selecting Awake switches it to richer yellow. Temperature, pee/latest-diaper labels open the existing new-activity forms; medication labels open a dose modal (individual names preselect that medication). The + menu includes Medication only while sick mode is active. Choose a configured medication, explicitly enter the actual amount/unit and Singapore time, and save through the existing idempotent dose API. Prescriptions are never silently used as actual doses; concurrent-history conflicts require review before resubmitting.
- Sick mode keeps the first-screen reading order Sleep → Health check-in → Milk consumption/Latest feeds, followed by the separate breastmilk-bank card. Its compact header, inline sleep timer, paired health readings, three diaper rows and every medication row reduce vertical space without hiding readings or changing calculations. Care-overview secondary controls are 24–32px; the animated sleep toggle is 32px (40px outside sick mode). Awake uses richer yellow and sleeping deeper blue in sick mode. Long names, safety warnings, large text and opened editors grow naturally instead of clipping content.
- Care overview spacing uses wider gaps between sections than between records, a full-width latest-diaper heading, quieter log links, and explicit timestamp/elapsed separators. It prioritizes readable phone layouts rather than compressing every possible prescription or warning onto a tiny screen; all entries remain available by scrolling when needed.
- Textual elapsed labels use `Yh Xm ago` below 24 hours, then days with remaining hours and padded minutes (e.g. `1d, 1h, 00m ago`). Duration labels use the same shape without `ago`. Live second-by-second stopwatches retain their timer format.

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
