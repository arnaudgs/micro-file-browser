import { stat, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve, relative, sep, basename, dirname } from "node:path";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

function lanIPs(): string[] {
  const out: string[] = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] ?? []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const rootArg = process.argv[2];
if (!rootArg) {
  console.error("Usage: bun server.ts <root-folder> [port]");
  process.exit(1);
}
const ROOT = resolve(rootArg);
const PORT = parseInt(process.argv[3] ?? "3000", 10);

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif", ".heic"]);
const VIDEO_EXTS = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".flv", ".wmv", ".mpg", ".mpeg"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".opus"]);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".svg": "image/svg+xml", ".avif": "image/avif", ".heic": "image/heic",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mkv": "video/x-matroska", ".avi": "video/x-msvideo", ".m4v": "video/mp4",
  ".ts": "video/mp2t", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
  ".flv": "video/x-flv", ".wmv": "video/x-ms-wmv",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".flac": "audio/flac", ".m4a": "audio/mp4", ".aac": "audio/aac", ".opus": "audio/opus",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
};

function kindOf(name: string): "dir" | "image" | "video" | "audio" | "file" {
  const e = extname(name).toLowerCase();
  if (IMAGE_EXTS.has(e)) return "image";
  if (VIDEO_EXTS.has(e)) return "video";
  if (AUDIO_EXTS.has(e)) return "audio";
  return "file";
}

function safePath(rel: string | null): string {
  const r = rel ?? "";
  const abs = resolve(ROOT, "." + sep + r.replace(/^\/+/, ""));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) {
    throw new Error("Path escapes root");
  }
  return abs;
}

function relFromRoot(abs: string): string {
  const r = relative(ROOT, abs);
  return r === "" ? "" : r;
}

async function listDir(absPath: string) {
  const entries = await readdir(absPath, { withFileTypes: true });
  const out: any[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = join(absPath, e.name);
    let size = 0, mtime = 0;
    try {
      const s = await stat(full);
      size = s.size;
      mtime = s.mtimeMs;
    } catch {}
    out.push({
      name: e.name,
      path: relFromRoot(full),
      isDir: e.isDirectory(),
      kind: e.isDirectory() ? "dir" : kindOf(e.name),
      size, mtime,
    });
  }
  out.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
  return out;
}

function mimeFor(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? "application/octet-stream";
}

function rangeResponse(absPath: string, size: number, rangeHeader: string | null, contentType: string): Response {
  if (!rangeHeader) {
    const stream = createReadStream(absPath);
    return new Response(stream as any, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      },
    });
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!m) return new Response("Bad range", { status: 416 });
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : size - 1;
  if (isNaN(start) || isNaN(end) || start > end || end >= size) {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }
  const chunk = end - start + 1;
  const stream = createReadStream(absPath, { start, end });
  return new Response(stream as any, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(chunk),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}

async function ffmpegThumb(absPath: string, isVideo: boolean): Promise<Uint8Array | null> {
  return new Promise((res) => {
    const args = isVideo
      ? ["-ss", "1", "-i", absPath, "-frames:v", "1", "-vf", "scale=320:-2", "-f", "image2", "-vcodec", "mjpeg", "-q:v", "5", "pipe:1"]
      : ["-i", absPath, "-vf", "scale=320:-2", "-frames:v", "1", "-f", "image2", "-vcodec", "mjpeg", "-q:v", "5", "pipe:1"];
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    p.stdout.on("data", (c) => chunks.push(c));
    p.on("close", (code) => {
      if (code === 0 && chunks.length) res(new Uint8Array(Buffer.concat(chunks)));
      else res(null);
    });
    p.on("error", () => res(null));
  });
}

/* ---------- THUMB CACHE (in-memory, binary, FIFO eviction) ---------- */
const THUMB_CACHE_MAX_ENTRIES = 2000;
const THUMB_CACHE_MAX_BYTES = 256 * 1024 * 1024; // 256 MB
const thumbCache = new Map<string, Uint8Array>(); // insertion order = FIFO
let thumbCacheBytes = 0;
// In-flight dedup: if two requests for the same key arrive concurrently,
// only spawn ffmpeg once.
const thumbInFlight = new Map<string, Promise<Uint8Array | null>>();

function thumbCachePut(key: string, buf: Uint8Array) {
  thumbCache.set(key, buf);
  thumbCacheBytes += buf.byteLength;
  while (
    (thumbCache.size > THUMB_CACHE_MAX_ENTRIES || thumbCacheBytes > THUMB_CACHE_MAX_BYTES) &&
    thumbCache.size > 0
  ) {
    const firstKey = thumbCache.keys().next().value as string;
    const v = thumbCache.get(firstKey)!;
    thumbCache.delete(firstKey);
    thumbCacheBytes -= v.byteLength;
  }
}
function thumbCacheStats() {
  return { entries: thumbCache.size, bytes: thumbCacheBytes };
}

