const main = document.getElementById("main");
const crumbs = document.getElementById("crumbs");
const bList = document.getElementById("bList");
const bGrid = document.getElementById("bGrid");

let mode = localStorage.getItem("fb.mode") || "grid";
let current = { path: "", items: [] };
let mediaList = []; // filtered list of viewable media in current dir
let viewIndex = 0;

function setMode(m) {
  mode = m;
  localStorage.setItem("fb.mode", m);
  bList.classList.toggle("on", m === "list");
  bGrid.classList.toggle("on", m === "grid");
  render();
}
bList.onclick = () => setMode("list");
bGrid.onclick = () => setMode("grid");

function fmtSize(n) {
  if (!n) return "";
  const u = ["B","KB","MB","GB","TB"];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return n.toFixed(n < 10 && i ? 1 : 0) + " " + u[i];
}
function fmtDate(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}
function iconFor(it) {
  if (it.isDir) return "📁";
  if (it.kind === "image") return "🖼";
  if (it.kind === "video") return "🎬";
  if (it.kind === "audio") return "🎵";
  return "📄";
}
function encPath(p) { return encodeURIComponent(p); }

async function load(path) {
  const r = await fetch("/api/list?path=" + encPath(path || ""));
  if (!r.ok) { main.innerHTML = '<div class="empty">'+await r.text()+'</div>'; return false; }
  current = await r.json();
  mediaList = current.items.filter(i => i.kind === "image" || i.kind === "video");
  renderCrumbs();
  render();
  return true;
}

/* ---------- HISTORY ---------- */
// State shape: { path: string, viewer: number | null }
function urlFor(path, viewer) {
  let h = "#" + encPath(path || "");
  if (viewer !== null && viewer !== undefined) h += "?v=" + viewer;
  return h;
}
function parseLocation() {
  const raw = location.hash.replace(/^#/, "");
  const [pathPart, query] = raw.split("?");
  const path = decodeURIComponent(pathPart || "");
  let viewer = null;
  if (query) {
    const m = /(?:^|&)v=(\d+)/.exec(query);
    if (m) viewer = parseInt(m[1], 10);
  }
  return { path, viewer };
}
async function navigateTo(path) {
  const ok = await load(path);
  if (!ok) return;
  history.pushState({ path: current.path, viewer: null }, "", urlFor(current.path, null));
}
window.addEventListener("popstate", async (e) => {
  const st = e.state || parseLocation();
  if (st.path !== current.path) {
    const ok = await load(st.path);
    if (!ok) return;
  }
  if (st.viewer !== null && st.viewer !== undefined) {
    if (st.viewer < mediaList.length) showViewer(st.viewer);
    else hideViewer();
  } else {
    hideViewer();
  }
});

function renderCrumbs() {
  const segs = current.path ? current.path.split("/") : [];
  const parts = [{ name: "root", path: "" }];
  let acc = "";
  for (const s of segs) {
    acc = acc ? acc + "/" + s : s;
    parts.push({ name: s, path: acc });
  }
  crumbs.innerHTML = "";
  parts.forEach((p, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "sep"; sep.textContent = "/";
      crumbs.appendChild(sep);
    }
    const a = document.createElement("span");
    a.className = "seg"; a.textContent = p.name;
    a.onclick = () => navigateTo(p.path);
    crumbs.appendChild(a);
  });
}

function render() {
  if (!current.items.length) {
    main.innerHTML = '<div class="empty">Empty folder</div>';
    return;
  }
  if (mode === "list") renderList();
  else renderGrid();
}

