# Dota Coach – notes for Claude

Dota Coach is a local Dota 2 coach (Node server + browser/Electron UI) for Henrik. All user-facing text
(UI, tips, README, release notes) is **Norwegian bokmål**; code and comments are English.

## How updates reach the user

The installed app updates itself from GitHub (`src/updater.js`):

- Channel: `update.json` → repo `henrikeide01/henrikeide01.github.io`, folder `dota-coach/`, branches tried in
  order: `claude/dota-coach`, then `main`. The branch with the highest `version.json` wins.
- The app checks on start-up (auto-installs if no game is running and `autoUpdate` is on) and every 3 hours
  (then it shows a banner with an «Oppdater nå» button).
- It downloads only changed files from the exact commit, verifies each file's git blob hash, backs up what
  it replaces to `backup/`, runs `src/selftest.js` on the new code and rolls back automatically if that fails.
- Users can undo with «Angre siste oppdatering» (Oppsett) or `rollback.bat`; the version they left is then
  stored as `skipVersion` and not auto-installed again.
- If `package.json` dependencies change, `.needs-install` is written and `Dota Coach.bat` runs `npm install`.

**Nothing is shipped until `version.json` gets a higher version.** Pushing code without bumping the version
does nothing for the user.

## Releasing a change

1. Make the change. Keep the server dependency-free (Node built-ins only); Electron is the only package.
2. `npm test` must pass, and `node src/selftest.js` must print `Selvtest OK` (the updater runs it on the
   user's machine and rolls back if it fails).
3. Bump the version with Norwegian release notes (shown in the app):
   `node tools/release.js patch "Fikset …"` (or `minor` / `major` / an explicit `1.4.0`).
4. Commit and push to the `claude/dota-coach` branch (or whatever `update.json` lists first). Users get it
   on their next start, or within 3 hours if the app is already running.

Never edit files the updater treats as user data: `settings.json`, `matches/`, `cache/`, `backup/`,
`overlay-window.json`, `.installed.json`.

## Where things live

- `src/server.js` – HTTP + SSE server, GSI receiver, OpenDota cache, match history, update API.
- `src/coach/` – pure logic: `engine.js` (live state), `rules.js` (live tips), `fight.js` (fight meter),
  `recorder.js` + `analysis.js` (post-game report), `draft.js`, `items.js`, `timers.js`, `map.js`.
- `data/` – game knowledge: `knowledge.js` (patch timings, counters, power curves), `positions.js`,
  generated `heroes.json` / `items.json` (`npm run build-data` from the `dotaconstants` package).
- `public/` – dashboard (`index.html`, `js/dashboard.js`) and overlay (`overlay.html`, `js/overlay-view.js`).
- `overlay/main.cjs` – Electron app (app window + click-through overlay + tray, restarts after updates).
- `overlay/vision.cjs` + `vision-worker.mjs` + `src/vision/` – reads the hero portraits from the screen during the
  draft (`detect.js`: template matching against the hero images, `picks.js`: confirms picks over several scans) and
  posts them to `/api/draft/auto`. Tuning input: «📸 Lagre skjermbilde» writes `debug/draft-*.png` + `.json`, and
  `/api/diagnostics` has the last detection (`vision`). Test detection changes against such screenshots.
- `src/coach/skills.js` – skill order / talent / neutral item stats from OpenDota explorer rows, and the live advice.
- `tools/` – `simulate.js` / `demo.js` (fake match), `make-fixtures.js` (fake OpenDota data for tests),
  `release.js`, `rollback.js`.

## Testing without Dota

- `npm test` – unit + server + updater tests (fake OpenDota data, fake GitHub).
- `DOTACOACH_FIXTURES=<dir> node src/server.js` after `node tools/make-fixtures.js <dir>` runs the app on fake
  OpenDota data; `node tools/simulate.js --speed 30` plays a match against it.
- The user can press «Kopier diagnose» (Oppsett) and paste the JSON into the chat: it has the app version,
  recent errors and the last match reports (scores, tags), which is the best input for tuning thresholds in
  `src/coach/analysis.js` and `src/coach/fight.js`.
