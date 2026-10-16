# Caretaker screenshot import — confirmed decisions and provider investigation

Updated: 2026-10-15.
Status: deployed to https://mcphee.vercel.app on 2026-10-15 after the targeted production migration. OCR runs in the browser using self-hosted Tesseract assets, with no OCR-provider API, key, paid fallback or provider charge. Earlier sections preserve the investigation and local verification record; completed rollout evidence appears at the end. Source is saved on the local feature branch; no Git push or merge has been performed.

## Confirmed decisions

- Use the infant-care app layout already supplied. The user confirms each screenshot covers one day. Do not request the same sample again.
- Require the activity date and interpret times in Asia/Singapore; the documented sample does not display a date. Support sequential screenshots from that day, including shared/overlapping rows.
- Milk quantities mean actually consumed. Leftovers, prepared/offered quantities, and waste must not count as consumed.
- Blue activity entries are household-entered updates communicated to infant care. Automatically exclude them from import and from milk-bank deductions; show them in review with the reason “Household entry (blue) — excluded”. This is a source-origin rule independent of duplicate detection. Never re-include them through “Import non-duplicates only”.
- Imported breastmilk must deduct from the breastmilk bank through the same safeguards used for ordinary breastmilk feeds. Never silently allow insufficient stock or change a feed to another milk type; retain the draft for correction or explicit exclusion.
- Missing or ambiguous milk type remains unresolved until explicitly corrected.
- Show conflicting activities for review; never silently overwrite an existing entry or insert a second feed as a correction. Infant-care entries normally arrive only through screenshots, but repeated/corrected screenshots still require conflict detection.
- All household members may upload; third-party care providers have no McPhee access.
- Mandatory review allows corrections/exclusions. Low-confidence included rows need explicit confirmation or correction. Incomplete, invalid, or overlapping naps must be fixed or excluded.
- Wet diapers map to the existing default of three pee units, visibly labelled as a McPhee default. Poo requires explicit source evidence. Preserve solids as free text; do not add a structured solids type for v1.
- External processing is authorized. On 2026-10-14 the user accepted Gemini's documented 55-day provider retention if Gemini is the best option and requires no OCR charges. This changes provider retention only; acceptance of free-tier model-improvement use has been asked separately and remains unanswered. McPhee's own seven-day purge remains unchanged.
- Delete screenshots, thumbnails, raw OCR, and source-bearing drafts seven days after upload; retries do not restart the clock. Preserve committed activities and minimal hash/audit metadata.

## Previously documented sample evidence

Recovered from `/home/cluser/.openclaw/workspace/memory/2026-10-13-1528.md`; this is the earlier screenshot interpretation, not a new visual inspection:

- Milk: 12:00 p.m., 130 ml breastmilk; 9:00 a.m., 130 ml; 4:55 a.m., 120 ml. Direct inspection of the corrected Drive sample subsequently confirmed all three explicitly say Breast Milk (see evaluation below).
- Diapers: 11:25 a.m., “Change Needed, Wet”; 8:25 a.m., “Routine, Wet”.
- Nap: 10:10 a.m.–12:40 p.m.; another start at 12:15 p.m. without an end. Highlight the overlap/incomplete interval; never invent an end or create a live nap from it.
- No completed solids entry. Ignore “Added by” and “Edited by” metadata.

The original standalone caretaker packet was not located in the checked McPhee worktrees. This addendum records the recovered evidence and current clarifications without claiming to replace an unavailable original packet.

## Mychelin investigation

Read-only inspection of source and Vercel environment-variable metadata on 2026-10-14; secret values were not retrieved or copied.

- Mychelin has a planned OCR workflow in `docs/work-packets/scan-recipe-photo-ocr.md`: prefer the existing Gemini provider, with OpenAI vision as a possible fallback. No implemented Scan recipe/OCR route was found in the current source checkout.
- Existing Gemini integration: `app/src/app/api/capture/transcribe-chunk/route.ts` uses `gemini-2.5-flash` for audio; `app/src/lib/ai-image.ts` submits image bytes for photo beautification. This establishes integration patterns, not OCR accuracy or current model availability.
- Mychelin production Vercel metadata lists `GOOGLE_API_KEY` and `OPENAI_API_KEY`; `GOOGLE_API_KEY` is also configured for Preview. DeepSeek and MiniMax are configured for other AI features. A configured key does not prove account entitlement, billing status, model access, or provider retention settings.
- McPhee production Vercel metadata has no Gemini, OpenAI, or Mistral key. No provider configuration was changed.
- Mychelin's 2026-07-30 memory describes Gemini as free-tier while billing is disabled; current billing status was not verified.

