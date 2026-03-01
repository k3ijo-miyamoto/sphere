import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const host = process.env.HOST ?? "127.0.0.1";
const stateApiHost = process.env.SPHERE_STATE_API_HOST ?? "127.0.0.1";
const stateApiPort = process.env.SPHERE_STATE_API_PORT ? Number(process.env.SPHERE_STATE_API_PORT) : 5180;
const allowUnsafeExpose = String(process.env.SPHERE_ALLOW_UNSAFE_EXPOSE ?? "").trim() === "1";

enforceLocalOnlyHost({ host, name: "web", allowUnsafeExpose });
enforceLocalOnlyHost({ host: stateApiHost, name: "state_api_upstream", allowUnsafeExpose });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

const server = http.createServer((req, res) => {
  if ((req.url ?? "").startsWith("/api/state/")) {
    const upstreamPath = req.url.replace("/api/state", "") || "/";
    const headers = {};
    if (req.headers["content-type"]) {
      headers["Content-Type"] = req.headers["content-type"];
    }
    if (req.headers["content-length"]) {
      headers["Content-Length"] = req.headers["content-length"];
    }
    const upstream = http.request(
      {
        host: stateApiHost,
        port: stateApiPort,
        method: req.method,
        path: upstreamPath,
        headers
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, {
          "Content-Type": upstreamRes.headers["content-type"] ?? "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        });
        upstreamRes.pipe(res);
      }
    );
    upstream.on("error", () => {
      res.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify({ ok: false, error: "state_api_unreachable" }));
    });
    req.pipe(upstream);
    return;
  }

  const urlPath = req.url === "/" ? "/web/index.html" : req.url;
  const normalizedPath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const safePath = normalizedPath.replace(/^[/\\]+/, "");
  const target = path.join(root, safePath);

  if (!target.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(target, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    const ext = path.extname(target).toLowerCase();
    const contentType = mimeTypes[ext] ?? "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    fs.createReadStream(target).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`Web viewer: http://${host}:${port}/`);
});

function enforceLocalOnlyHost({ host, name, allowUnsafeExpose }) {
  if (allowUnsafeExpose) {
    return;
  }
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!loopbackHosts.has(String(host).toLowerCase())) {
    console.error(`[safe-default] Refusing non-local ${name} host: ${host}`);
    console.error("[safe-default] Set SPHERE_ALLOW_UNSAFE_EXPOSE=1 only if you intentionally want remote exposure.");
    process.exit(1);
  }
}
