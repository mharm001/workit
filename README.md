# Workit

A personal workout tracker that syncs to Google Sheets. Built as a single HTML file — no build step, no backend, just deploy to GitHub Pages.

## Features

- **Flexible scheduling** — Weekly mode (assign workouts to days) or Cadence mode (rotating cycle like Push/Pull/Legs/Rest)
- **Workout builder** — Create custom workouts with exercises from a built-in library, set defaults for sets/reps, and define alternative exercises for each movement
- **Smart tracking** — Auto-picks today's workout based on your schedule. Override to swap workouts and the schedule shuffles accordingly
- **Per-set logging** — Track weight, reps, and effort (1-10 scale) for every set
- **Exercise swaps** — Can't do an exercise? Swap it mid-workout for a predefined alternative
- **Analytics** — Body weight trend, volume over time, per-exercise progress charts, and personal records
- **Google Sheets sync** — All data stored in a single Google Sheet you own. Uses `drive.file` scope so the app can only access the spreadsheet it creates — zero access to anything else in your Drive
- **JSON backup** — Export/import your data as JSON anytime

## Setup

### 1. Google Cloud credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable the **Google Sheets API** and **Google Drive API** under APIs & Services → Library
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add your GitHub Pages URL to **Authorized JavaScript Origins** (e.g. `https://yourusername.github.io`)
7. Copy the Client ID and replace the value in `index.html` at the `GOOGLE_CLIENT_ID` variable

### 2. Deploy

Push `index.html` to a GitHub repo, enable GitHub Pages (Settings → Pages → Deploy from branch → `main` / root), and you're live.

### 3. Use

1. Open the app and sign in with Google
2. Go to **Workouts** tab and create your workout splits
3. Go to **Schedule** tab and assign them to days (weekly) or build a rotation (cadence)
4. Hit **Track Workout** on the home screen each day

## Tech

Single `index.html` file. React 18 (UMD), vanilla CSS, custom SVG charts. No build tools, no bundler, no framework CLI. Google Identity Services for auth, Sheets API v4 for persistence.

## Privacy

The app runs entirely in your browser. The only external calls are to Google's OAuth and Sheets APIs. Your data lives in a Google Sheet in your own Drive. The `drive.file` scope ensures the app can never see or modify any other file.
