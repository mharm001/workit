# Workit

A personal workout tracker PWA that syncs to Google Sheets. Single HTML file — no build step, no backend.

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
- **Offline resilient** — Caches data locally, auto-reconnects to sync when back online
- **JSON backup** — Export/import your data anytime

## Usage

1. Open [harmant.app/workit](https://harmant.app/workit) and sign in with Google
2. Create your workout splits in the **Workouts** tab
3. Set your schedule in the **Schedule** tab — pick weekly or cadence mode
4. Track your workouts from the home screen. Completed workouts show a summary with volume, sets, and best lift

## Tech

Single `index.html` file. React 18 (UMD), vanilla CSS, custom SVG charts. No build tools, no bundler, no framework CLI. Google Identity Services for auth, Sheets API v4 for persistence.

## Privacy

Runs entirely in your browser. The only external calls are to Google's OAuth and Sheets APIs. Your data lives in a Google Sheet in your own Drive. The `drive.file` scope ensures the app can never see or modify any other file.

## License

MIT
