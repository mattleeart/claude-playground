"use strict";

/* Pattern hash. Regenerate with: python3 tools/hash_pattern.py <pattern>
   This gate is cosmetic: the markdown files are still publicly fetchable by
   direct URL. The pattern itself is stored only as a PBKDF2 hash. */
const AUTH = { salt: "074566f4abd1ce3f6696046e6d584f2a", iterations: 150000, hash: "21062b9f1e596f6480a1402da018ab1edb36f9bb64a3b60137716fb5886d0a5d" };

const SESSION_KEY = "mdv_unlocked";

/* ---------------- crypto helpers ---------------- */
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function derive(pattern) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(pattern), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(AUTH.salt), iterations: AUTH.iterations, hash: "SHA-256" },
    keyMaterial, 256
  );
  return bytesToHex(new Uint8Array(bits));
}

/* ---------------- pattern lock ---------------- */
const DOT_COUNT = 9;
const HIT_RADIUS = 38; // in 0..300 viewBox space
const MID = { "0,2": 1, "0,6": 3, "0,8": 4, "2,6": 4, "2,8": 5, "6,8": 7, "1,7": 4, "3,5": 4 };

function dotCenter(i) {
  const col = i % 3, row = Math.floor(i / 3);
  return { x: col * 100 + 50, y: row * 100 + 50 };
}

function initLock(onSuccess) {
  const lock = document.getElementById("lock");
  const grid = document.getElementById("pattern");
  const dotsWrap = document.getElementById("pattern-dots");
  const svg = document.getElementById("pattern-lines");
  const hint = document.getElementById("lock-hint");

  const dotEls = [];
  for (let i = 0; i < DOT_COUNT; i++) {
    const d = document.createElement("div");
    d.className = "dot";
    d.dataset.index = String(i);
    dotsWrap.appendChild(d);
    dotEls.push(d);
  }

  let drawing = false;
  let seq = [];

  function toLocal(ev) {
    const r = grid.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * 300, y: ((ev.clientY - r.top) / r.height) * 300 };
  }
  function clearSvg() { while (svg.firstChild) svg.removeChild(svg.firstChild); }
  function line(x1, y1, x2, y2, faint) {
    const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
    l.setAttribute("x1", x1); l.setAttribute("y1", y1);
    l.setAttribute("x2", x2); l.setAttribute("y2", y2);
    l.setAttribute("stroke", "#ddd6fe");
    l.setAttribute("stroke-width", "4");
    l.setAttribute("stroke-linecap", "round");
    if (faint) l.setAttribute("stroke-opacity", "0.55");
    svg.appendChild(l);
  }
  function redraw(cursor) {
    clearSvg();
    for (let i = 1; i < seq.length; i++) {
      const a = dotCenter(seq[i - 1]), b = dotCenter(seq[i]);
      line(a.x, a.y, b.x, b.y, false);
    }
    if (cursor && seq.length) {
      const a = dotCenter(seq[seq.length - 1]);
      line(a.x, a.y, cursor.x, cursor.y, true);
    }
  }
  function addDot(i) {
    if (seq.includes(i)) return;
    if (seq.length) {
      const prev = seq[seq.length - 1];
      const key = Math.min(prev, i) + "," + Math.max(prev, i);
      const mid = MID[key];
      if (mid !== undefined && !seq.includes(mid)) {
        seq.push(mid); dotEls[mid].classList.add("active");
      }
    }
    seq.push(i); dotEls[i].classList.add("active");
  }
  function hitTest(p) {
    for (let i = 0; i < DOT_COUNT; i++) {
      const c = dotCenter(i);
      if (Math.hypot(c.x - p.x, c.y - p.y) <= HIT_RADIUS) return i;
    }
    return -1;
  }
  function reset() {
    seq = []; clearSvg();
    dotEls.forEach((d) => d.classList.remove("active"));
  }

  function start(ev) {
    if (!crypto.subtle) { hint.textContent = "이 브라우저에서는 잠금 해제를 지원하지 않습니다"; return; }
    drawing = true; reset();
    grid.setPointerCapture && grid.setPointerCapture(ev.pointerId);
    const i = hitTest(toLocal(ev));
    if (i >= 0) addDot(i);
    redraw(toLocal(ev));
    ev.preventDefault();
  }
  function move(ev) {
    if (!drawing) return;
    const p = toLocal(ev);
    const i = hitTest(p);
    if (i >= 0) addDot(i);
    redraw(p);
    ev.preventDefault();
  }
  async function end(ev) {
    if (!drawing) return;
    drawing = false;
    redraw(null);
    if (seq.length < 2) { reset(); return; }
    const pattern = seq.join("-");
    let hash;
    try { hash = await derive(pattern); }
    catch (e) { hint.textContent = "오류가 발생했습니다"; reset(); return; }
    if (hash === AUTH.hash) {
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (_) {}
      lock.classList.add("hide");
      setTimeout(() => { lock.remove(); onSuccess(); }, 350);
    } else {
      hint.textContent = "패턴이 올바르지 않습니다";
      hint.classList.add("error");
      grid.classList.add("shake");
      setTimeout(() => grid.classList.remove("shake"), 400);
      reset();
    }
  }

  grid.addEventListener("pointerdown", start);
  grid.addEventListener("pointermove", move);
  grid.addEventListener("pointerup", end);
  grid.addEventListener("pointercancel", () => { drawing = false; redraw(null); reset(); });
}

