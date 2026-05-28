"use strict";

/* Pattern hash. Regenerate with: python3 tools/hash_pattern.py <pattern>
   This gate is cosmetic: the markdown files are still publicly fetchable by
   direct URL. The pattern itself is stored only as a PBKDF2 hash. */
const AUTH = { salt: "074566f4abd1ce3f6696046e6d584f2a", iterations: 150000, hash: "21062b9f1e596f6480a1402da018ab1edb36f9bb64a3b60137716fb5886d0a5d" };

const SESSION_KEY = "mdv_unlocked";
const THEME_KEY = "mdv_theme", SCALE_KEY = "mdv_scale", LAST_KEY = "mdv_last", POS_PREFIX = "mdv_pos_";
const TOKEN_KEY = "mdv_gh_token", DRAFT_PREFIX = "mdv_draft_";
const SORT_KEY = "mdv_sort", RECENT_KEY = "mdv_recent", PINS_KEY = "mdv_pins";
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
async function ghPutContent(path, contentBase64, sha, message) {
  const body = { message, content: contentBase64, branch: REPO.branch };
  if (sha) body.sha = sha;
  const r = await fetch(ghContentsUrl(path), { method: "PUT", headers: { ...ghHeaders(true), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("PUT " + r.status + " " + t.slice(0, 200)); }
  const j = await r.json();
  return { sha: j.content && j.content.sha };
}
async function ghPut(path, text, sha, message) {
  return ghPutContent(path, b64encodeUtf8(text), sha, message);
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
function getScale() { return Math.min(2.2, Math.max(0.7, parseFloat(lsGet(SCALE_KEY, "1")) || 1)); }
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
    // make tag pills clickable: filter drawer by that tag
    node.querySelectorAll(".tag").forEach((t) => {
      t.style.cursor = "pointer";
      t.title = "이 태그로 필터";
      t.addEventListener("click", (e) => {
        e.preventDefault();
        const txt = (t.textContent || "").replace(/^#/, "").trim();
        if (!txt) return;
        activeTag = txt;
        buildList(); setActive(currentDoc);
        openDrawer();
      });
    });
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
    loadAllTags();
  }

  /* ---- drawer tabs (문서 / 목차) ---- */
  const TAB_KEY = "mdv_drawer_tab";
  function activateDrawerTab(name) {
    document.querySelectorAll(".drawer-tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".drawer-panel").forEach((p) => {
      p.hidden = p.dataset.panel !== name;
    });
    lsSet(TAB_KEY, name);
  }
  document.querySelectorAll(".drawer-tab").forEach((t) => {
    t.addEventListener("click", () => activateDrawerTab(t.dataset.tab));
  });
  activateDrawerTab(lsGet(TAB_KEY, "files"));

  let tagsPromise = null;
  function loadAllTags() {
    if (tagsPromise) return tagsPromise;
    tagsPromise = (async () => {
      try { await ensureAllDocs(); } catch (_) {}
      files.forEach((f) => {
        const text = docText[f.name]; if (!text) return;
        const { meta, body } = parseFrontmatter(text);
        if (meta.tags) f.tags = Array.isArray(meta.tags) ? meta.tags : [meta.tags];
        f.readingMin = readingStats(body).minutes;
      });
      buildList();
      updateDrawerStat();
      if (currentDoc) appendRelated();
    })();
    return tagsPromise;
  }

  function appendRelated() {
    if (!currentDoc) return;
    const me = files.find((f) => f.name === currentDoc); if (!me) return;
    const myTags = me.tags || [];
    const meText = docText[currentDoc] || "";
    const related = files.filter((o) => {
      if (o.name === currentDoc) return false;
      const sharedTags = (o.tags || []).some((t) => myTags.includes(t));
      const mentionsMe = docText[o.name] && docText[o.name].includes(currentDoc);
      const meMentionsThem = meText && meText.includes(o.name);
      return sharedTags || mentionsMe || meMentionsThem;
    });
    content.querySelectorAll(".related-docs").forEach((n) => n.remove());
    if (!related.length) return;
    const section = document.createElement("section");
    section.className = "related-docs";
    section.innerHTML = "<h3>관련 문서</h3><ul>" + related.slice(0, 6).map((r) => {
      const why = (r.tags || []).filter((t) => myTags.includes(t));
      const whyHtml = why.length ? '<span class="related-why">' + why.map((t) => "#" + escapeHtml(t)).join(" ") + "</span>" : "";
      return '<li><a data-name="' + escapeHtml(r.name) + '">' + escapeHtml(r.title || r.name) + "</a>" + whyHtml + "</li>";
    }).join("") + "</ul>";
    section.querySelectorAll("a[data-name]").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); openFile(a.dataset.name); });
    });
    content.appendChild(section);
  }
  function updateDrawerStat() {
    const el = document.getElementById("drawer-stat"); if (!el) return;
    const docs = files.length;
    const total = files.reduce((s, f) => s + (f.readingMin || 0), 0);
    if (!docs) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `📚 <strong>${docs}</strong> 문서` + (total ? ` · ⏱ 약 <strong>${total}</strong>분` : "");
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
  // setZoom is defined later (function declaration; hoisted within initViewer)
  document.getElementById("font-dec").addEventListener("click", () => setZoom(getScale() - 0.1, true));
  document.getElementById("font-inc").addEventListener("click", () => setZoom(getScale() + 0.1, true));
  document.getElementById("font-reset").addEventListener("click", () => setZoom(1, true));
  const spellcheckToggle = document.getElementById("spellcheck-toggle");
  spellcheckToggle.checked = lsGet("mdv_spellcheck", "0") === "1";
  const applySpellcheck = () => {
    const ta = document.getElementById("editor-textarea");
    if (ta) ta.spellcheck = spellcheckToggle.checked;
  };
  applySpellcheck();
  spellcheckToggle.addEventListener("change", () => {
    lsSet("mdv_spellcheck", spellcheckToggle.checked ? "1" : "0");
    applySpellcheck();
  });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (getTheme() === "auto") onThemeChanged(); });
  }

  /* ---- search: title + full text ---- */
  const filter = document.getElementById("filter");
  const searchResults = document.getElementById("search-results");
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
  document.getElementById("download-btn").addEventListener("click", async () => {
    settings.hidden = true;
    if (!currentDoc) return;
    let text = "";
    if (editingState && editingState.name === currentDoc) text = editorTextarea.value;
    else if (docText[currentDoc]) text = docText[currentDoc];
    else {
      const file = files.find((f) => f.name === currentDoc);
      if (file) { try { const r = await fetch(file.path, { cache: "no-cache" }); text = await r.text(); } catch (_) {} }
    }
    if (!text) { toast("다운로드할 본문이 없습니다"); return; }
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = currentDoc; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("다운로드 시작");
  });

  /* ---- GitHub token field ---- */
  const tokenInput = document.getElementById("gh-token");
  const tokenClearBtn = document.getElementById("gh-token-clear");
  tokenInput.value = getToken();
  tokenInput.addEventListener("input", () => { lsSet(TOKEN_KEY, tokenInput.value.trim()); });
  tokenClearBtn.addEventListener("click", () => { tokenInput.value = ""; lsSet(TOKEN_KEY, ""); toast("토큰을 삭제했습니다"); });

  const shortcutsPop = document.getElementById("shortcuts-pop");
  document.getElementById("show-shortcuts").addEventListener("click", () => {
    settings.hidden = true;
    shortcutsPop.hidden = false;
  });
  const installBtn = document.getElementById("install-pwa");
  if (_installPrompt) installBtn.hidden = false;
  installBtn.addEventListener("click", async () => {
    settings.hidden = true;
    if (!_installPrompt) { toast("이미 설치되었거나 지원되지 않는 브라우저입니다"); return; }
    _installPrompt.prompt();
    await _installPrompt.userChoice;
    _installPrompt = null;
    installBtn.hidden = true;
  });
  document.getElementById("shortcuts-close").addEventListener("click", () => { shortcutsPop.hidden = true; });
  document.addEventListener("click", (e) => {
    if (shortcutsPop.hidden) return;
    if (shortcutsPop.contains(e.target)) return;
    if (e.target.closest && e.target.closest("#show-shortcuts")) return;
    shortcutsPop.hidden = true;
  });

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
    const ms = document.getElementById("editor-msg");
    if (ms) ms.textContent = msg || "";
    editorStatus.className = "editor-status" + (kind ? " " + kind : "");
  }
  function lintMarkdown(v) {
    const w = [];
    if ((v.match(/^```/gm) || []).length % 2) w.push("``` 미종료");
    if ((v.match(/^\$\$/gm) || []).length % 2) w.push("$$ 미종료");
    if (/^[ \t]*#+\s*$/m.test(v)) w.push("빈 헤딩");
    if (/!\[\s*\]\(\s*\)/.test(v)) w.push("빈 이미지");
    return w;
  }
  function updateEditorInfo() {
    const info = document.getElementById("editor-info"); if (!info) return;
    const ta = editorTextarea, v = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    let head = "";
    const issues = lintMarkdown(v);
    if (issues.length) head = `<span class="lint-warn">⚠ ${escapeHtml(issues[0])}${issues.length > 1 ? " +" + (issues.length - 1) : ""}</span> · `;
    if (s !== e) {
      const sel = v.slice(s, e);
      const cjkS = (sel.match(/[가-힣]/g) || []).length;
      const wordsS = (sel.replace(/[가-힣]/g, " ").match(/\b[\w'-]+\b/g) || []).length;
      info.innerHTML = head + `선택 ${sel.length.toLocaleString()} 자 · ${(wordsS + cjkS).toLocaleString()} 단어`;
      return;
    }
    const pos = s;
    const before = v.slice(0, pos);
    const line = (before.match(/\n/g) || []).length + 1;
    const col = pos - (before.lastIndexOf("\n") + 1) + 1;
    const cjk = (v.match(/[가-힣]/g) || []).length;
    const words = (v.replace(/[가-힣]/g, " ").match(/\b[\w'-]+\b/g) || []).length;
    info.innerHTML = head + `행 ${line} · ${col}열 · ${(words + cjk).toLocaleString()} 단어 · ${v.length.toLocaleString()} 자`;
  }
  ["input", "keyup", "click", "select"].forEach((evName) =>
    editorTextarea.addEventListener(evName, updateEditorInfo)
  );
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === editorTextarea) updateEditorInfo();
  });

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
      updateEditorInfo();
    } catch (e) {
      setEditorStatus("불러오기 실패: " + e.message, "error");
    }
  }

  function exitEditMode(discardDraft) {
    if (editingState && discardDraft) lsSet(DRAFT_PREFIX + editingState.name, "");
    editingState = null;
    document.body.classList.remove("editing");
    editorEl.hidden = true; content.hidden = false;
    // reset preview mode and meta form
    if (editorTextarea && editorTextarea.parentElement) editorTextarea.parentElement.classList.remove("preview-on");
    const pBtn = editorToolbar && editorToolbar.querySelector('[data-action="preview"]');
    if (pBtn) pBtn.classList.remove("on");
    const mf = document.getElementById("meta-form"); if (mf) mf.hidden = true;
    const fb = document.getElementById("find-bar"); if (fb) fb.hidden = true;
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
      const customMsgEl = document.getElementById("commit-msg");
      const customMsg = customMsgEl ? customMsgEl.value.trim() : "";
      const message = customMsg || "docs: update " + editingState.name;
      const { sha } = await ghPut(editingState.path, text, editingState.sha, message);
      if (customMsgEl) customMsgEl.value = "";
      editingState.sha = sha;
      editingState.original = text;
      lsSet(DRAFT_PREFIX + editingState.name, "");
      docText[editingState.name] = text;
      saveEditBtn.classList.remove("has-changes");
      const name = editingState.name;
      pendingEditedText = { name, text };
      exitEditMode(false);
      const ts = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      toast(ts + " 저장됨 — 라이브 반영 약 1분");
      openFile(name);
    } catch (e) {
      // refresh sha so retry succeeds even after concurrent edits
      try { const g = await ghGet(editingState.path); editingState.sha = g.sha; } catch (_) {}
      setEditorStatus("저장 실패: " + e.message + " (다시 시도 시 최신 위로 덮어씁니다)", "error");
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
  let livePreviewTimer = 0;
  editorTextarea.addEventListener("input", () => {
    if (!editingState) return;
    saveEditBtn.classList.toggle("has-changes", editorTextarea.value !== editingState.original);
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => lsSet(DRAFT_PREFIX + editingState.name, editorTextarea.value), 600);
    if (previewOn()) {
      clearTimeout(livePreviewTimer);
      livePreviewTimer = setTimeout(renderPreview, 350);
    }
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
  function previewOn() { return editorTextarea.parentElement.classList.contains("preview-on"); }
  function togglePreview() {
    const btn = editorToolbar.querySelector('[data-action="preview"]');
    const stack = editorTextarea.parentElement;
    if (previewOn()) {
      stack.classList.remove("preview-on");
      btn.classList.remove("on");
      editorTextarea.focus();
    } else {
      stack.classList.add("preview-on");
      btn.classList.add("on");
      renderPreview();
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
      const last = lsGet("mdv_last_lang", "");
      const lang = (prompt("언어 (예: javascript, python, rust — 빈칸 가능)", last) || "").trim().toLowerCase();
      lsSet("mdv_last_lang", lang);
      const { s, e: ee, v } = selRange();
      const sel = v.slice(s, ee) || "코드";
      const fence = "\n```" + lang + "\n" + sel + "\n```\n";
      const caretAt = s + 4 + lang.length + 1; // newline + 3 ticks + lang + newline
      insertAt(s, ee, fence, caretAt, caretAt + sel.length);
    } else if (a === "link") {
      const url = prompt("URL을 입력하세요", "https://");
      if (url) applyWrap("[", "](" + url + ")", "텍스트");
    } else if (a === "image") {
      const url = prompt("이미지 URL", "https://");
      if (url) applyInsert("![설명](" + url + ")");
    } else if (a === "snip-table") {
      applyInsert("\n\n| 열1 | 열2 | 열3 |\n| --- | --- | --- |\n| a | b | c |\n| d | e | f |\n\n");
    } else if (a === "snip-callout") {
      applyInsert("\n\n> [!NOTE]\n> 메모 내용을 여기 작성하세요.\n\n");
    } else if (a === "snip-mermaid") {
      applyInsert("\n\n```mermaid\nflowchart LR\n  A[시작] --> B{조건}\n  B -- 예 --> C[성공]\n  B -- 아니오 --> D[실패]\n```\n\n");
    } else if (a === "snip-math") {
      applyInsert("\n\n$$\n수식 = \\frac{a}{b}\n$$\n\n");
    } else if (a === "snip-details") {
      applyInsert("\n\n<details>\n<summary>제목</summary>\n\n숨겨진 내용\n\n</details>\n\n");
    } else if (a === "meta") toggleMetaForm();
    else if (a === "outline") toggleOutline();
    else if (a === "history") toggleHistory();
    else if (a === "diff") showDiff();
    else if (a === "format") formatMarkdown();
    else if (a === "preview") togglePreview();
    else if (a === "delete") deleteDoc();
  });

  /* ---- frontmatter form ---- */
  const metaForm = document.getElementById("meta-form");
  const metaTitle = document.getElementById("meta-title");
  const metaDate = document.getElementById("meta-date");
  const metaTags = document.getElementById("meta-tags");
  function yamlValue(s) {
    s = String(s);
    if (/^[\w가-힣 .,_-]+$/.test(s) && !/^\d/.test(s) && !/^(true|false|null|yes|no)$/i.test(s)) return s;
    return JSON.stringify(s);
  }
  function writeFrontmatter(meta, body) {
    const keys = Object.keys(meta).filter((k) => meta[k] != null && meta[k] !== "" && !(Array.isArray(meta[k]) && !meta[k].length));
    if (!keys.length) return body.replace(/^\n+/, "");
    const lines = ["---"];
    if (meta.title) lines.push("title: " + yamlValue(meta.title));
    if (meta.date) lines.push("date: " + meta.date);
    if (meta.tags && meta.tags.length) lines.push("tags: [" + meta.tags.map(yamlValue).join(", ") + "]");
    Object.keys(meta).forEach((k) => {
      if (k === "title" || k === "date" || k === "tags") return;
      const v = meta[k]; if (v == null || v === "") return;
      lines.push(k + ": " + (Array.isArray(v) ? "[" + v.map(yamlValue).join(", ") + "]" : yamlValue(v)));
    });
    lines.push("---");
    return lines.join("\n") + "\n" + body.replace(/^\n+/, "");
  }
  function loadMetaForm() {
    const { meta } = parseFrontmatter(editorTextarea.value);
    metaTitle.value = meta.title || "";
    metaDate.value = (meta.date && /^\d{4}-\d{2}-\d{2}/.test(meta.date)) ? meta.date.slice(0, 10) : "";
    metaTags.value = Array.isArray(meta.tags) ? meta.tags.join(", ") : (meta.tags || "");
  }
  function toggleMetaForm() {
    if (metaForm.hidden) { loadMetaForm(); metaForm.hidden = false; metaTitle.focus(); }
    else metaForm.hidden = true;
  }
  let metaTimer = 0;
  function commitMetaForm() {
    const v = editorTextarea.value;
    const { meta: existing, body } = parseFrontmatter(v);
    const next = { ...existing };
    next.title = metaTitle.value.trim() || undefined;
    next.date = metaDate.value.trim() || undefined;
    const tags = metaTags.value.split(",").map((s) => s.trim()).filter(Boolean);
    next.tags = tags.length ? tags : undefined;
    const newText = writeFrontmatter(next, body);
    if (newText === v) return;
    editorTextarea.focus();
    editorTextarea.setSelectionRange(0, v.length);
    const ok = document.execCommand && document.execCommand("insertText", false, newText);
    if (!ok) { editorTextarea.value = newText; dispatchInput(); }
    // restore caret to start of body for sanity
    const bodyStart = newText.length - body.replace(/^\n+/, "").length;
    setSel(bodyStart);
  }
  function onMetaInput() {
    clearTimeout(metaTimer);
    metaTimer = setTimeout(commitMetaForm, 350);
  }
  [metaTitle, metaDate, metaTags].forEach((el) => el.addEventListener("input", onMetaInput));

  const outlinePop = document.getElementById("outline-pop");
  const outlineList = document.getElementById("outline-list");
  function toggleOutline() {
    if (!outlinePop.hidden) { outlinePop.hidden = true; return; }
    const v = editorTextarea.value;
    const lines = v.split("\n");
    const heads = [];
    let pos = 0;
    for (const line of lines) {
      const m = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
      if (m) heads.push({ level: m[1].length, text: m[2], start: pos });
      pos += line.length + 1;
    }
    outlineList.innerHTML = "";
    if (!heads.length) {
      const li = document.createElement("li"); li.className = "empty";
      li.textContent = "이 문서에는 제목(# / ## / ###)이 없습니다.";
      outlineList.appendChild(li);
    } else {
      heads.forEach((h) => {
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = "#"; a.className = "l" + h.level; a.textContent = h.text;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          editorTextarea.focus();
          editorTextarea.setSelectionRange(h.start, h.start);
          // force scroll by re-applying focus
          editorTextarea.blur(); editorTextarea.focus();
          outlinePop.hidden = true;
        });
        li.appendChild(a); outlineList.appendChild(li);
      });
    }
    outlinePop.hidden = false;
  }
  document.addEventListener("click", (e) => {
    if (outlinePop.hidden) return;
    if (outlinePop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('[data-action="outline"]')) return;
    outlinePop.hidden = true;
  });

  /* ---- commit history viewer ---- */
  const historyPop = document.getElementById("history-pop");
  const historyList = document.getElementById("history-list");
  async function toggleHistory() {
    if (!historyPop.hidden) { historyPop.hidden = true; return; }
    if (!editingState) return;
    setEditorStatus("이력을 불러오는 중…");
    try {
      const url = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/commits?path=${encodeURIComponent(editingState.path)}&per_page=15&sha=${encodeURIComponent(REPO.branch)}`;
      const r = await fetch(url, { headers: ghHeaders(false) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const commits = await r.json();
      historyList.innerHTML = "";
      if (!commits.length) {
        const li = document.createElement("li"); li.className = "empty";
        li.textContent = "이력이 없습니다."; historyList.appendChild(li);
      } else {
        commits.forEach((c) => {
          const li = document.createElement("li");
          const a = document.createElement("a"); a.href = c.html_url || "#"; a.target = "_blank"; a.rel = "noopener";
          const msg = (c.commit && c.commit.message || "").split("\n")[0];
          const author = c.commit && c.commit.author && c.commit.author.name || "";
          const dt = c.commit && c.commit.author && c.commit.author.date ? new Date(c.commit.author.date).toLocaleString("ko-KR") : "";
          a.innerHTML = "<strong>" + escapeHtml(msg) + "</strong>" + '<span class="hist-meta">' + escapeHtml(author) + (dt ? " · " + escapeHtml(dt) : "") + "</span>";
          li.appendChild(a); historyList.appendChild(li);
        });
      }
      historyPop.hidden = false;
      setEditorStatus("");
    } catch (e) {
      setEditorStatus("이력 불러오기 실패: " + e.message, "error");
    }
  }
  document.addEventListener("click", (e) => {
    if (historyPop.hidden) return;
    if (historyPop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('[data-action="history"]')) return;
    historyPop.hidden = true;
  });

  function formatMarkdown() {
    const v = editorTextarea.value;
    const next = v
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+$/, "\n");
    if (next === v) { toast("이미 정돈되어 있습니다"); return; }
    editorTextarea.focus();
    editorTextarea.setSelectionRange(0, v.length);
    const ok = document.execCommand && document.execCommand("insertText", false, next);
    if (!ok) { editorTextarea.value = next; dispatchInput(); }
    toast("정돈 완료");
  }

  /* ---- diff viewer (current edits vs original) ---- */
  function lineDiff(a, b) {
    const A = a.split("\n"), B = b.split("\n");
    const m = A.length, n = B.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
      dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
    const out = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) { out.unshift({ t: "same", v: A[i - 1] }); i--; j--; }
      else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { out.unshift({ t: "add", v: B[j - 1] }); j--; }
      else if (i > 0) { out.unshift({ t: "del", v: A[i - 1] }); i--; }
    }
    return out;
  }
  function showDiff() {
    const pop = document.getElementById("diff-pop");
    const body = document.getElementById("diff-body");
    if (!editingState) { toast("편집 중이 아닙니다"); return; }
    const diff = lineDiff(editingState.original, editorTextarea.value);
    const changed = diff.filter((d) => d.t !== "same").length;
    if (!changed) {
      body.innerHTML = '<div class="diff-empty">변경 사항이 없습니다.</div>';
    } else {
      // collapse long stretches of unchanged lines
      const out = [];
      for (let i = 0; i < diff.length; i++) {
        if (diff[i].t === "same") {
          const start = i;
          while (i < diff.length && diff[i].t === "same") i++;
          const run = diff.slice(start, i);
          if (run.length <= 4) run.forEach((r) => out.push(r));
          else { out.push(run[0]); out.push({ t: "ellipsis", v: `… ${run.length - 2}줄 동일 …` }); out.push(run[run.length - 1]); }
          i--;
        } else {
          out.push(diff[i]);
        }
      }
      const sym = { add: "+", del: "−", same: " ", ellipsis: " " };
      body.innerHTML = out.map((d) => `<div class="diff-line ${d.t}">${sym[d.t]} ${escapeHtml(d.v)}</div>`).join("");
    }
    pop.hidden = false;
  }
  document.getElementById("diff-close").addEventListener("click", () => { document.getElementById("diff-pop").hidden = true; });
  document.addEventListener("click", (e) => {
    const pop = document.getElementById("diff-pop"); if (!pop || pop.hidden) return;
    if (pop.contains(e.target)) return;
    if (e.target.closest && e.target.closest('[data-action="diff"]')) return;
    pop.hidden = true;
  });

  /* ---- find / replace in editor ---- */
  const findBar = document.getElementById("find-bar");
  const findInput = document.getElementById("find-input");
  const replaceInput = document.getElementById("replace-input");
  const findCount = document.getElementById("find-count");
  function openFind() {
    findBar.hidden = false;
    const { s, e, v } = selRange();
    if (s !== e) findInput.value = v.slice(s, e);
    findInput.focus(); findInput.select();
    updateFindCount();
  }
  function closeFind() { findBar.hidden = true; editorTextarea.focus(); }
  function findStep(dir) {
    const q = findInput.value;
    if (!q) return;
    const v = editorTextarea.value;
    const sel = selRange();
    let idx;
    if (dir > 0) {
      const start = sel.s === sel.e ? sel.e : sel.e;
      idx = v.indexOf(q, start);
      if (idx < 0) idx = v.indexOf(q, 0);
    } else {
      const start = sel.s - 1;
      idx = v.lastIndexOf(q, start);
      if (idx < 0) idx = v.lastIndexOf(q);
    }
    if (idx >= 0) {
      editorTextarea.focus();
      editorTextarea.setSelectionRange(idx, idx + q.length);
      editorTextarea.blur(); editorTextarea.focus();
      // refocus find input for continued navigation typing
      setTimeout(() => findInput.focus(), 0);
    }
  }
  function updateFindCount() {
    const q = findInput.value, v = editorTextarea.value;
    if (!q) { findCount.textContent = ""; return; }
    let n = 0, i = 0;
    while ((i = v.indexOf(q, i)) >= 0) { n++; i += Math.max(q.length, 1); }
    findCount.textContent = n + "개";
  }
  function replaceOne() {
    const q = findInput.value, r = replaceInput.value;
    if (!q) return;
    const sel = selRange();
    if (sel.v.slice(sel.s, sel.e) === q) {
      insertAt(sel.s, sel.e, r, sel.s + r.length);
    }
    findStep(1);
    updateFindCount();
  }
  function replaceAll() {
    const q = findInput.value, r = replaceInput.value;
    if (!q) return;
    const v = editorTextarea.value;
    const next = v.split(q).join(r);
    if (next === v) return;
    editorTextarea.focus();
    editorTextarea.setSelectionRange(0, v.length);
    const ok = document.execCommand && document.execCommand("insertText", false, next);
    if (!ok) { editorTextarea.value = next; dispatchInput(); }
    updateFindCount();
  }
  findInput.addEventListener("input", updateFindCount);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); replaceOne(); }
    else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
  });
  findBar.addEventListener("click", (e) => {
    const a = e.target && e.target.dataset && e.target.dataset.find;
    if (!a) return;
    if (a === "next") findStep(1);
    else if (a === "prev") findStep(-1);
    else if (a === "one") replaceOne();
    else if (a === "all") replaceAll();
    else if (a === "close") closeFind();
  });
  // Ctrl/Cmd+F to open in edit mode
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F") && document.body.classList.contains("editing")) {
      e.preventDefault(); openFind();
    }
  });

  /* ---- slash commands ---- */
  const slashPop = document.getElementById("slash-pop");
  const slashList = document.getElementById("slash-list");
  const SLASH_CMDS = [
    { id: "h1", label: "H1 제목", keys: ["h1","heading","제목"], insert: "# 제목\n" },
    { id: "h2", label: "H2 부제목", keys: ["h2","heading"], insert: "## 부제목\n" },
    { id: "h3", label: "H3 소제목", keys: ["h3","heading"], insert: "### 소제목\n" },
    { id: "bold", label: "굵게", keys: ["b","bold","굵게"], insert: "**굵게**" },
    { id: "italic", label: "기울임", keys: ["i","italic","기울임"], insert: "*기울임*" },
    { id: "ul", label: "글머리 목록", keys: ["ul","list","목록"], insert: "- 항목\n" },
    { id: "ol", label: "번호 목록", keys: ["ol","number","번호"], insert: "1. 항목\n" },
    { id: "task", label: "체크리스트", keys: ["task","todo","체크"], insert: "- [ ] 항목\n" },
    { id: "quote", label: "인용문", keys: ["quote","인용"], insert: "> 인용\n" },
    { id: "code", label: "코드 블록", keys: ["code","코드"], insert: "```\n코드\n```\n" },
    { id: "table", label: "표", keys: ["table","표"], insert: "| 열1 | 열2 |\n| --- | --- |\n| a | b |\n" },
    { id: "mermaid", label: "다이어그램 (Mermaid)", keys: ["mermaid","diagram","다이어그램"], insert: "```mermaid\nflowchart LR\nA --> B\n```\n" },
    { id: "math", label: "수식 블록 (KaTeX)", keys: ["math","수식","katex"], insert: "$$\n수식\n$$\n" },
    { id: "callout-note", label: "콜아웃: NOTE", keys: ["note","callout","콜아웃"], insert: "> [!NOTE]\n> 메모\n" },
    { id: "callout-tip", label: "콜아웃: TIP", keys: ["tip","callout"], insert: "> [!TIP]\n> 팁\n" },
    { id: "callout-warning", label: "콜아웃: WARNING", keys: ["warning","callout","주의"], insert: "> [!WARNING]\n> 주의\n" },
    { id: "details", label: "접기/펼치기", keys: ["details","collapse","접기"], insert: "<details>\n<summary>제목</summary>\n\n내용\n\n</details>\n" },
    { id: "hr", label: "구분선", keys: ["hr","divider","구분"], insert: "---\n" },
    { id: "today", label: "오늘 날짜", keys: ["date","today","날짜"], insert: () => new Date().toISOString().slice(0, 10) },
    { id: "now", label: "현재 시각", keys: ["time","now","시각"], insert: () => new Date().toLocaleString("ko-KR") },
    { id: "tpl-note", label: "템플릿: 메모", keys: ["template","note","메모","tpl"], insert: () => "## 핵심\n\n- \n\n## 상세\n\n" },
    { id: "tpl-todo", label: "템플릿: 할 일", keys: ["template","todo","할일","tpl"], insert: () => "## 할 일\n\n- [ ] \n- [ ] \n- [ ] \n" },
    { id: "tpl-journal", label: "템플릿: 일지", keys: ["template","journal","일지","tpl"], insert: () => `## ${new Date().toISOString().slice(0, 10)}\n\n### 오늘 한 일\n\n- \n\n### 내일 할 일\n\n- [ ] \n` },
  ];

  let slashStart = -1; // textarea position of the leading "/"
  let slashFiltered = []; let slashIndex = 0;

  function detectSlash() {
    if (!document.body.classList.contains("editing")) { hideSlash(); return; }
    const pos = editorTextarea.selectionStart;
    const v = editorTextarea.value;
    // walk back over word/Korean chars
    let i = pos;
    while (i > 0 && /[\w가-힣]/.test(v[i - 1])) i--;
    if (i === 0 || v[i - 1] !== "/") { hideSlash(); return; }
    const slashPos = i - 1;
    if (slashPos !== 0 && v[slashPos - 1] !== "\n") { hideSlash(); return; }
    slashStart = slashPos;
    const query = v.slice(slashPos + 1, pos).toLowerCase();
    const items = SLASH_CMDS.filter((c) =>
      !query || c.id.startsWith(query) || c.label.toLowerCase().includes(query) || c.keys.some((k) => k.startsWith(query))
    );
    if (!items.length) { hideSlash(); return; }
    slashFiltered = items;
    slashIndex = 0;
    renderSlash();
    slashPop.hidden = false;
  }
  function renderSlash() {
    slashList.innerHTML = "";
    slashFiltered.forEach((c, idx) => {
      const li = document.createElement("li");
      if (idx === slashIndex) li.setAttribute("aria-selected", "true");
      const a = document.createElement("a");
      a.href = "#";
      a.innerHTML = escapeHtml(c.label) + '<span class="slash-hint">/' + escapeHtml(c.id) + "</span>";
      a.addEventListener("mousedown", (e) => { e.preventDefault(); slashIndex = idx; commitSlash(); });
      li.appendChild(a); slashList.appendChild(li);
    });
  }
  function hideSlash() { slashPop.hidden = true; slashStart = -1; }
  function commitSlash() {
    const c = slashFiltered[slashIndex]; if (!c) return;
    const pos = editorTextarea.selectionStart;
    const replacement = typeof c.insert === "function" ? c.insert() : c.insert;
    insertAt(slashStart, pos, replacement, slashStart + replacement.length);
    hideSlash();
  }

  editorTextarea.addEventListener("input", detectSlash);
  editorTextarea.addEventListener("keyup", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) detectSlash();
  });
  editorTextarea.addEventListener("blur", () => setTimeout(hideSlash, 120));
  editorTextarea.addEventListener("keydown", (e) => {
    if (slashPop.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); slashIndex = (slashIndex + 1) % slashFiltered.length; renderSlash(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); slashIndex = (slashIndex - 1 + slashFiltered.length) % slashFiltered.length; renderSlash(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commitSlash(); }
    else if (e.key === "Escape") { e.preventDefault(); hideSlash(); }
  });

  async function createShareDoc({ title, text, url }) {
    if (!getToken()) { setTimeout(() => { settings.hidden = false; tokenInput.focus(); }, 0); toast("공유 내용을 저장하려면 토큰이 필요합니다"); return; }
    const base = (title || "공유").replace(/[^\w가-힣 .,_-]/g, "").trim().slice(0, 40) || "shared";
    let name = base + ".md";
    if (files.some((f) => f.name === name)) name = base + "-" + Date.now() + ".md";
    const today = new Date().toISOString().slice(0, 10);
    const parts = [];
    if (text) parts.push(text);
    if (url) parts.push("\n[원문 링크](" + url + ")");
    const tpl = "---\ndate: " + today + "\ntags: [공유]\n---\n\n# " + (title || "공유 메모") + "\n\n" + parts.join("\n\n") + "\n";
    try {
      const { sha } = await ghPut("content/" + name, tpl, null, "docs: share " + name);
      const f = { name, path: "content/" + name, title: title || name, size: tpl.length };
      files.push(f); files.sort((a, b) => a.name.localeCompare(b.name));
      buildList();
      pendingEditedText = { name, text: tpl };
      openFile(name);
      toast("공유한 내용을 저장했습니다");
      lsSet(LAST_KEY, name);
    } catch (e) { toast("공유 저장 실패: " + e.message); }
  }

  async function newDoc() {
    let name = prompt("새 문서 파일명 (예: notes.md)", "");
    if (!name) return;
    name = name.trim();
    if (!/^[\w가-힣 .,_-]+$/.test(name)) { toast("파일명에 사용할 수 없는 문자가 있습니다"); return; }
    if (!/\.md$/i.test(name)) name += ".md";
    if (files.some((f) => f.name === name)) { toast("이미 존재하는 파일명입니다"); return; }
    if (!getToken()) { setTimeout(() => { settings.hidden = false; tokenInput.focus(); }, 0); toast("토큰을 먼저 입력하세요"); return; }
    const title = name.replace(/\.md$/i, "");
    const today = new Date().toISOString().slice(0, 10);
    const tpl = "---\ndate: " + today + "\n---\n\n# " + title + "\n\n";
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

  async function renameDoc() {
    if (!editingState) return;
    let newName = prompt("새 파일명", editingState.name);
    if (!newName) return;
    newName = newName.trim();
    if (newName === editingState.name) return;
    if (!/^[\w가-힣 .,_-]+$/.test(newName)) { toast("파일명에 사용할 수 없는 문자가 있습니다"); return; }
    if (!/\.md$/i.test(newName)) newName += ".md";
    if (files.some((f) => f.name === newName)) { toast("이미 존재하는 파일명입니다"); return; }
    if (!getToken()) { setTimeout(() => { settings.hidden = false; tokenInput.focus(); }, 0); toast("토큰이 필요합니다"); return; }
    setEditorStatus("이름 변경 중…");
    try {
      const oldName = editingState.name;
      const newPath = "content/" + newName;
      const text = editorTextarea.value;
      const { sha: newSha } = await ghPut(newPath, text, null, "docs: rename " + oldName + " → " + newName);
      if (!editingState.sha) { const g = await ghGet(editingState.path); editingState.sha = g.sha; }
      await ghDelete(editingState.path, editingState.sha, "docs: remove " + oldName);
      const oldIdx = files.findIndex((f) => f.name === oldName);
      if (oldIdx >= 0) files.splice(oldIdx, 1);
      const f = { name: newName, path: newPath, title: newName.replace(/\.md$/i, ""), size: text.length };
      files.push(f); files.sort((a, b) => a.name.localeCompare(b.name));
      delete docText[oldName]; docText[newName] = text;
      lsSet(DRAFT_PREFIX + oldName, "");
      if (lsGet(LAST_KEY, "") === oldName) lsSet(LAST_KEY, newName);
      editingState.name = newName;
      editingState.path = newPath;
      editingState.sha = newSha;
      editingState.original = text;
      saveEditBtn.classList.remove("has-changes");
      titleEl.textContent = f.title;
      buildList();
      currentDoc = newName;
      history.replaceState(null, "", "#" + encodeURIComponent(newName));
      setEditorStatus("이름 변경됨 — 라이브 반영은 약 1분", "ok");
    } catch (e) {
      setEditorStatus("이름 변경 실패: " + e.message, "error");
    }
  }
  // Tap topbar title in edit mode to rename
  titleEl.addEventListener("click", () => {
    if (!document.body.classList.contains("editing")) return;
    renameDoc();
  });

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

  /* ---- smart paste: URL→link, image→upload ---- */
  editorTextarea.addEventListener("paste", (ev) => {
    if (!ev.clipboardData) return;
    // image first
    for (const it of ev.clipboardData.items) {
      if (it.kind === "file" && /^image\//.test(it.type)) {
        ev.preventDefault();
        const file = it.getAsFile(); if (file) uploadPastedImage(file);
        return;
      }
    }
    // URL → wrap selection
    const text = ev.clipboardData.getData("text");
    if (text && /^https?:\/\/\S+$/.test(text.trim())) {
      const { s, e } = selRange();
      if (s !== e) { ev.preventDefault(); applyWrap("[", "](" + text.trim() + ")"); }
    }
  });

  // drop file → upload if image
  editorTextarea.addEventListener("dragover", (e) => { if (e.dataTransfer && e.dataTransfer.types.includes("Files")) e.preventDefault(); });
  editorTextarea.addEventListener("drop", (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    const file = e.dataTransfer.files[0];
    if (/^image\//.test(file.type)) { e.preventDefault(); uploadPastedImage(file); }
  });

  async function uploadPastedImage(file) {
    if (!getToken()) { setTimeout(() => { settings.hidden = false; tokenInput.focus(); }, 0); toast("이미지 업로드에 토큰이 필요합니다"); return; }
    setEditorStatus("이미지 업로드 중…", "");
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const hashBuf = await crypto.subtle.digest("SHA-1", buf);
      const hex = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
      const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").toLowerCase() || "png";
      const name = `paste-${hex}.${ext}`;
      const path = `assets/uploads/${name}`;
      let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      await ghPutContent(path, b64, null, "docs: upload " + name);
      applyInsert(`![붙여넣은 이미지](${path})`);
      setEditorStatus("이미지 업로드 완료", "ok");
    } catch (e) {
      setEditorStatus("이미지 업로드 실패: " + e.message, "error");
    }
  }

  function getLineRange() {
    const v = editorTextarea.value;
    const s = editorTextarea.selectionStart, e = editorTextarea.selectionEnd;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e); if (le < 0) le = v.length;
    return { ls, le, s, e, v };
  }
  function moveLines(dir) {
    const { ls, le, s, e, v } = getLineRange();
    if (dir < 0) {
      if (ls === 0) return;
      const prevLs = v.lastIndexOf("\n", ls - 2) + 1;
      const prev = v.slice(prevLs, ls - 1);
      const cur = v.slice(ls, le);
      const replacement = cur + "\n" + prev;
      insertAt(prevLs, le, replacement, prevLs + (s - ls), prevLs + (e - ls));
    } else {
      if (le === v.length) return;
      let nextLe = v.indexOf("\n", le + 1); if (nextLe < 0) nextLe = v.length;
      const next = v.slice(le + 1, nextLe);
      const cur = v.slice(ls, le);
      const replacement = next + "\n" + cur;
      const newCurStart = ls + next.length + 1;
      insertAt(ls, nextLe, replacement, newCurStart + (s - ls), newCurStart + (e - ls));
    }
  }
  function duplicateLine() {
    const { ls, le, v } = getLineRange();
    const block = v.slice(ls, le);
    insertAt(le, le, "\n" + block, le + 1 + block.length);
  }
  function toggleComment() {
    const { ls, le, v } = getLineRange();
    const block = v.slice(ls, le);
    let next, finalEnd;
    if (/^\s*<!--[\s\S]*-->\s*$/.test(block)) {
      next = block.replace(/^\s*<!--\s?/, "").replace(/\s?-->\s*$/, "");
    } else {
      next = "<!-- " + block + " -->";
    }
    finalEnd = ls + next.length;
    insertAt(ls, le, next, ls, finalEnd);
  }

  const BRACKETS = { "(": ")", "[": "]", "{": "}", "`": "`", '"': '"', "*": "*", "_": "_" };
  editorTextarea.addEventListener("keydown", (ev) => {
    // Alt+Up / Alt+Down: move line(s)
    if (ev.altKey && !ev.metaKey && !ev.ctrlKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
      ev.preventDefault(); moveLines(ev.key === "ArrowUp" ? -1 : 1); return;
    }
    // Ctrl/Cmd+Enter: toggle checklist on current line
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      const { ls, le, v } = getLineRange();
      const line = v.slice(ls, le);
      const m = /^(\s*[-*+]\s+)\[([ xX])\](.*)$/.exec(line);
      if (m) {
        const flipped = m[1] + "[" + (m[2].trim() ? " " : "x") + "]" + m[3];
        ev.preventDefault();
        insertAt(ls, le, flipped, ls + flipped.length);
        return;
      }
    }
    // Ctrl/Cmd shortcuts for common formatting
    if ((ev.metaKey || ev.ctrlKey) && !ev.shiftKey && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === "b") { ev.preventDefault(); applyWrap("**", "**", "굵게"); return; }
      if (k === "i") { ev.preventDefault(); applyWrap("*", "*", "기울임"); return; }
      if (k === "k") {
        ev.preventDefault();
        (async () => {
          let suggest = "https://";
          try {
            if (navigator.clipboard && navigator.clipboard.readText) {
              const t = await navigator.clipboard.readText();
              if (/^https?:\/\/\S+$/.test((t || "").trim())) suggest = t.trim();
            }
          } catch (_) {}
          const url = prompt("URL을 입력하세요", suggest);
          if (url) applyWrap("[", "](" + url + ")", "텍스트");
        })();
        return;
      }
      if (k === "d") { ev.preventDefault(); duplicateLine(); return; }
      if (k === "/") { ev.preventDefault(); toggleComment(); return; }
      if (k >= "1" && k <= "4") {
        ev.preventDefault();
        const lvl = parseInt(k, 10);
        const { ls, le, v } = getLineRange();
        const line = v.slice(ls, le);
        const stripped = line.replace(/^#{1,6}\s*/, "");
        const prefix = "#".repeat(lvl) + " ";
        insertAt(ls, le, prefix + stripped, ls + prefix.length, ls + prefix.length + stripped.length);
        return;
      }
    }
    if (BRACKETS[ev.key]) {
      const { s, e } = selRange();
      if (s !== e) { ev.preventDefault(); applyWrap(ev.key, BRACKETS[ev.key]); return; }
    }
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
    const fb = document.getElementById("find-bar");
    if (fb && !fb.hidden) { fb.hidden = true; editorTextarea.focus(); return; }
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

  /* ---- pinch / wheel zoom on content ---- */
  const ZOOM_MIN = 0.7, ZOOM_MAX = 2.2;
  let zoomBadge = null, zoomTimer = 0;
  function showZoomBadge(scale) {
    if (!zoomBadge) { zoomBadge = document.createElement("div"); zoomBadge.className = "zoom-badge"; document.body.appendChild(zoomBadge); }
    zoomBadge.textContent = Math.round(scale * 100) + "%";
    zoomBadge.classList.add("show");
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => zoomBadge.classList.remove("show"), 900);
  }
  function setZoom(s, persist) {
    s = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(s * 100) / 100));
    applyScale(s);
    showZoomBadge(s);
    if (persist) lsSet(SCALE_KEY, String(s));
  }
  let pinchStart = null;
  function tdist(a, b) { return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY); }
  function startPinch(initialDist, initialScale) {
    pinchStart = { d: initialDist, scale: initialScale };
    document.body.classList.add("pinching");
  }
  function endPinch() {
    if (!pinchStart) return;
    const live = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--md-scale")) || 1;
    lsSet(SCALE_KEY, String(live));
    pinchStart = null;
    document.body.classList.remove("pinching");
  }
  function pinchAllowed() {
    if (document.body.classList.contains("editing")) return false;
    const lb = document.querySelector(".lightbox"); if (lb && lb.classList.contains("open")) return false;
    return true;
  }
  // Touch events on document so a pinch anywhere on screen scales the text.
  document.addEventListener("touchstart", (e) => {
    if (!pinchAllowed()) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      startPinch(tdist(e.touches[0], e.touches[1]), getScale());
    }
  }, { passive: false });
  document.addEventListener("touchmove", (e) => {
    if (pinchStart && e.touches.length >= 2) {
      e.preventDefault();
      const d = tdist(e.touches[0], e.touches[1]);
      setZoom(pinchStart.scale * (d / pinchStart.d), false);
    }
  }, { passive: false });
  document.addEventListener("touchend", (e) => {
    if (pinchStart && e.touches.length < 2) endPinch();
  }, { passive: true });
  document.addEventListener("touchcancel", () => endPinch(), { passive: true });
  // iOS Safari: WebKit-specific gesture events fire for pinches and are the
  // most reliable way to stop the visual-viewport zoom from kicking in.
  document.addEventListener("gesturestart", (e) => {
    if (!pinchAllowed()) return;
    e.preventDefault();
    startPinch(1, getScale());
  }, { passive: false });
  document.addEventListener("gesturechange", (e) => {
    if (!pinchStart) return;
    e.preventDefault();
    setZoom(pinchStart.scale * (e.scale || 1), false);
  }, { passive: false });
  document.addEventListener("gestureend", (e) => { try { e.preventDefault(); } catch (_) {} endPinch(); }, { passive: false });
  // Ctrl/Cmd + wheel for desktop.
  document.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (document.body.classList.contains("editing")) return;
    e.preventDefault();
    setZoom(getScale() + (e.deltaY > 0 ? -0.05 : 0.05), true);
  }, { passive: false });

  /* ---- TOC + scroll memory ---- */
  const tocEl = document.getElementById("toc");
  const tocEmpty = document.getElementById("toc-empty");
  const tocDocTitle = document.getElementById("toc-doc-title");
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
    if (tocDocTitle) tocDocTitle.textContent = (titleEl && titleEl.textContent) || "목차";
    const heads = Array.from(content.querySelectorAll("h2, h3"));
    if (!heads.length) { if (tocEmpty) tocEmpty.hidden = false; return; }
    if (tocEmpty) tocEmpty.hidden = true;
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
      tocEl.innerHTML = "";
      if (tocEmpty) tocEmpty.hidden = false;
    }
    currentDoc = file.name;
    lsSet(LAST_KEY, file.name);
    pushRecent(file.name);
    appendRelated();
    onScroll();
    const hash = "#" + encodeURIComponent(file.name);
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  let activeTag = null;
  function getRecent() { try { return JSON.parse(lsGet(RECENT_KEY, "[]")) || []; } catch (_) { return []; } }
  function pushRecent(name) {
    const r = getRecent().filter((n) => n !== name);
    r.unshift(name);
    lsSet(RECENT_KEY, JSON.stringify(r.slice(0, 30)));
  }
  function getPins() { try { return JSON.parse(lsGet(PINS_KEY, "[]")) || []; } catch (_) { return []; } }
  function togglePin(name) {
    let p = getPins();
    p = p.includes(name) ? p.filter((x) => x !== name) : [name, ...p];
    lsSet(PINS_KEY, JSON.stringify(p));
    buildList(); setActive(currentDoc);
  }
  function sortedFiles() {
    const mode = lsGet(SORT_KEY, "name");
    const arr = files.slice();
    if (mode === "size") arr.sort((a, b) => (b.size || 0) - (a.size || 0));
    else if (mode === "date") {
      arr.sort((a, b) => {
        const ad = a.tags ? "" : ""; // placeholder; use frontmatter date
        const at = (docText[a.name] && parseFrontmatter(docText[a.name]).meta.date) || "";
        const bt = (docText[b.name] && parseFrontmatter(docText[b.name]).meta.date) || "";
        if (at === bt) return a.name.localeCompare(b.name);
        return at < bt ? 1 : -1; // newest first
      });
    }
    else if (mode === "recent") {
      const r = getRecent();
      arr.sort((a, b) => {
        const ai = r.indexOf(a.name), bi = r.indexOf(b.name);
        if (ai < 0 && bi < 0) return a.name.localeCompare(b.name);
        if (ai < 0) return 1;
        if (bi < 0) return -1;
        return ai - bi;
      });
    } else arr.sort((a, b) => a.name.localeCompare(b.name));
    // promote pinned to the top, in pin order
    const pins = getPins();
    const pinned = pins.map((n) => arr.find((f) => f.name === n)).filter(Boolean);
    const rest = arr.filter((f) => !pins.includes(f.name));
    return [...pinned, ...rest];
  }
  function buildList() {
    list.innerHTML = "";
    if (activeTag) {
      const banner = document.createElement("li");
      banner.className = "tag-filter-banner";
      banner.innerHTML = `태그: <strong>#${escapeHtml(activeTag)}</strong> <button class="tag-clear" type="button">전체 보기</button>`;
      banner.querySelector(".tag-clear").addEventListener("click", () => { activeTag = null; buildList(); });
      list.appendChild(banner);
    }
    const recent = getRecent();
    const pins = getPins();
    sortedFiles()
      .filter((f) => !activeTag || (f.tags && f.tags.includes(activeTag)))
      .forEach((f) => {
        const li = document.createElement("li");
        li.dataset.name = f.name;
        const kb = f.size ? (f.size / 1024).toFixed(1) + " KB" : "";
        const isRecent = recent.length && recent[0] === f.name && f.name !== currentDoc;
        const recentBadge = isRecent ? ' <span class="recent-badge">최근</span>' : "";
        const tagsHtml = f.tags && f.tags.length
          ? `<span class="file-tags">${f.tags.map((t) => `<span class="file-tag" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join("")}</span>` : "";
        const rt = f.readingMin ? " · ⏱️" + f.readingMin + "분" : "";
        const isPinned = pins.includes(f.name);
        const pinHtml = `<button class="pin-btn${isPinned ? " on" : ""}" data-pin="${escapeHtml(f.name)}" aria-label="${isPinned ? "고정 해제" : "고정"}">${isPinned ? "★" : "☆"}</button>`;
        li.innerHTML = `${pinHtml}${escapeHtml(f.title || f.name)}${recentBadge}<span class="file-sub">${escapeHtml(f.name)}${kb ? " · " + kb : ""}${rt}</span>${tagsHtml}`;
        li.addEventListener("click", (ev) => {
          const pinEl = ev.target.closest(".pin-btn");
          if (pinEl) { ev.stopPropagation(); togglePin(pinEl.dataset.pin); return; }
          const tagEl = ev.target.closest(".file-tag");
          if (tagEl) { ev.stopPropagation(); activeTag = tagEl.dataset.tag; buildList(); return; }
          openFile(f.name);
        });
        list.appendChild(li);
      });
  }

  const sortSelect = document.getElementById("sort-select");
  sortSelect.value = lsGet(SORT_KEY, "name");
  sortSelect.addEventListener("change", () => { lsSet(SORT_KEY, sortSelect.value); buildList(); setActive(currentDoc); });

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
    updateDrawerStat();
    const params = new URLSearchParams(location.search);
    const last = lsGet(LAST_KEY, null);
    const initial = currentFromHash() || (last && files.some((f) => f.name === last) ? last : files[0].name);
    openFile(initial);
    // PWA app-shortcut handling (?new=1)
    if (params.get("new") === "1") {
      history.replaceState(null, "", location.pathname + location.hash);
      setTimeout(newDoc, 300);
    } else if (params.get("last") === "1") {
      history.replaceState(null, "", location.pathname + location.hash);
    } else if (params.has("title") || params.has("text") || params.has("url")) {
      // PWA share target
      const sd = { title: params.get("title") || "", text: params.get("text") || "", url: params.get("url") || "" };
      history.replaceState(null, "", location.pathname + location.hash);
      setTimeout(() => createShareDoc(sd), 300);
    }
    // populate tags + related docs in the background
    setTimeout(() => loadAllTags(), 200);
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

let _installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _installPrompt = e;
  const btn = document.getElementById("install-pwa");
  if (btn) btn.hidden = false;
});

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
