/*
  api/ships.js — Vercel serverless snapshot of Boston Harbor AIS traffic.

  Vercel can't host a persistent WebSocket relay (no long-lived server), so instead of
  streaming we take a short snapshot on demand: open a WebSocket to aisstream, listen for
  a few seconds, keep the newest message of each type per vessel, and return them as JSON.
  The client (harborview.html) polls this endpoint and replays the messages through its
  existing handle(), accumulating state across polls.

  The aisstream key is read from the AISSTREAM_API_KEY environment variable (set it in the
  Vercel project settings) and is never sent to the client.
*/

const WebSocket = require("ws");

const BBOX = [[[42.45, -70.86], [42.27, -71.13]]]; // Boston Harbor (same box as the proxy)
const TYPES = ["PositionReport", "ShipStaticData"];
const LISTEN_MS = 6500; // collection window; keep well under the function's maxDuration

module.exports = async (req, res) => {
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) {
    res.status(500).json({ ok: false, error: "AISSTREAM_API_KEY is not set on the server" });
    return;
  }

  // newest message per (mmsi, MessageType) — bounds the payload to <= 2 messages/vessel
  const latest = new Map();
  let ws;

  try {
    const messages = await new Promise((resolve, reject) => {
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        resolve([...latest.values()]);
      };
      const timer = setTimeout(finish, LISTEN_MS);

      ws.on("open", () => {
        ws.send(JSON.stringify({ APIKey: key, BoundingBoxes: BBOX, FilterMessageTypes: TYPES }));
      });
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const mmsi = msg && msg.MetaData && msg.MetaData.MMSI;
          if (!mmsi || !msg.MessageType) return;
          latest.set(mmsi + "|" + msg.MessageType, msg);
        } catch (e) {}
      });
      ws.on("error", (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        reject(e);
      });
    });

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: true, count: messages.length, messages });
  } catch (e) {
    res.status(502).json({ ok: false, error: "upstream AIS feed unavailable" });
  }
};
