# ImmuTrack

Offline infant-immunisation visit tracker for one clinic. Vanilla HTML/CSS/JS, no build step.

| File | Job |
|---|---|
| `schedule.js` | Schedule config (clinic verifies this) + all date, phone and template logic |
| `store.js` | Load/save (localStorage), records, backup/restore validation |
| `app.js` | Screens and behaviour |
| `index.html`, `style.css` | Shell and look |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline + install to home screen |

## Run
```
python3 -m http.server 8000      # then open http://localhost:8000
node tests/schedule.test.js      # due-date & custom schedule logic, 46 checks
```
Service workers need `localhost` or HTTPS, so opening `index.html` as a file works but not offline.

## Deploy (HTTPS)
- **GitHub Pages:** push this folder to a repo, Settings > Pages > deploy from branch.
- **Netlify:** drag the folder onto app.netlify.com/drop.

Whenever you change any file, bump `CACHE` in `sw.js` (`immutrack-v7`...) so phones update.

## Before real use
1. Clinic verifies the visit ages in `schedule.js`, then sets `verified: true` and `verifiedBy`.
2. Design choices (yours, not clinical rules): reminders 2 and 1 days before a visit; recalls 1 and 7 days after a missed one; defaulter = 7+ days overdue; due soon = within 2 days. All in `CONFIG`.
3. Records live in this browser only. Use Settings > Export backup regularly.

## Demo
Settings > Load demo data adds fake children placed relative to today. Add `?today=2026-12-01` to the address to preview another date (a banner shows when active).

## Next (not in the MVP)
Real SMS or voice sending (a small serverless function between the app and the provider), multiple clinics and accounts, DHIS2, antenatal care, analytics. For real use, move `store.js` from localStorage to IndexedDB. See `SYNC_DESIGN.md` for the draft offline-first backend sync and PostgreSQL schema design.