## Provider decision and zero-charge requirement — 2026-10-14

User requirement: OCR must be free. Gemini's documented 55-day provider retention is acceptable if Gemini is the best option. This is not a claim that all free-tier data is deleted within 55 days; model-improvement use is a separate policy.

- Gemini 2.5 Flash currently lists free image input and text output. It is a candidate to evaluate, not a proven accuracy winner for the supported screenshot layout.
- Use a dedicated or verified existing Google project with no active billing account, confirmed Free tier, and available quota. Do not use Mychelin's key merely because it exists; its current project billing status was not verified, and no authenticated Google billing-management CLI was found in this session.
- Never enable billing, buy credits, attach payment methods, or switch to a paid provider for this feature. Never automatically fall back to DeepSeek, OpenAI, or a paid Mistral account. If quota is unavailable/exhausted, stop OCR and preserve the existing manual-entry path. Local request limits and retry caps are useful, but cannot guarantee zero charges on a billed project.
- Free Gemini terms permit using inputs/outputs to improve products and human review, and instruct users not to submit sensitive, confidential, or personal information. The user's acceptance of 55-day retention does not alone waive the earlier no-training requirement. A separate data-use question is pending. Even consent does not override the provider's input restrictions: use only appropriately anonymized inputs or evaluate local OCR for real private care records.
- McPhee still deletes its own images, thumbnails, raw OCR, and source-bearing drafts seven days after original upload.

### DeepSeek correction

Current official DeepSeek documentation says `deepseek-flash` supports reading text from screenshots. Image tokens and outputs are billed; it is not a guaranteed free API. Mychelin's existing helper `app/src/lib/deepseek.ts` sends text strings only, so Mychelin has no implemented DeepSeek image/OCR flow. Separate open-source OCR models do not establish a free hosted service or free compute.

### Mistral correction

A deeper historical inspection found a real OCR caller at `/home/cluser/.openclaw/workspace/scripts/mcphee-mistral-ocr.js`, using `/v1/ocr` and `mistral-ocr-latest`, plus 52 saved result files. `/home/cluser/.openclaw/workspace/mcphee-imports/mistral-extraction-summary.md` reports 52 pages and 666 candidate rows. The earlier statement that only a CSV-processing script existed was incomplete: that described the extraction/review script and missed the separate OCR caller.

This historical Mistral usage belongs to McPhee's paper-log workflow, not Mychelin. No Mistral integration or Vercel provider variable was found in Mychelin. The historical Mistral key file exists, but its contents, current account mode, quota, and billing settings were not inspected. Mistral documents a Free mode with included monthly limits and OCR usage limits; actual free OCR entitlement must be verified before treating that old key as a zero-charge alternative. Do not run the historical script as a test: its billing status is unknown and its inputs contain real care records.

Primary references checked on 2026-10-14:

- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/billing
- https://ai.google.dev/gemini-api/terms
- https://ai.google.dev/gemini-api/docs/usage-policies
- https://api-docs.deepseek.com/guides/vision/
- https://api-docs.deepseek.com/quick_start/pricing/
- https://docs.mistral.ai/admin/billing-usage/usage-limits

No provider calls, credential transfers, account changes, or billing changes were made. Next evaluation requires verified free account access and permissible input data; use synthetic screenshot fixtures first. Local/browser OCR remains a possible zero-provider-charge alternative if private source data cannot go to a free external service.

## Required implementation boundaries

Reuse `paper_log_import_batches` and `paper_log_import_rows` and extend the existing UI. Commit must share normal activity validators, check stock/duplicates/conflicts/nap overlaps transactionally, and remain idempotent after a lost response. Compare activity payloads as well as type/time; check rows within an upload and across sequential uploads, then recheck at commit.

Resolve household membership, baby ownership, and batch ownership server-side; derive attribution from the approving member. Protect uploads against cross-site requests and excessive usage. Existing unsigned household/user identifier cookies remain the inherited authentication boundary; this feature must not claim an authentication upgrade.