/* ---------------- markdown viewer ---------------- */
function initViewer() {
  const drawer = document.getElementById("drawer");
  const backdrop = document.getElementById("backdrop");
  const list = document.getElementById("file-list");
  const content = document.getElementById("content");
  const titleEl = document.getElementById("doc-title");

  marked.setOptions({ gfm: true, breaks: false });

  let files = [];

  function openDrawer() { drawer.classList.add("open"); backdrop.hidden = false; }
  function closeDrawer() { drawer.classList.remove("open"); backdrop.hidden = true; }

  document.getElementById("menu-btn").addEventListener("click", openDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.getElementById("lock-btn").addEventListener("click", () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    location.reload();
  });

  function render(html) { content.innerHTML = DOMPurify.sanitize(html); }

  function setActive(name) {
    Array.from(list.children).forEach((li) => {
      li.classList.toggle("active", li.dataset.name === name);
    });
  }

  async function openFile(name) {
    const file = files.find((f) => f.name === name) || files[0];
    if (!file) return;
    setActive(file.name);
    titleEl.textContent = file.title || file.name;
    content.innerHTML = '<p class="placeholder">불러오는 중…</p>';
    closeDrawer();
    try {
      const res = await fetch(file.path, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const text = await res.text();
      render(marked.parse(text));
      content.scrollIntoView({ block: "start" });
      window.scrollTo(0, 0);
    } catch (e) {
      content.innerHTML = '<p class="placeholder">문서를 불러오지 못했습니다.</p>';
    }
    const hash = "#" + encodeURIComponent(file.name);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function buildList() {
    list.innerHTML = "";
    files.forEach((f) => {
      const li = document.createElement("li");
      li.dataset.name = f.name;
      const kb = f.size ? (f.size / 1024).toFixed(1) + " KB" : "";
      li.innerHTML = `${escapeHtml(f.title || f.name)}<span class="file-sub">${escapeHtml(f.name)}${kb ? " · " + kb : ""}</span>`;
      li.addEventListener("click", () => openFile(f.name));
      list.appendChild(li);
    });
  }

  function currentFromHash() {
    if (!location.hash) return null;
    try { return decodeURIComponent(location.hash.slice(1)); } catch (_) { return null; }
  }

  window.addEventListener("hashchange", () => {
    const name = currentFromHash();
    if (name) openFile(name);
  });

  (async function load() {
    try {
      const res = await fetch("manifest.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      files = Array.isArray(data.files) ? data.files : [];
    } catch (e) {
      content.innerHTML = '<p class="placeholder">목록(manifest.json)을 불러오지 못했습니다.</p>';
      return;
    }
    if (!files.length) {
      content.innerHTML = '<p class="placeholder">표시할 문서가 없습니다. content/ 폴더에 .md 파일을 추가하세요.</p>';
      return;
    }
    buildList();
    openFile(currentFromHash() || files[0].name);
  })();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ---------------- boot ---------------- */
function reveal() {
  const app = document.getElementById("app");
  app.hidden = false;
  initViewer();
}

document.addEventListener("DOMContentLoaded", () => {
  let unlocked = false;
  try { unlocked = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (_) {}
  if (unlocked) {
    const lock = document.getElementById("lock");
    if (lock) lock.remove();
    reveal();
  } else {
    initLock(reveal);
  }
});
