#!/usr/bin/env bash
set -euo pipefail

level="${1:-}"
if [[ "$#" != 1 || ( "$level" != fast && "$level" != ui ) ]]; then
  echo 'Usage: bash scripts/verify.sh <fast|ui>' >&2
  exit 2
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Override inherited remote credentials before starting ANY verification child.
# Next's dotenv loader respects already-set process variables, including the empty token.
export TURSO_DATABASE_URL='file:/tmp/mcphee-verify-uninitialized.sqlite'
export TURSO_AUTH_TOKEN=''
unset MCPHEE_DASHBOARD_FIXTURE_DB
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS='--max-old-space-size=1024'
verify_tmp="$(mktemp -d /tmp/mcphee-verify-XXXXXXXX)"
export TURSO_DATABASE_URL="file:$verify_tmp/db.sqlite"
server_pid=''
active_step=''
active_log=''
active_started=0
mkdir -p .verify/logs .verify/shots
node scripts/verify-report.mjs start "$level"

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  if [[ -n "$server_pid" ]]; then
    # The detached group includes pnpm, Next, and its server worker.
    kill -TERM -- "-$server_pid" 2>/dev/null || true
    for ((i=0; i<30; i++)); do
      if ! kill -0 -- "-$server_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
    kill -KILL -- "-$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "$active_step" ]]; then
    node scripts/verify-report.mjs step "$active_step" fail "$((SECONDS-active_started))" "$active_log"
  fi
  rm -rf -- "$verify_tmp"
  node scripts/verify-report.mjs finish "$code"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

assert_file_db() {
  if [[ "${TURSO_DATABASE_URL:-}" != file:* ]]; then
    echo 'Refusing verification: TURSO_DATABASE_URL must start with file:; remote databases are forbidden.' >&2
    return 3
  fi
}

step() {
  active_step="$1"
  active_log=".verify/logs/$1.log"
  active_started=$SECONDS
  shift
  assert_file_db
  echo "Running $active_step…"
  local code=0
  "$@" >"$active_log" 2>&1 || code=$?
  cat "$active_log"
  local status=pass
  if ((code != 0)); then status=fail; fi
  node scripts/verify-report.mjs step "$active_step" "$status" "$((SECONDS-active_started))" "$active_log"
  active_step=''
  return "$code"
}

assert_file_db
step typecheck node scripts/verify-typecheck.mjs
step test pnpm test
step dashboard pnpm test:dashboard
if [[ -f scripts/feature-map-check.mjs ]]; then
  step feature-map node scripts/feature-map-check.mjs
else
  echo 'Feature map check skipped: scripts/feature-map-check.mjs is absent.' > .verify/logs/feature-map.log
  node scripts/verify-report.mjs step feature-map skip 0 .verify/logs/feature-map.log
fi

if [[ "$level" == ui ]]; then
  # migrate.ts applies every additive schema, then recreates dashboard_version triggers.
  step migrate pnpm db:migrate
  # Fail before launching if the fixed port is already occupied; never test somebody else's server.
  step port node -e 'const s=require("node:net").createServer(); s.once("error",()=>{console.error("Port 3217 is occupied; stop the existing server first.");process.exitCode=1}); s.listen(3217,"127.0.0.1",()=>s.close())'
  start_server() {
    assert_file_db
    setsid pnpm exec next dev --webpack --hostname 127.0.0.1 --port 3217 > .verify/logs/server.log 2>&1 &
    server_pid=$!
    for ((i=0; i<90; i++)); do
      if ! kill -0 "$server_pid" 2>/dev/null; then
        echo 'Next dev exited before readiness. See .verify/logs/server.log.' >&2
        return 1
      fi
      if curl --silent --fail --max-time 2 http://127.0.0.1:3217/api/version > /dev/null; then return 0; fi
      sleep 1
    done
    echo 'Timed out waiting for Next dev; see .verify/logs/server.log.' >&2
    return 1
  }
  step server start_server
  # A new UI run must not leave old fixture screenshots looking like fresh evidence.
  rm -f .verify/shots/{fresh-day,sick-episode,childcare-checked-in,milk-bank,breastfeed-timer}.png
  step playwright pnpm exec playwright test
fi