Specify private storage, a complete seven-day purge mechanism, and an upload-size strategy that accounts for Vercel's function request-body limit before building. Do not reuse public recipe-photo storage for infant-care screenshots.

Validation for this addendum: documentation whitespace check. No application code, credentials, provider settings, activity data, commits, or deployments changed.

## Supplied Drive sample check — 2026-10-14

The user supplied Drive file `1ACw1JCNbL4w1nxG11fZ90x9qOwum8f2-`. It downloaded successfully as a 960 × 2142 PNG, approximately 300 KiB. Visual inspection showed McPhee's dashboard (sick mode, care summaries, milk and bank cards), rather than the infant-care app's daily activity list. A corrected infant-care sample link was requested; no substitute source layout is assumed.

A local-only trial with the already installed RapidOCR ONNX runtime package (1.4.4) detected 67 lines in approximately 7.5 seconds including engine setup on this machine. All three displayed latest-feed times and amounts were readable and matched visual inspection. Other text had errors, including zero/letter confusion, punctuation, and symbols mistaken for text. This is a limited text-recognition check, not evidence that nap/diaper/source-row normalization works or that OCR confidence scores are calibrated. It does not establish iPhone performance.

Recommendation for the strict zero-OCR-charge requirement: evaluate browser/device-local OCR plus a deterministic parser for the known infant-care layout before choosing an external provider. Tesseract.js supports browser OCR; RapidOCR provides an offline alternative already available on this machine. Preserve mandatory row review and validation. Select an engine only after checking the actual target screenshot and mobile runtime performance. Local OCR uses device resources and existing app hosting; it adds no OCR-provider API fee and avoids sending images to a model provider.

Gemini remains a conditional alternative if local accuracy/correction burden is inadequate and the account is verified to have billing disabled. No authenticated Google billing-management access was available, so the existing key's billing status remains unverified. No Gemini, Mistral, or DeepSeek inference requests were made, and no new provider charge was incurred by this test. The supplied private image was removed from temporary storage after inspection; no raw OCR or private screenshot was copied into this repository.

Additional primary references:

- https://github.com/RapidAI/RapidOCR
- https://github.com/naptha/tesseract.js

Documentation validation: whitespace checks passed. No application changes or deployments.

## Correct infant-care screenshot evaluation — 2026-10-14

Drive file `1TPPe5yrss9xJ1ce82clNNp39InI_k0d4` downloaded successfully as a 960 × 2249 PNG, approximately 181 KiB. Direct visual inspection confirmed the expected infant-care layout and the earlier documented sample. It contains three explicit breastmilk feeds (380 ml consumed in total), two wet diapers, one complete nap, and one incomplete nap. The screenshot does not display an activity date. “Solid / Pending Updates” is a placeholder, not a solids activity.

Local checks on the original image:

- RapidOCR ONNX runtime 1.4.4: approximately 5.0 seconds including setup; 27 text lines. A one-off line parser matched all three feed times, amounts and breastmilk labels, both diaper times/notes, and all four nap Start/End markers against visual inspection. It omitted the visual dash placeholder but preserved the untimed Nap End marker.
- Tesseract.js 7.0.0 (isolated temporary install, with an existing local English model): approximately 2.5 seconds including worker setup in Node on this machine. It correctly read all activity times/amounts/milk types/diaper notes, all nap markers, and the blank-end placeholder. The same semantic checks passed. It misread the Milk heading and decorative symbols; do not require exact icon/title OCR. Use stable labels such as “Past Milk Feeds”, “Past diaper changes”, “Past Nap Times” and row patterns, with normalization and a clear unresolved-layout state.
- These are desktop local-runtime trials on one screenshot, not browser/iPhone performance measurements or a representative accuracy benchmark. OCR confidence scores are not calibrated probabilities. No Gemini, Mistral, DeepSeek, or other inference API was used.

Verified review output:

