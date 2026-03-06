# Workit

A personal workout tracker PWA that syncs to Google Sheets. Single HTML file — no build step, no backend. Installable on Android and iOS.

**Live at [harmant.app/workit](https://harmant.app/workit)**

## Features

- **Flexible scheduling** — Weekly mode (assign workouts to days) or Cadence mode (rotating cycle like Push/Pull/Legs/Rest)
- **Workout builder** — Custom workouts with exercises from a built-in library, set defaults for sets/reps, and define alternative exercises per movement
- **Smart tracking** — Auto-picks today's workout based on your schedule. Override to swap workouts and the schedule adjusts
- **Per-set logging** — Track weight, reps, and RIR (Reps in Reserve) for every set. Mark warmup sets separately
- **Exercise swaps** — Swap exercises mid-workout for predefined alternatives
- **Body metrics** — Log body weight and body fat %, track trends over time
- **Analytics** — Body composition chart, volume trends, per-exercise progress, intensity tracking, and personal records grouped by muscle with Strength Score (e1RM)
- **Google Sheets sync** — All data in a Google Sheet you own. Uses `drive.file` scope — the app can only access the spreadsheet it creates
- **Drag-to-reorder** — Reorder exercises with drag handles or up/down buttons, touch-friendly
- **Schedule confirmation** — Switching between Weekly and Rotating Split prompts for confirmation when data exists
- **Offline resilient** — Service worker caches the app shell, localStorage persists data, auto-reconnects to sync when back online
- **Installable PWA** — Add to home screen on Android (via manifest.json) and iOS (via meta tags)
- **Error boundaries** — Runtime errors show a recovery UI instead of a blank screen
- **JSON backup** — Export/import your data anytime

## Usage

1. Open [harmant.app/workit](https://harmant.app/workit) and sign in with Google
2. Create your workout splits in the **Workouts** tab
3. Set your schedule in the **Schedule** tab — pick weekly or cadence mode
4. Track your workouts from the home screen. Completed workouts show a summary with volume, sets, and best lift

## Tech

Single `index.html` file. React 18 (UMD), vanilla CSS, custom SVG charts. No build tools, no bundler, no framework CLI. Google Identity Services for auth, Sheets API v4 for persistence. SRI hashes on all CDN resources, Content Security Policy via meta tag, service worker for offline caching.

## Testing

The test suite runs in Node.js without a browser — it simulates the React state, localStorage, and Google Sheets API to cover sync flows, reducer logic, edge cases, and data round-trip integrity.

```bash
# Run all tests
bash tests/run-tests.sh

# Run individual suites
node tests/test-sync.js            # 76 tests — login/logout, offline sync, push/pull, auto-reconnect triggers
node tests/test-reducer.js         # 54 tests — workout CRUD, scheduling, tracking sessions, weight logging
node tests/test-edge-cases.js      # 26 tests — boundary conditions, null handling, large history
node tests/test-history-roundtrip.js  # 30 tests — Sheets serialization fidelity, RIR/warmup preservation
```

Requires Node.js 18+. No dependencies to install.

## Local Development

```bash
npx serve -l 4782
```

Add `http://localhost:4782` to your Google OAuth Client ID's authorized JavaScript origins in the [GCP Console](https://console.cloud.google.com/apis/credentials).

## Updating the Installed PWA

If the app doesn't update after a new deploy, the old service worker may still be serving cached files. To force an update:

- **Android:** Settings > Apps > WorkIt > Storage > Clear Cache, then reopen
- **iOS:** Delete the app from home screen, revisit the URL, re-add to home screen
- **Desktop:** Open DevTools > Application > Service Workers > Unregister, then hard refresh

This is a one-time issue from before the service worker used network-first for HTML. Future updates will apply automatically on reload.

## Privacy

Runs entirely in your browser. The only external calls are to Google's OAuth and Sheets APIs. Your data lives in a Google Sheet in your own Drive. The `drive.file` scope ensures the app can never see or modify any other file.

## License

MIT
