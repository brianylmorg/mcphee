# Feature map

This maps B’s words to the cards, buttons, sheets and code behind McPhee. Most features live on /dashboard; /weight and the welcome page are separate routes.

For a bug or change: find the entry → read its traps → seed its fixture → reproduce with a failing spec → fix → verify. Use the seed/cookie helpers in `e2e/fixtures.ts` through `e2e/dashboard.spec.ts`; see `e2e/README.md`. Every fixture includes Robin, Alex, a weight and seven previous SGT days of feeds, pumps, diapers and sleep. “fresh-day” is populated history, not an empty database. A “fresh-day + …” instruction means extend that seed for the reported state; fixture-specific screenshots only prove the assertions in the spec, not every interaction below.

`scripts/feature-map-check.mjs` enforces existing backticked repo paths, coverage of every page/API route/top-level component, exported fixture names and unique feature IDs. It runs in `scripts/verify.sh` fast. Add or update an entry whenever adding one of those surfaces. Paths under Tests identify relevant coverage; they do not imply complete end-to-end coverage.

Use a throwaway file: database for local reproduction. Never point local runs at .env.local (prod). Preview DB data stops at its copy date, so recent-time hints need entries at the intended test date. Symlinked node_modules breaks Turbopack here: use next dev --webpack (the UI verifier does this).

## Logging

### Bottle feeds and leftovers {#bottle-feeds}
- **B calls it:** bottlefeed, bottle, formula, breast milk, leftover, wastage, 150-40
- **Reach it:** /dashboard → “Add activity” → “Bottlefeed” → “Breast milk” or “Formula” → “Amount (ml)” → “Log activity”. In “Recent activity”, “Edit bottlefeed activity” opens the saved form; “Save changes” updates it.
- **Fixture:** fresh-day
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/lib/amount-expression.ts`, `src/lib/milk-calculation.ts`, `src/lib/milk-volumes.ts`, `src/lib/activity-input.ts`, `src/app/api/activities/route.ts`, `src/db/schema.ts`
- **API / tables:** /api/activities POST/PUT/DELETE, /api/dashboard; activities, babies, users; breastmilk also affects the activity-based bank ledger.
- **Tests:** `src/lib/amount-expression.test.ts`, `src/app/api/activities/route.test.ts`, `src/lib/recent-milk-feeds.test.ts`, `e2e/dashboard.spec.ts` (fresh-day writes a formula bottle and reloads).
- **Traps:** Amount expressions preserve amountExpression and wastedAmount; 150-40 counts 110 ml consumed while the bank deducts the full 150 ml for breastmilk. Modern rows may have multiple feeds plus breastmilkAmount/formulaAmount; do not count both representations. Breastmilk availability validation includes the original feed when editing. See the backdating entry for near-future timestamps.

### Pump logging {#pump-logging}
- **B calls it:** pump, expressed milk, add milk
- **Reach it:** /dashboard → “Add activity” → “Pump” → “Amount (ml)” → “Log activity”. Tap “Edit pump activity” in “Recent activity” to correct it.
- **Fixture:** fresh-day
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/lib/milk-calculation.ts`, `src/lib/milk-bank-ledger.ts`, `src/app/api/activities/route.ts`, `src/db/schema.ts`
- **API / tables:** /api/activities, /api/dashboard; activities, babies, users.
- **Tests:** `src/app/api/activities/route.test.ts`, `src/lib/milk-bank-ledger.test.ts`; no pump-write e2e.
- **Traps:** Pump volume adds Available milk rather than consumption. The pump input filters to digits, decimal, plus and minus; do not assume the broader amount-expression evaluator describes everything this UI accepts. Changing a historical pump can invalidate later bank balances.

### Diapers and pee units {#diapers}
- **B calls it:** diaper, pee, poop, wet diaper, pee units
- **Reach it:** /dashboard → “Add activity” → “Diaper” → choose “Poo” and “Pee units” → “Log activity”. With sick mode active, “Health check-in” → “Log diaper” or “Log a new diaper” opens the same form.
- **Fixture:** sick-episode
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/components/SickModePanel.tsx`, `src/components/LatestEntriesDisclosure.tsx`, `src/lib/activity-input.ts`, `src/app/api/activities/route.ts`, `src/db/schema.ts`
- **API / tables:** /api/activities, /api/sick-mode, /api/dashboard; activities, babies, users, sick_mode_episodes.
- **Tests:** `src/components/SickModePanel.test.ts`, `src/components/LatestEntriesDisclosure.test.ts`, `src/app/api/activities/route.test.ts`, `src/app/api/sick-mode/route.test.ts`, `e2e/dashboard.spec.ts` (health card smoke).
- **Traps:** Pee units are a quantity, not simply a diaper count. Legacy imported rows can contain peeText/peeCount while modern rows use peeUnits; preserve the normalization in sick-mode code. SGT midnight controls “Pee today”. Childcare logging requires the explicit override confirmation.

### Notes and legacy vomit {#notes}
- **B calls it:** note, solids, vomit, dribble, projectile
- **Reach it:** /dashboard → “Add activity” → “Note” → “Log activity”. For existing rows, tap the corresponding “Edit … activity” button in “Recent activity”. Vomit is a legacy edit form, absent from the new-activity menu.
- **Fixture:** fresh-day + add a note or legacy vomit activity for the reported case
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/lib/activity-note.ts`, `src/lib/vomit-note.ts`, `src/lib/activity-input.ts`, `src/db/migrate-vomit-to-note.ts`, `src/app/api/activities/route.ts`
- **API / tables:** /api/activities, /api/dashboard; activities, babies, users.
- **Tests:** `src/lib/activity-note.test.ts`, `src/lib/vomit-note.test.ts`, `src/app/api/activities/route.test.ts`; no dedicated e2e.
- **Traps:** Do not resurrect “Vomit” as a new logging action based on stale stage documentation. Legacy vomit details and notes have conversion helpers; generic notes need meaningful text and use the note validator.

