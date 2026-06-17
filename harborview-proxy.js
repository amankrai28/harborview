/*
  harborview-proxy.js — reliable local relay for the Harbor View app.

  Why: aisstream.io can be flaky when a browser connects to it directly
  (an HTTP/2 WebSocket-upgrade quirk). This little server holds the
  aisstream connection itself and relays it to the page over localhost,
  which is rock solid. It also serves harborview.html, so you just visit
  http://localhost:8080 and the page auto-detects the proxy.

  Setup (one time):
    1. Install Node.js (https://nodejs.org) if you don't have it.
    2. In this folder:  npm install
    3. Get a free aisstream key at https://aisstream.io, then either:
         - copy .env.example to .env and put your key in it, or
         - set AISSTREAM_API_KEY in your shell.
    4. Run:   npm start        (or: node --env-file=.env harborview-proxy.js)
    5. Open:  http://localhost:8080

  The API key is read from the AISSTREAM_API_KEY environment variable and is
  never written into anything committed to the repo.
*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const API_KEY = process.env.AISSTREAM_API_KEY;
if (!API_KEY) {
  console.error(
    "Missing AISSTREAM_API_KEY.\n" +
    "Get a free key at https://aisstream.io, then either:\n" +
    "  - copy .env.example to .env and run:  node --env-file=.env harborview-proxy.js\n" +
    "  - or set it inline:  AISSTREAM_API_KEY=your_key node harborview-proxy.js"
  );
  process.exit(1);
}
const BBOX = [[[42.45, -70.86], [42.27, -71.13]]]; // Boston Harbor
const PORT = 8080;
const PAGE = path.join(__dirname, "harborview.html");

const server = http.createServer((req, res) => {
  fs.readFile(PAGE, (err, buf) => {
    if (err) { res.writeHead(404); res.end("Put harborview.html next to this file."); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buf);
  });
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (client) => {
  const up = new WebSocket("wss://stream.aisstream.io/v0/stream");
  up.on("open", () => up.send(JSON.stringify({
    APIKey: API_KEY,
    BoundingBoxes: BBOX,
    FilterMessageTypes: ["PositionReport", "ShipStaticData"]
  })));
  up.on("message", (data) => { if (client.readyState === WebSocket.OPEN) client.send(data.toString()); });
  up.on("close", () => { try { client.close(); } catch (e) {} });
  up.on("error", () => { try { client.close(); } catch (e) {} });
  client.on("close", () => { try { up.close(); } catch (e) {} });
});

server.listen(PORT, () => console.log("Harbor View running at  http://localhost:" + PORT));
