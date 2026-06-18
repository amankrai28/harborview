# CLAUDE.md

Guidance for working in this repo.

## What this is

Harbor View is a single-page app that shows live AIS ship traffic in Boston Harbor on a
top-down map (MapLibre GL + CARTO dark tiles) oriented to the view out a fixed window
("Pier 4"). Vessels are heading-oriented hull shapes; clicking one opens a detail panel.

## Files

- `harborview.html` — the client app (HTML + CSS + vanilla JS, single file). No build step,
  no framework, but it loads MapLibre GL + CARTO dark tiles from a CDN to draw the map.
  Openable directly: over `file://` it polls the deployed `/api/ships` (CORS) for QC, else demo.
- `harborview-proxy.js` — optional Node relay for local dev. Holds the aisstream WebSocket,
  relays it to the page over `localhost:8080`, and serves the HTML. CommonJS; only
  dependency is `ws`.
- `api/ships.js` — Vercel serverless function for the deployed site. Listens to aisstream
  ~4s and, if a Redis/KV store is connected, merges results into one accumulated document
  so static fields persist across polls; returns vessel records as JSON (with an
  `Access-Control-Allow-Origin: *` header so the page can be QC'd locally). CommonJS; uses
  `ws` + `@upstash/redis`.
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
`api/ships` serverless function, which the client polls (~3s). Set `AISSTREAM_API_KEY` in
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
  `ShipStaticData` (name, dimensions, destination, ETA, draught, IMO, call sign, type). See
  `handle()` and `upsert()`.
- **Geometry**: `geo(lat,lon)` converts a vessel position into range (km) + bearing (deg)
  from the observer `OBS` (the Pier 4 window). `destPoint()` is the inverse, used to place
  demo ships.
- **Map view**: a full-screen MapLibre map (CARTO dark vector tiles), rotated to the Pier 4
  window view (`WINDOW_BEARING`, ~30°). Vessels are MapLibre markers — top-down hull
  silhouettes by type (`shipSVG`), sized by length, rotated by heading; click → detail
  panel. Curated harbor labels are added on map load; `geo()` still computes the
  range/bearing readout shown in the panel.
- **Connection** (`MODE`): `proxy` (served from `localhost:8080` → WebSocket relay, parsed
  by `handle()`) or `poll` (everything else → polls `/api/ships` ~3s, applied via
  `applyVessel()`). `file://` also polls — the deployed `/api/ships` via its CORS header —
  so the page can be QC'd locally. Either mode falls back to demo ships on failure.

## Conventions

- Keep it light: no build step; the client is a single HTML file (its only runtime deps are
  MapLibre GL + CARTO tiles from a CDN). The proxy/function are CommonJS (`require`); the
  proxy's only npm dep is `ws`, the function adds `@upstash/redis`.
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
- The map opens rotated to the Pier 4 window view (`WINDOW_BEARING`); use the compass
  (top-right) to reset north.

## This machine

Node.js (v24) and the GitHub CLI (`gh`, authenticated) are installed, so the proxy can be
run/tested locally and `gh` can manage the repo. Gotcha: a freshly installed tool may not
be on an already-open shell's PATH — open a new shell, or call binaries by full path
(`/c/Program Files/nodejs/`, `/c/Program Files/GitHub CLI/`). The HTML's demo mode works
in any browser.
