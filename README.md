# Harbor View

Live AIS ship traffic over Boston Harbor on a **top-down map**, oriented to the view out a
window at Pier 4. Vessels are drawn as heading-pointed, type-shaped hulls; click any ship
for its name, flag, destination, speed, size, and heading.

![status: live / demo](https://img.shields.io/badge/feed-AIS%20via%20aisstream.io-46C2B0)

## Quick start

You only need the proxy for local **streaming**. To just see the UI, open `harborview.html`
in any browser — it pulls live data from the deployed `/api/ships` (or shows demo ships if
it can't reach it).

1. Install [Node.js](https://nodejs.org) (≥ 20.6 recommended for `--env-file`).
2. `npm install`
3. Get a free key at <https://aisstream.io>.
4. Copy `.env.example` to `.env` and put your key in it.
5. `node --env-file=.env harborview-proxy.js`
6. Open <http://localhost:8080>.

If your Node is older than 20.6, set the variable yourself and use the start script:

```bash
AISSTREAM_API_KEY=your_key npm start      # macOS / Linux
$env:AISSTREAM_API_KEY="your_key"; npm start   # PowerShell
```

## Deploy on Vercel

The repo auto-deploys on every push to `main`.

1. In Vercel: **Add New → Project → Import** this repo, framework preset **Other**.
2. **Settings → Environment Variables**: add `AISSTREAM_API_KEY` (your key from aisstream.io).
3. *(Recommended)* **Storage → Create Database → Upstash Redis**, connected to the project.
   This lets `/api/ships` remember vessel details across polls, so names, sizes, IMO, call
   signs and destinations fill in instead of staying blank. Vercel injects the store's env
   vars automatically — no code change needed.
4. Deploy.

Vercel can't run the WebSocket proxy (no persistent server), so the deployed site gets live
data from the `api/ships` serverless function, which the page polls every ~9s. With the KV
store connected it accumulates static data over time; without it you still get live
positions, just sparser detail. The key stays server-side in Vercel — never sent to the browser.

## How it works

`harborview.html` is the whole client — a single HTML file (it loads MapLibre GL + CARTO
dark tiles from a CDN for the map). It plots each vessel at its lat/lon as a top-down,
heading-oriented hull on a harbor map rotated to the Pier 4 window view, and opens a detail
panel on click. It gets data from the local proxy (`localhost:8080`, true streaming) or by
polling `/api/ships` (deployed, ~3s); it falls back to demo ships if neither responds.

`harborview-proxy.js` is a small Node relay for local dev. aisstream.io is unreliable on
direct browser connections (an HTTP/2 WebSocket-upgrade quirk), so the proxy holds the
upstream connection, relays it to the page over localhost, and also serves the HTML. Its
only dependency is `ws`.

### Orientation

The map opens rotated to match the view out the Pier 4 window. Use the compass (top-right)
to spin it or reset to north.

## Security

The aisstream API key is read from the `AISSTREAM_API_KEY` environment variable — by the
local proxy and by the `api/ships` serverless function (set in Vercel project settings) —
and is **never** committed or sent to the browser. `.env` is git-ignored. Don't hardcode a
key in the client, proxy, or function.

## Limitations

- AIS reports only broad ship types (a container ship and a bulk carrier both say
  "cargo"), so silhouettes are by category. Many small craft don't transmit at all.
- Owner and build year aren't in AIS — use the per-ship MarineTraffic profile link.