- 12:00 p.m.: 130 ml breastmilk consumed.
- 9:00 a.m.: 130 ml breastmilk consumed.
- 4:55 a.m.: 120 ml breastmilk consumed.
- 11:25 a.m. and 8:25 a.m.: Wet; default three pee units each, labelled as McPhee defaults. No explicit poo evidence.
- Complete nap: 10:10 a.m.–12:40 p.m., 150 minutes.
- Incomplete nap: starts at 12:15 p.m.; its separate Nap End row has no time. Preserve source grouping before sorting chronologically; do not pair this start with the earlier nap's 12:40 p.m. end. Highlight its overlap with the complete nap and require correction or exclusion.
- Ignore Added By/Edited By rows, including the 12:41 p.m. edited-at timestamp. Derive McPhee attribution from the reviewing household member.

Recommendation: browser-local Tesseract.js plus deterministic normalization for this source layout, with the existing mandatory review/staging/transactional commit design. It introduces no OCR-provider fee, key, quota, provider-retention tradeoff, or paid fallback. Cache the OCR worker/model assets for repeat daily use; evaluate first-load size, iPhone memory/latency, cropped screenshots and sequential overlapping screenshots before accepting implementation. OCR should run in a browser worker so the UI remains responsive. Implementation must preserve uncertainty and detect incomplete captures; it must not silently infer missing date/end times or fabricate missing rows.

Keep the previously authorized private source-storage/seven-day purge design for any screenshot uploaded to McPhee; local OCR does not authorize silently removing that decision. External-provider billing and training questions are parked unless an external fallback is proposed later.

The temporary screenshot and raw OCR outputs were deleted after evaluation. No private images or staff names were added to the repository. Documentation whitespace validation passed; no application code, activity data, account settings, commits or deployments changed.

## Blue-entry exclusion — user-confirmed 2026-10-14

The user clarified that blue entries were entered by household members and communicated to infant care through the source app. They must be excluded from import automatically. Do not infer author identity from staff names or equate every non-blue row with a verified caretaker; colour is the confirmed signal for this known layout.

Implementation requirements:

- Preserve source-row bounding boxes and inspect the original image colour before import. Plain OCR text cannot implement this rule because it loses colour information.
- Detect blue on the activity text itself (time/description/amount), not on unrelated icons, dividers, or author metadata. Bind the colour decision to the full source activity group. For a nap, exclude the whole activity when its start/end activity text indicates blue; never import only one endpoint or pair an excluded endpoint with another nap.
- Mark clearly blue groups excluded automatically, with reason “Household entry (blue) — excluded”. Keep a compact excluded summary available in review so the user can see what was omitted. They are not part of normal included rows and contribute no consumed milk, stock deduction, diaper, solids, or nap records.
- “Import non-duplicates only” must respect blue exclusions. Editing time/amount or sorting rows must not silently clear them. Prevent accidental inclusion in the normal commit path.
- If source colour is ambiguous (for example a degraded, grayscale or changed-layout capture), flag it as unresolved and require the user to resolve source origin or exclude it. Do not silently treat colour loss as caretaker origin. The default v1 flow provides no override to import a clearly blue source row; manual entry remains available separately.
- Colour detection must be tested on both blue and non-blue activity text and on anti-aliased edges; do not use a single exact RGB value. Keep a confidence/uncertainty state rather than claiming perfect classification. Use synthetic fixtures for tests rather than committing the private screenshot.
- Preserve existing duplicate, conflict, low-confidence, stock and nap checks for remaining included rows. Colour exclusions are an additional filter, not a replacement for validation.

Updated expected review for the visually inspected sample:

- Exclude the blue 4:55 a.m. breastmilk feed (120 ml).
- Exclude the blue 8:25 a.m. wet diaper.
- Keep the non-blue 9:00 a.m. and 12:00 p.m. breastmilk feeds as candidates: 130 ml each, 260 ml total consumed and deducted from the bank only on successful reviewed commit.
- Keep the non-blue 11:25 a.m. wet diaper as a candidate: default three pee units, visibly labelled; no explicit poo evidence.
- Nap candidates remain unchanged: completed 10:10 a.m.–12:40 p.m. nap and incomplete 12:15 p.m. start. The incomplete/overlapping nap still requires correction or exclusion before commit.

The earlier 380 ml total described all visible source feeds. It is superseded as an import expectation by the 260 ml non-blue candidate total. Earlier OCR checks verified text recognition only; colour classification has not yet been implemented or tested. The source screenshot was already deleted from temporary storage; this rule and its sample mapping rely on the direct visual inspection performed earlier in this conversation.

Documentation-only update; whitespace checks passed. No application code, activities, milk stock, credentials, commits or deployments changed.

