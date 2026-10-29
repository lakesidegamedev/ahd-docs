#!/usr/bin/env node
// Corporate Warfare doc charts. Every number plotted is read from the game's own source
// (content JSON, Rust `const NAME: T = value;` lines, and literals inside named functions).
//
// Regenerate:  node build-charts.mjs            (from this folder)
//              GAME_REPO_PATH=/path/to/corporate-warfare node build-charts.mjs
// Output:      ../images/<page-stem>-<name>.svg
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = process.env.GAME_REPO_PATH || new URL('../../../../corporate-warfare', import.meta.url).pathname.replace(/\/$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'images');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- source readers
const read = (p) => readFileSync(join(REPO, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const ECON = 'crates/cw-sim/src/economy/';
const num = (s) => Number(String(s).replace(/_/g, ''));

/** Value of `const NAME: type = <number>;` in a Rust file. */
function rconst(file, name) {
  const m = read(file).match(new RegExp(`const ${name}\\s*:[^=]+=\\s*(-?[0-9_]+)\\s*;`));
  if (!m) throw new Error(`const ${name} not found in ${file}`);
  return num(m[1]);
}
/** Numbers in `const NAME: [..] = [a, b, c];`. */
function rarray(file, name) {
  const m = read(file).match(new RegExp(`const ${name}\\s*:[^=]+=\\s*\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`array ${name} not found in ${file}`);
  return m[1].split(',').map((x) => num(x.trim()));
}
/** Source text of `fn name(...) {...}` up to the next top-level closing brace. */
function rfn(file, name) {
  const src = read(file);
  const i = src.indexOf(`fn ${name}(`);
  if (i < 0) throw new Error(`fn ${name} not found in ${file}`);
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j + 2);
}
/** Capture groups of a regex in a function body; throws if absent so drift is loud. */
function lit(body, re, label) {
  const m = body.match(re);
  if (!m) throw new Error(`literal not found: ${label}`);
  return m.slice(1).map((x) => num(x));
}

// ---------------------------------------------------------------- svg helpers
const BLUE = '#2563eb';
const RED = '#dc2626';
const GREY = '#a1a1aa';
const INK = '#27272a';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n) => (Math.round(n * 10) / 10).toString();

function frame(w, h, title, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family='${FONT}' role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#ffffff" stroke="#d4d4d8"/>
${inner}
</svg>
`;
}

function ticks(min, max, n) {
  const span = max - min;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/**
 * Draws one line chart inside box {x,y,w,h}. Returns svg text.
 * series: {pts:[[x,y]], color, dash, width, label, endLabel, step}
 * hlines: {y, label, color}; vbands: {x0,x1,label}; vlines: {x,label}
 */
function chart(box, o) {
  const { x: bx, y: by, w: bw, h: bh } = box;
  const legendItems = o.series.filter((x) => x.label);
  let rows = 1, cur = 0;
  for (const se of legendItems) {
    const wd = 36 + se.label.length * 6.1;
    if (cur + wd > bw - 70 && cur > 0) { rows++; cur = 0; }
    cur += wd;
  }
  const m = { l: 56, r: o.rightPad ?? 16, t: o.title ? 30 : 12, b: 62 + 15 * (rows - 1) };
  const pw = bw - m.l - m.r;
  const ph = bh - m.t - m.b;
  const sx = (v) => bx + m.l + ((v - o.xmin) / (o.xmax - o.xmin)) * pw;
  const sy = (v) => by + m.t + ph - ((v - o.ymin) / (o.ymax - o.ymin)) * ph;
  let s = '';
  if (o.title) s += `<text x="${bx + m.l}" y="${by + 18}" font-size="13" font-weight="600" fill="${INK}">${esc(o.title)}</text>\n`;
  for (const v of o.yticks ?? ticks(o.ymin, o.ymax, 5)) {
    s += `<line x1="${f(sx(o.xmin))}" x2="${f(sx(o.xmax))}" y1="${f(sy(v))}" y2="${f(sy(v))}" stroke="#e4e4e7"/>`;
    s += `<text x="${f(sx(o.xmin) - 6)}" y="${f(sy(v) + 4)}" font-size="11" text-anchor="end" fill="#52525b">${v}</text>\n`;
  }
  for (const v of o.xticks ?? ticks(o.xmin, o.xmax, 6)) {
    s += `<line x1="${f(sx(v))}" x2="${f(sx(v))}" y1="${f(sy(o.ymin))}" y2="${f(sy(o.ymax))}" stroke="#f4f4f5"/>`;
    s += `<text x="${f(sx(v))}" y="${f(sy(o.ymin) + 16)}" font-size="11" text-anchor="middle" fill="#52525b">${o.xfmt ? o.xfmt(v) : v}</text>\n`;
  }
  s += `<rect x="${f(sx(o.xmin))}" y="${f(sy(o.ymax))}" width="${f(pw)}" height="${f(ph)}" fill="none" stroke="#a1a1aa"/>\n`;
  for (const b of o.vbands ?? []) {
    s += `<rect x="${f(sx(b.x0))}" y="${f(sy(o.ymax))}" width="${f(sx(b.x1) - sx(b.x0))}" height="${f(ph)}" fill="${RED}" opacity="0.08"/>`;
    s += `<text x="${f((sx(b.x0) + sx(b.x1)) / 2)}" y="${f(sy(o.ymax) + 40)}" font-size="11" text-anchor="middle" fill="${RED}">${esc(b.label)}</text>\n`;
  }
  for (const h of o.hlines ?? []) {
    s += `<line x1="${f(sx(o.xmin))}" x2="${f(sx(o.xmax))}" y1="${f(sy(h.y))}" y2="${f(sy(h.y))}" stroke="${h.color ?? GREY}" stroke-dasharray="5 4"/>`;
    s += `<text x="${f(h.left ? sx(o.xmin) + 6 : sx(o.xmax) - 4)}" y="${f(sy(h.y) - 4)}" font-size="11" text-anchor="${h.left ? 'start' : 'end'}" fill="${h.color ?? '#52525b'}">${esc(h.label)}</text>\n`;
  }
  for (const v of o.vlines ?? []) {
    s += `<line x1="${f(sx(v.x))}" x2="${f(sx(v.x))}" y1="${f(sy(o.ymin))}" y2="${f(sy(o.ymax))}" stroke="${v.color ?? GREY}" stroke-dasharray="5 4"/>`;
    if (v.label) s += `<text x="${f(sx(v.x) + 4)}" y="${f(sy(o.ymax) + 14)}" font-size="11" fill="#52525b">${esc(v.label)}</text>\n`;
  }
  for (const se of o.series) {
    const pts = se.pts.map(([x, y]) => `${f(sx(x))},${f(sy(y))}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${se.color}" stroke-width="${se.width ?? 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} stroke-linejoin="round"/>\n`;
    if (se.endLabel) {
      const [lx, ly] = se.pts[se.pts.length - 1];
      s += `<text x="${f(sx(lx) + 4)}" y="${f(sy(ly) + 4)}" font-size="11" fill="${se.color}">${esc(se.endLabel)}</text>\n`;
    }
  }
  for (const p of o.points ?? []) {
    s += `<circle cx="${f(sx(p.x))}" cy="${f(sy(p.y))}" r="4" fill="#fff" stroke="${p.color ?? INK}" stroke-width="2"/>`;
    s += `<text x="${f(sx(p.x) + (p.dx ?? 8))}" y="${f(sy(p.y) + (p.dy ?? 4))}" font-size="11" fill="${INK}" text-anchor="${p.anchor ?? 'start'}">${esc(p.label)}</text>\n`;
  }
  // axis titles
  s += `<text x="${f(bx + m.l + pw / 2)}" y="${f(by + bh - 28 - 15 * (rows - 1))}" font-size="12" text-anchor="middle" fill="${INK}">${esc(o.xlabel)}</text>\n`;
  s += `<text transform="translate(${bx + 14} ${f(by + m.t + ph / 2)}) rotate(-90)" font-size="12" text-anchor="middle" fill="${INK}">${esc(o.ylabel)}</text>\n`;
  // legend (below the plot)
  const legend = o.series.filter((x) => x.label);
  let lx = bx + m.l;
  let ly = by + bh - 10 - 15 * (rows - 1);
  for (const se of legend) {
    const wd = 36 + se.label.length * 6.1;
    if (lx - (bx + m.l) + wd > bw - 70 && lx > bx + m.l) { lx = bx + m.l; ly += 15; }
    s += `<line x1="${lx}" x2="${lx + 22}" y1="${ly - 4}" y2="${ly - 4}" stroke="${se.color}" stroke-width="2.5" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''}/>`;
    s += `<text x="${lx + 27}" y="${ly}" font-size="11" fill="${INK}">${esc(se.label)}</text>\n`;
    lx += 36 + se.label.length * 6.1;
  }
  return s;
}

function write(name, title, inner, w = 640, h = 360) {
  writeFileSync(join(OUT, name), frame(w, h, title, inner));
  console.log('wrote', name);
}
const single = (name, title, o, h = 360) => write(name, title, chart({ x: 0, y: 0, w: 640, h }, o), 640, h);

/** Piecewise-linear interpolation between anchors, held flat after the last (as the engine does). */
function interp(anchors, q) {
  if (q <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    if (q <= anchors[i][0]) {
      const [x0, y0] = anchors[i - 1];
      const [x1, y1] = anchors[i];
      return y0 + ((y1 - y0) * (q - x0)) / (x1 - x0);
    }
  }
  return anchors[anchors.length - 1][1];
}
const range = (a, b, st = 1) => Array.from({ length: Math.floor((b - a) / st) + 1 }, (_, i) => a + i * st);

// ================================================================ commodity-exchange
const PP = json('content/price-paths.json');
const SCEN = json('content/scenarios.json');
const scenList = Array.isArray(SCEN) ? SCEN : SCEN.scenarios;
const scenName = (id) => scenList.find((s) => s.id === id)?.name ?? id;

// World price index by family: one panel per scenario.
{
  const ids = Object.keys(PP.scenarios);
  const W = 640, H = 660;
  let inner = '';
  ids.forEach((id, i) => {
    const sc = PP.scenarios[id];
    const lastQ = Math.max(...Object.values(sc.families).map((a) => a[a.length - 1][0]));
    const series = [];
    const hi = (fam) => ({ oil: BLUE, steel: RED, electronics: RED })[fam];
    let ymax = 0;
    for (const [fam, anchors] of Object.entries(sc.families)) {
      const pts = range(0, lastQ * 13, 2).map((w) => [w / 13, interp(anchors, w / 13)]);
      ymax = Math.max(ymax, ...pts.map((p) => p[1]));
      series.push({ pts, color: hi(fam) ?? '#d4d4d8', width: hi(fam) ? 2 : 1.2, endLabel: null, label: null, fam });
    }
    series.sort((a, b) => Number(!!hi(a.fam)) - Number(!!hi(b.fam)));
    const key = series.filter((x) => hi(x.fam));
    inner += chart(
      { x: (i % 2) * 320, y: Math.floor(i / 2) * 320, w: 320, h: 320 },
      {
        title: `${scenName(id)}`,
        xmin: 0, xmax: lastQ, ymin: 0, ymax: Math.ceil(ymax / 100) * 100,
        xticks: ticks(0, lastQ, 4),
        xlabel: 'Quarters since the start', ylabel: 'Index (day one = 100)',
        series,
        rightPad: 10,
      },
    );
  });
  inner += `<line x1="40" x2="62" y1="${H - 14}" y2="${H - 14}" stroke="${BLUE}" stroke-width="2.5"/><text x="67" y="${H - 10}" font-size="11" fill="${INK}">Oil and fuel</text>`;
  inner += `<line x1="150" x2="172" y1="${H - 14}" y2="${H - 14}" stroke="${RED}" stroke-width="2.5"/><text x="177" y="${H - 10}" font-size="11" fill="${INK}">Steel (chips and electronics in Silicon Valley)</text>`;
  inner += `<line x1="480" x2="502" y1="${H - 14}" y2="${H - 14}" stroke="#d4d4d8" stroke-width="2.5"/><text x="507" y="${H - 10}" font-size="11" fill="${INK}">Other families</text>`;
  write('commodity-exchange-world-prices.svg', 'World price index by family for each scenario, authored historical paths', inner, W, H);
}

// Storage: stock remaining vs weeks stored.
{
  const cut = rconst(ECON + 'storage.rs', 'PROTECTED_SPOILAGE_CUT_BPS') / 10000;
  const prods = Object.fromEntries(json('content/initial-balance.json').products.map((p) => [p.id, p]));
  const goods = [
    ['food_raw', 'Food', BLUE, null],
    ['livestock', 'Livestock', RED, null],
    ['grain', 'Grain', BLUE, '6 4'],
  ];
  const series = [];
  for (const [id, label, color, dash] of goods) {
    const r = prods[id].spoilage_bps_weekly / 10000;
    const stock = (rate) => range(0, 26).map((w) => [w, 100 * (1 - rate) ** w]);
    series.push({ pts: stock(r), color, dash, label: `${label} ${r * 100}%/wk`, endLabel: null });
    series.push({ pts: stock(r * (1 - cut)), color, dash: '2 3', width: 1.5, label: null });
  }
  single('commodity-exchange-storage.svg', 'Stock remaining against weeks stored, with and without owned storage', {
    xmin: 0, xmax: 26, ymin: 0, ymax: 100, xticks: [0, 5, 10, 15, 20, 25],
    xlabel: 'Weeks stored (dotted = with owned storage)', ylabel: 'Stock remaining (%)', series,
    hlines: [{ y: 50, label: 'Half gone' }],
    points: [],
    vlines: [],
  });
  // note: dotted lines are the same good with owned storage (spoilage rate cut by PROTECTED_SPOILAGE_CUT_BPS).
}

// Sell-through pricing curve.
{
  const body = rfn(ECON + 'pricing.rs', 'goods_wanted_bps');
  const [lo, hi] = lit(body, /\.clamp\((-?\d+),\s*(\d+)\)/, 'gap clamp');
  const k = rconst(ECON + 'pricing.rs', 'WANT_BPS_PER_HUNDREDTH_WEEK');
  const cap = rconst(ECON + 'pricing.rs', 'MAX_WEEKLY_MOVE_BPS') / 100;
  const lag = rconst(ECON + 'pricing.rs', 'PRICE_LAG_WEEKS');
  const pts = range(lo, hi, 25).map((g) => [g / 100, (10000 + g * k) / 100]);
  single('commodity-exchange-pricing.svg', 'The price a seller wants against how short buyers are or how much stock is unsold', {
    xmin: lo / 100, xmax: hi / 100, ymin: 70, ymax: 130,
    xlabel: 'Weeks of buyer shortage (right) or unsold stock over target (left)',
    ylabel: 'Wanted price (% of reference)',
    series: [{ pts, color: BLUE, label: 'Price the seller wants' }],
    hlines: [{ y: 100, label: 'Reference price' }],
    points: [{ x: 0, y: 100, label: `Real price closes 1/${lag} of the gap a week, max ${cap}%`, dx: 10, dy: -14, color: RED }],
  });
}

// ================================================================ freight
const LOG = json('content/logistics.json');
{
  const e = LOG.empty_lane_bps, o = LOG.outside_premium_bps;
  const capPct = rconst(ECON + 'logistics.rs', 'COMMON_CARRIER_RATE_PCT');
  const cap = (e + ((o - e) * capPct) / 100) / 100;
  const pts = range(0, 100, 2).map((fl) => [fl, (e + ((o - e) * fl * fl) / 10000) / 100]);
  single('freight-rates.svg', 'Lane rate against how full the lane is', {
    xmin: 0, xmax: 100, ymin: 60, ymax: 130,
    xlabel: 'Lane fill (%)', ylabel: 'Rate (% of base rate)',
    series: [{ pts, color: BLUE, label: 'Rate other owners charge' }],
    hlines: [
      { y: cap, label: `Common carrier cap ${cap}%`, color: RED },
      { y: LOG.contract_discount_bps / 100, label: `Contracted lots ${LOG.contract_discount_bps / 100}%` },
      { y: LOG.own_cost_bps / 100, label: `Own carrier ${LOG.own_cost_bps / 100}%` },
    ],
    points: [{ x: 100, y: o / 100, label: `Outside carriers ${o / 100}%`, dx: -8, dy: 16, anchor: 'end', color: BLUE }],
  });
}
{
  const series = [];
  const colors = { truck: BLUE, rail: RED, pipeline: '#52525b', sea: '#0f766e' };
  const maxKm = 1100;
  const notes = [];
  for (const m of LOG.modes) {
    const end = m.reach_km > 0 && m.reach_km < maxKm ? m.reach_km : maxKm;
    const perKm = m.rate_milli_cents_per_lot_km / 100000; // dollars per lot-km
    const pts = [[0, 0], [end, end * perKm]];
    series.push({
      pts, color: colors[m.id], dash: m.id === 'sea' ? '6 4' : m.id === 'pipeline' ? '2 3' : null,
      label: `${m.name} ${m.rate_milli_cents_per_lot_km / 1000} c`,
    });
    notes.push(`${m.name}: min ${m.min_lots} lot${m.min_lots > 1 ? 's' : ''}`);
  }
  single('freight-modes.svg', 'Delivered cost per lot over distance by freight mode', {
    xmin: 0, xmax: maxKm, ymin: 0, ymax: 25, xticks: [0, 200, 400, 600, 800, 1000],
    xlabel: 'Distance (km); legend shows cents per lot-km', ylabel: 'Cost per lot ($)',
    series,
    vlines: LOG.modes.filter((m) => m.reach_km > 0 && m.reach_km < maxKm).map((m) => ({ x: m.reach_km, label: `${m.name} reach ${m.reach_km} km` })),
  });
}

// ================================================================ currencies (peg band)
{
  const cur = json('content/scenarios/ruhr-rhine-1991/currencies.json');
  const peg = cur.currencies.find((c) => c.peg).peg;
  const band = peg.band_bps / 100, wide = peg.widened_band_bps / 100;
  const [c0, c1] = peg.crisis_window_weeks;
  const lastQ = Math.max(...Object.values(PP.scenarios['ruhr-rhine-1991'].families).map((a) => a[a.length - 1][0]));
  const xmax = lastQ * 13;
  single('currencies-peg-band.svg', 'Pegged currency band against the Deutsche Mark in Ruhr and Rhine 1991', {
    xmin: 0, xmax, ymin: -16, ymax: 16, xticks: [0, 52, 104, 156, 208, 260, 312, 364].filter((x) => x <= xmax),
    xlabel: 'Weeks since January 1991', ylabel: 'Rate against the mark (% from parity)',
    series: [
      { pts: [[0, 0], [xmax, 0]], color: INK, width: 1.5, label: 'Parity' },
      { pts: [[0, band], [xmax, band]], color: BLUE, label: `Normal band +/-${band}%` },
      { pts: [[0, -band], [xmax, -band]], color: BLUE },
      { pts: [[0, wide], [xmax, wide]], color: RED, dash: '6 4', label: `Band after a crisis +/-${wide}%` },
      { pts: [[0, -wide], [xmax, -wide]], color: RED, dash: '6 4' },
    ],
    vbands: [{ x0: c0, x1: c1, label: 'Crisis window' }],
  });
}

// ================================================================ companies
{
  const body = rfn(ECON + 'sectors.rs', 'dominance_multiplier_bps');
  const thr = rconst(ECON + 'sectors.rs', 'DOMINANCE_THRESHOLD_BPS');
  const max = rconst(ECON + 'sectors.rs', 'DOMINANCE_MAX_BPS');
  const rs = body.match(/rival_scale = ([\d_]+) \+ ([\d_]+) \* rivals\.min\((\d+)\) as i64 \/ (\d+)/);
  if (!rs) throw new Error('rival_scale literal not found');
  const [rb, rp, rc, rd] = rs.slice(1).map(num);
  const mult = (shareBps, rivals) => {
    if (shareBps <= thr) return 10000;
    const scale = rb + (rp * Math.min(rivals, rc)) / rd;
    const excess = ((Math.min(shareBps, 10000) - thr) * 10000) / (10000 - thr);
    const ramp = (excess * excess) / 10000;
    return 10000 + (((max - 10000) * ramp) / 10000) * scale / 10000;
  };
  const defs = [[0, BLUE, null], [1, BLUE, '6 4'], [2, RED, null], [4, RED, '6 4']];
  const series = defs.map(([r, color, dash]) => ({
    pts: range(50, 100, 1).map((s) => [s, mult(s * 100, r) / 10000]),
    color, dash, label: r === 4 ? '4 or more rivals' : r === 1 ? '1 rival' : `${r} rivals`,
  }));
  single('companies-dominance.svg', 'Expansion cost multiplier against local market share', {
    xmin: 50, xmax: 100, ymin: 1, ymax: 3, yticks: [1, 1.5, 2, 2.5, 3],
    xlabel: 'Your share of the local market (%)', ylabel: 'Expansion cost (x normal)', series,
  });
}
{
  const body = rfn(ECON + 'operations.rs', 'sprawl_rate_bps');
  const [coef, scale] = lit(body, /d \* d \* (\d+) \* (\d+)/, 'sprawl coefficient');
  const [strengthDen] = lit(body, /\(\s*(\d+) - strength\)\s*\/\s*\d+/, 'strength');
  const lg = body.match(/owned_logistics\.max\(0\) \* ([\d_]+)\)\.min\(([\d_]+)\)/);
  if (!lg) throw new Error('owned logistics literal not found');
  const [perDiv, capBps] = lg.slice(1).map(num);
  const rate = (d, owned) => {
    let r = d * d * coef * scale;
    r = (r * (strengthDen - 0)) / strengthDen; // logistics strength 0
    r = (r * (10000 - Math.min(owned * perDiv, capBps))) / 10000;
    return r / 10000 / 100; // percent of weekly revenue
  };
  const owned = Math.round(3);
  single('companies-sprawl.svg', 'Division overhead as a share of weekly revenue against number of divisions', {
    xmin: 1, xmax: 40, ymin: 0, ymax: Math.ceil(rate(40, 0)),
    xlabel: 'Divisions you own', ylabel: 'Overhead (% of weekly revenue)',
    series: [
      { pts: range(1, 40).map((d) => [d, rate(d, 0)]), color: RED, label: 'No logistics divisions' },
      { pts: range(1, 40).map((d) => [d, rate(d, owned)]), color: BLUE, label: `${owned} owned logistics divisions` },
    ],
    hlines: [{ y: 1, label: '1% of revenue' }],
  });
}

// ================================================================ governments
{
  const src = read(ECON + 'politics.rs');
  const m = src.match(/let hold = \(p\.approval_bps \+ (\d+)\)\.clamp\((\d+), (\d[\d_]*)\)/);
  if (!m) throw new Error('hold formula not found');
  const [add, lo, hi] = m.slice(1).map(num);
  const pts = range(0, 100, 1).map((a) => [a, Math.min(hi, Math.max(lo, a * 100 + add)) / 100]);
  single('governments-election-hold.svg', 'Chance the governing party keeps power against approval', {
    xmin: 0, xmax: 100, ymin: 0, ymax: 100,
    xlabel: 'Government approval (%)', ylabel: 'Chance the party keeps power (%)',
    series: [{ pts, color: BLUE, label: `Approval + ${add / 100} points, held between ${lo / 100}% and ${hi / 100}%` }],
  });
}
{
  const src = read(ECON + 'macro_cycle.rs');
  const m = src.match(/let step = if distance\.abs\(\) < (\d+) \{\s*0\s*\} else if distance\.abs\(\) >= (\d+) \{\s*(\d+)\s*\} else \{\s*(\d+)\s*\}/);
  if (!m) throw new Error('step rule not found');
  const [dead, big, bigStep, smallStep] = m.slice(1).map(num);
  const stepOf = (d) => (d < dead ? 0 : d >= big ? bigStep : smallStep);
  const pts = [];
  for (let d = 0; d <= 150; d++) pts.push([d, stepOf(d)]);
  single('governments-rate-step.svg', 'Central bank rate change at a meeting against distance from its target', {
    xmin: 0, xmax: 150, ymin: 0, ymax: 60, yticks: [0, 25, 50],
    xlabel: 'Distance between the current rate and the bank\'s target (basis points)',
    ylabel: 'Rate move (basis points)',
    series: [{ pts, color: BLUE, label: `Meets every ${rconst(ECON + 'macro_cycle.rs', 'MEETING_WEEKS')} weeks; moves toward target` }],
  });
}

// ================================================================ regions-and-labour
{
  const src = read(ECON + 'labour.rs');
  const floor = lit(src, /if \*wage \* 100 < prevailing \* (\d+) \{/, 'wage floor')[0];
  const [resv] = lit(src, /reservation_wage_cents = \(new_prevailing \* (\d+) \/ 100\)/, 'reservation');
  const [tenth] = lit(src, /reservation \/ (\d+)\b/, 'reservation tenth');
  const pull = (offer) => (offer < floor ? 0 : Math.max(0, offer - resv + resv / tenth));
  const pts = [];
  for (let x = 60; x <= 140; x += 0.5) {
    if (x === floor) pts.push([x - 0.0001, 0]);
    pts.push([x, pull(x)]);
  }
  single('regions-and-labour-applicant-pull.svg', 'Applicants drawn per open position against the wage offered', {
    xmin: 60, xmax: 140, ymin: 0, ymax: 80,
    xlabel: 'Wage offered (% of the going wage)', ylabel: 'Pull per open position (% of going wage)',
    series: [{ pts, color: BLUE, label: 'Share of applicants a job attracts' }],
    vlines: [{ x: floor, label: `Below ${floor}%: nobody applies`, color: RED }],
  });
}
{
  const yield_ = rarray(ECON + 'production.rs', 'SEASONAL_YIELD_BPS').map((b) => b / 100);
  const W = 640, H = 360;
  const m = { l: 56, r: 16, t: 14, b: 62 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const ymax = 140;
  const sy = (v) => m.t + ph - (v / ymax) * ph;
  let s = '';
  for (const v of [0, 20, 40, 60, 80, 100, 120, 140]) {
    s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${f(sy(v))}" y2="${f(sy(v))}" stroke="#e4e4e7"/><text x="${m.l - 6}" y="${f(sy(v) + 4)}" font-size="11" text-anchor="end" fill="#52525b">${v}</text>\n`;
  }
  const bw = pw / yield_.length;
  yield_.forEach((v, i) => {
    const x = m.l + i * bw + bw * 0.2;
    s += `<rect x="${f(x)}" y="${f(sy(v))}" width="${f(bw * 0.6)}" height="${f(sy(0) - sy(v))}" fill="${v === Math.max(...yield_) ? RED : BLUE}"/>`;
    s += `<text x="${f(x + bw * 0.3)}" y="${f(sy(v) - 6)}" font-size="12" text-anchor="middle" fill="${INK}">${v}%</text>`;
    s += `<text x="${f(x + bw * 0.3)}" y="${f(sy(0) + 16)}" font-size="11" text-anchor="middle" fill="#52525b">Quarter ${i + 1}</text>\n`;
  });
  s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${f(sy(100))}" y2="${f(sy(100))}" stroke="${INK}" stroke-dasharray="5 4"/><text x="${m.l + pw - 4}" y="${f(sy(100) - 4)}" font-size="11" text-anchor="end" fill="${INK}">Normal output (100%)</text>\n`;
  s += `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${f(ph)}" fill="none" stroke="#a1a1aa"/>\n`;
  s += `<text x="${m.l + pw / 2}" y="${H - 22}" font-size="12" text-anchor="middle" fill="${INK}">Calendar quarter of the year</text>\n`;
  s += `<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${INK}">Farm output (% of normal)</text>\n`;
  write('regions-and-labour-farm-seasons.svg', 'Farm output by quarter of the year', s, W, H);
}

// ================================================================ rivals
{
  const sc = ECON + 'sectors.rs';
  const stakeMin = rconst(sc, 'RAID_STAKE_MIN_BPS'), stakeMax = rconst(sc, 'RAID_STAKE_MAX_BPS');
  const drag = rconst(sc, 'RAID_STAKE_DRAG_BPS');
  const body = rfn(sc, 'raid_quote');
  const [span] = lit(body, /\.clamp\(0, (\d[\d_]*)\)/, 'advantage span');
  const [lo, hi] = lit(body, /chance_bps: chance\.clamp\((\d+), (\d[\d_]*)\)/, 'chance clamp');
  const ratios = range(0.2 * 100, 6 * 100, 2).map((x) => x / 100);
  const stake = (r) => stakeMin + ((stakeMax - stakeMin) * Math.min(Math.max(r * 10000 - 10000, 0), span)) / span;
  const chance = (r) => Math.min(hi, Math.max(lo, (r / (r + 1)) * 10000 * (1 - (stake(r) * drag) / 10000 / 10000)));
  single('rivals-raid-odds.svg', 'Raid success chance and share of the division at stake against attack to defence ratio', {
    xmin: 0, xmax: 6, ymin: 0, ymax: 100, xticks: [0, 1, 2, 3, 4, 5, 6],
    xlabel: 'Attack spending / defence (ratio)', ylabel: 'Percent',
    series: [
      { pts: ratios.map((r) => [r, chance(r) / 100]), color: BLUE, label: 'Chance the raid succeeds' },
      { pts: ratios.map((r) => [r, stake(r) / 100]), color: RED, label: 'Share of the division at stake' },
    ],
    vlines: [{ x: 1, label: 'Even match' }],
  });
}
{
  const rv = ECON + 'rivalry.rs';
  const gd = rconst(rv, 'GRUDGE_DECAY_BPS'), floor = rconst(rv, 'FLOOR');
  const active = rconst(rv, 'ACTIVE'), hold = rconst(rv, 'VENTURE_HOLD');
  const weeks = 260;
  const path = (start) => {
    const pts = [[0, start]];
    let s = start;
    for (let w = 1; w <= weeks; w++) {
      s = s - Math.trunc((s * gd) / 10000) - 1;
      if (s < floor) break;
      pts.push([w, s]);
    }
    return pts;
  };
  const starts = [[1500, BLUE, '2 3'], [3600, BLUE, '6 4'], [5400, BLUE, null]];
  single('rivals-grudge-decay.svg', 'Grudge strength over time for three starting values', {
    xmin: 0, xmax: weeks, ymin: 0, ymax: 6000, xticks: [0, 52, 104, 156, 208, 260],
    xlabel: 'Weeks since the last hostile act', ylabel: 'Grudge strength (points)',
    series: [
      ...starts.map(([v, c, d]) => ({ pts: path(v), color: c, dash: d, label: `Start ${v.toLocaleString('en-US')}` })),
      { pts: [[0, hold], [weeks, hold]], color: RED, label: `Alliance held at ${hold.toLocaleString('en-US')} during a venture` },
    ],
    hlines: [
      { y: active, label: `Active (${active.toLocaleString('en-US')})`, color: GREY, left: true },
      { y: floor, label: `Forgotten, dropped below ${floor}`, color: GREY, left: true },
    ],
  }, 380);
}

// ================================================================ scenarios
{
  const ids = Object.keys(PP.scenarios);
  const style = {
    'great-lakes-2000': [BLUE, null],
    'texas-1981': [RED, null],
    'silicon-valley-1995': [BLUE, '6 4'],
    'ruhr-rhine-1991': [RED, '6 4'],
  };
  const series = [];
  let ymax = 0, xmax = 0;
  for (const id of ids) {
    const a = PP.scenarios[id].families.oil;
    const last = a[a.length - 1][0];
    xmax = Math.max(xmax, last);
    const pts = range(0, last * 13, 2).map((w) => [w / 13, interp(a, w / 13)]);
    ymax = Math.max(ymax, ...pts.map((p) => p[1]));
    series.push({ pts, color: style[id][0], dash: style[id][1], label: scenName(id) });
  }
  const chips = PP.scenarios['silicon-valley-1995'].families.electronics;
  const cl = chips[chips.length - 1][0];
  const cpts = range(0, cl * 13, 2).map((w) => [w / 13, interp(chips, w / 13)]);
  ymax = Math.max(ymax, ...cpts.map((p) => p[1]));
  series.push({ pts: cpts, color: GREY, dash: '2 3', width: 2, label: 'Silicon Valley chips and electronics' });
  single('scenarios-oil-paths.svg', 'Default oil price index for each scenario, plus chips and electronics for Silicon Valley', {
    xmin: 0, xmax, ymin: 0, ymax: Math.ceil(ymax / 100) * 100,
    xlabel: 'Quarters since the start', ylabel: 'Oil index (day one = 100)', series,
  }, 400);
}
