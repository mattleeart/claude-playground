"use strict";

/* Pattern hash. Regenerate with: python3 tools/hash_pattern.py <pattern>
   This gate is cosmetic: the markdown files are still publicly fetchable by
   direct URL. The pattern itself is stored only as a PBKDF2 hash. */
const AUTH = { salt: "074566f4abd1ce3f6696046e6d584f2a", iterations: 150000, hash: "21062b9f1e596f6480a1402da018ab1edb36f9bb64a3b60137716fb5886d0a5d" };

const SESSION_KEY = "mdv_unlocked";
const THEME_KEY = "mdv_theme", SCALE_KEY = "mdv_scale", LAST_KEY = "mdv_last", POS_PREFIX = "mdv_pos_";
const TOKEN_KEY = "mdv_gh_token", DRAFT_PREFIX = "mdv_draft_";
const REPO = { owner: "mattleeart", repo: "claude-playground", branch: "claude/simple-web-server-0x42B" };

/* ---------------- GitHub Contents API ---------------- */
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { return ""; } }
function b64encodeUtf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64decodeUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function ghHeaders(needAuth) {
  const h = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const t = getToken();
  if (needAuth && !t) throw new Error("GitHub 토큰이 설정되지 않았습니다");
  if (t) h.Authorization = "Bearer " + t;
  return h;
}
function ghContentsUrl(path) {
  return `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}`;
}
async function ghGet(path) {
  const r = await fetch(ghContentsUrl(path) + "?ref=" + encodeURIComponent(REPO.branch), { headers: ghHeaders(false), cache: "no-store" });
  if (!r.ok) throw new Error("GET " + r.status);
  const j = await r.json();
  return { sha: j.sha, text: b64decodeUtf8(j.content || "") };
}
async function ghPut(path, text, sha, message) {
  const body = { message, content: b64encodeUtf8(text), branch: REPO.branch };
  if (sha) body.sha = sha;
  const r = await fetch(ghContentsUrl(path), { method: "PUT", headers: { ...ghHeaders(true), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("PUT " + r.status + " " + t.slice(0, 200)); }
  const j = await r.json();
  return { sha: j.content && j.content.sha };
}
async function ghDelete(path, sha, message) {
  const r = await fetch(ghContentsUrl(path), { method: "DELETE", headers: { ...ghHeaders(true), "Content-Type": "application/json" }, body: JSON.stringify({ message, sha, branch: REPO.branch }) });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("DELETE " + r.status + " " + t.slice(0, 200)); }
  return true;
}

/* ---------------- settings (theme + font) ---------------- */
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function getTheme() { return lsGet(THEME_KEY, "auto"); }
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
function getScale() { return Math.min(1.6, Math.max(0.8, parseFloat(lsGet(SCALE_KEY, "1")) || 1)); }
function applyScale(s) { document.documentElement.style.setProperty("--md-scale", String(s)); }
function effectiveDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
applyTheme(getTheme());
applyScale(getScale());

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

  // ==highlight== mark extension (no async deps)
  marked.use({
    extensions: [{
      name: "mark", level: "inline",
      start(src) { const i = src.indexOf("=="); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
        if (m) return { type: "mark", raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return "<mark>" + this.parser.parseInline(t.tokens) + "</mark>"; },
    }],
  });

  // ^superscript^ and ~subscript~ (pandoc-style, no spaces inside)
  marked.use({
    extensions: [
      {
        name: "sup", level: "inline",
        start(src) { const i = src.indexOf("^"); return i < 0 ? undefined : i; },
        tokenizer(src) { const m = /^\^([^\^\s]+)\^/.exec(src); if (m) return { type: "sup", raw: m[0], text: m[1] }; },
        renderer(t) { return "<sup>" + escapeHtml(t.text) + "</sup>"; },
      },
      {
        name: "sub", level: "inline",
        start(src) { const i = src.indexOf("~"); return i < 0 ? undefined : i; },
        tokenizer(src) { const m = /^~(?!~)([^~\s]+)~/.exec(src); if (m) return { type: "sub", raw: m[0], text: m[1] }; },
        renderer(t) { return "<sub>" + escapeHtml(t.text) + "</sub>"; },
      },
    ],
  });

  /* ---- YAML-ish frontmatter ---- */
  function parseFrontmatter(text) {
    const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!m) return { meta: {}, body: text };
    const meta = {};
    m[1].split(/\r?\n/).forEach((line) => {
      const mm = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!mm) return;
      let v = mm[2].trim().replace(/^["']|["']$/g, "");
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      meta[mm[1].toLowerCase()] = v;
    });
    return { meta, body: text.slice(m[0].length) };
  }

  function readingStats(body) {
    const cjk = (body.match(/[　-鿿가-힣]/g) || []).length;
    const words = (body.replace(/[　-鿿가-힣]/g, " ").match(/\b[\w'-]+\b/g) || []).length;
    const minutes = Math.max(1, Math.round(cjk / 500 + words / 220));
    return { minutes, words: words + cjk };
  }

  function metaHeader(meta, body) {
    const bits = [];
    if (meta.date) bits.push(`<span>📅 ${escapeHtml(meta.date)}</span>`);
    const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
    if (tags.length) bits.push(`<span class="tags">${tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join(" ")}</span>`);
    const st = readingStats(body);
    bits.push(`<span>⏱️ 약 ${st.minutes}분</span>`);
    return `<div class="doc-meta">${bits.join('<span class="dot-sep">·</span>')}</div>`;
  }
  function insertMeta(root, meta, body) {
    const tmp = document.createElement("div");
    tmp.innerHTML = DOMPurify.sanitize(metaHeader(meta, body));
    const node = tmp.firstChild;
    if (!node) return;
    const h1 = root.querySelector(":scope > h1");
    if (h1) h1.after(node); else root.prepend(node);
  }

  /* ---- emoji shortcodes (lazy) ---- */
  let emojiReady = null, emojiMap = null;
  function loadEmoji() {
    if (!emojiReady) {
      emojiReady = fetch("assets/vendor/emoji.json", { cache: "force-cache" })
        .then((r) => r.json())
        .then((map) => {
          emojiMap = map;
          marked.use({
            extensions: [{
              name: "emoji", level: "inline",
              start(src) { const i = src.indexOf(":"); return i < 0 ? undefined : i; },
              tokenizer(src) {
                const m = /^:([a-zA-Z0-9_+\-]+):/.exec(src);
                if (m && emojiMap[m[1]]) return { type: "emoji", raw: m[0], text: emojiMap[m[1]] };
              },
              renderer(t) { return t.text; },
            }],
          });
        });
    }
    return emojiReady;
  }

  /* ---- footnotes: [^id] refs + [^id]: definitions ---- */
  function preprocessFootnotes(src) {
    const defRe = /^\[\^([^\]\s]+)\]:[ \t]*(.+)$/gm;
    const defs = {};
    let m;
    while ((m = defRe.exec(src))) defs[m[1]] = m[2].trim();
    if (!Object.keys(defs).length) return src;
    src = src.replace(defRe, "").replace(/\n{3,}/g, "\n\n");
    const order = [];
    src = src.replace(/\[\^([^\]\s]+)\]/g, (full, id) => {
      if (!defs[id]) return full;
      if (order.indexOf(id) < 0) order.push(id);
      const n = order.indexOf(id) + 1;
      return `<sup class="fnref" id="fnref-${escapeHtml(id)}"><a href="#fn-${escapeHtml(id)}">${n}</a></sup>`;
    });
    if (!order.length) return src;
    let section = '\n\n<hr class="fn-sep">\n<ol class="footnotes">\n';
    order.forEach((id) => {
      const html = marked.parseInline(defs[id]);
      section += `<li id="fn-${escapeHtml(id)}">${html} <a href="#fnref-${escapeHtml(id)}" class="fn-back" aria-label="돌아가기">↩</a></li>\n`;
    });
    section += "</ol>\n";
    return src + section;
  }

  let files = [];

  function openDrawer() {
    drawer.classList.add("open"); backdrop.hidden = false;
    const tb = document.querySelector(".topbar"); if (tb) tb.classList.remove("hidden");
  }
  function closeDrawer() { drawer.classList.remove("open"); backdrop.hidden = true; }

  document.getElementById("menu-btn").addEventListener("click", openDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.getElementById("lock-btn").addEventListener("click", () => {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
    location.reload();
  });

  /* ---- settings panel: theme + font size ---- */
  const settingsBtn = document.getElementById("settings-btn");
  const settings = document.getElementById("settings");
  const themeSeg = document.getElementById("theme-seg");
  settingsBtn.addEventListener("click", (e) => { e.stopPropagation(); settings.hidden = !settings.hidden; });
  document.addEventListener("click", (e) => {
    if (!settings.hidden && !settings.contains(e.target) && e.target !== settingsBtn) settings.hidden = true;
  });
  function refreshThemeSeg() {
    const t = getTheme();
    themeSeg.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.themeVal === t));
  }
  function onThemeChanged() {
    syncHljsTheme();
    if (currentDoc && content.querySelector(".mermaid")) openFile(currentDoc);
  }
  themeSeg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const t = b.dataset.themeVal;
      lsSet(THEME_KEY, t); applyTheme(t); refreshThemeSeg(); onThemeChanged();
    });
  });
  refreshThemeSeg();
  function setScale(s) {
    s = Math.min(1.6, Math.max(0.8, Math.round(s * 100) / 100));
    lsSet(SCALE_KEY, String(s)); applyScale(s);
  }
  document.getElementById("font-dec").addEventListener("click", () => setScale(getScale() - 0.1));
  document.getElementById("font-inc").addEventListener("click", () => setScale(getScale() + 0.1));
  document.getElementById("font-reset").addEventListener("click", () => setScale(1));
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (getTheme() === "auto") onThemeChanged(); });
  }

  /* ---- search: title + full text ---- */
  const filter = document.getElementById("filter");
  const searchResults = document.getElementById("search-results");
  const tocHeadEl = () => document.getElementById("toc-head");
  const docText = {};
  let allDocsPromise = null;
  let pendingSearch = null;

  function ensureAllDocs() {
    if (!allDocsPromise) {
      allDocsPromise = Promise.all(files.map((f) =>
        fetch(f.path, { cache: "force-cache" }).then((r) => r.text())
          .then((t) => { docText[f.name] = t; }).catch(() => { docText[f.name] = ""; })
      ));
    }
    return allDocsPromise;
  }
  function showLists(normal) {
    list.hidden = !normal;
    searchResults.hidden = normal;
    const th = tocHeadEl(); if (th) th.hidden = !normal || th.dataset.empty === "1";
    tocEl.hidden = !normal;
  }
  function snippet(text, q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return "";
    const start = Math.max(0, i - 30), end = Math.min(text.length, i + q.length + 50);
    const pre = (start > 0 ? "…" : "") + text.slice(start, i);
    const hit = text.slice(i, i + q.length);
    const post = text.slice(i + q.length, end) + (end < text.length ? "…" : "");
    return escapeHtml(pre) + "<mark>" + escapeHtml(hit) + "</mark>" + escapeHtml(post);
  }
  function renderSearch(q) {
    const ql = q.toLowerCase();
    searchResults.innerHTML = "";
    let count = 0;
    files.forEach((f) => {
      const inTitle = (f.title || f.name).toLowerCase().includes(ql);
      const text = docText[f.name] || "";
      const inBody = text.toLowerCase().includes(ql);
      if (!inTitle && !inBody) return;
      count++;
      const li = document.createElement("li");
      li.dataset.name = f.name;
      const snip = inBody ? snippet(text, q) : escapeHtml(f.name);
      li.innerHTML = `${escapeHtml(f.title || f.name)}<span class="file-sub">${snip}</span>`;
      li.addEventListener("click", () => { pendingSearch = q; openFile(f.name); });
      searchResults.appendChild(li);
    });
    if (!count) searchResults.innerHTML = '<li class="no-hit">검색 결과가 없습니다</li>';
  }
  let searchTimer = 0;
  filter.addEventListener("input", () => {
    const q = filter.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 1) { showLists(true); return; }
    searchTimer = setTimeout(async () => {
      showLists(false);
      await ensureAllDocs();
      renderSearch(q);
    }, 180);
  });

  function highlightMatches(root, q) {
    if (!q) return;
    const ql = q.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.nodeValue.toLowerCase().includes(ql)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|CODE|PRE)$/.test(p.tagName) || p.closest(".katex, .mermaid")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const targets = [];
    let n; while ((n = walker.nextNode())) targets.push(n);
    let first = null;
    targets.forEach((node) => {
      const frag = document.createDocumentFragment();
      const val = node.nodeValue;
      let idx = 0, lo = val.toLowerCase(), pos;
      while ((pos = lo.indexOf(ql, idx)) >= 0) {
        if (pos > idx) frag.appendChild(document.createTextNode(val.slice(idx, pos)));
        const mk = document.createElement("mark");
        mk.className = "search-hit";
        mk.textContent = val.slice(pos, pos + q.length);
        frag.appendChild(mk);
        if (!first) first = mk;
        idx = pos + q.length;
      }
      if (idx < val.length) frag.appendChild(document.createTextNode(val.slice(idx)));
      node.parentNode.replaceChild(frag, node);
    });
    if (first) setTimeout(() => first.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }

  /* ---- reading progress, hide-on-scroll header, back-to-top ---- */
  const progress = document.getElementById("progress");
  const topbar = document.querySelector(".topbar");
  const toTop = document.getElementById("to-top");
  toTop.hidden = false;
  let lastY = 0;
  function onScroll() {
    const h = document.documentElement;
    const y = h.scrollTop;
    const max = h.scrollHeight - h.clientHeight;
    progress.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
    if (y > 120 && y > lastY + 4) topbar.classList.add("hidden");
    else if (y < lastY - 4 || y < 120) topbar.classList.remove("hidden");
    toTop.classList.toggle("show", y > 500);
    lastY = y;
    saveScrollSoon();
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* ---- toast ---- */
  let toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  }
  function copyText(t) {
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => toast("링크를 복사했습니다")).catch(() => {});
    else toast("복사를 지원하지 않습니다");
  }

  /* ---- share / copy link ---- */
  document.getElementById("share-btn").addEventListener("click", async () => {
    settings.hidden = true;
    const data = { title: titleEl.textContent, url: location.href };
    if (navigator.share) { try { await navigator.share(data); } catch (_) {} }
    else copyText(location.href);
  });
  document.getElementById("copylink-btn").addEventListener("click", () => { settings.hidden = true; copyText(location.href); });

  /* ---- GitHub token field ---- */
  const tokenInput = document.getElementById("gh-token");
  const tokenClearBtn = document.getElementById("gh-token-clear");
  tokenInput.value = getToken();
  tokenInput.addEventListener("input", () => { lsSet(TOKEN_KEY, tokenInput.value.trim()); });
  tokenClearBtn.addEventListener("click", () => { tokenInput.value = ""; lsSet(TOKEN_KEY, ""); toast("토큰을 삭제했습니다"); });

  /* ---- editor ---- */
  const editBtn = document.getElementById("edit-btn");
  const cancelEditBtn = document.getElementById("cancel-edit");
  const saveEditBtn = document.getElementById("save-edit");
  const editorEl = document.getElementById("editor");
  const editorTextarea = document.getElementById("editor-textarea");
  const editorStatus = document.getElementById("editor-status");
  let editingState = null; // { name, path, sha, original }
  let draftTimer = 0;

  function setEditorStatus(msg, kind) {
    editorStatus.textContent = msg || "";
    editorStatus.className = "editor-status" + (kind ? " " + kind : "");
  }

  async function enterEditMode() {
    if (!currentDoc) { toast("문서가 선택되지 않았습니다"); return; }
    const file = files.find((f) => f.name === currentDoc);
    if (!file) return;
    document.body.classList.add("editing");
    editorEl.hidden = false; content.hidden = true;
    editorTextarea.value = "";
    setEditorStatus("본문을 불러오는 중…");
    try {
      const res = await fetch(file.path + "?cb=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      editingState = { name: file.name, path: file.path, sha: null, original: text };
      const draftRaw = lsGet(DRAFT_PREFIX + file.name, "");
      if (draftRaw && draftRaw !== text) {
        if (confirm("저장되지 않은 임시 변경사항이 있습니다. 복원할까요?")) editorTextarea.value = draftRaw;
        else { editorTextarea.value = text; lsSet(DRAFT_PREFIX + file.name, ""); }
      } else {
        editorTextarea.value = text;
      }
      setEditorStatus("준비됨. 저장하려면 💾 또는 Ctrl/Cmd+S.", "");
      editorTextarea.focus();
    } catch (e) {
      setEditorStatus("불러오기 실패: " + e.message, "error");
    }
  }

  function exitEditMode(discardDraft) {
    if (editingState && discardDraft) lsSet(DRAFT_PREFIX + editingState.name, "");
    editingState = null;
    document.body.classList.remove("editing");
    editorEl.hidden = true; content.hidden = false;
    // reset preview mode
    if (editorPreview) editorPreview.hidden = true;
    if (editorTextarea) editorTextarea.hidden = false;
    const pBtn = editorToolbar && editorToolbar.querySelector('[data-action="preview"]');
    if (pBtn) pBtn.classList.remove("on");
    setEditorStatus("");
  }

  async function saveEdit() {
    if (!editingState) return;
    if (!getToken()) {
      setTimeout(() => { settings.hidden = false; tokenInput.focus(); }, 0);
      setEditorStatus("저장하려면 GitHub 토큰을 먼저 입력하세요", "error");
      return;
    }
    const text = editorTextarea.value;
    if (text === editingState.original) { setEditorStatus("변경사항이 없습니다", ""); return; }
    setEditorStatus("저장 중…");
    saveEditBtn.disabled = true;
    try {
      if (!editingState.sha) {
        const got = await ghGet(editingState.path);
        editingState.sha = got.sha;
      }
      const { sha } = await ghPut(editingState.path, text, editingState.sha, "docs: update " + editingState.name);
      editingState.sha = sha;
      editingState.original = text;
      lsSet(DRAFT_PREFIX + editingState.name, "");
      docText[editingState.name] = text;
      saveEditBtn.classList.remove("has-changes");
      const name = editingState.name;
      pendingEditedText = { name, text };
      exitEditMode(false);
      toast("저장됨 — 라이브 반영은 약 1분");
      openFile(name);
    } catch (e) {
      setEditorStatus("저장 실패: " + e.message, "error");
    } finally {
      saveEditBtn.disabled = false;
    }
  }

  editBtn.addEventListener("click", enterEditMode);
  cancelEditBtn.addEventListener("click", () => {
    if (editingState && editorTextarea.value !== editingState.original) {
      if (!confirm("변경사항이 저장되지 않았습니다. 취소할까요?")) return;
    }
    exitEditMode(true);
  });
  saveEditBtn.addEventListener("click", saveEdit);
  editorTextarea.addEventListener("input", () => {
    if (!editingState) return;
    saveEditBtn.classList.toggle("has-changes", editorTextarea.value !== editingState.original);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => lsSet(DRAFT_PREFIX + editingState.name, editorTextarea.value), 600);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S") && document.body.classList.contains("editing")) {
      e.preventDefault(); saveEdit();
    }
  });
  window.addEventListener("beforeunload", (e) => {
    if (editingState && editorTextarea.value !== editingState.original) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---- formatting toolbar + preview ---- */
  const editorToolbar = document.getElementById("editor-toolbar");
  const editorPreview = document.getElementById("editor-preview");
  function selRange() {
    return { s: editorTextarea.selectionStart, e: editorTextarea.selectionEnd, v: editorTextarea.value };
  }
  function setSel(s, e) {
    editorTextarea.focus();
    editorTextarea.setSelectionRange(s, e == null ? s : e);
  }
  function dispatchInput() { editorTextarea.dispatchEvent(new Event("input", { bubbles: true })); }
  // Use execCommand insertText so the browser's native undo stack records changes.
  function insertAt(s, e, text, finalSelStart, finalSelEnd) {
    editorTextarea.focus();
    editorTextarea.setSelectionRange(s, e);
    const ok = document.execCommand && document.execCommand("insertText", false, text);
    if (!ok) {
      const v = editorTextarea.value;
      editorTextarea.value = v.slice(0, s) + text + v.slice(e);
      dispatchInput();
    }
    if (finalSelStart != null) setSel(finalSelStart, finalSelEnd == null ? finalSelStart : finalSelEnd);
  }
  function applyWrap(prefix, suffix, placeholder) {
    const { s, e, v } = selRange();
    const sel = v.slice(s, e) || (placeholder || "");
    insertAt(s, e, prefix + sel + suffix, s + prefix.length, s + prefix.length + sel.length);
  }
  function applyLinePrefix(prefix) {
    const { s, e, v } = selRange();
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e); if (le < 0) le = v.length;
    const block = v.slice(ls, le) || prefix.trim().replace(/\s.*$/, "") + " 새 항목";
    const transformed = block.split("\n").map((line) => prefix + line).join("\n");
    insertAt(ls, le, transformed, ls, ls + transformed.length);
  }
  function applyInsert(text) {
    const { s, e } = selRange();
    insertAt(s, e, text, s + text.length);
  }

  async function renderPreview() {
    const raw = editorTextarea.value;
    const { body } = parseFrontmatter(raw);
    let text = body;
    if (/\$\$?[^\s$]/.test(text)) { try { await loadKatex(); } catch (_) {} }
    if (/:[a-z0-9_+-]+:/i.test(text)) { try { await loadEmoji(); } catch (_) {} }
    text = preprocessFootnotes(text);
    editorPreview.innerHTML = DOMPurify.sanitize(marked.parse(text), {
      USE_PROFILES: { html: true, svg: true, mathMl: true }, ADD_ATTR: ["target"],
    });
    enhance(editorPreview);
  }
  function togglePreview() {
    const btn = editorToolbar.querySelector('[data-action="preview"]');
    if (editorPreview.hidden) {
      editorPreview.hidden = false; editorTextarea.hidden = true;
      btn.classList.add("on"); renderPreview();
    } else {
      editorPreview.hidden = true; editorTextarea.hidden = false;
      btn.classList.remove("on"); editorTextarea.focus();
    }
  }

  editorToolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tb"); if (!btn) return;
    const a = btn.dataset.action;
    if (a === "bold") applyWrap("**", "**", "굵게");
    else if (a === "italic") applyWrap("*", "*", "기울임");
    else if (a === "strike") applyWrap("~~", "~~", "취소선");
    else if (a === "code") applyWrap("`", "`", "code");
    else if (a === "heading") applyLinePrefix("## ");
    else if (a === "quote") applyLinePrefix("> ");
    else if (a === "ul") applyLinePrefix("- ");
    else if (a === "ol") applyLinePrefix("1. ");
    else if (a === "task") applyLinePrefix("- [ ] ");
    else if (a === "hr") applyInsert("\n\n---\n\n");
    else if (a === "codeblock") {
      const { s, e: ee, v } = selRange();
      const sel = v.slice(s, ee) || "코드";
      const block = "\n```\n" + sel + "\n```\n";
      insertAt(s, ee, block, s + 5, s + 5 + sel.length);
    } else if (a === "link") {
      const url = prompt("URL을 입력하세요", "https://");
      if (url) applyWrap("[", "](" + url + ")", "텍스트");
    } else if (a === "image") {
      const url = prompt("이미지 URL", "https://");
      if (url) applyInsert("![설명](" + url + ")");
    } else if (a === "preview") togglePreview();
    else if (a === "delete") deleteDoc();
  });

  async function newDoc() {
    let name = prompt("새 문서 파일명 (예: notes.md)", "");
    if (!name) return;
    name = name.trim();
    if (!/^[\w가-힣 .,_-]+$/.test(name)) { toast("파일명에 사용할 수 없는 문자가 있습니다"); return; }
    if (!/\.md$/i.test(name)) name += ".md";
    if (files.some((f) => f.name === name)) { toast("이미 존재하는 파일명입니다"); return; }
    if (!getToken()) { setTimeout(() => { settings.hidden = false; tokenInput.focus(); }, 0); toast("토큰을 먼저 입력하세요"); return; }
    const title = name.replace(/\.md$/i, "");
    const tpl = "# " + title + "\n\n";
    try {
      const { sha } = await ghPut("content/" + name, tpl, null, "docs: add " + name);
      const f = { name, path: "content/" + name, title, size: tpl.length };
      files.push(f); files.sort((a, b) => a.name.localeCompare(b.name));
      buildList();
      currentDoc = name;
      titleEl.textContent = title;
      document.body.classList.add("editing");
      editorEl.hidden = false; content.hidden = true;
      editingState = { name, path: f.path, sha, original: tpl };
      editorTextarea.value = tpl;
      setEditorStatus("새 문서 생성됨. 편집 후 저장하세요.", "ok");
      closeDrawer();
      editorTextarea.focus();
      lsSet(LAST_KEY, name);
    } catch (e) { toast("생성 실패: " + e.message); }
  }
  document.getElementById("new-doc").addEventListener("click", newDoc);

  async function deleteDoc() {
    if (!editingState) return;
    if (!confirm("'" + editingState.name + "' 문서를 삭제하시겠습니까?")) return;
    if (!getToken()) { setTimeout(() => { settings.hidden = false; tokenInput.focus(); }, 0); toast("토큰을 먼저 입력하세요"); return; }
    try {
      if (!editingState.sha) { const g = await ghGet(editingState.path); editingState.sha = g.sha; }
      await ghDelete(editingState.path, editingState.sha, "docs: delete " + editingState.name);
      const name = editingState.name;
      const idx = files.findIndex((f) => f.name === name);
      if (idx >= 0) files.splice(idx, 1);
      delete docText[name];
      lsSet(DRAFT_PREFIX + name, "");
      if (lsGet(LAST_KEY, "") === name) lsSet(LAST_KEY, "");
      exitEditMode(true);
      buildList();
      toast("삭제됨 — 라이브 반영은 약 1분");
      if (files.length) openFile(files[0].name);
      else { content.innerHTML = '<p class="placeholder">문서가 없습니다.</p>'; titleEl.textContent = "문서"; currentDoc = null; }
    } catch (e) { toast("삭제 실패: " + e.message); }
  }

  editorTextarea.addEventListener("keydown", (ev) => {
    if (ev.key === "Tab") {
      ev.preventDefault();
      const { s, e: end, v } = selRange();
      if (s === end) {
        insertAt(s, end, "  ", s + 2);
      } else {
        const ls = v.lastIndexOf("\n", s - 1) + 1;
        let le = v.indexOf("\n", end); if (le < 0) le = v.length;
        const block = v.slice(ls, le);
        const transformed = ev.shiftKey
          ? block.split("\n").map((l) => l.replace(/^ {1,2}/, "")).join("\n")
          : block.split("\n").map((l) => "  " + l).join("\n");
        insertAt(ls, le, transformed, ls, ls + transformed.length);
      }
      return;
    }
    if (ev.key === "Enter" && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      const { s, e: end, v } = selRange();
      if (s !== end) return;
      const ls = v.lastIndexOf("\n", s - 1) + 1;
      const line = v.slice(ls, s);
      const m = /^(\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?|\s*>\s+)/.exec(line);
      if (!m) return;
      const prefix = m[0];
      const rest = line.slice(prefix.length);
      if (!rest.trim()) {
        // empty list/quote item: outdent (clear the prefix)
        ev.preventDefault();
        insertAt(ls, s, "", ls);
        return;
      }
      ev.preventDefault();
      let next = prefix;
      const num = /^(\s*)(\d+)\.\s+/.exec(prefix);
      if (num) next = num[1] + (parseInt(num[2], 10) + 1) + ". " + prefix.slice(num[0].length);
      next = next.replace(/\[[xX]\]/, "[ ]");
      insertAt(s, end, "\n" + next, s + 1 + next.length);
    }
  });

  let pendingEditedText = null;

  /* ---- Esc to dismiss overlays ---- */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (lightbox && lightbox.classList.contains("open")) lightbox.classList.remove("open");
    else if (!settings.hidden) settings.hidden = true;
    else if (drawer.classList.contains("open")) closeDrawer();
  });

  /* ---- edge-swipe to open / swipe to close the drawer ---- */
  let sx = null, sy = null;
  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { sx = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (sx == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0 && sx < 40 && !drawer.classList.contains("open")) openDrawer();
      else if (dx < 0 && drawer.classList.contains("open")) closeDrawer();
    }
    sx = sy = null;
  }, { passive: true });

  /* ---- TOC + scroll memory ---- */
  const tocEl = document.getElementById("toc");
  const tocHead = document.getElementById("toc-head");
  let currentDoc = null;
  let tocObserver = null;
  let saveTimer = 0;
  function saveScrollSoon() {
    if (!currentDoc) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => lsSet(POS_PREFIX + currentDoc, String(Math.round(window.scrollY))), 250);
  }
  function slugify(t) {
    return (t || "").trim().toLowerCase()
      .replace(/[^\w\s가-힣-]/g, "")
      .replace(/\s+/g, "-").slice(0, 64) || "section";
  }
  function buildToc() {
    tocEl.innerHTML = "";
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    const heads = Array.from(content.querySelectorAll("h2, h3"));
    if (!heads.length) { tocHead.hidden = true; tocHead.dataset.empty = "1"; return; }
    tocHead.dataset.empty = "0";
    tocHead.hidden = false;
    const seen = {};
    const linkById = {};
    heads.forEach((h) => {
      const titleText = h.textContent;
      let id = slugify(titleText);
      if (seen[id]) { seen[id]++; id = id + "-" + seen[id]; } else seen[id] = 1;
      h.id = id;
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.className = h.tagName === "H3" ? "h3" : "h2";
      link.textContent = titleText;
      link.href = "#";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        closeDrawer();
      });
      li.appendChild(link); tocEl.appendChild(li);
      linkById[id] = link;
    });
    tocObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          Object.values(linkById).forEach((l) => l.classList.remove("active"));
          const l = linkById[en.target.id]; if (l) l.classList.add("active");
        }
      });
    }, { rootMargin: "-10% 0px -75% 0px" });
    heads.forEach((h) => tocObserver.observe(h));
  }

  function render(html) {
    content.innerHTML = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, mathMl: true },
      ADD_ATTR: ["target"],
    });
    enhance(content);
  }

  /* ---- KaTeX (lazy) via marked extension ---- */
  let katexReady = null;
  let katexExtRegistered = false;
  function loadKatex() {
    if (!katexReady) {
      loadStyle("assets/vendor/katex/katex.min.css");
      katexReady = loadScript("assets/vendor/katex/katex.min.js").then(registerKatexExt);
    }
    return katexReady;
  }
  function registerKatexExt() {
    if (katexExtRegistered || !window.katex) return;
    katexExtRegistered = true;
    const k = window.katex;
    const render = (text, display) => {
      try { return k.renderToString(text, { displayMode: display, throwOnError: false }); }
      catch (e) { return "<code>" + escapeHtml(text) + "</code>"; }
    };
    // Block math: $$ on its own line(s). Inline math: $...$ on a single line.
    const blockRule = /^\$\$\s*\n?([\s\S]+?)\n?\s*\$\$(?:\n|$)/;
    const inlineRule = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$/;
    marked.use({
      extensions: [
        {
          name: "blockKatex", level: "block",
          start(src) {
            if (src.startsWith("$$")) return 0;
            const i = src.indexOf("\n$$");
            return i < 0 ? undefined : i + 1;
          },
          tokenizer(src) { const m = blockRule.exec(src); if (m) return { type: "blockKatex", raw: m[0], text: m[1].trim() }; },
          renderer(t) { return render(t.text, true); },
        },
        {
          name: "inlineKatex", level: "inline",
          start(src) { const i = src.indexOf("$"); return i < 0 ? undefined : i; },
          tokenizer(src) { const m = inlineRule.exec(src); if (m) return { type: "inlineKatex", raw: m[0], text: m[1].trim() }; },
          renderer(t) { return render(t.text, false); },
        },
      ],
    });
  }

  function enhance(root) {
    transformCallouts(root);
    renderMermaid(root);
    addCopyButtons(root);
    highlightCode(root);
    setupImages(root);
    linkifyExternal(root);
  }

  function linkifyExternal(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      if (/^https?:/i.test(a.getAttribute("href") || "")) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
    });
  }

  function setupImages(root) {
    root.querySelectorAll("img").forEach((img) => {
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("click", () => openLightbox(img));
      img.addEventListener("error", () => { img.alt = (img.alt || "이미지") + " (불러오기 실패)"; img.classList.add("img-broken"); });
      // wrap a standalone image in <figure> with caption from alt text
      const p = img.parentElement;
      if (p && p.tagName === "P" && p.childNodes.length === 1 && img.alt) {
        const fig = document.createElement("figure");
        const cap = document.createElement("figcaption");
        cap.textContent = img.alt;
        p.replaceWith(fig);
        fig.appendChild(img);
        fig.appendChild(cap);
      }
    });
  }

  let lightbox = null;
  function openLightbox(img) {
    if (!lightbox) {
      lightbox = document.createElement("div");
      lightbox.className = "lightbox";
      lightbox.innerHTML = '<img alt="" /><button class="lightbox-close" aria-label="닫기">✕</button>';
      lightbox.addEventListener("click", () => lightbox.classList.remove("open"));
      document.body.appendChild(lightbox);
    }
    lightbox.querySelector("img").src = img.currentSrc || img.src;
    lightbox.querySelector("img").alt = img.alt || "";
    lightbox.classList.add("open");
  }

  let mermaidReady = null;
  function renderMermaid(root) {
    const blocks = Array.from(root.querySelectorAll("pre > code")).filter(
      (c) => /language-mermaid/.test(c.className || "")
    );
    if (!blocks.length) return;
    const nodes = [];
    blocks.forEach((code) => {
      const div = document.createElement("div");
      div.className = "mermaid";
      div.textContent = code.textContent;
      code.parentElement.replaceWith(div);
      nodes.push(div);
    });
    if (!mermaidReady) mermaidReady = loadScript("assets/vendor/mermaid.min.js");
    mermaidReady.then(() => {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: effectiveDark() ? "dark" : "default",
      });
      return window.mermaid.run({ nodes, suppressErrors: true });
    }).catch(() => { nodes.forEach((n) => (n.textContent = "다이어그램을 불러오지 못했습니다.")); });
  }

  /* GitHub-style admonitions: blockquote starting with [!NOTE] etc. */
  const CALLOUT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
  const CALLOUT_ICON = { note: "ℹ️", tip: "💡", important: "❗", warning: "⚠️", caution: "🛑" };
  function transformCallouts(root) {
    root.querySelectorAll("blockquote").forEach((bq) => {
      const first = bq.querySelector("p");
      if (!first) return;
      const m = (first.textContent || "").match(CALLOUT_RE);
      if (!m) return;
      const kind = m[1].toLowerCase();
      // strip the label, keeping any leading <br> trailing content
      first.innerHTML = first.innerHTML.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?/i, "");
      if (!first.textContent.trim() && !first.querySelector("img,code")) first.remove();
      const box = document.createElement("div");
      box.className = "callout callout-" + kind;
      const head = document.createElement("div");
      head.className = "callout-head";
      head.innerHTML = `<span class="callout-ico">${CALLOUT_ICON[kind]}</span><span>${kind.toUpperCase()}</span>`;
      const body = document.createElement("div");
      body.className = "callout-body";
      while (bq.firstChild) body.appendChild(bq.firstChild);
      box.appendChild(head); box.appendChild(body);
      bq.replaceWith(box);
    });
  }

  const LANG_LABELS = { js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", typescript: "TypeScript", py: "Python", python: "Python", rb: "Ruby", sh: "Shell", bash: "Bash", json: "JSON", html: "HTML", css: "CSS", sql: "SQL", go: "Go", rust: "Rust", c: "C", cpp: "C++", java: "Java", yaml: "YAML", yml: "YAML", md: "Markdown", text: "Text" };
  function addCopyButtons(root) {
    root.querySelectorAll("pre > code").forEach((code) => {
      const pre = code.parentElement;
      if (pre.dataset.copy) return;
      pre.dataset.copy = "1";
      const m = /language-([\w-]+)/.exec(code.className || "");
      if (m && !/^(mermaid|math)$/.test(m[1])) {
        const label = document.createElement("span");
        label.className = "lang-label";
        label.textContent = LANG_LABELS[m[1].toLowerCase()] || m[1];
        pre.appendChild(label);
      }
      const btn = document.createElement("button");
      btn.className = "copy-btn"; btn.type = "button";
      btn.textContent = "복사"; btn.setAttribute("aria-label", "코드 복사");
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code.innerText);
          btn.textContent = "복사됨"; setTimeout(() => (btn.textContent = "복사"), 1400);
        } catch (_) { btn.textContent = "실패"; }
      });
      pre.appendChild(btn);
    });
  }

  let hljsReady = null;
  const hljsLinks = { light: null, dark: null };
  function mkLink(href) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
    return l;
  }
  function syncHljsTheme() {
    if (!hljsLinks.light) return;
    const dark = effectiveDark();
    hljsLinks.light.disabled = dark;
    hljsLinks.dark.disabled = !dark;
  }
  function highlightCode(root) {
    const blocks = Array.from(root.querySelectorAll("pre > code")).filter((c) => {
      const cls = c.className || "";
      return !/language-(mermaid|math)/.test(cls);
    });
    if (!blocks.length) return;
    if (!hljsLinks.light) {
      hljsLinks.light = mkLink("assets/vendor/hljs-styles/github.min.css");
      hljsLinks.dark = mkLink("assets/vendor/hljs-styles/github-dark.min.css");
      syncHljsTheme();
    }
    if (!hljsReady) hljsReady = loadScript("assets/vendor/highlight.min.js");
    hljsReady.then(() => {
      if (!window.hljs) return;
      blocks.forEach((c) => { try { window.hljs.highlightElement(c); } catch (_) {} });
    }).catch(() => {});
  }

  function setActive(name) {
    Array.from(list.children).forEach((li) => {
      const on = li.dataset.name === name;
      li.classList.toggle("active", on);
      if (on) li.setAttribute("aria-current", "page"); else li.removeAttribute("aria-current");
    });
  }

  async function openFile(name) {
    const file = files.find((f) => f.name === name) || files[0];
    if (!file) return;
    currentDoc = null; // pause scroll saving during transition
    setActive(file.name);
    titleEl.textContent = file.title || file.name;
    content.innerHTML = '<p class="placeholder">불러오는 중…</p>';
    closeDrawer();
    try {
      let raw;
      if (pendingEditedText && pendingEditedText.name === file.name) {
        raw = pendingEditedText.text; pendingEditedText = null;
      } else {
        const res = await fetch(file.path, { cache: "no-cache" });
        if (!res.ok) throw new Error(res.status);
        raw = await res.text();
      }
      const { meta, body } = parseFrontmatter(raw);
      if (meta.title) titleEl.textContent = meta.title;
      let text = body;
      if (/\$\$?[^\s$]/.test(text)) { try { await loadKatex(); } catch (_) {} }
      if (/:[a-z0-9_+-]+:/i.test(text)) { try { await loadEmoji(); } catch (_) {} }
      text = preprocessFootnotes(text);
      render(marked.parse(text));
      insertMeta(content, meta, body);
      buildToc();
      if (pendingSearch) {
        highlightMatches(content, pendingSearch);
        pendingSearch = null;
      } else {
        const saved = parseInt(lsGet(POS_PREFIX + file.name, "0"), 10) || 0;
        window.scrollTo(0, saved);
        setTimeout(() => window.scrollTo(0, saved), 60);
        setTimeout(() => window.scrollTo(0, saved), 350);
      }
    } catch (e) {
      content.innerHTML = '<p class="placeholder">문서를 불러오지 못했습니다.</p>';
      tocHead.hidden = true; tocEl.innerHTML = "";
    }
    currentDoc = file.name;
    lsSet(LAST_KEY, file.name);
    onScroll();
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
    // only treat the hash as a document; in-page anchors (footnotes, etc.)
    // are left to the browser's native scroll.
    if (name && files.some((f) => f.name === name)) openFile(name);
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
    const last = lsGet(LAST_KEY, null);
    const initial = currentFromHash() || (last && files.some((f) => f.name === last) ? last : files[0].name);
    openFile(initial);
  })();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/* ---------------- lazy asset loaders ---------------- */
const _loaded = {};
function loadScript(src) {
  if (_loaded[src]) return _loaded[src];
  _loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
  return _loaded[src];
}
function loadStyle(href, media) {
  if (_loaded["css:" + href]) return;
  _loaded["css:" + href] = true;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = href;
  if (media) l.media = media;
  document.head.appendChild(l);
}
function prefersDark() {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/* ---------------- boot ---------------- */
function reveal() {
  const app = document.getElementById("app");
  app.hidden = false;
  initViewer();
}

if ("serviceWorker" in navigator) {
  const reg = () => navigator.serviceWorker.register("sw.js").catch(() => {});
  if (document.readyState === "complete") reg();
  else window.addEventListener("load", reg);
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
