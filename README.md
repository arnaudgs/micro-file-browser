# micro-file-browser

A tiny, zero-dependency file browser running on [Bun](https://bun.sh). Stream a folder over your local network and browse it from any device — list or grid view, image gallery, real HTML5 video player with HTTP range seeking and on-the-fly ffmpeg transcoding for non-native codecs.

No npm dependencies. Single TypeScript file for the server, single HTML file for the UI.

## Features

- 📁 Browse any folder passed as CLI argument (path-sandboxed)
- 🔀 **List** and **Grid** view (toggle persisted in `localStorage`)
- 🖼 Image thumbnails in grid view
- 🎬 Video thumbnails generated via `ffmpeg` (cached in memory by mtime+size)
- 🔎 Fullscreen viewer with prev/next navigation
- ▶️ Native HTML5 video player with **HTTP Range** requests (real seeking)
- 🔄 Live transcoding via `ffmpeg` → fragmented MP4 for codecs the browser cannot play (mkv, avi, wmv, flv…)
- 🌐 Listens on `0.0.0.0` — accessible from any device on the LAN
- ⌨️ Keyboard navigation, browser back/forward, deep-linkable URLs
- 🖼 Fullscreen toggle (button, `F` key, double-click/double-tap on video)

## Requirements

- [Bun](https://bun.sh) (any recent version)
- [`ffmpeg`](https://ffmpeg.org) in your `PATH` (for video thumbnails and transcoding)

## Install & run

```bash
git clone https://github.com/arnaudgs/micro-file-browser.git
cd micro-file-browser

bun server.ts /path/to/folder                       # default port 3000, open
bun server.ts /path/to/folder 8080                  # custom port
bun server.ts /path/to/folder 8080 -p hunter2       # require password (HTTP Basic auth)
MFB_PASSWORD=hunter2 bun server.ts /path/to/folder  # password via env var
```

When a password is set, the browser prompts for HTTP Basic credentials on first visit (any username works). Without `-p` / `MFB_PASSWORD`, the server is open.

The server prints both the local URL and any LAN IPs:

```
📁 micro-file-browser
   root:  /Users/me/Movies
   local: http://localhost:3000
   lan:   http://192.168.1.42:3000
```

Open it in a browser — also works from a phone on the same Wi-Fi.

## Keyboard shortcuts

| Key       | Action                              |
| --------- | ----------------------------------- |
| `←` / `→` | Previous / next image or video      |
| `F`       | Toggle fullscreen                   |
| `Space`   | Play / pause (video)                |
| `Esc`     | Exit fullscreen, or close the viewer |

## Endpoints

| Endpoint                 | Description                                 |
| ------------------------ | ------------------------------------------- |
| `GET /`                  | UI                                          |
| `GET /api/list?path=…`   | JSON listing of a directory                 |
| `GET /api/file?path=…`   | Raw file with HTTP Range support            |
| `GET /api/thumb?path=…`  | 320px JPEG thumbnail (image or video)       |
| `GET /api/transcode?path=…` | Live ffmpeg → fragmented MP4 stream      |

All paths are constrained to the root folder — directory traversal attempts return an error.

## Why?

Sometimes you just want to point a browser at a folder of videos and watch them on your TV/phone without setting up Plex, Jellyfin, or anything heavy. This is ~250 lines of server code and a single HTML file.

## License

[MIT](LICENSE) © 2026 Arnaud Guéras

Contributions welcome — open an issue or a PR.