### Backdating and activity history {#activity-history}
- **B calls it:** when, custom time, history, all days, edit log, delete log, CSV, overdue
- **Reach it:** /dashboard → “Add activity” → an activity → “When” → “Custom” → “Activity date” and time → “Log activity”. In “Recent activity”, use “Select activity date”, “Show previous day activities”, “All days”, “Activity type: All activity types”, “View all activities”, or “Export CSV”. Tap a row’s “Edit … activity” button, then “Save changes” or “Delete activity”.
- **Fixture:** fresh-day
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/components/ActivityTimelineCard.tsx`, `src/components/ActivityRecency.tsx`, `src/lib/activity-timeline.ts`, `src/lib/activity-time.ts`, `src/lib/sgt-day.ts`, `src/app/api/activities/route.ts`, `src/app/api/activities/export/route.ts`
- **API / tables:** /api/activities GET with date/type filters and mutation methods; /api/activities/export GET; /api/dashboard; activities, sick_mode_doses, sick_mode_medications, sick_mode_episodes, babies, users.
- **Tests:** `src/components/ActivityTimelineCard.test.ts`, `src/lib/activity-recency.test.ts`, `src/lib/activity-time.test.ts`, `src/lib/sgt-day.test.ts`, `src/app/api/activities/route.test.ts`, `e2e/dashboard.spec.ts` (bottle persistence).
- **Traps:** Day filters use SGT, not the host timezone. activity-time clamps times ahead by <=2 minutes to now so they enter totals immediately; more distant future times still require validation. The picker retains its opening minute alongside five-minute steps. Date selection also changes the milk day. Type filters close after each choice. Activity-menu overdue color needs at least three entries, uses up to eight intervals and median × 1.2; this is separate from the milk glow. Canonical doses and imported historical medication rows have separate edit/delete endpoints.

### Breastfeeding live timer {#breastfeed-timer}
- **B calls it:** breastfeed, feeding timer, left side, right side, stop and log, safety check
- **Reach it:** /dashboard → “Add activity” → “Breastfeed” → tap “Breastfeed” again after “Tap again to start”. The live card offers “Left side”, “Right side”, “Stop & log”. With the timer fixture these controls are already visible.
- **Fixture:** breastfeed-timer
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/app/api/active-timers/route.ts`, `src/lib/activity-creators.ts`, `src/db/schema.ts`
- **API / tables:** /api/active-timers POST starts, PUT switches side, DELETE stops/logs; /api/dashboard; active_timers, activities, babies, users, childcare_sessions.
- **Tests:** `src/app/api/activities/childcare-log.test.ts`, `e2e/dashboard.spec.ts` (timer controls only).
- **Traps:** First tap is a safety prompt; second starts. The timer is server persisted, not a browser stopwatch. Switching sides appends history; stopping creates the activity and removes the timer in a transaction. At two hours the UI shows “Safety check”. No measured ml is inferred from a timed breastfeed. A start immediately refreshes the dashboard to avoid an older poll hiding the timer.