## Implemented importer — 2026-10-15

Entry point: Dashboard → Add activity → Import caretaker screenshot. Select the
Singapore activity date, read the image locally, edit or exclude rows, save the
review, confirm the included rows and import. Blue entries have a separate locked
excluded summary. Valid rows show compact summaries with editable details;
unresolved rows open their editor. Wet-to-three-unit defaults remain labelled.

The browser worker and English model are self-hosted under `public/ocr/`. There
is no external OCR API or automatic provider fallback. Screenshots can still be
uploaded to McPhee's private review storage under the previously agreed policy.
The upload limit is 3 MiB per image and the multipart request is stream-bounded
below Vercel's function-body limit. Existing app hosting/database costs remain
separate from the zero OCR-provider fee.

The existing paper-log staging tables receive additive caretaker-specific
columns and indexes. New stage, private-source, review and commit routes verify
member/household/baby/batch ownership and same-origin mutations. Source hashes
prevent restaging the same file under a different date or restarting retention.
Legacy admin routes cannot read or commit caretaker batches. Unsigned identity
cookies remain the existing authentication boundary.

Final commit rechecks reviewed rows, duplicates, conflicts, nap overlaps and the
household milk ledger in one write transaction. Historical breastmilk cannot
create or worsen a shortage in later persisted feeds. Lost-response retries
recover the same committed activity IDs. Saving unchanged parser fallbacks
cannot clear missing-time or unsupported-layout issues. Duplicate comparison
normalizes numeric string/number quantities and duplicated note storage while
preserving meaningful differences in amounts, milk type, diaper contents and
nap duration.

Retention starts at original upload. API access stops at seven days; expired
sources and source-bearing drafts are removed on import requests. The existing
free daily notification cron also purges sources due before its next run,
normally deleting them between day six and day seven. Committed activities and
sanitized hash/origin/confidence/activity-ID audits remain. The application
cannot enforce a physical deletion deadline if scheduled jobs fail; production
database backup retention is an existing infrastructure policy and has not been
changed or verified in this task.

Implementation files: `src/components/CaretakerImportModal.tsx`, the dashboard
entry point, `src/app/api/caretaker-import/`, `src/lib/caretaker-import*`, shared
`src/lib/activity-input.ts`, `src/db/caretaker-import-schema.ts`, the targeted
migration, bundled OCR assets and vendor script. Existing activity, legacy
import, migration, notification and service-worker code integrate these paths.

Rollout requires the existing paper-log tables and the targeted additive
migration: run `pnpm db:migrate:caretaker-import` with the intended deployment's
database environment, then deploy the reviewed code and verify the daily cron.
Do not use the old broad admin migration just to enable this feature; it also
performs unrelated user deduplication. This section records local verification before the rollout recorded below.

Validation uses temporary, isolated SQLite databases and synthetic care records.
The end-to-end browser test runs real local OCR at a 390-pixel mobile viewport,
locks two blue exclusions, resolves the incomplete nap, imports four activities,
simulates a successful commit with a lost response, and verifies retries reuse
the same IDs. It checks that OCR makes no off-origin request. A separate
browser-only check of the user's sample found the two blue exclusions and
260 ml eligible breastmilk; the sample was not staged or committed and its
temporary image was deleted. Browser timings are desktop Chromium measurements;
physical iPhone/Safari performance remains unmeasured.

Final verification:

- `pnpm test`: 176 passed, zero failed, including the pre-existing activity,
  medication, sick-mode and milk-ledger suites plus caretaker import coverage.
- `pnpm exec tsc --noEmit`: passed; the production build also completed its
  TypeScript validation.
- `pnpm build --webpack`: passed. Webpack is used for this checkout because
  `node_modules` is a shared symlink outside the project, which Turbopack rejects.
  No build configuration was changed for that environment limitation.
- The browser smoke test passed against both development and production
  servers using the isolated synthetic database. Production OCR plus staging
  took approximately 4.8 seconds on desktop Chromium; this is not an iPhone
  performance claim. Exactly two feeds, one wet diaper and one completed nap
  were committed. The synthetic milk bank changed from 1,000 ml to 725 ml once.
- Existing lint tooling remains unavailable: `pnpm lint` invokes removed
  `next lint`, and ESLint 9 has no flat config in this checkout. No lint pass is
  claimed and no unrelated lint migration was introduced.
