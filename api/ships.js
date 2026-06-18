/*
  api/ships.js — Vercel serverless snapshot + KV accumulation of Boston Harbor AIS traffic.

  Each request opens a short WebSocket to aisstream, listens a few seconds, and parses the
  messages into per-vessel records. If a Redis/KV store is configured it merges them into a
  single accumulated document — so static fields (name, dimensions, IMO, call sign, type,
  destination), which AIS broadcasts only every few minutes, stick once seen — and returns
  the whole accumulated set. Without a store it just returns this one snapshot.

  Secrets come from env vars (set in Vercel project settings), never sent to the client:
    AISSTREAM_API_KEY                          — required
    KV_REST_API_URL / KV_REST_API_TOKEN        — optional (Vercel KV)
    UPSTASH_REDIS_REST_URL / ..._TOKEN         — optional (Upstash Redis)
*/

const WebSocket = require("ws");

const BBOX = [[[42.45, -70.86], [42.27, -71.13]]]; // Boston Harbor (same box as the proxy)
const TYPES = ["PositionReport", "ShipStaticData"];
const LISTEN_MS = 4000;              // collection window; shorter = fresher (store accumulates between polls)
const KEY = "harbor:vessels";        // single accumulated document
const STALE_MS = 15 * 60 * 1000;     // drop vessels not heard from in 15 min
const SAFETY_TTL = 86400;            // seconds; clears the doc if the project goes idle

const DYNAMIC_FIELDS = ["lat", "lon", "sog", "course", "heading", "nav"];
const STATIC_FIELDS = ["len", "beam", "dest", "imo", "cs", "type", "draught", "eta"];

// optional KV (Vercel KV or Upstash), via the Upstash REST client
function getKV() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const { Redis } = require("@upstash/redis");
    return new Redis({ url, token });
  } catch (e) {
    return null; // dependency unavailable — fall back to snapshot-only
  }
}

// AIS ETA is a {Month,Day,Hour,Minute} object; 0 / out-of-range means "not set".
function formatEta(e) {
  if (!e || !e.Month || !e.Day) return null;
  const p2 = (n) => String(n).padStart(2, "0");
  const hm = (e.Hour != null && e.Hour < 24 && e.Minute != null && e.Minute < 60) ? " " + p2(e.Hour) + ":" + p2(e.Minute) : "";
  return p2(e.Month) + "-" + p2(e.Day) + hm;
}

function parse(msg) {
  const mmsi = msg && msg.MetaData && msg.MetaData.MMSI;
  if (!mmsi || !msg.MessageType) return null;
  if (msg.MessageType === "PositionReport") {
    const p = msg.Message.PositionReport || {};
    const patch = {
      lat: p.Latitude, lon: p.Longitude,
      sog: typeof p.Sog === "number" ? p.Sog : null,
      course: typeof p.Cog === "number" ? p.Cog : null,
      heading: (p.TrueHeading != null && p.TrueHeading < 360) ? p.TrueHeading : null,
      nav: p.NavigationalStatus
    };
    const nm = (msg.MetaData.ShipName || "").trim();
    if (nm) patch.name = nm;
    return { mmsi, patch };
  }
  if (msg.MessageType === "ShipStaticData") {
    const s = msg.Message.ShipStaticData || {};
    const dim = s.Dimension || {};
    const patch = {
      len: (dim.A != null && dim.B != null) ? dim.A + dim.B : null,
      beam: (dim.C != null && dim.D != null) ? dim.C + dim.D : null,
      dest: (s.Destination || "").trim() || null,
      imo: s.ImoNumber || null,
      cs: (s.CallSign || "").trim() || null,
      type: s.Type != null ? s.Type : null,
      draught: (typeof s.MaximumStaticDraught === "number" && s.MaximumStaticDraught > 0) ? s.MaximumStaticDraught : null,
      eta: formatEta(s.Eta)
    };
    const nm = (s.Name || "").trim();
    if (nm) patch.name = nm;
    return { mmsi, patch };
  }
  return null;
}

// merge a patch into a record: dynamic fields always overwrite; static fields and name only
// when present (never clobber a known value with null). Stamps last-seen time.
function applyPatch(rec, patch) {
  rec = rec || {};
  for (const k of DYNAMIC_FIELDS) if (k in patch) rec[k] = patch[k];
  if (patch.name) rec.name = patch.name;
  for (const k of STATIC_FIELDS) if (k in patch && patch[k] != null) rec[k] = patch[k];
  rec.ts = Date.now();
  return rec;
}

// listen for one window; return Map<mmsi, merged fragment>
function collect(apiKey) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    const heard = new Map();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      resolve(heard);
    };
    const timer = setTimeout(finish, LISTEN_MS);
    ws.on("open", () => ws.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: BBOX, FilterMessageTypes: TYPES })));
    ws.on("message", (data) => {
      try {
        const parsed = parse(JSON.parse(data.toString()));
        if (parsed) heard.set(parsed.mmsi, applyPatch(heard.get(parsed.mmsi), parsed.patch));
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
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // public AIS data; lets the page be QC'd locally
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    res.status(500).json({ ok: false, error: "AISSTREAM_API_KEY is not set on the server" });
    return;
  }

  let heard;
  try {
    heard = await collect(apiKey);
  } catch (e) {
    res.status(502).json({ ok: false, error: "upstream AIS feed unavailable" });
    return;
  }

  const now = Date.now();
  const kv = getKV();
  let store = {};

  if (kv) {
    try {
      const existing = await kv.get(KEY); // @upstash/redis auto-parses JSON objects
      if (existing) store = (typeof existing === "string") ? JSON.parse(existing) : existing;
    } catch (e) { store = {}; }
  }

  // merge this window into the store
  heard.forEach((frag, mmsi) => { store[mmsi] = applyPatch(store[mmsi], frag); });

  // prune stale vessels
  for (const mmsi of Object.keys(store)) {
    if (!store[mmsi] || (now - (store[mmsi].ts || 0)) > STALE_MS) delete store[mmsi];
  }

  if (kv) {
    try { await kv.set(KEY, store, { ex: SAFETY_TTL }); } catch (e) { /* best effort */ }
  }

  const vessels = Object.keys(store).map((mmsi) => {
    const r = store[mmsi];
    return {
      mmsi: +mmsi,
      lat: r.lat, lon: r.lon, sog: r.sog, course: r.course, heading: r.heading, nav: r.nav,
      name: r.name || null, len: r.len || null, beam: r.beam || null, dest: r.dest || null,
      imo: r.imo || null, cs: r.cs || null, type: (r.type != null ? r.type : null),
      draught: r.draught || null, eta: r.eta || null,
      ageMs: now - (r.ts || now)
    };
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, now, count: vessels.length, vessels });
};
