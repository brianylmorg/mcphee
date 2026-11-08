# McPhee watch app (Garmin Venu 3S)

A Connect IQ watch app with three menu items:

- **Sleep / Wake up**: asks to confirm, then starts or ends sleep now.
- **Feed**: Breast milk or Formula, then scroll the ml (10–300, 10 ml steps; starts at the last feed). Fix leftovers on the phone.
- **Diaper**: Pee (3 units), Poo (M), or Both.

It calls `/api/watch` on McPhee through the phone's Garmin Connect app. Logging is blocked while the baby is checked in to childcare.

## Server setup (Vercel env vars)

- `MCPHEE_WATCH_TOKEN`: the same 32+ character token the watch is built with.
- `MCPHEE_WATCH_HOUSEHOLD_ID`: the household the watch logs into.
- `MCPHEE_WATCH_USER_ID` (optional): the user shown as "created by".

Without the first two, `/api/watch` answers 404.

## Build

1. Toolchain: a JDK and the Connect IQ SDK in `~/opt/ciq` (`jdk-*/` and `sdk/`).
2. Device files: the Venu 3S profile in `~/.Garmin/ConnectIQ/Devices/venu3s/`. Garmin's SDK Manager downloads it after a Garmin login (on a Mac it lives in `~/Library/Application Support/Garmin/ConnectIQ/Devices/venu3s`; copy that folder).
3. Secrets: `~/.config/mcphee-watch/token` and `~/.config/mcphee-watch/url` (the https base URL; use a preview URL to test). Both stay outside the repo.
4. Run `./build.sh`. It writes `source/Secrets.mc` (git-ignored), creates a developer key on the first run, and outputs `bin/McPhee-venu3s.prg`.

## Install (sideload)

Connect the watch by USB. Copy `bin/McPhee-venu3s.prg` to `GARMIN/APPS/` on the watch, then unplug it. The app shows up as "McPhee" in the apps list. Map it to a long-press hotkey under Settings → System → Hotkeys.

On a Mac, use Android File Transfer or OpenMTP, because the Venu 3S connects over MTP.