- Tracked diff and new source/document whitespace checks passed. No private
  source image or raw OCR was committed to the repository.

Native Sol workers handled foundational, stock, schema and security work until
their usage limit; the main orchestrator completed remaining safety fixes and
validation. The isolated DeepSeek Flash worker successfully handled only the
bounded compact-review presentation pass. No worker committed, pushed or
deployed changes.


## Completed production rollout — 2026-10-15

- Live URL: https://mcphee.vercel.app. Open Dashboard → Add activity → Import caretaker screenshot.
- Code commit: `dff456b7`, local branch `feat/caretaker-screenshot-import`. No remote Git push/merge was performed. This local packet contains private source-link identifiers and must not be published to the public repository without redaction and history review.
- Production deployment: `dpl_PzHdFiJkkTAexEiSrHrKZpLDejxz`, https://mcphee-bfabezq2z-brianylms-projects.vercel.app. The primary live alias was verified to resolve to this Ready deployment after promotion.
- Previous healthy deployment: `dpl_4btCBAXdvLjbEZGS9isbRokQvUAe`, https://mcphee-3lcjjp5rv-brianylms-projects.vercel.app.
- Vercel's remote default Turbopack build and TypeScript validation passed. The main thread reran the complete suite: 177 tests passed, zero failed.
- Added a POST-only `/api/admin/caretaker-import/migrate` endpoint using the existing migration bearer secret, constant-time comparison and generic errors. This invokes only the additive caretaker schema helper using credentials already held by Vercel. It never returns database credentials or calls the broad admin migration.
- Targeted production migration returned `success: true`, `schemaReady: true`, `purgeCronConfigured: true`; an idempotent repeat returned the same result. Unauthenticated migration, importer and source requests were rejected. No production care records or screenshots were inserted for testing.
- All eight deployed OCR worker/model/core files were downloaded and their SHA-256 hashes matched the tested source files. The live homepage, dashboard and worker returned HTTP 200 without deployment SSO.
- A final browser check ran the actual deployed UI and local OCR at a 390-pixel viewport, using synthetic API fixtures and intercepting all API writes. It detected two blue exclusions and 275 ml eligible synthetic milk with zero browser errors or off-origin OCR requests. No synthetic screenshot reached production storage.
- The existing notification/purge cron remains enabled for 09:00 UTC daily and points to the new deployment. Configuration was verified; no notification run was manually triggered, and the next scheduled purge run has not been observed yet. Backup retention remains outside the application's deletion guarantee.
- Hosting remains on the existing Hobby plan. No paid provider, plan upgrade, billing changes or credential rotation were performed.
- Initial candidate `dpl_3py26FyNCXptuCvwMXZGPTPZjWV7` was blocked because the machine's default commit identity was Brainie. Both authenticated Vercel and GitHub identities were verified as brianylm; the unpublished feature commit was corrected to the existing repository owner identity while retaining Brainie co-authorship, and the next candidate built successfully. No team membership or global Git identity was changed.
- Automatic approval review rejected a broad decrypted production-environment export. The safer protected migration endpoint avoided exporting Turso credentials. Temporary deployment metadata and the existing pulled migration-secret file were removed after rollout verification.


## Care-window sleep authority — user clarification 2026-10-15

The user reports leaving the awake/sleep counter in either state when bringing
the child to infant care. They require imported caregiver sleep to override
McPhee: only the screenshot's reviewed nap periods count as sleeping, and the
gaps count as awake. The user chose entering care start/end during review.

Implementation acceptance criteria:

- Require an explicit care range on the selected Singapore date and explicit
  confirmation that the complete nap history for that range has been checked.
  Do not invent drop-off/pick-up times from the first/last event. Reject invalid
  or future ranges and included naps outside the chosen period.
- Treat only reviewed, complete, non-blue naps as sleep inside that range.
  Included incomplete, low-confidence or conflicting source groups still need
  correction, confirmation or explicit exclusion. Blue records remain excluded.
  Missing nap sections and zero-nap captures require a clear warning.
- Replace overlapping McPhee sleep inside the range in the same transaction as
  activity insertion and milk-bank validation. Trim/split completed records to
  preserve outside portions. A stale open sleep that began before/inside care
  closes at care start or is removed when it has no outside prefix; never resume
  its open tail after care end. Preserve later home sleep that starts at/after
  care end.