### Temperature logging {#temperature}
- **B calls it:** fever, temperature, thermometer, armpit
- **Reach it:** /dashboard → “Add activity” → “Temperature” → “Log activity”; in sick mode, “Health check-in” → “Log temperature” opens it directly.
- **Fixture:** sick-episode
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/components/SickModePanel.tsx`, `src/lib/activity-input.ts`, `src/lib/sick-mode.ts`, `src/app/api/activities/route.ts`
- **API / tables:** /api/activities, /api/sick-mode, /api/dashboard; activities, babies, users, sick_mode_episodes.
- **Tests:** `src/lib/sick-mode.test.ts`, `src/components/SickModePanel.test.ts`, `src/app/api/sick-mode/route.test.ts`, `e2e/dashboard.spec.ts` (37.8 °C health check-in).
- **Traps:** Temperature includes a measurement method. The health card marks the latest temperature overdue after one hour, independently of activity-menu medians. Stale sick-mode data pauses health-card actions; it is not evidence that an episode ended.

## Sleep

### Sleep / awake state and corrections {#sleep-state}
- **B calls it:** sleep, awake, wake up, sleeping timer, undo sleep
- **Reach it:** /dashboard → “Sleep status” → “Sleep” (aria-label “Set state to Sleeping”) or “Wake up” (“Set state to Awake”). Use “Edit sleep start (<time>)” or “Edit awake start (<time>)” → “Current state start time” → “Save”; the transition message offers “Undo”.
- **Fixture:** fresh-day
- **Code:** `src/components/SleepStateControl.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/lib/sleep-transition.ts`, `src/app/api/sleep-state/route.ts`, `src/db/schema.ts`
- **API / tables:** /api/sleep-state POST sleep/wake/undo, /api/activities PUT for corrections, /api/dashboard; activities, babies, users, paper_log_import_batches, childcare_sessions.
- **Tests:** `src/components/SleepStateControl.test.ts`, `src/lib/sleep-transition.test.ts`, `src/app/api/activities/childcare-log.test.ts`; no transition e2e.
- **Traps:** Open sleep is an activities row with no ended_at, not active_timers. Awake duration normally starts at the last completed sleep end; confirmed caretaker coverage supplies a fallback. Undo checks the expected state and import audit before changing rows. The carousel disables its action during its one-second scene transition. A backfilled completed sleep is different from toggling live state.

### Sleep blips (crying in his sleep) {#sleep-blips}
- **B calls it:** blip, blips, screaming in his sleep, crying for no reason, night wakings, sleep through the night
- **Reach it:** The Blip button is HIDDEN since 14 Nov 2026 (`SLEEP_BLIP_CONTROL_VISIBLE = false` in `src/lib/sleep-blips.ts`; B kept forgetting to stop it, and night feeds alone drive the night plan). History, diary rows and the API still work. When visible: /dashboard → “Sleep status” while sleeping → “Blip” (aria-label “Start a blip (crying in his sleep)”), then “Settled himself” or “We settled him”; the toast offers “Undo”. The line beside the button reads “N blips · Mm this sleep”. Per-night history: “View wake window and nap charts” → “Night blips” includes night feeds as interruptions, with feed count and consumed ml. Each marked blip is also a diary row (“Blip”, filter “Blip”) whose start and end can be edited or deleted.
- **Fixture:** asleep-blips
- **Code:** `src/components/SleepBlipControl.tsx`, `src/components/NightBlipsSummary.tsx`, `src/lib/sleep-blips.ts`, `src/lib/sleep-blips-server.ts`, `src/app/api/sleep-blips/route.ts`, `src/app/api/sleep-state/route.ts`, `src/app/api/dashboard/route.ts`, `src/app/(app)/dashboard/page.tsx`
- **API / tables:** /api/sleep-blips POST start/stop/undo; /api/sleep-state wake and undo also touch open blips; /api/dashboard `sleepBlips` and `nightFeeds` (bottlefeed/breastfeed, last 15 days); /api/activities PUT/DELETE for diary edits; activities (type `sleepblip`, details.ending self/us/woke). No new table or trigger.
- **Tests:** `src/lib/sleep-blips.test.ts`, `src/app/api/sleep-blips/route.test.ts`, `src/components/SleepBlipControl.test.ts`, `src/components/NightBlipsSummary.test.ts`, `src/app/api/dashboard/route.test.ts`, `e2e/dashboard.spec.ts` (asleep-blips checks the Blip button is hidden and opens the chart).
- **Traps:** One open blip inside the current sleep; start, sleep edits and caretaker commits heal stranded opens as “woke”. Deleting a sleep deletes blips starting in its window; undoing sleep start deletes all later blips. Stop undo requires its containing sleep still open; diary saves cannot reopen closed blips. Wake records wokeAt for exact undo, with end clamped to start. Night history covers starts in the last 14 days (15-day server margin); overlapping blips cut every intersecting sleep interval, but count by start. Gaps <=5 minutes merge; daytime naps stay off the night chart. Feeds count only >30 minutes after bedtime and before the final wake (now if open); positive amounts <=5 ml are ignored, breastfeeds (0 ml) count. Within 15 minutes of a blip span or merged wake gap, feeds add no extra blip; all qualifying feeds still cut sleep stretches. Feed ml is consumed volume; blip duration stays marked-blip time only. Tags expire at blip/feed window exits. No childcare guard or watch blip button. Legacy dashboard equivalence ignores sleepBlips, nightFeeds and recentWeights; separate tests cover them.

### Night plan (gentle night weaning) {#night-plan}
- **B calls it:** night plan, weaning, night feeds, sleep through the night
- **Reach it:** /dashboard → “View wake window and nap charts” → “Sleep charts” → “Night blips”, with the compact “Night plan” block above the history. During a night, “Add activity” → “Bottlefeed” prefills the first amount and first preset from that slot's plan. No push notification. No new first-screen content, controls or input fields.
- **Fixture:** asleep-blips
- **Code:** `src/lib/night-plan.ts`, `src/lib/sleep-blips.ts`, `src/components/NightPlanSummary.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/api/dashboard/route.ts`
- **API / tables:** /api/dashboard `nightFeeds`, `sleepActivities`, `recentWeights` (last six non-null weights across household babies, filtered to the selected baby in the page); activities, measurements, babies. Measurements already has dashboard-version tracking. No schema, trigger, table or cron change.
- **Tests:** `src/lib/night-plan.test.ts`, `src/components/NightPlanSummary.test.ts`, `src/app/api/dashboard/route.test.ts`, `e2e/dashboard.spec.ts` (asleep-blips opens charts and finds Night plan within Night blips).
- **Traps:** Stateless ratchet, no saved target: history is the last seven completed nights starting within ten days, minimum four nights. Reuses blip night grouping (18:00–07:00 SGT, gaps <=5 minutes merge), feeds >30 minutes after bedtime and before night end; ignores positive <=5 ml. Slots Evening (18:00–23:59), 01:00 (00:00–03:59), 05:00 (04:00–06:59); shrink in evening → early → midnight order. Per slot, any breastfeed or unknown amount makes that night unusable; empty slots are usable zeroes. Use the last two usable nights for max(milk) minus 20 ml and for two-zero “gone”; median positive usable totals rounded to 10 ml is usual. Ratchet capped at usual +20 and max(usual, m); <=60 ml means settle first, always feed if he will not settle. Fewer than two usable nights or no positive usable total gives unknown, holds progression, no size/prefill. Midnight needs a weight within 14 days and the most recent eligible earlier weight >=7 days before it gaining >=70 g/week; otherwise locked at usual with a weigh note. Pause for sick mode, milk <700 ml on each of two full 07:00–07:00 SGT days (both must contain feeds), or latest weight below previous; paused/data-insufficient plans have no sizes. 650 ml day target, 700 ml pause threshold and 70 g/week are judgement, not guideline. B dropped the daily plan push on 13 Nov (not wanted); the morning brief carries last night instead. Form prefill only during an open night or within five minutes of a closed sleep, >30 minutes after first bedtime and only at 18:00–06:59; active/usual/locked positive sizes only, never editing, unknown, gone, paused or settle-first.

### Naps today and total glow {#naps-today}
- **B calls it:** naps today glow, nap total, too much daytime sleep, waiting for morning wake
- **Reach it:** /dashboard → “Sleep status” → “Naps today”; “How naps today is calculated” expands the rules. To reproduce glow, add completed daytime sleep near Robin’s age maximum, using history editing or a fixture extension.
- **Fixture:** fresh-day + add SGT daytime sleeps totaling within 30 minutes of the age maximum, or above it
- **Code:** `src/components/DailyNapSummary.tsx`, `src/lib/daily-naps.ts`, `src/lib/sleep-windows.ts`, `src/app/(app)/dashboard/page.tsx`, `src/app/globals.css`
- **API / tables:** /api/dashboard sleepActivities/sleepCoverages; activities, babies, sick_mode_episodes, paper_log_import_batches.
- **Tests:** `src/components/DailyNapSummary.test.ts`, `src/lib/daily-naps.test.ts`, `src/lib/sleep-windows.test.ts`, `src/app/api/dashboard/route.test.ts`; no glow e2e.
- **Traps:** SGT midnight resets the total. NIGHT_ENDS_HOUR is 07:00: sleep starting before it is the tail of night; the day starts at the last such wake, or a fallback wake >=05:00. Confirmed care coverage can establish an earlier start. First sleep starting >=18:00 is bedtime and ends daytime tracking. Overlaps merge, an ongoing nap contributes through now. Glow starts 30 minutes before the age maximum and pulses at/above it; missing age guidance and sick mode disable glow. A seed run near midnight may still be waiting for morning wake.

### Wake windows, nap zones and charts {#sleep-charts}
- **B calls it:** nap time glow, awake timer glow, wake windows, his usual day, nap charts, sick naps
- **Reach it:** /dashboard → “View wake window and nap charts” → “Sleep charts”: “His usual day”, “Wake windows”, “Nap length”. In “His usual day”, “Usual days” / “Sick days” appears when sick data exists. The awake timer itself glows in/past a nap zone.
- **Fixture:** fresh-day
- **Code:** `src/components/NapZonesSummary.tsx`, `src/components/SleepWindowsChart.tsx`, `src/components/SleepStateControl.tsx`, `src/lib/sleep-windows.ts`, `src/app/(app)/dashboard/page.tsx`, `src/app/globals.css`
- **API / tables:** /api/dashboard; activities, babies, sick_mode_episodes (sick-day classification).
- **Tests:** `src/components/NapZonesSummary.test.ts`, `src/components/SleepStateControl.test.ts`, `src/lib/sleep-windows.test.ts`, `src/app/api/dashboard/route.test.ts`; no chart-interaction e2e.
- **Traps:** Uses the same 07:00 NIGHT_ENDS_HOUR rule as daily naps. Sleep gaps <=5 minutes merge. Ranges need at least three samples at that point in the day; recent 14-day data is preferred with older fallback. Usual and sick days are separated. The awake hint can fall back to own earlier windows or age guidance; its words are screen-reader text, while the visible indication is glow/pulse. This differs from the daily-total glow.

### Storybook scenes and the bee {#storybook-art}
- **B calls it:** the bee, balloon, cottage, sleeping kid, running kid, clouds, moon
- **Reach it:** /dashboard → look at “Sleep status” while awake for the daytime scene and bee; tap “Sleep” (“Set state to Sleeping”) for the night scene. The header’s “Childcare status: at home” cottage becomes “Childcare status: in childcare” when checked in.
- **Fixture:** fresh-day
- **Code:** `src/components/StorybookArt.tsx`, `src/components/SleepStateControl.tsx`, `src/components/ChildcareStatusTrigger.tsx`, `src/app/globals.css`, `public/storybook/bee-up.webp`, `public/storybook/bee-down.webp`
- **API / tables:** Decorative art has no API; /api/dashboard and /api/sleep-state provide sleep/childcare state from activities and childcare_sessions.
- **Tests:** `src/components/SleepStateControl.test.ts`, `e2e/dashboard.spec.ts` (screenshots, no bee-motion assertion).
- **Traps:** Art is aria-hidden. Motion is in globals.css under .sb- classes and respects reduced motion; inspect CSS and assets as well as TSX. The bee has two image frames. Childcare art also acts as a real button through ChildcareStatusTrigger; the sleep illustrations themselves are decorative.

## Milk

### Milk totals, recent feeds, glow and history {#milk-consumption}
- **B calls it:** milk total, milk glow, recent bottle feeds, same time yesterday, milk median, consumption chart
- **Reach it:** /dashboard → “Today’s milk consumption” and “Recent bottle feeds”. Use “Show previous day milk summary”, “Show same-time milk total for previous day”, “How the milk median is calculated”, or “View total milk consumption history” → “Milk consumption charts”.
- **Fixture:** fresh-day
- **Code:** `src/components/RecentBottleFeeds.tsx`, `src/components/LatestEntriesDisclosure.tsx`, `src/components/MilkHistoryChart.tsx`, `src/lib/recent-milk-feeds.ts`, `src/lib/milk-hint.ts`, `src/lib/dashboard-milk-state.ts`, `src/lib/milk-volumes.ts`, `src/app/api/milk-history/route.ts`, `src/app/(app)/dashboard/page.tsx`
- **API / tables:** /api/dashboard, /api/milk-history?babyId=…&asOf=…; activities, measurements, babies, sick_mode_episodes.
- **Tests:** `src/components/RecentBottleFeeds.test.ts`, `src/lib/milk-hint.test.ts`, `src/lib/dashboard-milk-state.test.ts`, `src/lib/recent-milk-feeds.test.ts`, `src/app/api/dashboard/route.test.ts`, `e2e/dashboard.spec.ts` (totals heading and recent feeds).
- **Traps:** Totals use consumed bottle ml, not offered volume, pump volume or timed breastfeeding. Expected is weight ×150 ml/kg/day; it is not the same reference as the historical median. SGT determines day and same-time cutoffs. Milk hint becomes due at 2h45, past at 3h30 and disappears at >=8h to avoid stale-history warnings. Sick-day handling has its own entry. Dependent requests refetch on tag/data changes and explicit refresh, not an independent 30-second polling loop.

### Breastmilk bank, freezer packets and reconciliation {#milk-bank}
- **B calls it:** milk bank, available milk, frozen milk, thaw, freeze, reconcile, bank adjustment
- **Reach it:** /dashboard → “Breastmilk bank” → “Reconcile Available milk” → “Actual Available milk in ml” → “Set”; or “Show frozen milk details” → “Freeze”, “Thaw whole” (aria-label “Thaw 180 ml packet” for the seed), “Reconcile frozen packets” → “Add packet”, or “Freezer bank history”.
- **Fixture:** milk-bank
- **Code:** `src/components/MilkBank.tsx`, `src/lib/milk-bank-ledger.ts`, `src/lib/milk-bank-command.ts`, `src/app/api/milk-bank/route.ts`, `src/app/api/activities/route.ts`, `src/db/schema.ts`
- **API / tables:** /api/milk-bank GET/POST/PUT/DELETE, /api/activities for Available reconciliation, /api/dashboard; activities, babies, users.
- **Tests:** `src/components/MilkBank.test.ts`, `src/lib/milk-bank-ledger.test.ts`, `src/lib/milk-bank-command.test.ts`, `src/app/api/activities/route.test.ts`, `e2e/dashboard.spec.ts` (1040 ml and frozen 180 ml packet).
- **Traps:** No separate bank table: ordered activity events form the ledger. Breastmilk feeds deduct offered volume including leftover/wastage; consumption totals deduct wastage instead. Freeze/thaw are packet transfers; thaw is whole-packet. Reconcile frozen milk by adding/correcting/removing physical packets, not an opaque total. Corrections can be rejected if later balances or packet states become impossible. Corrected freeze dates recalculate expiry using Singapore time.

## Childcare

### Attendance, handover and session history {#childcare-attendance}
- **B calls it:** childcare, check in, checkout, at home, handover, dimmed dashboard, edit session
- **Reach it:** /dashboard → “Childcare status: at home” or “Baby settings for Robin” → “Childcare” → “Check in”. Once checked in, “Childcare summary” offers “Check out”; the header button becomes “Childcare status: in childcare”. In the care sheet use “Edit start time” for an active stay or “Edit session” on a history row.
- **Fixture:** childcare-checked-in
- **Code:** `src/components/BabyCareMenu.tsx`, `src/components/ChildcareModePanel.tsx`, `src/components/ChildcareStatusTrigger.tsx`, `src/components/ChildcareHandoverCard.tsx`, `src/components/CareTimesEditor.tsx`, `src/lib/childcare-mode-client.ts`, `src/lib/childcare-mode-server.ts`, `src/lib/childcare-handover.ts`, `src/app/api/childcare-mode/route.ts`, `src/db/childcare-mode-schema.ts`
- **API / tables:** /api/childcare-mode, /api/dashboard; childcare_sessions, babies, users, activities, paper_log_import_batches, paper_log_import_rows.
- **Tests:** `src/components/BabyCareMenu.test.ts`, `src/components/ChildcareModePanel.test.ts`, `src/components/ChildcareHandoverCard.test.ts`, `src/components/CareTimesEditor.test.ts`, `src/lib/childcare-mode-client.test.ts`, `src/app/api/childcare-mode/route.test.ts`, `e2e/dashboard.spec.ts` (checked-in sheet).
- **Traps:** Check-in/out records now on ordinary presses; an old open stay instead asks when the child left that SGT day. Check-out must follow check-in on the same SGT date. At childcare the dashboard is dimmed and logging needs explicit override. Editing imported session attendance leaves imported activities unchanged. Pending imports and imported sessions have different removal/dismissal rules; preserve request/revision guards when editing.

### Checkout screenshot import and sleep reconciliation {#checkout-import}
- **B calls it:** the checkout import, caretaker screenshot, OCR, childcare log, balance 40ml, blue entries, care hours
- **Reach it:** /dashboard → “Childcare status: in childcare” → “Check out” opens the linked import; pending history rows offer “Import screenshot”. Alternatively “Baby settings for Robin” → “Childcare” → “Import a screenshot without a check-in”. In “Import caretaker screenshot”, choose “Date (Singapore)” → “Choose screenshot” → “Read screenshot” → review “Care hours” and rows, check all naps, then “Save to diary” (or “Save sleep schedule” if no rows are included).
- **Fixture:** fresh-day + check in/out for a same-SGT-day stay and supply a PNG/JPEG/WebP caretaker screenshot with the reported rows
- **Code:** `src/components/CaretakerImportModal.tsx`, `src/components/CaretakerImportInfo.tsx`, `src/components/CaretakerReviewOverview.tsx`, `src/components/CareTimesEditor.tsx`, `src/lib/caretaker-import.ts`, `src/lib/caretaker-import-client.ts`, `src/lib/caretaker-import-server.ts`, `src/lib/caretaker-sleep-reconciliation.ts`, `src/lib/caretaker-sleep-audit.ts`, `src/lib/screenshot-stitch.ts`, `src/app/api/caretaker-import/route.ts`, `src/app/api/caretaker-import/stage/route.ts`, `src/app/api/caretaker-import/source/route.ts`, `src/app/api/caretaker-import/review/route.ts`, `src/app/api/caretaker-import/commit/route.ts`, `src/db/caretaker-import-schema.ts`, `public/ocr/README.md`
- **API / tables:** /api/caretaker-import (snapshot), /stage, /source, /review, /commit under that prefix; /api/childcare-mode; paper_log_import_batches, paper_log_import_rows, activities, childcare_sessions, babies, users.
- **Tests:** `src/lib/caretaker-import.test.ts`, `src/lib/caretaker-import-client.test.ts`, `src/lib/screenshot-stitch.test.ts`, `src/lib/caretaker-care-window.test.ts`, `src/lib/childcare-import-match.test.ts`, `src/lib/caretaker-sleep-reconciliation.test.ts`, `src/app/api/caretaker-import/route.test.ts`, `src/app/api/caretaker-import/sleep-reconciliation.test.ts`; no OCR/import e2e.
- **Traps:** Local OCR runs on the device using vendored assets; private source/drafts expire after seven days. “Remarks: Balance 40ml” is leftover, not a second feed: parseFeedLeftover must keep 40 out of offeredFeedAmounts. 150 offered minus 40 balance imports 110 consumed with amountExpression/wastedAmount; breastmilk bank still deducts 150. Blue household entries and exact duplicates cannot be included; uncertain origin/low confidence needs review. Linked care times must match the session and edits invalidate the saved sleep plan. Within confirmed care hours, reviewed non-blue naps are authoritative and all gaps awake; existing sleeps may be removed/trimmed/split, an old running sleep stops, and later home sleep remains. Commit rechecks revisions/clashes; do not blindly retry a stale plan.

## Sick mode

### Episode start, onset correction, end and archive {#sick-episodes}
- **B calls it:** sick mode, onset, care theme, start sick, end mode, resume episode
- **Reach it:** /dashboard → “Baby settings for Robin” → “Sick mode” → “Start” → “Sick mode started” → “Start sick mode”. With an active episode, “Sick-mode settings” offers “Edit sick-mode start time” and “End mode”; previous episodes appear below in the same sheet.
- **Fixture:** sick-episode
- **Code:** `src/components/SickModePanel.tsx`, `src/components/CareModeTheme.tsx`, `src/lib/sick-mode.ts`, `src/lib/sick-mode-client.ts`, `src/lib/care-mode.ts`, `src/app/api/sick-mode/route.ts`, `src/db/sick-mode-schema.ts`
- **API / tables:** /api/sick-mode GET/POST; sick_mode_episodes, sick_mode_medications, sick_mode_doses, activities, babies, users, childcare_sessions.
- **Tests:** `src/components/SickModePanel.test.ts`, `src/lib/sick-mode.test.ts`, `src/lib/care-mode.test.ts`, `src/app/api/sick-mode/route.test.ts`, `e2e/dashboard.spec.ts` (active health card).
- **Traps:** Baseline is frozen from completed pre-onset SGT days, with incomplete/manual confirmation where needed. Same-day onset edits retain the snapshot; moving a calculated onset across dates may recalculate, while manual baseline is retained. Doses constrain onset/end edits. Resume reopens the same episode continuously, preserving medications and doses; it must not overlap another episode. Schema-unready/stale state disables actions, and care theme persists until an explicitly ended episode is confirmed.

### Sick milk percentage and health read budget {#sick-milk}
- **B calls it:** sick mode milk %, 50 percent, pre-sick median, hydration, milk baseline
- **Reach it:** /dashboard with sick mode active → “Today’s milk consumption” → “Full-day milk guide values”; “Health check-in” shows temperature, pee and medications. Open “Baby settings for Robin” → “Sick-mode settings” to inspect “Usual daily intake”.
- **Fixture:** sick-episode
- **Code:** `src/components/SickMilkProgress.tsx`, `src/components/SickModePanel.tsx`, `src/lib/sick-mode.ts`, `src/lib/dashboard-milk-state.ts`, `src/app/api/sick-mode/route.ts`, `src/app/api/milk-history/route.ts`, `src/app/(app)/dashboard/page.tsx`
- **API / tables:** /api/sick-mode summary/baseline, /api/milk-history, /api/dashboard; activities, measurements, babies, sick_mode_episodes, sick_mode_medications, sick_mode_doses.
- **Tests:** `src/components/SickMilkProgress.test.ts`, `src/lib/sick-mode.test.ts`, `src/lib/dashboard-milk-state.test.ts`, `src/app/api/sick-mode/route.test.ts`, `src/app/api/dashboard/route.test.ts`, `e2e/dashboard.spec.ts` (health smoke).
- **Traps:** Half-baseline is a full-day marker, not a clock-prorated alarm; expected weight estimate and pre-sick/manual baseline are separate markers. Keep summary reads bounded to the onset..now period: the SQL starts at SGT midnight of the onset day (to support day totals) and ends at asOfTimestamp, with older “latest” rows fetched only in bounded per-type fallback pages. Do not load all activity history each refresh; that previously doubled sick-mode reads. Bounded reads and calculations must preserve onset filtering for episode-specific values. Saved baseline source days exclude sick days. Avoid replacing sick-day totals with a normal dashboard snapshot while sick-mode data loads.

### Medication prescriptions and doses {#medications}
- **B calls it:** medication, paracetamol, dose history, log medicine, prescription
- **Reach it:** /dashboard with sick mode → “Health check-in” → “Add medication prescription” to configure; “Log Paracetamol” (seed) or “Log medication” opens dosing. “Dose history for Paracetamol” expands history; “Edit medication Paracetamol” edits its prescription. Dose rows in “Recent activity” open the dose editor.
- **Fixture:** sick-episode
- **Code:** `src/components/MedicationPrescriptionModal.tsx`, `src/components/MedicationLogModal.tsx`, `src/components/MedicationDoseEditModal.tsx`, `src/components/SickModePanel.tsx`, `src/lib/medication-entry.ts`, `src/lib/sick-mode-client.ts`, `src/app/api/sick-mode/route.ts`, `src/db/sick-mode-schema.ts`
- **API / tables:** /api/sick-mode addMedication/updateMedication/logDose/updateDose/deleteDose, /api/activities merged diary; sick_mode_episodes, sick_mode_medications, sick_mode_doses, babies, users, childcare_sessions.
- **Tests:** `src/components/MedicationPrescriptionModal.test.ts`, `src/components/MedicationLogModal.test.ts`, `src/components/MedicationDoseEditModal.test.ts`, `src/lib/medication-entry.test.ts`, `src/app/api/sick-mode/route.test.ts`, `e2e/dashboard.spec.ts` (Paracetamol controls/history count).
- **Traps:** “Medication” is in “Add activity” only during active sick mode. Record actual prescribed/given text; the app does not calculate a dose. Times must fall in the episode and not the future. Revision checks and request IDs prevent stale edits/double logging; a conflict may require “Review latest history”. Delete is soft on canonical doses. Childcare dose logging requires override confirmation. New episode state must invalidate an old open medication form.

### Imported historical medication and procedures {#historical-medications}
- **B calls it:** old medicine, imported medication, procedure, edit old dose
- **Reach it:** /dashboard → “Recent activity” → “Select activity date” or “All days” → “Edit <medication name> activity” on a historical medication row → dose editor → “Save changes” or “Delete dose”. There is no standalone add-historical-medication button.
- **Fixture:** fresh-day + add a historical medication/procedure activity using the format in the historical-medication import tests
- **Code:** `src/lib/historical-medication.ts`, `src/lib/historical-medication-import.ts`, `src/components/MedicationDoseEditModal.tsx`, `src/lib/activity-timeline.ts`, `src/app/api/historical-medications/route.ts`, `src/app/(app)/dashboard/page.tsx`
- **API / tables:** /api/historical-medications PUT/DELETE, /api/activities GET, /api/dashboard; activities, babies, users.
- **Tests:** `src/lib/historical-medication.test.ts`, `src/lib/historical-medication-import.test.ts`, `src/components/MedicationDoseEditModal.test.ts`, `src/app/api/historical-medications/route.test.ts`; no dedicated e2e.
- **Traps:** These are activities, not sick_mode_doses; do not send them to canonical dose endpoints. Preserve historical metadata/revision and distinguish a procedure from a dose requiring an amount. A medication-shaped diary row without canonical or historical source metadata is deliberately not editable.

## Growth

### Weight history and percentile chart {#weight}
- **B calls it:** weight, weigh-in, growth, percentile, baby weight chart
- **Reach it:** /dashboard → “Weight <value>, open weight details” (or “Add a weight, open weight details”) → /weight → “Add weight” → “Weight (kg)” and “Date” → “Save weight”. Tap a chart point or “Edit <weight> on <date>” in “Weigh-ins” to edit/delete.
- **Fixture:** fresh-day
- **Code:** `src/app/(app)/weight/page.tsx`, `src/lib/growth/weight-chart.ts`, `src/lib/growth/percentile.ts`, `src/lib/growth/sg2000-weight-for-age-boys.ts`, `src/app/api/measurements/route.ts`, `src/db/schema.ts`
- **API / tables:** /api/measurements GET/POST/PUT/DELETE, /api/babies, /api/dashboard; measurements, babies.
- **Tests:** `src/lib/growth/weight-chart.test.ts`, `src/lib/growth/percentile.test.ts`, `src/app/api/dashboard/route.test.ts`; no weight-page e2e.
- **Traps:** UI uses kg, storage grams; dates parse as SGT. Current chart uses Singapore 2000 boys reference through 24 months, not the old staged WHO plan. Birth date is needed for percentiles. Length/head columns exist in schema/API but the current page is a weight editor, not a general growth form. Weight also drives milk expected-volume estimates.

## Platform/PWA/push

### Appearance and sick care theme {#appearance}
- **B calls it:** dark mode, light mode, phone theme, teal theme, care theme
- **Reach it:** /dashboard → “Baby settings for Robin” → “Household & settings” → “Appearance” → “Light”, “Dark”, or “System”. Starting sick mode adds “Sick mode active” and the care palette.
- **Fixture:** sick-episode
- **Code:** `src/components/ThemePreferenceControl.tsx`, `src/lib/theme-preference.ts`, `src/components/CareModeTheme.tsx`, `src/lib/care-mode.ts`, `src/app/layout.tsx`, `src/app/globals.css`
- **API / tables:** Appearance preference uses device storage; care theme reads /api/sick-mode and sometimes /api/babies; sick_mode_episodes, babies, users for initial layout context.
- **Tests:** `src/components/ThemePreferenceControl.test.ts`, `src/lib/care-mode.test.ts`, `e2e/dashboard.spec.ts` (sick-mode screenshot).
- **Traps:** Appearance is device-local; System follows the OS. Early boot script avoids first-paint theme flash. Care palette is independent of light/dark and is household scoped; offline failure keeps last confirmed state. CareModeTheme has a stale-state fallback check, an exception to the normal dashboard dependent-fetch pattern. Browser theme-color metadata must follow confirmed episode state too.

### Installed app and push notifications {#pwa-push}
- **B calls it:** install app, home screen, notifications, overdue push, offline
- **Reach it:** /dashboard → “Baby settings for Robin” → “Household & settings” → “Enable notifications” (only when service worker and PushManager exist); “Notifications on” toggles it off. Installation uses browser/OS UI; no custom install prompt is implemented on the dashboard.
- **Fixture:** fresh-day + use a push-capable browser and notification permission to inspect the toggle
- **Code:** `public/manifest.json`, `public/sw.js`, `src/app/layout.tsx`, `src/app/(app)/dashboard/page.tsx`, `src/app/api/push-vapid/route.ts`, `src/app/api/push-subscribe/route.ts`, `src/app/api/notify/route.ts`, `vercel.json`, `src/db/schema.ts`
- **API / tables:** /api/push-vapid, /api/push-subscribe POST/DELETE, /api/notify GET/POST; push_subscriptions, notification_log, households, babies, activities.
- **Tests:** none
- **Traps:** VAPID keys, browser permission and device subscription are required for real delivery; the fixture does not create a push subscription. Notify is an externally triggered, protected endpoint with a notification-log throttle; do not invoke it as local UI verification. Current configured cron is daily 09:00 UTC. Service worker is network-first except cached OCR assets; cached dashboard fallback is not offline write/sync support.

### Refresh, polling and release updates {#refresh-updates}
- **B calls it:** refresh dashboard, pull to refresh, stale screen, app update, other phone did not update
- **Reach it:** /dashboard → “Refresh dashboard”; in standalone/fullscreen mode pull down from the top until “Release to refresh”. Failure feedback offers “Retry”. Release checking is automatic on foreground/focus and in the background, without a visible update button.
- **Fixture:** fresh-day
- **Code:** `src/app/(app)/dashboard/page.tsx`, `src/components/AppUpdateWatcher.tsx`, `src/hooks/use-standalone-pull-to-refresh.ts`, `src/hooks/use-sgt-day-rollover.ts`, `src/lib/dashboard-refresh.ts`, `src/lib/app-version.ts`, `src/app/api/dashboard/route.ts`, `src/app/api/version/route.ts`, `src/db/dashboard-version-schema.ts`
- **API / tables:** /api/dashboard, dependent /api/activities, /api/sick-mode and /api/milk-history, /api/version; dashboard_version and DASHBOARD_VERSION_TABLES.
- **Tests:** `src/lib/dashboard-refresh.test.ts`, `src/lib/app-version.test.ts`, `src/lib/sgt-day.test.ts`, `src/app/api/dashboard/route.test.ts`, `e2e/dashboard.spec.ts` (reload persistence).
- **Traps:** Only /api/dashboard is on the normal 30-second data poll; dependent APIs refetch on tag/data change, mutation or explicit refresh, with ten-minute sick-mode/milk-history freshness backstops. X-Dashboard-Tag is used because Vercel strips If-None-Match; unchanged returns 204. Triggers must cover every dashboard-read table (and dependent-state writes); a new clock-dependent response value needs its next change time in validUntil. Missing triggers disable tags and cause expensive full reads. Refresh/release reload is blocked while editors/dialogs are open. AppUpdateWatcher checks releases at most every 30 seconds and on a 15-minute background interval; data refresh alone does not load new app code.

## Data/infra

### Household setup, baby and caregiver settings {#household-settings}
- **B calls it:** invite code, join household, baby name, your name, leave household, baby settings
- **Reach it:** /dashboard → “Baby settings for Robin” → “Household & settings” → “Invite code”, “Your name”, “Baby name”, or “Leave household”. For initial setup, leave the test household then visit / → “Create a household” or “Join with invite code” → “Create household” / “Join household” → “Your name” → “Continue”.
- **Fixture:** fresh-day
- **Code:** `src/app/page.tsx`, `src/components/BabyCareMenu.tsx`, `src/lib/context/household-context.tsx`, `src/lib/db/household.ts`, `src/app/api/household/route.ts`, `src/app/api/babies/route.ts`, `src/app/api/users/route.ts`, `src/db/schema.ts`
- **API / tables:** /api/household GET/POST (create/join/leave), /api/users GET/POST/PUT, /api/babies GET/POST/PUT; households, users, babies.
- **Tests:** `src/components/BabyCareMenu.test.ts`, `e2e/dashboard.spec.ts` (seeded authenticated dashboard only; setup is not covered).
- **Traps:** Household membership and cookies supply context; each fixture needs its own household and user cookies. The dashboard selects the first returned baby. Birth date is collected on creation, while the current settings sheet edits baby name. Do not infer auth behavior from the stale “signed cookie” description; inspect the routes/context before changing membership. UI verification seeds cookies instead of exercising setup.

### Garmin watch logging {#garmin-watch}
- **B calls it:** watch, Garmin, Venu, log from the watch, watch app
- **Reach it:** No web UI. McPhee 1.2.0 on the Venu 3S (`watch/`) offers Sleep/Wake → When (Start sleep / Wake up), Feed → Breast milk / Formula → ml → When, and Diaper → Pee / Poo / Both → When. Choose Now (default), 5, 15 or 30 min ago to save. Saved offers Tap to undo for 10 s; Back closes it. Add McPhee to the watch glance list for cached sleep/childcare state and the last two feeds; tap to open the app. Open the app once to register its 15-minute background refresh.
- **Fixture:** none
- **Code:** `src/app/api/watch/route.ts`, `src/lib/watch-api.ts`, `src/lib/sleep-transition.ts`, `watch/source/McpheeApp.mc`, `watch/source/WatchCache.mc`, `watch/manifest.xml`
- **API / tables:** /api/watch GET (status) and POST (sleep, wake, feed, diaper with optional minutesAgo=0/5/15/30; undo with an opaque string); relays to /api/sleep-state POST and /api/activities POST/DELETE; activities, babies, users, childcare_sessions. Env: MCPHEE_WATCH_TOKEN (32+ chars), MCPHEE_WATCH_HOUSEHOLD_ID, optional MCPHEE_WATCH_USER_ID.
- **Tests:** `src/app/api/watch/route.test.ts`, `src/lib/sleep-transition.test.ts`; compile with the real venu3s profile and minApiLevel 4.2.0. Physical-watch QA is needed for menu/back/undo timing, glance sizing and background connectivity.
- **Traps:** Without the env vars the route answers 404, so prod is inert until configured. Writes go through the existing handlers on purpose; do not copy their SQL here. Childcare check-in blocks watch writes (AT_CHILDCARE) by B's choice; the watch never sends childcareOverride. Diaper buttons map Pee to peeUnits 3/poop no, Poo to poop M/peeUnits no, Both to M/3. Feeds have no leftover; fix those on the phone. Status returns recentFeeds (last two, newest first) for watch 1.1+; keep lastFeed/lastFeedAgoSec for the 1.0.0 build. A failed status read after a write still reports success, so a retry cannot duplicate the entry. The watch re-checks a status older than 15 s before applying its local childcare block, and refreshes a menu older than 60 s when it comes back into view. The watch sends sleep or wake explicitly from the state it shows, so a double tap cannot flip it twice. The baby is the household's first by created_at. minutesAgo accepts only numeric 0/5/15/30; times use server now. Undo strings stay opaque because Monkey C cannot safely round-trip epoch milliseconds. Activity undo accepts only bottlefeed/diaper rows for that baby created within 10 minutes (not started_at), and relays DELETE so milk-ledger reversal and import-reference cleanup stay shared. Sleep undo carries changedAt and issuedAt, expires 30 s after issue, and retains row/later-transition/import checks; legacy phone tokens fall back to changedAt and the phone keeps its 5 s undo display. Glance stores only state, sinceAgoSec, atChildcare, two feed amounts/agoSec and storedAt (epoch seconds) in Application.Storage; displayed ages advance from that timestamp. Background uses the same authenticated GET headers every 15 minutes and keeps the cache on failure. Scheduling and glance redraws are device-managed, not exact timers. No cache shows Open to load. Keep API 4.2.0 and Background permission; annotate only the small shared/service/glance code to stay within those memory limits.

### Schema migrations, admin imports and verification {#data-infra}
- **B calls it:** database setup, missing data, preview stale, paper log import, backfill, verify
- **Reach it:** There is no dashboard button for admin migrations/imports. “Sick mode unavailable” or missing childcare controls can indicate schema readiness. Reproduce against a throwaway file: DB via `scripts/verify.sh`; inspect protected admin routes in code, not by invoking them on a shared deployment.
- **Fixture:** fresh-day
- **Code:** `src/db/index.ts`, `src/db/schema.ts`, `src/db/migrate.ts`, `src/db/migrate-caretaker-import.ts`, `src/db/dashboard-version-schema.ts`, `src/db/childcare-mode-schema.ts`, `src/db/caretaker-import-schema.ts`, `src/db/sick-mode-schema.ts`, `src/app/api/admin/migrate/route.ts`, `src/app/api/admin/caretaker-import/migrate/route.ts`, `src/app/api/admin/import-paper-log/route.ts`, `src/app/api/admin/backfill-diaper-pee-count/route.ts`, `scripts/backfill-diaper-pee-count.mjs`, `scripts/stage-mistral-paper-log.mjs`, `scripts/verify.sh`, `scripts/verify-report.mjs`, `scripts/verify-typecheck.mjs`, `scripts/feature-map-check.mjs`, `CLAUDE.md`
- **API / tables:** /api/admin/migrate, /api/admin/caretaker-import/migrate, /api/admin/import-paper-log, /api/admin/backfill-diaper-pee-count; schema/admin operations touch core tables, paper_log_import_batches/rows, childcare_sessions, sick_mode_* and dashboard_version.
- **Tests:** `src/app/api/admin/caretaker-import/migrate/route.test.ts`, `src/app/api/dashboard/route.test.ts`, `src/lib/feature-map-check.test.ts`, `e2e/dashboard.spec.ts`.
- **Traps:** Local runs must never use .env.local (prod). Preview data stops at its copy date; a missing recent hint may be correct. Table rebuilds drop dashboard_version triggers: reapply the schema afterward. Every dashboard-read table must appear in DASHBOARD_VERSION_TABLES, and clock-dependent values need validUntil. Admin paper-log import is distinct from the reviewed screenshot flow and has its own duplicate matching. Fast verification writes .verify/last.json and step logs; UI verification owns a temporary file: DB, uses --webpack because symlinked node_modules breaks Turbopack, captures .verify/shots/, and stops its server. Run heavy steps separately under the worker memory cap.
