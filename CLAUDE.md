# CLAUDE.md

Guidance for working in this repo.

## What this is

Harbor View is a single-page app that shows live AIS ship traffic in Boston Harbor as if
seen from a fixed window ("Pier 4, floor 12"). It renders vessels three ways: a
calibrated horizon panorama, a top-down radar map, and a per-ship detail panel.

## Files

- `harborview.html` — the entire client app (HTML + CSS + vanilla JS). No build step, no
  framework, no browser dependencies. Self-contained and openable directly.
- `harborview-proxy.js` — optional Node relay. Holds the aisstream WebSocket, relays it to
  the page over `localhost:8080`, and serves the HTML. CommonJS; only dependency is `ws`.
- `package.json` — proxy dependency and `npm start` script.
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
- **Connection**: the page auto-detects — served from `localhost:8080` it uses the proxy;
  otherwise it would connect directly (now skipped when there is no key) and falls back to
  demo on failure.

## Conventions

- Keep it dependency-light: no framework or build for the client; the proxy's only
  dependency is `ws`. The proxy is CommonJS (`require`).
- Match the existing style: 2-space indent, compact vanilla JS.
- Don't reintroduce a hardcoded API key (see Security).

## Security

- **Never hardcode the aisstream key.** It lives only in the `AISSTREAM_API_KEY`
  environment variable, read by the proxy. The client has no secret.
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

Node.js and the GitHub CLI (`gh`) are not installed here, so the proxy can't be run or
tested locally without installing Node first. The HTML's demo mode works in any browser.
