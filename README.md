# Harbor View

Live AIS ship traffic over Boston Harbor, framed to the view from a window at Pier 4.
Vessels are drawn three ways — a calibrated horizon **panorama**, a top-down **radar
map**, and a per-ship **detail panel**. Click any ship for its name, flag, destination,
speed, size, and heading.

![status: live / demo](https://img.shields.io/badge/feed-AIS%20via%20aisstream.io-46C2B0)

## Quick start

You only need the proxy for **live** data. To just see the UI, open `harborview.html` in
any browser — with no key it renders demo data (synthetic ships that drift around).

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

## How it works

`harborview.html` is the whole client — HTML + CSS + vanilla JS, no build step, no
framework. It opens a WebSocket to the AIS feed (filtered to a Boston Harbor bounding
box), converts each vessel's lat/lon into a range and bearing from the observer window,
and renders it. The page auto-detects: when served from `localhost:8080` it uses the
proxy; otherwise it falls back to demo mode.

`harborview-proxy.js` is a small Node relay. aisstream.io is unreliable on direct
browser connections (an HTTP/2 WebSocket-upgrade quirk), so the proxy holds the upstream
connection, relays it to the page over localhost, and also serves the HTML. Its only
dependency is `ws`.

### Calibrate to your window

Use the two sliders to set the left/right bearing edges of your real window, then line up
a labelled landmark on screen with the same one outside. After that, every bearing is
locked to reality. Your calibration is saved in the browser.

## Security

The aisstream API key is read from the `AISSTREAM_API_KEY` environment variable (via the
proxy) and is **never** committed. `.env` is git-ignored. Don't hardcode a key in
`harborview.html` or `harborview-proxy.js`.

## Limitations

- AIS reports only broad ship types (a container ship and a bulk carrier both say
  "cargo"), so silhouettes are by category. Many small craft don't transmit at all.
- Bearings are meaningful only after you calibrate the sliders to your window.
- Owner and build year aren't in AIS — use the per-ship MarineTraffic profile link.
