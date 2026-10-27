// Docs builder for the satellite games (everything except A House Divided).
//
// A House Divided has a wiki seed, a source-file manifest, a jargon glossary and
// a cross-reference graph, so it keeps its own builder (build.mjs) and the site
// root. The other games are a curated list of markdown files in their own repos
// — see games.mjs — and they all render the same way, so one builder covers all
// of them. Output goes to <OUT>/g/<slug>/ and the theme is shared verbatim, so a
// satellite is visually indistinguishable from the main site.
//
// Usage: node build-game.mjs [slug ...]   (no args = every satellite)

import { marked } from "marked";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { css, baseJs, searchJsFor, reportJs, switcherHtml, askFabHtml } from "./theme.mjs";
import { ALL_GAMES, EXTRAS, BUILDABLE, RETIRED, LAKESIDE_MARK, askHref } from "./games.mjs";

const OUT = process.env.DOCS_OUT || "/srv/lakeside-docs";
const SITE = "https://docs.lakesidegames.net";

// These repos are private working trees. The curation in games.mjs already keeps
// the deploy runbooks out, but a design doc can still mention the box in passing,
// so every published file goes through this regardless of which game it is.
const SCRUB = [
  [/\/root\/[\w./-]+/g, "the project directory"],
  [/\/(?:srv|var\/www)\/[\w./-]+/g, "the web root"],
  [/\b46\.224\.28\.26\b/g, "the server"],
  [/\bhttps?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?[\w./-]*/g, "the local dev server"],
  [/\b(?:127\.0\.0\.1|localhost):\d+/g, "the local dev server"],
  // Bounded to one line: \s in the class would otherwise run to the last word
  // character in the file.
  [/`?systemctl [^\n`]+`?/g, "the service manager"],
  // AI-workflow scaffolding: true of how the docs were written, meaningless to a
  // reader and not something the published docs should name. Slash-joined tool
  // names go first so "Cursor/Kimi session" collapses in one pass.
  [/ Every subsequent Cursor\/Kimi session should be scoped against a section here\./g, ""],
  [/\b(?:Cursor|Kimi|Claude|Codex|Copilot)(?:\/(?:Cursor|Kimi|Claude|Codex|Copilot))+/g, "AI coding tools"],
  [/\b(?:Cursor|Kimi|Claude|Codex|Copilot)\s+session/gi, "development session"],
  // Bare tool names. "Cursor" is deliberately not in this list — it collides with
  // the ordinary UI sense of the word, and the rules above already cover the
  // forms it actually appears in.
  [/\b(?:Kimi|Codex|Copilot)(?:\s+CLI)?\b/g, "an AI coding tool"],
];

/**
 * Drop whole markdown sections whose heading matches, from the heading down to
 * the next heading of the same or higher level.
 *
 * Word-level scrubbing is the wrong tool for a section that is entirely about
 * something the published docs should not discuss — it leaves a mangled heading
 * and a paragraph that no longer parses as English. The main site excludes its
 * AI-workflow docs at file level for the same reason; this is the same rule for
 * a game whose internal material sits inside an otherwise publishable file.
 */
function stripSections(md, patterns) {
  if (!patterns?.length) return md;
  const lines = md.split("\n");
  const out = [];
  let dropUntilLevel = 0;
  for (const line of lines) {
    const h = line.match(/^(#{2,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      if (dropUntilLevel && level <= dropUntilLevel) dropUntilLevel = 0;   // section ended
      if (!dropUntilLevel && patterns.some(re => re.test(h[2]))) { dropUntilLevel = level; continue; }
    }
    if (!dropUntilLevel) out.push(line);
  }
  return out.join("\n");
}

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const anchor = t => t.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
const slugOf = file => path.basename(file, ".md").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const titleOf = (md, fallback) => {
  const m = md.match(/^#\s+(.+)$/m);
  return (m ? m[1] : fallback).replace(/[*`]/g, "").trim() || fallback;
};
const firstPara = md => {
  const body = md.replace(/^#\s+.+$/m, "").trim();
  const m = body.match(/^(?![#>\-|*`\d])([^\n]{40,})$/m);
  if (!m) return "";
  const t = m[1].replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
  return t.length > 150 ? t.slice(0, 147).replace(/\s+\S*$/, "") + "…" : t;
};

/** Last commit date for a file, so a stale page says so. Blank if not in git. */
function lastUpdated(repo, rel) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", rel], { cwd: repo, stdio: ["ignore", "pipe", "ignore"] });
    return out.toString().trim();
  } catch { return ""; }
}

marked.use({
  renderer: {
    heading(text, level) {
      if (level === 1) return "";                        // the shell renders the H1
      const id = anchor(text);
      return `<h${level} id="${id}">${text}<a class="anchor" href="#${id}">#</a></h${level}>`;
    },
  },
});

/** Write <base>/logo.png, falling back to the Lakeside mark for games without one. */
function writeLogo(game, dir) {
  const dest = path.join(dir, "logo.png");
  if (game.logo) {
    const src = path.join(game.repo, game.logo);
    if (fs.existsSync(src)) { fs.copyFileSync(src, dest); return; }
    console.warn(`[${game.slug}] logo missing at ${src}, using the Lakeside mark`);
  }
  // The switcher builds every mark URL as <base>/logo.png, so the shared SVG is
  // rasterised rather than served with a lying extension. librsvg first: the
  // ImageMagick renderer drops gradients inside clip paths and paints them black.
  try {
    execFileSync("rsvg-convert", ["-w", "192", "-h", "192", "-o", dest, LAKESIDE_MARK], { stdio: ["ignore", "ignore", "pipe"] });
  } catch {
    execFileSync("convert", ["-background", "none", "-density", "384", LAKESIDE_MARK, "-resize", "192x192", dest]);
  }
}

function buildGame(game) {
  const base = game.base;
  // Derive the output dir from base, not from slug: games live under /g/<slug>/
  // but non-game docs (the desktop client) sit at their own top-level path.
  const dir = path.join(OUT, base);

  // ---------- collect pages ----------
  const pages = [];
  for (const section of game.sections) {
    for (const group of section.groups) {
      for (const rel of group.files) {
        const abs = path.join(game.repo, rel);
        if (!fs.existsSync(abs)) { console.warn(`[${game.slug}] missing ${rel} — skipped`); continue; }
        let md = stripSections(fs.readFileSync(abs, "utf8"), game.dropSections);
        for (const [re, rep] of SCRUB) md = md.replace(re, rep);
        const fallback = slugOf(rel).replace(/-/g, " ");
        pages.push({
          section: section.key, sectionLabel: section.label, group: group.label,
          slug: slugOf(rel), rel,
          title: titleOf(md, fallback.charAt(0).toUpperCase() + fallback.slice(1)),
          desc: firstPara(md), md,
          updated: lastUpdated(game.repo, rel),
          href: `${base}/${section.key}/${slugOf(rel)}.html`,
        });
      }
    }
  }
  if (!pages.length) { console.warn(`[${game.slug}] no publishable pages — skipped`); return null; }

  // ---------- nav ----------
  const navHtml = activeHref => game.sections.map(section => {
    const secPages = pages.filter(p => p.section === section.key);
    if (!secPages.length) return "";
    const open = secPages.some(p => p.href === activeHref) || !activeHref ? " open" : "";
    const inner = section.groups.map(group => {
      const gp = secPages.filter(p => p.group === group.label);
      if (!gp.length) return "";
      return `<div class="grp">${esc(group.label)}</div>` + gp.map(p =>
        `<a href="${p.href}"${p.href === activeHref ? ' class="on"' : ""} data-t="${esc(p.title.toLowerCase())}">${esc(p.title)}</a>`).join("");
    }).join("");
    return `<details class="sec"${open}><summary>${esc(section.label)} <span class="n">${secPages.length}</span></summary>${inner}</details>`;
  }).join("");

  const shell = ({ title, body, activeHref, toc, desc }) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(game.name)} Docs</title>
<meta name="description" content="${esc(desc || game.tagline)}">
<meta property="og:title" content="${esc(title)} · ${esc(game.name)} Docs">
<meta property="og:image" content="${SITE}${base}/logo.png">
<link rel="icon" href="${base}/logo.png"><style>${css}</style></head><body>
<header class="top">
  <button id="menu-btn" aria-label="Menu">☰</button>
  <a href="${base}/" style="display:flex;align-items:center;gap:.7rem;text-decoration:none"><img src="${base}/logo.png" alt="${esc(game.name)}">
  <span class="name">${esc(game.name)}<small>Documentation</small></span></a>
  <div class="hsearch">
    <span class="ico"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
    <input class="docsearch-input" type="search" placeholder="Search the docs…" autocomplete="off" spellcheck="false" aria-label="Search documentation">
    <span class="kbd">↵</span>
  </div>
  <span class="links">${switcherHtml(ALL_GAMES, game.slug, EXTRAS)}${game.site ? `<a href="${game.site}">Play</a>` : ""}</span>
</header>
<div class="layout${toc ? " with-toc" : ""}">
<nav class="side">${navHtml(activeHref)}</nav>
<main>${body}
<footer><span>© Lakeside Games</span>${game.github ? `<a href="${game.github}">Source on GitHub</a>` : ""}<a href="/">A House Divided docs</a></footer>
</main>
${toc || ""}</div>
${askFabHtml(askHref(game))}
<button id="report-fab" type="button" data-page="${esc(activeHref || base + "/")}" aria-label="Report an issue with this page"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15V4a1 1 0 0 1 1-1h11l-2 4 2 4H5a1 1 0 0 1-1-1z"/><path d="M4 22v-7"/></svg>Report page issue</button>
<div id="report-modal" role="dialog" aria-modal="true" aria-label="Report an issue" hidden>
  <div class="rm-card">
    <div class="rm-head">Report an issue with this page</div>
    <div class="rm-sub">Spotted something out of date or wrong? Let us know and we will fix it.</div>
    <label class="rm-l">What is the issue?
      <select id="rm-reason">
        <option value="stale">Out of date / stale</option>
        <option value="incorrect">Incorrect information</option>
        <option value="update-request">Requesting an update or more detail</option>
        <option value="other">Other</option>
      </select>
    </label>
    <label class="rm-l">Details (optional)
      <textarea id="rm-note" rows="4" placeholder="What did you notice, and what should it say?"></textarea>
    </label>
    <div class="rm-actions"><button type="button" id="rm-cancel" class="rm-ghost">Cancel</button><button type="button" id="rm-send" class="rm-primary">Send report</button></div>
    <div id="rm-msg" class="rm-msg"></div>
  </div>
</div>
<script>${baseJs}</script><script>${searchJsFor(base)}</script><script>${reportJs}</script></body></html>`;

  // ---------- render pages ----------
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  writeLogo(game, dir);

  const bySlug = new Map(pages.map(p => [path.basename(p.rel), p]));
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    let html = marked.parse(p.md);
    // Relative links between the game's own markdown files resolve to built pages.
    html = html.replace(/href="(?:\.\/|docs\/)?([\w.-]+\.md)(#[\w-]*)?"/g, (m, name, hash) =>
      bySlug.has(name) ? `href="${bySlug.get(name).href}${hash || ""}"` : m);

    const h2s = [...p.md.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].replace(/[*`]/g, ""));
    const toc = h2s.length >= 2
      ? `<aside class="toc"><div class="t">On this page</div>${h2s.map(t => `<a href="#${anchor(t)}">${esc(t)}</a>`).join("")}</aside>`
      : null;

    const prev = pages[i - 1], next = pages[i + 1];
    const pager = `<div class="pager">${
      prev ? `<a href="${prev.href}"><div class="lbl">Previous</div><div class="nt">${esc(prev.title)}</div></a>` : "<span style='flex:1'></span>"}${
      next ? `<a class="next" href="${next.href}"><div class="lbl">Next</div><div class="nt">${esc(next.title)}</div></a>` : "<span style='flex:1'></span>"}</div>`;

    const body = `<div class="crumb">${esc(p.sectionLabel)}<span class="sep">/</span>${esc(p.group)}</div>`
      + `<h1>${esc(p.title)}</h1>`
      + (p.updated ? `<div class="updated">Last updated ${esc(p.updated)}</div>` : "")
      + html + pager;

    const outPath = path.join(dir, p.section, `${p.slug}.html`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, shell({ title: p.title, body, activeHref: p.href, toc, desc: p.desc }));
  }

  // ---------- search index ----------
  // Lexical only: `semantic:false` makes the shared client skip the embedder and
  // rank on exact-phrase + all-terms, which is what the main site serves too.
  const plain = s => s
    .replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*_|\-\s]+/gm, " ").replace(/[#>*_|]/g, " ")
    .replace(/\s+/g, " ").trim();

  const items = [];
  for (const p of pages) {
    let heading = "", anchorId = "", buf = [];
    const flush = () => {
      const text = plain(buf.join("\n")).slice(0, 1200);
      if (text.length > 40) {
        items.push({
          t: heading ? `${p.title} — ${heading}` : p.title,
          h: anchorId ? `${p.href}#${anchorId}` : p.href,
          s: p.sectionLabel, x: text,
        });
      }
      buf = [];
    };
    for (const line of p.md.split("\n")) {
      const m = line.match(/^(##|###)\s+(.+)$/);
      if (m) { flush(); heading = m[2].replace(/[*`]/g, "").trim(); anchorId = anchor(heading); }
      else buf.push(line);
    }
    flush();
  }
  fs.writeFileSync(path.join(dir, "search-index.json"), JSON.stringify({ dim: 0, semantic: false, items }));

  // ---------- home + search + sitemap ----------
  const cards = game.sections.map(section => {
    const secPages = pages.filter(p => p.section === section.key);
    if (!secPages.length) return "";
    const inner = section.groups.map(group => {
      const gp = secPages.filter(p => p.group === group.label);
      if (!gp.length) return "";
      return `<div class="gcard"><b>${esc(group.label)}</b>${gp.map(p => `<a href="${p.href}">${esc(p.title)}</a>`).join("")}</div>`;
    }).join("");
    return `<div class="home-sec"><h2>${esc(section.label)}</h2><div class="gwrap">${inner}</div></div>`;
  }).join("");

  const home = `
<div class="hero"><img src="${base}/logo.png" alt="${esc(game.name)} logo">
<div><h1>${esc(game.name)} Docs</h1>
<p>${esc(game.tagline)}</p>
<div class="cta">${game.site ? `<a class="primary" href="${game.site}">Play the game</a>` : ""}${
    game.github ? `<a class="ghost" href="${game.github}">Source on GitHub</a>` : ""}<a class="ghost" href="${askHref(game)}">Ask a question</a></div></div></div>
${cards}`;
  fs.writeFileSync(path.join(dir, "index.html"), shell({ title: "Home", body: home, activeHref: "" }));

  const searchPage = `<div class="results-wrap">
<div class="results-head"><h1>Search<span class="seg" id="mode-seg"><button data-mode="smart" class="on">Smart</button><button data-mode="exact">Exact</button></span></h1></div>
<div class="results-search">
  <span class="ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></span>
  <input class="docsearch-input" data-mode="page" type="search" placeholder="Search the docs…" autocomplete="off" spellcheck="false" aria-label="Search documentation">
</div>
<div id="results-meta" style="color:var(--mut);font-size:.9rem;margin:.2rem 0 1.1rem"></div>
<div class="rlist" id="results-list"></div>
</div>`;
  fs.writeFileSync(path.join(dir, "search.html"),
    shell({ title: "Search", body: searchPage, activeHref: "", desc: `Search the ${game.name} documentation.` }));

  fs.writeFileSync(path.join(dir, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [`${SITE}${base}/`, ...pages.map(p => SITE + p.href)].map(u => `<url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`);

  console.log(`[${game.slug}] ${pages.length} pages, ${items.length} search chunks -> ${dir}`);
  return { slug: game.slug, pages: pages.length };
}

const wanted = process.argv.slice(2);
const targets = wanted.length ? BUILDABLE.filter(g => wanted.includes(g.slug)) : BUILDABLE;
if (wanted.length && targets.length !== wanted.length) {
  const known = BUILDABLE.map(g => g.slug).join(", ");
  throw new Error(`unknown game(s): ${wanted.filter(w => !targets.some(t => t.slug === w)).join(", ")} — known: ${known}`);
}
const built = targets.map(buildGame).filter(Boolean);
// Retired and renamed games no longer build; delete their old output so nothing
// stale is served if the web server's redirect for them is ever dropped.
for (const r of RETIRED) {
  const old = path.join(OUT, "g", r.slug);
  if (fs.existsSync(old)) { fs.rmSync(old, { recursive: true, force: true }); console.log(`[${r.slug}] retired, removed ${old}`); }
}
console.log(`built ${built.length} game(s): ${built.map(b => `${b.slug}(${b.pages})`).join(" ")}`);
