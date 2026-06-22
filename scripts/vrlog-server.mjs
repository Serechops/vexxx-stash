/**
 * vrlog-server — wireless telemetry collector for the immersive VR player.
 *
 * The Quest browser page is served over HTTPS (Stash's local-HTTPS listener),
 * so this collector must also be HTTPS or the browser blocks the POST as mixed
 * content. It reuses Stash's own LAN-SAN leaf cert (.local/stash-https.*) so the
 * headset — which already trusts the Stash CA — accepts it with no warnings.
 *
 * Run:   node scripts/vrlog-server.mjs           (port 9444)
 *        VRLOG_PORT=9555 node scripts/vrlog-server.mjs
 *
 * The client logger (ui/.../VR/vrLog.ts) POSTs batched NDJSON entries to /log.
 * Each entry is appended to .local/vrlog.ndjson (truncated on startup) and a
 * concise line is printed to stdout. Tail the file to watch playback live.
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const certDir = path.join(root, ".local");
const outFile = path.join(certDir, "vrlog.ndjson");
const PORT = Number(process.env.VRLOG_PORT || 9444);

let key, cert, ca;
try {
  key = fs.readFileSync(path.join(certDir, "stash-https.key"));
  cert = fs.readFileSync(path.join(certDir, "stash-https.crt"));
  const caPath = path.join(certDir, "stash-https-ca.crt");
  if (fs.existsSync(caPath)) ca = fs.readFileSync(caPath);
} catch (err) {
  console.error(`[vrlog] could not read Stash HTTPS cert in ${certDir}: ${err.message}`);
  console.error("[vrlog] start Stash's Local HTTPS once so the cert is generated.");
  process.exit(1);
}

// Fresh file per run so each debugging session is self-contained.
fs.writeFileSync(outFile, "");

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/** One concise human line per entry for the live stdout view. */
function fmt(e) {
  const ts = String(e.t ?? 0).padStart(7, " ");
  if (e.ev === "sample") {
    const flags = [];
    if (e.stuck) flags.push("STUCK");
    if (e.ddrop > 0) flags.push(`drop+${e.ddrop}`);
    if (typeof e.bufAhead === "number" && e.bufAhead < 1) flags.push(`buf=${e.bufAhead}`);
    return `${ts}ms  ct=${e.ct}s rs=${e.rs} buf=${e.bufAhead}s drop=${e.dropped}/${e.total} ${e.vw}x${e.vh} ${flags.join(" ")}`;
  }
  return `${ts}ms  «${e.ev}» ${JSON.stringify({ ...e, t: undefined, ev: undefined })}`;
}

const server = https.createServer({ key, cert, ca }, (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("vrlog collector ok\n");
    return;
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 5_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        const data = JSON.parse(body);
        const arr = Array.isArray(data) ? data : [data];
        const lines = arr.map((e) => JSON.stringify(e)).join("\n") + "\n";
        fs.appendFile(outFile, lines, () => {});
        for (const e of arr) process.stdout.write(fmt(e) + "\n");
        res.writeHead(200);
        res.end(String(arr.length));
      } catch (err) {
        process.stdout.write(`[vrlog] bad payload: ${err.message}\n`);
        res.writeHead(400);
        res.end("bad");
      }
    });
    return;
  }
  res.writeHead(405);
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[vrlog] HTTPS collector listening on :${PORT}`);
  console.log(`[vrlog] writing -> ${outFile}`);
  console.log(`[vrlog] client activates with ?vrlog=1 (defaults to https://<host>:${PORT}/log)`);
});
