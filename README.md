# Ride Stats

Every ride from a DJI Avinox e-bike (M1, M2, M2S) in one dashboard: miles per month, assist modes and what each costs, range on a full battery, battery health, gears, motor torque, temperature, records and a searchable ride list, with a page per ride (map, you vs the motor). English, miles or km. A Dark Matter Solutions app, built with Next.js and Tailwind, stored in Firestore, deployed on Firebase App Hosting. Installable on a phone.

Try it without an account at `/demo` (made-up rides).

## Where the data comes from

The Avinox Ride app keeps a raw recording of every ride on Android at
`Android/data/com.avinox.ride/files/ebike/data/…/cloud_ride_rec_*.proto`. Copy that folder to a computer (USB file transfer, or `adb pull`) and drop it on the Import page. Rides already imported are skipped, so the whole folder can be dropped again each time. Select **Update existing rides** to replace partial imports or recalculate rides after a fix; ride names are kept.

The files are read **in the browser** (`src/lib/parseRide.ts`). Only each ride's summary and a thinned route (about 600 points) are sent to the server. The format isn't documented by DJI: it's a 251-byte header then `0x02EB` frames of protobuf samples, with field numbers from the community's reverse engineering (Avinox Ride Explorer; [lucad87/avinox-setup-app](https://github.com/lucad87/avinox-setup-app), MIT). Assist modes are stored as numbers (1 Eco, 2 Trail, 3 Turbo, 4 Auto, 20+ custom, as far as riders have worked out), and Settings lets a rider rename them. No per-cell battery voltages have been found in the files, so there's no cell balance chart; battery health is estimated instead.

## What's worked out

- **Reading the file**: each frame ends in a CRC-16 of its payload (init `0x3692`, reflected poly `0x8408`, from [sgmess/avinox-stats](https://github.com/sgmess/avinox-stats)). Frames that fail it are skipped and counted, and the reader resyncs on the next good one.
- **Time**: samples are sorted, the last one at a repeated timestamp wins, and each holds until the next if that's within one missed reading (2 s at the bike's 1 Hz). Longer gaps are unknown time, left out of durations, modes, gears and averages, and shown under each ride.
- **Per ride**: average and peak motor power, rider power and cadence (averaged over the time each is above zero), motor torque and power zones, gears while pedalling and gear changes, steepest climb and descent over 100 m, distance per 1% of battery, and rider work in kJ and kcal. Rides imported before these were added need importing again with **Update existing rides**.
- **Story image**: a 1080 × 1920 PNG of a ride for Instagram, drawn in the browser (gradient, your photo, or transparent), with the layout from avinox-stats.

- **Battery used / Wh per mile**: the battery % drop times the pack size the ride was ridden on (Settings, 600 or 800 Wh; a battery change is recorded with its date so earlier rides keep the old size), or the motor's output over the drive efficiency when a ride has no battery reading.
- **Drive efficiency**: motor output over pack energy across rides that used 20%+ of the battery (falls back to 80%).
- **Wh per mile by mode**: motor energy in each mode over the distance ridden in it.
- **Range on a full battery**: usable Wh over each mode's Wh per km, plus a cold-weather figure.
- **Battery health**: motor Wh per 1% of battery on rides using 20%+, a rolling median of 10 rides against the first 10.
- **Cold costs range**: Wh per km by the lowest temperature on the ride, below 10 °C against above 15 °C.

## Planning and comparing

- **Range planner** (dashboard): a distance and climb give the battery % each mode would take. The route is priced with the climbing model below, at your usual mix of modes, then scaled by each mode's Wh per km against your average. Optionally with the cold-weather penalty.
- **Climbing efficiency**: pack Wh is split into a cost per km and a cost per metre climbed by least squares across rides (Wh ≈ a·km + b·climb); needs 8+ rides with different amounts of climbing. Rides are also grouped flat / rolling / hilly / steep by climb per km.
- **Trends**: your power, motor power, heart rate and cadence per ride, with a 10-ride rolling median.
- **Heatmap** (`/heatmap`): every route on one map, faint lines adding up where you ride most; filter by year.
- **Compare** (a ride's Compare button): rides covering mostly the same ~200 m grid squares (45%+ overlap, distance within 25%), and each climb of 40 m+ at 3%+ against every other ride that passed its start and top: time, speed, your power, motor power, assist mix and battery. Works from the stored routes, so older imports are included.
- **Backup** (Settings): one JSON file with settings, every ride's details (names and notes too) and routes; restore skips or replaces rides already there.
- **Import**: uploads that fail on a dropped connection or a busy server are retried twice automatically, then offered for retry; every skipped or unreadable file is listed with the reason.
- **Electricity price** (Settings): for the charging cost on the dashboard and each ride, allowing a tenth for charger losses.

## Privacy

Each rider's data lives under `riders/{uid}` (settings), `riders/{uid}/rides/{id}` (summaries), `riders/{uid}/tracks/{id}` (routes) and `riders/{uid}/shapes/{id}` (a few kB of each route: the squares it passes through and a thinned line, so the heatmap and compare pages needn't load every full route), read and written only by the server for the signed-in rider. Firestore rules deny all browser access. Pages need sign-in except `/demo` and `/login`, and the site asks search engines not to index it.

The site sends no analytics or tracking. Sign out everywhere (Settings) revokes every session the rider has.

## Running locally

```bash
npm install
npx firebase-tools emulators:start --only firestore,auth --project demo-ride   # in another terminal
export NEXT_PUBLIC_FIREBASE_CONFIG='{"apiKey":"demo-key","authDomain":"demo-ride.firebaseapp.com","projectId":"demo-ride"}'
export NEXT_PUBLIC_AUTH_EMULATOR=http://127.0.0.1:9099
GCLOUD_PROJECT=demo-ride FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run dev
npm test            # library tests (node --test)
npm run test:api    # API route tests (Vitest, in-memory Firestore: tests/api)
npm run check       # type check, lint, both test suites and a build, as CI runs on every pull request
```

## Deploying (Firebase App Hosting)

Use its own Firebase project (Blaze plan).

1. Firestore: create the (default) database in production mode, then `npx firebase-tools deploy --only firestore:rules --project <project-id>`.
2. Authentication → Sign-in method: turn on **Google** and **Email/Password**. Under Settings → Authorized domains, add the site's domain and its `*.hosted.app` address.
3. App Hosting: create a backend from this repo, branch `main`, and link it to a Firebase web app so App Hosting passes `FIREBASE_WEBAPP_CONFIG` at build time (`next.config.ts` hands it to the browser).

It needs no secrets.

The map includes a public CARTO basemap key. To use a different key, set
`NEXT_PUBLIC_CARTO_API_KEY` at build time (locally or in App Hosting's `env` configuration).

## Layout

| Path | What |
| --- | --- |
| `src/lib/parseRide.ts` | Reads a `.proto` ride file into samples |
| `src/lib/ride.ts` | One ride's summary (modes, gears, torque bands, energy, temperatures) and thinned track |
| `src/lib/stats.ts` | Everything on the dashboard, from the summaries |
| `src/lib/demo.ts` | Made-up rides for `/demo` and the tests |
| `src/components/Dashboard.tsx`, `RideTable.tsx` | The dashboard |
| `src/components/RideView.tsx`, `RideMap.tsx` | A ride's page (Leaflet map, CARTO dark tiles) |
| `src/components/RideDetails.tsx` | A ride's power, cadence, zones, gears and gradients |
| `src/components/StoryImage.tsx` | The story image for a ride |
| `src/lib/insights.ts` | Climbing model, hill bands, range planner, route and climb matching |
| `src/components/DashboardInsights.tsx` | Planner, climbing efficiency and trends cards |
| `src/components/CompareView.tsx`, `Heatmap.tsx` | The compare and heatmap pages |
| `src/lib/backup.ts`, `src/app/api/backup/` | Backup export and restore |
| `src/components/Importer.tsx` | Drop files or a folder; parses, skips known rides, saves three at a time |
| `src/app/api/` | Session cookie, rides, settings |
| `src/lib/heat.ts`, `src/lib/data.ts` | Route shapes, and reading rides, routes and shapes from Firestore |
| `src/lib/confidence.ts` | Each ride's data confidence rating |
| `tests/api/` | API route tests and the in-memory Firestore they run against |
| `.github/workflows/ci.yml` | Checks run on every pull request and push to `main` |
