# CLAUDE.md

Guidance for working in this repo.

## What this is

Harbor View is a single-page app that shows live AIS ship traffic in Boston Harbor as if
seen from a fixed window ("Pier 4, floor 12"). It renders vessels three ways: a
calibrated horizon panorama, a top-down radar map, and a per-ship detail panel.

## Files

- `harborview.html` — the entire client app (HTML + CSS + vanilla JS). No build step, no
  framework, no browser dependencies. Self-contained and openable directly.
- `harborview-proxy.js` — optional Node relay for local dev. Holds the aisstream WebSocket,
  relays it to the page over `localhost:8080`, and serves the HTML. CommonJS; only
  dependency is `ws`.
- `api/ships.js` — Vercel serverless function for the deployed site. Listens to aisstream
  ~6.5s and, if a Redis/KV store is connected, merges results into one accumulated document
  so static fields persist across polls; returns vessel records as JSON for the client to
  poll. CommonJS; uses `ws` + `@upstash/redis`.
- `vercel.json` — serves `harborview.html` at `/` and sets the function's `maxDuration`.
- `package.json` — `ws` dependency and `npm start` script.
- `.env.example` — template for the one secret, `AISSTREAM_API_KEY`.

## Running locally

Live data requires the proxy (the client ships without a key):

1. `npm install`
2. Copy `.env.example` to `.env` and add a key from <https://aisstream.io>.
3. `node --env-file=.env harborview-proxy.js` (Node ≥ 20.6), or set `AISSTREAM_API_KEY`
   in the shell and run `npm start`.
4. Open <http://localhost:8080>.

Opening `harborview.html` directly (file://) has no key, so it renders **demo mode** —
eight synthetic vessels that drift around. Good for UI work without a feed.

## Deployment (Vercel)

The repo auto-deploys to Vercel on push to `main`. Vercel can't run `harborview-proxy.js`
(no persistent WebSocket server), so live data on the deployed site comes from the
`api/ships` serverless function, which the client polls (~9s). Set `AISSTREAM_API_KEY` in
the Vercel **project settings** (not in GitHub).

**Enrichment (optional but recommended):** connect a Redis/KV store (Vercel Storage →
Upstash Redis) to the project. `api/ships` then accumulates each vessel in one document
(`harbor:vessels`), so static fields (name, dimensions, IMO, call sign, type, destination)
— which AIS sends only every few minutes — persist across polls and fill in on fresh loads.
It reads `KV_REST_API_URL`/`_TOKEN` or `UPSTASH_REDIS_REST_URL`/`_TOKEN` (whichever Vercel
injects); single-document model keeps it to ~2 commands/poll. Without a store it gracefully
returns snapshot-only data.

The local proxy remains the way to get true streaming during development.

## How it works

- **Data**: aisstream.io WebSocket, filtered to a Boston Harbor bounding box. Two message
  types — `PositionReport` (lat/lon, speed, course, heading, nav status) and
  `ShipStaticData` (name, dimensions, destination, IMO, call sign, type). See `handle()`
  and `upsert()`.
- **Geometry**: `geo(lat,lon)` converts a vessel position into range (km) + bearing (deg)
  from the observer `OBS` (the Pier 4 window). `destPoint()` is the inverse, used to place
  demo ships.
- **Three views**: the panorama places ships horizontally by bearing and vertically by
  range, with type-based silhouettes (`glyphSVG`); the SVG map draws range rings + a
  field-of-view cone; the detail panel shows the selected ship.
- **Calibration**: two sliders set the left/right bearing edges of the real window;
  persisted in `localStorage` under `harborview_fov`.
- **Connection** (`MODE`): the page auto-detects three modes — `proxy` (served from
  `localhost:8080` → WebSocket relay, true streaming, parsed by `handle()`), `poll` (any
  other http/https origin, e.g. Vercel → polls `/api/ships` every ~9s and applies the
  returned vessel records via `applyVessel()`), and `demo` (`file://` → synthetic ships).
  Each falls back to demo on failure.

## Conventions

- Keep it dependency-light: no framework or build for the client; the proxy's only
  dependency is `ws`. The proxy is CommonJS (`require`).
- Match the existing style: 2-space indent, compact vanilla JS.
- Don't reintroduce a hardcoded API key (see Security).

## Maintaining this file

Keep `CLAUDE.md` current. When work in a session changes something documented here — file
layout, how to run, conventions, security posture, tooling, or gotchas — update the
relevant section in that same session so this file always reflects reality.

## Security

- **Never hardcode the aisstream key.** It lives only in the `AISSTREAM_API_KEY`
  environment variable — read by the local proxy and by the `api/ships` serverless function
  (set in Vercel project settings). The client has no secret.
- `.env`, `.env.local`, and `config.local.js` are git-ignored.
- Any API key that previously appeared in these files must be treated as **compromised**
  and rotated at aisstream.io. Use the new key only via `.env` / the env var.

## Gotchas

- Direct browser → aisstream connections are unreliable (HTTP/2 upgrade quirk); the proxy
  exists to work around this.
- AIS can't distinguish cargo subtypes, so silhouettes are by broad category. Many small
  craft don't transmit at all.
- Bearings are only meaningful after calibrating to your window.

## This machine

Node.js (v24) and the GitHub CLI (`gh`, authenticated) are installed, so the proxy can be
run/tested locally and `gh` can manage the repo. Gotcha: a freshly installed tool may not
be on an already-open shell's PATH — open a new shell, or call binaries by full path
(`/c/Program Files/nodejs/`, `/c/Program Files/GitHub CLI/`). The HTML's demo mode works
in any browser.
