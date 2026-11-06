Run `pnpm verify:fast` for TypeScript, unit tests, dashboard tests, and the optional
feature-map check. Run `pnpm verify:ui` for those checks plus mobile Chromium smoke
tests and a real bottle-feed write through the dashboard.

The runner overrides database credentials before running checks. UI mode migrates
a new `/tmp/mcphee-verify-XXXXXXXX/db.sqlite`, owns Next dev on `127.0.0.1:3217`,
and removes the database and stops the server on exit, including failures. Stop
any existing server on that port first. It never installs browsers: Playwright
1.63.0 is pinned for cached chromium-headless-shell revision 1243.

Each fixture creates a separate household, user, and baby. Dates use today's SGT
calendar boundary, with today's events scaled into the elapsed day so no run
seeds future feeds or naps. Seven previous days provide prediction history.

Evidence is ignored by git:

- `.verify/last.json`: latest run, SGT timestamps, step results and log paths.
- `.verify/logs/`: command output, server log, and origin/main typecheck comparison.
- `.verify/shots/<fixture>.png`: full-page screenshots from the latest UI suite.
- `.verify/playwright/`: machine-readable results and failure screenshots.

TypeScript errors are accepted only when every complete diagnostic also appears
on a local `git archive origin/main` checked with the same installed dependencies
and Next declarations. Missing origin/main or any new diagnostic fails the run.
No fetch or worktree change is performed. E2E specs use `.spec.ts`, outside the
unit-test globs, and remain included in the TypeScript check.

See [FEATURES.md](../FEATURES.md) for which fixture fits each feature.