- Retain an exact existing nap once rather than insert it twice. Other staged
  screenshots must not veto the reviewed care schedule. Repeated/overlapping
  source nap groups within one capture still need explicit resolution.
- Show a saved replacement preview. A relevant sleep change after review must
  invalidate it and require review again, with no partial writes. Changing the
  care range invalidates saved review and frozen commit identity. Lost-response
  retries must not repeat replacement or milk deductions.
- Support no-nap and zero-new-activity reconciliation, without inserting fake
  zero-duration sleep records. Reuse existing batch draft/audit metadata; no
  schema migration is intended. Preserve sanitized reconciliation audit metadata
  while maintaining source/draft deletion policy.
- Current state and daily totals must use the reconciled history. Awake since
  means the last actual nap end (e.g. 12:40), not care end (e.g. 17:00). Preserve
  an already-known earlier awake start on no-nap days; use confirmed coverage
  only as a fallback when no closed sleep history exists. Count the first
  imported daytime nap even if no morning home wake was recorded.

Implementation and local verification are complete. The full suite passed
193 tests; the seven reconciliation API integration tests also passed after
the final old-response compatibility assertion. TypeScript and the webpack
production build passed. A real browser-local OCR test at 390px verified the
care window, source exclusions, saved replacement preview, revision invalidation,
forgotten-timer closure, wrong-nap removal, awake-since-last-nap behavior, daily
sleep total and lost-response retry without another milk deduction.

No schema migration is required. Existing batch draft/audit metadata stores the
reviewed coverage, relevant-sleep fingerprint and sanitized applied summary.
Unchanged exact naps are retained once; explicit reviewed notes on retained
naps are applied while existing details/attribution are preserved. Legacy
staged nap locks can enter the new review, and old committed responses remain
replayable without reapplying reconciliation. Dashboard reads also tolerate an
old or partially migrated caretaker schema. No production care records have
been changed during validation. Deployment verification is recorded below.


## Care-window sleep authority — production verification 2026-10-15

- Live at https://mcphee.vercel.app, final code revision `51813cdb`
  (main implementation `4ac93243`), deployment
  `dpl_J8JQgMa72N5YMte32ngtweDSFns5`, candidate URL
  https://mcphee-iegcr2rto-brianylms-projects.vercel.app.
  Primary alias was verified to serve this READY deployment after promotion.
- Final full suite: 193/193 passing. TypeScript passed locally, and the final
  remote production build passed compilation and TypeScript. The final audit
  normalization regression verifies that extra client properties cannot survive
  into retained coverage metadata. Existing lint script remains incompatible
  with the repository's Next/ESLint versions; no lint pass is claimed.
- Candidate homepage returned 200, deployed OCR worker matched the source hash,
  private import/source reads returned 401 without membership, and a nonexistent
  household dashboard probe returned 200 with no babies. Promotion followed
  verification that the primary alias had no intervening deployment.
- Final live browser check used real deployed UI/OCR and intercepted synthetic
  API responses: care range and saved replacement preview worked, two blue rows
  stayed excluded, eligible synthetic milk was 275 ml, and the dialog fit 320,
  375 and 390 pixel widths. No page errors, external OCR requests or live API
  writes occurred. Real local API/transaction browser validation additionally
  verified stale timer closure, wrong-nap replacement, awake since 12:40,
  corrected daily totals, bank deduction and lost-response idempotency.
- No new migration, real production care imports, paid OCR provider, plan
  upgrade or billing change was performed. OCR remains browser-local Tesseract.
  The new rule is applied when a new care log is explicitly reviewed and applied;
  previously committed imports are not silently rewritten.
- Native Sol workers reached their usage limit after implementing/reviewing the
  main changes. The main thread completed integration safeguards and final
  validation; no DeepSeek implementation or paid model upgrade was used.
- All commits remain local. No Git push was made: this work packet contains
  private source references and must not be published to the public repository
  without redacting the relevant history. Deployment excludes documentation.


## Childcare activity-log labels — 2026-10-15

User requested DeepSeek implementation, visible care start/end in the activity
log, and screenshot-created activities authored as exactly `childcare`.