function renderList() {
  const el = document.createElement("div");
  el.className = "list";
  current.items.forEach(it => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <span class="icon">${iconFor(it)}</span>
      <span class="name">${escapeHtml(it.name)}</span>
      <span class="size">${it.isDir ? "" : fmtSize(it.size)}</span>
      <span class="date">${fmtDate(it.mtime)}</span>`;
    row.onclick = () => activate(it);
    el.appendChild(row);
  });
  main.innerHTML = "";
  main.appendChild(el);
}

function renderGrid() {
  const el = document.createElement("div");
  el.className = "grid";
  current.items.forEach(it => {
    const tile = document.createElement("div");
    tile.className = "tile";
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (it.kind === "image" || it.kind === "video") {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.src = "/api/thumb?path=" + encPath(it.path);
      img.onerror = () => { thumb.innerHTML = iconFor(it); };
      thumb.appendChild(img);
      if (it.kind === "video") {
        const b = document.createElement("span");
        b.className = "badge"; b.textContent = "VIDEO";
        thumb.appendChild(b);
      }
    } else {
      thumb.textContent = iconFor(it);
    }
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = it.name;
    tile.appendChild(thumb);
    tile.appendChild(label);
    tile.onclick = () => activate(it);
    el.appendChild(tile);
  });
  main.innerHTML = "";
  main.appendChild(el);
}

function activate(it) {
  if (it.isDir) { navigateTo(it.path); return; }
  if (it.kind === "image" || it.kind === "video") {
    const idx = mediaList.findIndex(m => m.path === it.path);
    if (idx >= 0) openViewer(idx);
  } else {
    // download / open file directly
    window.open("/api/file?path=" + encPath(it.path), "_blank");
  }
}

/* ---------- VIEWER ---------- */
let viewerEl = null;
let viewerOpen = false;

// User-initiated: push a history entry so Back closes the viewer
function openViewer(idx) {
  showViewer(idx);
  history.pushState({ path: current.path, viewer: idx }, "", urlFor(current.path, idx));
}
function closeViewer() {
  // If the viewer is in history, go back (popstate will hide it).
  if (history.state && history.state.viewer !== null && history.state.viewer !== undefined) {
    history.back();
  } else {
    hideViewer();
  }
}

// State-only (no history): used by popstate + openViewer
function showViewer(idx) {
  viewIndex = idx;
  if (!viewerEl) buildViewer();
  viewerEl.style.display = "flex";
  viewerOpen = true;
  document.body.style.overflow = "hidden";
  showCurrent();
}
function hideViewer() {
  if (!viewerEl || !viewerOpen) return;
  viewerEl.style.display = "none";
  viewerOpen = false;
  const c = viewerEl.querySelector(".content");
  c.innerHTML = "";
  document.body.style.overflow = "";
}
function buildViewer() {
  viewerEl = document.createElement("div");
  viewerEl.className = "viewer";
  viewerEl.style.display = "none";
  viewerEl.innerHTML = `
    <div class="bar">
      <div class="title" id="vTitle"></div>
      <button class="btn" id="vFs" title="Fullscreen (F)">⛶</button>
      <button class="btn" id="vOpen">Open raw</button>
      <button class="btn" id="vClose">✕ Close</button>
    </div>
    <div class="content" id="vContent"></div>
    <div class="nav prev" id="vPrev">‹</div>
    <div class="nav next" id="vNext">›</div>
    <div class="info" id="vInfo"></div>`;
  document.body.appendChild(viewerEl);
  viewerEl.querySelector("#vClose").onclick = closeViewer;
  viewerEl.querySelector("#vPrev").onclick = () => step(-1);
  viewerEl.querySelector("#vNext").onclick = () => step(1);
  viewerEl.querySelector("#vFs").onclick = toggleFullscreen;
  viewerEl.querySelector("#vOpen").onclick = () => {
    const it = mediaList[viewIndex];
    if (it) window.open("/api/file?path=" + encPath(it.path), "_blank");
  };
  viewerEl.addEventListener("click", (e) => {
    if (e.target === viewerEl) closeViewer();
  });
  document.addEventListener("fullscreenchange", updateFsBtn);
  document.addEventListener("webkitfullscreenchange", updateFsBtn);
}

function isFs() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function enterFs(el) {
  el = el || viewerEl;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn) return fn.call(el).catch(() => {});
}
function exitFs() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (fn) return fn.call(document).catch(() => {});
}
function toggleFullscreen() {
  if (isFs()) exitFs(); else enterFs(viewerEl);
}
function updateFsBtn() {
  const btn = viewerEl && viewerEl.querySelector("#vFs");
  if (btn) btn.textContent = isFs() ? "⛉" : "⛶";
}

function step(d) {
  if (!mediaList.length) return;
  viewIndex = (viewIndex + d + mediaList.length) % mediaList.length;
  showCurrent();
  // Keep URL deep-linkable but don't pollute history with every image step
  history.replaceState({ path: current.path, viewer: viewIndex }, "", urlFor(current.path, viewIndex));
}

function showCurrent() {
  const it = mediaList[viewIndex];
  if (!it) return;
  document.getElementById("vTitle").textContent = it.name;
  document.getElementById("vInfo").textContent =
    (viewIndex + 1) + " / " + mediaList.length + "  •  " + fmtSize(it.size);
  const c = document.getElementById("vContent");
  c.innerHTML = "";
  if (it.kind === "image") {
    const img = document.createElement("img");
    img.src = "/api/file?path=" + encPath(it.path);
    img.alt = it.name;
    c.appendChild(img);
  } else if (it.kind === "video") {
    const v = document.createElement("video");
    v.controls = true;
    v.autoplay = true;
    v.preload = "metadata";
    v.playsInline = true;
    const ext = it.name.split(".").pop().toLowerCase();
    const browserNative = ["mp4","webm","m4v","mov","ogg","ogv"];
    if (browserNative.includes(ext)) {
      v.src = "/api/file?path=" + encPath(it.path);
    } else {
      // mkv, avi, flv, wmv, ts, mpg... → live transcode
      v.src = "/api/transcode?path=" + encPath(it.path);
    }
    // Fallback: if native source fails (incompatible codec inside mp4/mov), retry transcoded
    v.addEventListener("error", () => {
      if (!v.dataset.fallback) {
        v.dataset.fallback = "1";
        v.src = "/api/transcode?path=" + encPath(it.path);
        v.load(); v.play().catch(()=>{});
      }
    });
    // Double-click (desktop) toggles fullscreen on the viewer
    v.addEventListener("dblclick", (e) => { e.preventDefault(); toggleFullscreen(); });
    // Double-tap (touch) — dblclick is unreliable on iOS for <video>
    let lastTap = 0;
    v.addEventListener("touchend", (e) => {
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        toggleFullscreen();
        lastTap = 0;
      } else {
        lastTap = now;
      }
    });
    c.appendChild(v);
  }
}

document.addEventListener("keydown", (e) => {
  if (!viewerOpen) return;
  if (e.key === "Escape") {
    // If we're in fullscreen, the browser will handle ESC to exit fullscreen.
    // Only close the viewer when not in fullscreen.
    if (!isFs()) closeViewer();
  }
  else if (e.key === "ArrowRight") step(1);
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); }
  else if (e.key === " ") {
    const v = viewerEl.querySelector("video");
    if (v) { e.preventDefault(); v.paused ? v.play() : v.pause(); }
  }
});

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// initial
setMode(mode);
(async () => {
  const init = parseLocation();
  const ok = await load(init.path);
  if (!ok) return;
  // Seed the first history entry so popstate has a state object to return to
  history.replaceState({ path: current.path, viewer: init.viewer }, "", urlFor(current.path, init.viewer));
  if (init.viewer !== null && init.viewer < mediaList.length) showViewer(init.viewer);
})();
