# McPhee watch app 1.2.0 (Garmin Venu 3S)

A Connect IQ watch app with three menu items:

- **Sleep / Wake up**: opens When, titled Start sleep or Wake up.
- **Feed**: Breast milk or Formula → scroll the ml (10–300, 10 ml steps; starts at the last feed) → When. Fix leftovers on the phone.
- **Diaper**: Pee (3 units), Poo (M), or Both → When.

Each When menu starts on **Now**, with **5 min ago**, **15 min ago** and **30 min ago** below it. Selecting a time saves; Back returns to the previous choice. After saving, **Saved / Tap to undo** stays for 10 seconds, then returns to the main menu. Tap or Select sends undo and shows **Undoing...**, then **Undone** (green), or **Not undone** with the server reason. Back dismisses the saved screen without undoing. Save failures retain their usual message and close behavior.

It calls `/api/watch` on McPhee through the phone's Garmin Connect app. Logging is blocked while the baby is checked in to childcare.

## Undo and API contract

`POST /api/watch` accepts sleep, wake, feed and diaper with optional numeric `minutesAgo` of 0, 5, 15 or 30 (default 0). All other offsets return 400. The server computes the event time. Successful writes return fresh `status` plus an opaque **string** `undo`; send it back unchanged as `{ "action": "undo", "undo": "..." }`. Never parse its millisecond timestamps into Monkey C Numbers.

- Feed/diaper tokens are `a:<activityId>`. Only bottlefeed/diaper rows for the configured household's first baby, created in the last 10 minutes, are eligible. Backdated event times do not shorten this window. Unavailable, foreign, wrong-type or expired entries return 409 / `UNDO_EXPIRED`. Deletion goes through the shared activities handler, restoring activity-based milk availability and clearing import references.
- Sleep tokens are `s:<kind>:<activityId>:<changedAt>:<issuedAt>`. The shared sleep handler allows 30 seconds from issue, including backdated transitions, and still checks the original row, later transitions and caretaker imports. Stale undo returns 409 / `STALE_UNDO`. Legacy phone tokens without issuedAt use changedAt; the phone's visible undo timing stays unchanged.
- Malformed undo strings return 400; every action, including undo, requires the configured bearer token (401 otherwise). Writes relay through the existing sleep-state / activity handlers. The watch never sends childcareOverride. Status retains lastFeed / lastFeedAgoSec / recentFeeds for older builds.

## Glance and background refresh

Add McPhee to the Venu 3S glance list. It shows sleep or awake duration (or At childcare) and up to two recent feeds, e.g. `60ml 2h10, 90ml 5h05`. Tapping opens the app. Until the first successful status fetch it shows **Open to load**.

Every successful status fetch/save caches only state, sinceAgoSec, atChildcare and the last two feed amounts/agoSec, together with `Time.now().value()` (epoch **seconds**). Glance ages add elapsed seconds since that fetch, even while the app is closed. Raw status dictionaries and epoch milliseconds are not stored.

Opening the full app registers a repeating 15-minute temporal background service. It uses the same authenticated GET and optional preview-bypass headers, updates that compact cache on success, and preserves the previous cache on failure. The phone/Garmin Connect connection is still required; device scheduling and glance redraws may delay updates. The glance cannot discover a new transition without a successful refresh.

Minimum API stays **4.2.0**. Garmin SDK docs list getGlanceView/GlanceView since 3.1, background web requests since 2.3, and background Storage writes on devices supporting 3.2+. Glance storage reads are supported. The app uses Background and Communications permissions and separate `:glance` / `:background` code scopes; foreground menus/client objects are allocated only when the full app opens.

On-device checks still needed: When focus/Back paths, saved screen timeout and tap/select versus Back, undo during slow connectivity, two-line glance fit, ages after closing/reopening, and actual 15-minute background updates (including disconnected-phone recovery). The stub compile checks API/type compatibility, not runtime scheduling or memory use on the watch.

## Server setup (Vercel env vars)

- `MCPHEE_WATCH_TOKEN`: the same 32+ character token the watch is built with.
- `MCPHEE_WATCH_HOUSEHOLD_ID`: the household the watch logs into.
- `MCPHEE_WATCH_USER_ID` (optional): the user shown as "created by".

Without the first two, `/api/watch` answers 404.

## Build

1. Toolchain: a JDK and the Connect IQ SDK in `~/opt/ciq` (`jdk-*/` and `sdk/`).
2. Device files: the Venu 3S profile in `~/.Garmin/ConnectIQ/Devices/venu3s/`. Garmin's SDK Manager downloads it after a Garmin login (on a Mac it lives in `~/Library/Application Support/Garmin/ConnectIQ/Devices/venu3s`; copy that folder).
3. Secrets: `~/.config/mcphee-watch/token` and `~/.config/mcphee-watch/url` (the https base URL; use a preview URL to test). Both stay outside the repo. For a protected Vercel preview, also put the project's Protection Bypass for Automation secret in `~/.config/mcphee-watch/bypass`; leave it out for prod.
4. Run `./build.sh`. It writes `source/Secrets.mc` (git-ignored), creates a developer key on the first run, and outputs `bin/McPhee-venu3s.prg`.

## Install (sideload)

Connect the watch by USB. Copy `bin/McPhee-venu3s.prg` to `GARMIN/APPS/` on the watch, then unplug it. The app shows up as "McPhee" in the apps list. Map it to a long-press hotkey under Settings → System → Hotkeys.

On a Mac, use Android File Transfer or OpenMTP, because the Venu 3S connects over MTP.


## Compile check without secrets

Leave `source/Secrets.mc` as the harmless compile stub. Do not run `build.sh` for a stub check; it reads local credentials and replaces that file. With the installed toolchain/profile and stub signing key:

```sh
cd watch
/home/cluser/opt/ciq/jdk-17.0.21+9/bin/java -Duser.home=/home/cluser -Xmx768m -jar /home/cluser/opt/ciq/sdk/bin/monkeybrains.jar -o /tmp/mcphee-check.prg -f monkey.jungle -y /tmp/ciqstub/k.der -d venu3s -w
```

The dashboard's upload version is **1.2.0** (`APP_VERSION` in source).
