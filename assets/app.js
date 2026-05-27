"use strict";

/* Pattern hash. Regenerate with: python3 tools/hash_pattern.py <pattern>
   This gate is cosmetic: the markdown files are still publicly fetchable by
   direct URL. The pattern itself is stored only as a PBKDF2 hash. */
const AUTH = { salt: "074566f4abd1ce3f6696046e6d584f2a", iterations: 150000, hash: "21062b9f1e596f6480a1402da018ab1edb36f9bb64a3b60137716fb5886d0a5d" };

const SESSION_KEY = "mdv_unlocked";
const THEME_KEY = "mdv_theme", SCALE_KEY = "mdv_scale", LAST_KEY = "mdv_last", POS_PREFIX = "mdv_pos_";

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
  themeSeg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const t = b.dataset.themeVal;
      lsSet(THEME_KEY, t); applyTheme(t); refreshThemeSeg(); syncHljsTheme();
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
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (getTheme() === "auto") syncHljsTheme(); });
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
    if (!mermaidReady) {
      mermaidReady = loadScript("assets/vendor/mermaid.min.js").then(() => {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: prefersDark() ? "dark" : "default",
        });
      });
    }
    mermaidReady.then(() => window.mermaid.run({ nodes, suppressErrors: true }))
      .catch(() => { nodes.forEach((n) => (n.textContent = "다이어그램을 불러오지 못했습니다.")); });
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
      const res = await fetch(file.path, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const raw = await res.text();
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