- Code revision `670614a8` adds a GET-only display projection in
  `src/lib/caretaker-activity-log.ts`, integrates it with activities GET, and
  renders virtual care boundaries as static ActivityTimelineCard rows.
- Reads only household/baby-scoped committed caretaker screenshot audits.
  Existing imported activity IDs from v1/v2 audits display `childcare`; stored
  uploader attribution remains unchanged. Reviewed v2 care coverage produces
  `Care started` and `Care ended` at its actual SGT times. Legacy imports without
  saved coverage do not receive invented care times.
- Markers behave as notes for the existing type filter, respect date and combined
  global limits, deduplicate identical care windows and survive source deletion.
  They have no edit/delete buttons and guarded handlers. The CSV exporter and
  dashboard totals retain their established semantics.
- DeepSeek Flash produced the implementation patch from supplied source. Its
  first read-only shell investigation hit the host bubblewrap error, so the
  working patch was generated without tools and mechanically applied by the
  orchestrator. One focused DeepSeek correction fixed an incorrect guessed table
  and tightened the audit parser. Native Sol reviewed architectural/data-access
  boundaries and supplied the independent synthetic API integration tests.
- Main-thread validation: full suite 196/196 passing; card tests 3/3 and focused
  new API tests 2/2; production webpack build and remote Turbopack/TypeScript
  build passed. A real Chromium browser at 320/390px verified both care markers,
  `Entered by childcare`, no marker actions, ordinary activity actions and no
  horizontal overflow. All browser APIs were intercepted with synthetic fixtures;
  no production care data was written or changed. No schema migration is needed.

- Promoted final deployment `dpl_BuZfX4Yc9hEwU4Fcu8Xo2F7nrJZc`
  (https://mcphee-qudqzeq5e-brianylms-projects.vercel.app) to
  https://mcphee.vercel.app after candidate homepage/activities/dashboard health
  probes and private-route authorization probes passed. Primary alias verified
  against final READY deployment. Final live Chromium check also passed with
  intercepted synthetic APIs, zero browser errors and zero live API writes.
- No Git push, new provider, credential export, billing change or migration.
  Work packet remains local because it contains private source references.


## Rolling same-time median — clarified rule 2026-10-16

Normal mode, including after ending sick mode, now uses the latest seven
completed non-sick days with milk logs. Selection looks further back through
available history to replace sick/no-log days, excludes today/future/invalid
dates, deduplicates calendar dates, and returns chronological days. As healthy
logged days accrue, they replace older reference days. If fewer than seven are
available in the existing 180-day history, use the available count; if none,
show unavailable. Each eligible day's intake is compared at current Singapore
time. Active sick-mode saved reference and baseline calculation are unchanged.

- Code revision `fd75beb2`: normal selection in
  `src/lib/dashboard-milk-state.ts`, meaningful regression cases in its test
  file, and normal-mode tooltip/comment in the dashboard page.
- DeepSeek Flash produced the three-file implementation as a tool-free patch
  from supplied source because the worker shell sandbox remains unavailable.
  Main applied/reviewed it and made a small copy clarification. Native Sol
  independently reviewed the final diff and found no material blocker.
- Focused milk-state tests: 19/19 passed. Full suite: 200/200 passed. Local
  webpack production build, including TypeScript, passed. A real browser at
  320/390px with intercepted synthetic APIs showed a post-sick median of 70 ml
  from seven eligible days across the sick-day gap; the old seven-calendar-day
  approach would have produced 120 ml, and a fixed archived reference 40 ml.
  No browser errors, horizontal overflow, or live API writes occurred.
- No API/schema/migration change, no activity rewrite, no Git push or provider
  configuration change. Existing 180-day history limits remain in force.

- Final production deployment `dpl_2LnsWco8rH1aV5zuUiapxB4t19fM`
  (https://mcphee-awqb5743p-brianylms-projects.vercel.app) passed remote build
  and TypeScript. Candidate homepage returned 200; milk-history scope probe
  rejected a nonexistent baby with 404; unauthenticated history was empty.
  Promoted to https://mcphee.vercel.app after checking for no intervening
  deployment, and verified primary alias points to final READY deployment.
- Final live browser also passed the same post-sick 70 ml median and 320/390px
  checks using intercepted synthetic APIs, with zero page errors or live writes.
  Work packet remains local; no private-source Git history was pushed.