const STATIC: Record<string, string> = {
  "/": new URL("./index.html", import.meta.url).pathname,
  "/index.html": new URL("./index.html", import.meta.url).pathname,
  "/style.css": new URL("./style.css", import.meta.url).pathname,
  "/app.js": new URL("./app.js", import.meta.url).pathname,
};

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (STATIC[url.pathname]) {
        const f = STATIC[url.pathname];
        return new Response(Bun.file(f), {
          headers: { "Content-Type": MIME[extname(f).toLowerCase()] ?? "application/octet-stream" },
        });
      }

      if (url.pathname === "/api/root") {
        return Response.json({ root: ROOT });
      }

      if (url.pathname === "/api/list") {
        const p = url.searchParams.get("path");
        const abs = safePath(p);
        const s = await stat(abs);
        if (!s.isDirectory()) return new Response("Not a directory", { status: 400 });
        const items = await listDir(abs);
        return Response.json({
          path: relFromRoot(abs),
          parent: abs === ROOT ? null : relFromRoot(dirname(abs)),
          items,
        });
      }

      if (url.pathname === "/api/file") {
        const p = url.searchParams.get("path");
        const abs = safePath(p);
        const s = await stat(abs);
        if (s.isDirectory()) return new Response("Is dir", { status: 400 });
        const ct = mimeFor(abs);
        return rangeResponse(abs, s.size, req.headers.get("range"), ct);
      }

      if (url.pathname === "/api/thumb") {
        const p = url.searchParams.get("path");
        const abs = safePath(p);
        const s = await stat(abs);
        const kind = kindOf(basename(abs));
        const ext = extname(abs).toLowerCase();

        // SVG: tiny vector, no point generating a raster thumb — serve as-is
        if (ext === ".svg") {
          return rangeResponse(abs, s.size, null, mimeFor(abs));
        }

        if (kind !== "image" && kind !== "video") {
          return new Response("No thumb", { status: 404 });
        }

        const cacheKey = `${abs}:${s.mtimeMs}:${s.size}`;
        const cached = thumbCache.get(cacheKey);
        if (cached) {
          return new Response(cached, {
            headers: {
              "Content-Type": "image/jpeg",
              "Cache-Control": "public, max-age=31536000",
              "X-Thumb-Cache": "HIT",
            },
          });
        }

        // Dedup concurrent requests for the same thumb
        let pending = thumbInFlight.get(cacheKey);
        if (!pending) {
          pending = ffmpegThumb(abs, kind === "video").finally(() => {
            thumbInFlight.delete(cacheKey);
          });
          thumbInFlight.set(cacheKey, pending);
        }
        const buf = await pending;
        if (!buf) return new Response("No thumb", { status: 404 });
        thumbCachePut(cacheKey, buf);
        return new Response(buf, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=31536000",
            "X-Thumb-Cache": "MISS",
          },
        });
      }

      if (url.pathname === "/api/cache-stats") {
        return Response.json(thumbCacheStats());
      }

      // Transcoded video stream (HLS-free, on the fly to fragmented mp4) for codecs the browser can't play natively
      if (url.pathname === "/api/transcode") {
        const p = url.searchParams.get("path");
        const abs = safePath(p);
        // Pipe ffmpeg to fragmented MP4 (h264 + aac). Browser plays as video/mp4 via MSE/native.
        const args = [
          "-i", abs,
          "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
          "-c:a", "aac", "-ac", "2",
          "-movflags", "frag_keyframe+empty_moov+default_base_moof",
          "-f", "mp4", "pipe:1",
        ];
        const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
        const stream = new ReadableStream({
          start(controller) {
            child.stdout.on("data", (c) => controller.enqueue(c));
            child.stdout.on("end", () => { try { controller.close(); } catch {} });
            child.on("error", () => { try { controller.close(); } catch {} });
          },
          cancel() { child.kill("SIGKILL"); },
        });
        return new Response(stream, {
          headers: { "Content-Type": "video/mp4", "Cache-Control": "no-cache" },
        });
      }

      return new Response("Not found", { status: 404 });
    } catch (e: any) {
      return new Response("Error: " + e.message, { status: 500 });
    }
  },
});

console.log(`📁 micro-file-browser`);
console.log(`   root:  ${ROOT}`);
console.log(`   local: http://localhost:${server.port}`);
for (const ip of lanIPs()) {
  console.log(`   lan:   http://${ip}:${server.port}`);
}
