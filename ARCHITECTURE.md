# Chad — app shell

A static, installable web app for personal training and health tracking. **This
repository contains no personal data and never will** — it is public, and is
published with GitHub Pages.

All data lives in a separate **private** repository. The app reads and writes it
through the GitHub Contents API using a fine-grained personal access token that
the user pastes in on first run and which never leaves their browser.

## Why it is built this way

GitHub Pages on a personal account cannot restrict access, so the published site
must be an empty shell. The token is therefore both the credential and the
access-control mechanism: with no token the app renders a setup screen and makes
no network request at all. A crawler that finds the URL gets nothing.

Every write is a git commit, which gives version history, rollback and an audit
trail for free — with no backend to run, pay for, or migrate off when it shuts
down. The same private repo is readable by an assistant through the GitHub
connector, which is how coaching and analysis happen without an API of our own.

## Constraints

- **No build step, no framework, no CDN.** Plain ES modules, plain CSS, hand-rolled
  SVG charts. The app must still run in a decade, and every dependency is a thing
  that can churn or vanish. It also means the whole app works offline.
- **No personal data in this repo.** Enforced by `.github/workflows/no-personal-data.yml`.
- **The data schema is owned by the data repo**, documented in its `README.md`.
  This app conforms to that contract; it does not define it.

## Layout

```
index.html              shell, noindex, PWA meta
manifest.webmanifest    installable app metadata
sw.js                   service worker — app shell only, never caches API responses
robots.txt              deny all
css/app.css             single stylesheet, incl. print styles for the clinical report
js/
  app.js                boot, hash router, token gate, error handling
  config.js             token + repository coordinates (localStorage)
  github.js             Contents API client: UTF-8-safe base64, SHA read-modify-write
  format.js             canonical JSON serialiser — MIRRORS the data repo's validate.mjs
  schema.js             client-side validation, mirrors the data repo's rules
  store.js              registries, year shards, all mutations
  stats.js              aggregation and summary statistics
  chart.js              dependency-free SVG line charts
  ui.js                 toasts, modal, small helpers
  views/                setup, today, log, plan, progress, clinical, settings
```

## Things that will bite if changed carelessly

- **`js/format.js` mirrors `validate.mjs` in the data repo.** If the two disagree,
  every write from the app trips the data repo's CI with a formatting error.
- **Base64 must go through `TextEncoder`.** `btoa()` alone corrupts any non-Latin-1
  character — Finnish notes contain them routinely.
- **Writes must keep the SHA read-modify-write loop.** An assistant may be
  committing to the same file concurrently; on conflict the mutation is re-applied
  to freshly fetched content rather than overwriting it.
- **The service worker must not cache `api.github.com`.** Personal data must not
  sit in a browser cache, and a stale reading shown to a doctor is a real harm.

## Running locally

```sh
python -m http.server 8000     # or any static server
# then open http://localhost:8000
```

A token is required to see anything beyond the setup screen. Service worker
registration is skipped outside HTTPS.
