// Regenerates the Margin of Victory documentation charts (SVG) from the game's own source.
//
//   GAME_REPO_PATH=/path/to/MOVGame node games/margin-of-victory/charts/build-charts.mjs
//
// GAME_REPO_PATH defaults to a MOVGame checkout beside this docs repo. Every game number is read
// from the game's files at run time (parsed from `const` lines, inline literals in the formulas,
// or imported from the pure scoring module). Nothing is typed in by hand; if a pattern stops
// matching, the script fails loudly instead of drawing stale numbers.
// Output: ../images/<page-stem>-<name>.svg

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GAME = process.env.GAME_REPO_PATH || new URL('../../../../MOVGame', import.meta.url).pathname.replace(/\/$/, '');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../images");
mkdirSync(OUT, { recursive: true });

const src = (rel) => readFileSync(join(GAME, rel), "utf8");
const ACTIONS = src("src/engine/actions.ts");
const TURN = src("src/engine/turn.ts");
const POLLS = src("src/engine/polls.ts");
const BLOCS_SRC = src("src/content/blocs.ts");
const STATES = src("src/content/states.ts");
const SCORING = src("src/engine/scoring.ts");

// ---------- source readers ----------
function grab(text, re, what) {
  const m = text.match(re);
  if (!m) throw new Error(`Could not find ${what} in game source (pattern ${re})`);
  return m.slice(1).map(Number);
}
const num = (text, re, what) => grab(text, re, what)[0];

const CEILING = num(ACTIONS, /const ceiling = ([\d.]+);/, "saturate ceiling");
const LEAN_RESIST = num(ACTIONS, /1 \/ \(1 \+ Math\.abs\(bloc\.baselineMargin\) \* ([\d.]+)\)/, "lean resist");
const AD_SAT = num(ACTIONS, /const AD_SAT = ([\d.]+);/, "AD_SAT");
const GROUND_STEP = num(ACTIONS, /state\.groundGame\[c\] = Math\.min\(1, state\.groundGame\[c\] \+ ([\d.]+)\)/, "ground game step");
const [GOTV_K, GOTV_BASE] = grab(ACTIONS, /saturate\(bloc, ([\d.]+) \* ground \* \(([\d.]+) \+ propensity\)\)/, "GOTV formula");
const STATE_DECAY = num(TURN, /st\.momentum \*= ([\d.]+);/, "state momentum decay");
const NAT_DECAY = num(TURN, /res\.nationalMomentum \*= ([\d.]+);/, "national momentum decay");

const mediaCosts = [...STATES.matchAll(/mediaCost: ([\d.]+),/g)].map((m) => Number(m[1]));
if (mediaCosts.length < 40) throw new Error("media market costs not found");
const MARKET_MIN = Math.min(...mediaCosts);
const MARKET_MAX = Math.max(...mediaCosts);
const MARKET_MID = 1.0; // the neutral multiplier; asserted below
if (!mediaCosts.includes(MARKET_MID)) throw new Error("no state has a 1.0 media market");

const BLOCS = [...BLOCS_SRC.matchAll(/name: "([^"]+)",\s*nationalShare: ([\d.]+),\s*turnoutPropensity: ([\d.]+),/g)].map((m) => ({
  name: m[1], share: Number(m[2]), turnout: Number(m[3]),
}));
if (BLOCS.length !== 8) throw new Error(`expected 8 blocs, found ${BLOCS.length}`);

const POLLSTERS = [...POLLS.matchAll(/\{ name: "([^"]+)", house: (-?[\d.]+), n: (\d+) \}/g)].map((m) => ({
  name: m[1], house: Number(m[2]), n: Number(m[3]),
}));
if (POLLSTERS.length < 3) throw new Error("pollsters not found");
const MOE_Z = num(POLLS, /const moe = ([\d.]+) \* Math\.sqrt/, "moe z");
const NOISE_K = num(POLLS, /rng\.normal\(0, moe \* ([\d.]+)\)/, "noise factor");

const { computeScoreFromFacts, DIFFICULTY_MULTIPLIER } = await import(pathToFileURL(join(GAME, "src/engine/scoring.ts")).href);
const EV_RE = /const evScore = clampScore\(f\.unitMargin \* norm \* ([\d.]+), (-?[\d.]+), ([\d.]+)\)/;
const [EV_PER_POINT, , EV_HI] = grab(SCORING, EV_RE, "ev score clamp");
const WIN_LINE = num(SCORING, /unitMargin: \(result\.electoralVotes\[player\] \?\? 0\) - (\d+),/, "win line");
const CAP_EV = WIN_LINE + EV_HI / EV_PER_POINT; // 336.67 -> labelled 337

const { PLAN_BONUSES } = await import(pathToFileURL(join(GAME, "src/engine/planBonuses.ts")).href);

// ---------- svg helpers ----------
const W = 640, H = 360;
const BLUE = "#2563eb", RED = "#dc2626", INK = "#27272a", MUTE = "#52525b", GRID = "#e4e4e7";
const f = (x) => (Math.round(x * 100) / 100).toString();
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function frame(title, body, w = W, h = H) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#ffffff" stroke="#d4d4d8"/>
<text x="${w / 2}" y="24" text-anchor="middle" font-size="15" font-weight="600" fill="${INK}">${esc(title)}</text>
${body}
</svg>
`;
}

// Generic line chart. series: [{name,color,pts:[[x,y]],dash?}]
function lineChart({ title, xLabel, yLabel, xMin, xMax, yMin, yMax, xTicks, yTicks, series, extras = "", fmtX = f, fmtY = f, legendAt = "tr" }) {
  const L = 62, R = 24, T = 44, B = 56;
  const pw = W - L - R, ph = H - T - B;
  const X = (x) => L + ((x - xMin) / (xMax - xMin)) * pw;
  const Y = (y) => T + ph - ((y - yMin) / (yMax - yMin)) * ph;
  let s = "";
  for (const t of yTicks) s += `<line x1="${L}" x2="${L + pw}" y1="${f(Y(t))}" y2="${f(Y(t))}" stroke="${GRID}"/><text x="${L - 8}" y="${f(Y(t) + 4)}" text-anchor="end" font-size="12" fill="${MUTE}">${fmtY(t)}</text>`;
  for (const t of xTicks) s += `<line x1="${f(X(t))}" x2="${f(X(t))}" y1="${T}" y2="${T + ph}" stroke="${GRID}"/><text x="${f(X(t))}" y="${T + ph + 18}" text-anchor="middle" font-size="12" fill="${MUTE}">${fmtX(t)}</text>`;
  s += `<rect x="${L}" y="${T}" width="${pw}" height="${ph}" fill="none" stroke="#a1a1aa"/>`;
  s += `<text x="${L + pw / 2}" y="${H - 12}" text-anchor="middle" font-size="13" fill="${INK}">${esc(xLabel)}</text>`;
  s += `<text transform="translate(16 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${INK}">${esc(yLabel)}</text>`;
  s += extras;
  const ctx = { X, Y, L, T, pw, ph };
  series.forEach((se) => {
    const d = se.pts.map(([x, y], i) => `${i ? "L" : "M"}${f(X(x))} ${f(Y(y))}`).join(" ");
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2.5"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""} stroke-linejoin="round"/>`;
    if (se.dots) for (const [x, y] of se.pts) s += `<circle cx="${f(X(x))}" cy="${f(Y(y))}" r="3.5" fill="${se.color}"/>`;
  });
  // legend
  const lx = legendAt === "tr" ? L + pw - 190 : legendAt === "br" ? L + pw - 215 : L + 12;
  series.forEach((se, i) => {
    const ly = legendAt === "br" ? T + ph - 12 - (series.length - 1 - i) * 18 : T + 16 + i * 18;
    s += `<line x1="${lx}" x2="${lx + 22}" y1="${ly - 4}" y2="${ly - 4}" stroke="${se.color}" stroke-width="2.5"${se.dash ? ` stroke-dasharray="${se.dash}"` : ""}/><text x="${lx + 28}" y="${ly}" font-size="12" fill="${INK}">${esc(se.name)}</text>`;
  });
  return { body: s, ctx };
}

const write = (name, svg) => { writeFileSync(join(OUT, name), svg); console.log("wrote", name); };
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

// ---------- 1. ad reach vs spend ----------
{
  const reach = (spend, market) => AD_SAT * (1 - Math.exp(-spend / market / AD_SAT));
  const mk = (m, color, dash) => ({ name: `Media market ${m} ($1 buys ${f(1 / m)}x)`, color, dash, pts: range(0, 30, 60).map((s) => [s, reach(s, m)]) });
  const series = [mk(MARKET_MIN, BLUE, "6 4"), mk(MARKET_MID, INK), mk(MARKET_MAX, RED, "2 3")];
  const { body, ctx } = lineChart({
    title: "Advertising: reach versus spend", xLabel: "Spend in one ad buy ($ millions)", yLabel: "Effective reach (ad reach units)",
    xMin: 0, xMax: 30, yMin: 0, yMax: AD_SAT + 0.5, xTicks: [0, 5, 10, 15, 20, 25, 30], yTicks: range(0, AD_SAT, AD_SAT),
    series, legendAt: "br",
  });
  const cap = `<line x1="${ctx.L}" x2="${ctx.L + ctx.pw}" y1="${f(ctx.Y(AD_SAT))}" y2="${f(ctx.Y(AD_SAT))}" stroke="#a1a1aa" stroke-dasharray="4 4"/><text x="${ctx.L + ctx.pw - 6}" y="${f(ctx.Y(AD_SAT) - 5)}" text-anchor="end" font-size="12" fill="${MUTE}">Ceiling ${AD_SAT}</text>`;
  write("campaign-actions-ad-reach.svg", frame("Advertising: reach versus spend", body + cap));
}

// ---------- 2. GOTV by bloc (bars) and by field offices (line) ----------
const gotv = (ground, turnout) => GOTV_K * ground * (GOTV_BASE + (1 - turnout));
{
  const rows = BLOCS.map((b) => ({ ...b, v: gotv(1, b.turnout) })).sort((a, b) => b.v - a.v);
  const L = 200, R = 50, T = 48, rowH = 32, B = 56;
  const pw = W - L - R;
  const max = Math.ceil(Math.max(...rows.map((r) => r.v)) * 100) / 100;
  const X = (v) => L + (v / max) * pw;
  let s = "";
  for (const t of range(0, max, 4)) s += `<line x1="${f(X(t))}" x2="${f(X(t))}" y1="${T - 6}" y2="${T + rows.length * rowH}" stroke="${GRID}"/><text x="${f(X(t))}" y="${T + rows.length * rowH + 16}" text-anchor="middle" font-size="12" fill="${MUTE}">${t.toFixed(3)}</text>`;
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    s += `<text x="${L - 8}" y="${y + 19}" text-anchor="end" font-size="12" fill="${INK}">${esc(r.name)}</text><rect x="${L}" y="${y + 5}" width="${f(X(r.v) - L)}" height="20" fill="${BLUE}"/><text x="${f(X(r.v) + 5)}" y="${y + 20}" font-size="12" fill="${INK}">${r.v.toFixed(3)}</text>`;
  });
  s += `<text x="${L + pw / 2}" y="${H - 12}" text-anchor="middle" font-size="13" fill="${INK}">Margin shift per GOTV action, before saturation (vote scale)</text>`;
  write("campaign-actions-gotv-by-bloc.svg", frame(`GOTV shift by bloc at ground game ${f(1)}`, s));
}
{
  const avgTurnout = BLOCS.reduce((a, b) => a + b.share * b.turnout, 0) / BLOCS.reduce((a, b) => a + b.share, 0);
  const pts = [1, 2, 3, 4, 5].map((n) => [n, gotv(n * GROUND_STEP, avgTurnout)]);
  const top = Math.ceil(pts[4][1] * 100) / 100;
  const { body } = lineChart({
    title: "GOTV shift by field offices", xLabel: `Field offices built (ground game +${GROUND_STEP} each)`, yLabel: "Margin shift per GOTV action (vote scale)",
    xMin: 1, xMax: 5, yMin: 0, yMax: top, xTicks: [1, 2, 3, 4, 5], yTicks: range(0, top, 4),
    series: [{ name: `Average bloc (turnout ${avgTurnout.toFixed(2)})`, color: RED, pts, dots: true }],
    fmtY: (v) => v.toFixed(3), legendAt: "bl",
  });
  write("campaign-actions-gotv-by-offices.svg", frame("GOTV shift by field offices", body));
}

// ---------- 3. saturation ----------
{
  const pts = range(0, CEILING, 70).map((x) => [x, Math.max(0, 1 - Math.abs(x) / CEILING)]);
  const { body } = lineChart({
    title: "Diminishing returns on repeat pushes", xLabel: "Shift already achieved in the bloc (vote scale)", yLabel: "Share of a fresh push's effect",
    xMin: 0, xMax: CEILING, yMin: 0, yMax: 1, xTicks: range(0, CEILING, 7), yTicks: [0, 0.25, 0.5, 0.75, 1],
    series: [{ name: `Room left (ceiling ${CEILING})`, color: BLUE, pts }], fmtX: (v) => v.toFixed(1), fmtY: (v) => `${Math.round(v * 100)}%`, legendAt: "bl",
  });
  write("campaign-actions-saturation.svg", frame("Diminishing returns on repeat pushes", body));
  void LEAN_RESIST;
}

// ---------- 4. momentum fade ----------
{
  const weeks = range(0, 8, 8);
  const { body } = lineChart({
    title: "Momentum fade after a 100 point peak", xLabel: "Weeks after the peak", yLabel: "Momentum remaining (start = 100)",
    xMin: 0, xMax: 8, yMin: 0, yMax: 100, xTicks: weeks, yTicks: [0, 25, 50, 75, 100],
    series: [
      { name: `National momentum (x${NAT_DECAY} per week)`, color: BLUE, pts: weeks.map((w) => [w, 100 * NAT_DECAY ** w]), dots: true },
      { name: `State momentum (x${STATE_DECAY} per week)`, color: RED, pts: weeks.map((w) => [w, 100 * STATE_DECAY ** w]), dots: true },
    ],
  });
  write("the-campaign-week-momentum-fade.svg", frame("Momentum fade after a 100 point peak", body));
}

// ---------- 5. score vs electoral votes ----------
{
  const LEAD = 4.5;
  const score = (ev, d) => computeScoreFromFacts({ unitMargin: ev - WIN_LINE, chamberSize: 538, popularMargin: LEAD, difficulty: d });
  const evs = range(200, 400, 100);
  const diffs = [["easy", "Easy", BLUE, "6 4"], ["normal", "Normal", INK, null], ["hard", "Hard", RED, "2 3"]];
  const { body, ctx } = lineChart({
    title: `Score versus electoral votes (popular vote lead ${LEAD} points)`, xLabel: "Electoral votes won (of 538)", yLabel: "Score (0 to 1000)",
    xMin: 200, xMax: 400, yMin: 0, yMax: 1000, xTicks: [200, 250, 300, 350, 400], yTicks: [0, 250, 500, 750, 1000],
    series: diffs.map(([k, n, c, d]) => ({ name: `${n} (x${DIFFICULTY_MULTIPLIER[k]})`, color: c, dash: d, pts: evs.map((e) => [e, score(e, k)]) })),
    legendAt: "bl",
  });
  const cx = ctx.X(CAP_EV);
  const mark = `<line x1="${f(cx)}" x2="${f(cx)}" y1="${ctx.T}" y2="${ctx.T + ctx.ph}" stroke="#a1a1aa" stroke-dasharray="4 4"/><text x="${f(cx - 6)}" y="${ctx.T + ctx.ph - 8}" text-anchor="end" font-size="12" fill="${MUTE}">Electoral vote bonus caps at ${Math.round(CAP_EV)}</text>`;
  write("polls-and-scoring-score-curve.svg", frame(`Score versus electoral votes (popular vote lead ${LEAD} points)`, body + mark));
}

// ---------- 6. poll noise ----------
{
  const sd = (p) => (MOE_Z * Math.sqrt(0.25 / p.n) * NOISE_K) * 100; // points
  const sds = POLLSTERS.map(sd);
  const singleSd = Math.sqrt(sds.reduce((a, s) => a + s * s, 0) / sds.length);
  const avgSd = Math.sqrt(sds.reduce((a, s) => a + s * s, 0)) / sds.length;
  const house = (POLLSTERS.reduce((a, p) => a + p.house, 0) / POLLSTERS.length) * 100;
  const TRUE = 50;
  const pdf = (x, mu, s) => Math.exp(-0.5 * ((x - mu) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));
  const xs = range(TRUE - 7, TRUE + 7, 140);
  const yMax = Math.ceil(pdf(TRUE + house, TRUE + house, avgSd) * 10) / 10;
  const { body, ctx } = lineChart({
    title: "Where a reported poll lands when the true share is 50%", xLabel: "Reported two-party share (%)", yLabel: "Relative likelihood",
    xMin: TRUE - 7, xMax: TRUE + 7, yMin: 0, yMax, xTicks: range(TRUE - 6, TRUE + 6, 6), yTicks: [0],
    series: [
      { name: `One poll (typical error ${f(singleSd)} points)`, color: RED, pts: xs.map((x) => [x, pdf(x, TRUE + house, singleSd)]) },
      { name: `Five poll average (error ${f(avgSd)} points)`, color: BLUE, pts: xs.map((x) => [x, pdf(x, TRUE + house, avgSd)]) },
    ],
    legendAt: "bl",
  });
  const tx = ctx.X(TRUE);
  const mark = `<line x1="${f(tx)}" x2="${f(tx)}" y1="${ctx.T}" y2="${ctx.T + ctx.ph}" stroke="#a1a1aa" stroke-dasharray="4 4"/><text x="${f(tx + 5)}" y="${ctx.T + ctx.ph - 8}" font-size="12" fill="${MUTE}">True share</text>`;
  const band = `<rect x="${f(ctx.X(TRUE + house - avgSd))}" y="${ctx.T}" width="${f(ctx.X(TRUE + house + avgSd) - ctx.X(TRUE + house - avgSd))}" height="${ctx.ph}" fill="${BLUE}" opacity="0.10"/>`;
  write("polls-and-scoring-poll-error.svg", frame("Where a reported poll lands when the true share is 50%", band + body + mark));
  // The shaded band is one standard deviation of the five poll average.
}

// ---------- 7. blocs ----------
{
  const rows = [...BLOCS].sort((a, b) => b.share - a.share);
  const L = 210, R = 40, T = 66, rowH = 30;
  const H2 = T + rows.length * rowH + 52;
  const pw = W - L - R;
  const X = (v) => L + v * pw;
  let s = "";
  for (const t of [0, 0.2, 0.4, 0.6, 0.8]) s += `<line x1="${f(X(t))}" x2="${f(X(t))}" y1="${T - 6}" y2="${T + rows.length * rowH}" stroke="${GRID}"/><text x="${f(X(t))}" y="${T + rows.length * rowH + 16}" text-anchor="middle" font-size="12" fill="${MUTE}">${Math.round(t * 100)}%</text>`;
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    s += `<text x="${L - 8}" y="${y + 18}" text-anchor="end" font-size="12" fill="${INK}">${esc(r.name)}</text>`;
    s += `<rect x="${L}" y="${y + 2}" width="${f(X(r.share) - L)}" height="12" fill="${BLUE}"/><text x="${f(X(r.share) + 4)}" y="${y + 12}" font-size="11" fill="${INK}">${Math.round(r.share * 100)}%</text>`;
    s += `<rect x="${L}" y="${y + 15}" width="${f(X(r.turnout) - L)}" height="12" fill="${RED}"/><text x="${f(X(r.turnout) + 4)}" y="${y + 25}" font-size="11" fill="${INK}">${Math.round(r.turnout * 100)}%</text>`;
  });
  s += `<rect x="${L}" y="36" width="12" height="12" fill="${BLUE}"/><text x="${L + 18}" y="47" font-size="12" fill="${INK}">Share of the national electorate</text>`;
  s += `<rect x="${L + 265}" y="36" width="12" height="12" fill="${RED}"/><text x="${L + 283}" y="47" font-size="12" fill="${INK}">Base turnout</text>`;
  s += `<text x="${L + pw / 2}" y="${H2 - 12}" text-anchor="middle" font-size="13" fill="${INK}">Percent</text>`;
  write("voter-blocs-share-and-turnout.svg", frame("The eight voter blocs", s, W, H2));
}

// ---------- 8. plan bonus diagram (multipliers read from PLAN_BONUSES) ----------
{
  const rows = PLAN_BONUSES;
  const rowH = 62, T = 74, h = T + rows.length * rowH + 40;
  const [setupOf, payoffOf] = [(r) => r.recipe.split("->")[0].trim(), (r) => r.recipe.split("->")[1].trim()];
  const label = { Rally: "Rally", ads: "Ads", Field: "Field offices", GOTV: "GOTV", Policy: "Policy prep", issue: "Issue pivot or issue ad", Oppo: "Opposition research", contrast: "Contrast ads" };
  let s = `<text x="130" y="58" text-anchor="middle" font-size="12" fill="${MUTE}">Setup (earlier day)</text><text x="510" y="58" text-anchor="middle" font-size="12" fill="${MUTE}">Payoff (later day, same state)</text>`;
  s += `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0 0L10 5L0 10z" fill="${BLUE}"/></marker></defs>`;
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    s += `<rect x="30" y="${y}" width="200" height="40" rx="6" fill="#eff6ff" stroke="${BLUE}"/><text x="130" y="${y + 25}" text-anchor="middle" font-size="14" fill="${INK}">${esc(label[setupOf(r)] ?? setupOf(r))}</text>`;
    s += `<rect x="410" y="${y}" width="200" height="40" rx="6" fill="#fef2f2" stroke="${RED}"/><text x="510" y="${y + 25}" text-anchor="middle" font-size="14" fill="${INK}">${esc(label[payoffOf(r)] ?? payoffOf(r))}</text>`;
    s += `<line x1="232" x2="406" y1="${y + 20}" y2="${y + 20}" stroke="${BLUE}" stroke-width="2.5" marker-end="url(#a)"/>`;
    s += `<text x="320" y="${y + 14}" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}">x${r.multiplier}</text><text x="320" y="${y + 36}" text-anchor="middle" font-size="11" fill="${MUTE}">${esc(r.name)}</text>`;
  });
  write("campaign-actions-plan-bonuses.svg", frame("Plan bonuses: set up first, pay off later", s, W, h));
}

console.log(`Constants: ceiling=${CEILING} AD_SAT=${AD_SAT} markets=${MARKET_MIN}..${MARKET_MAX} gotv=${GOTV_K}/${GOTV_BASE} ground=${GROUND_STEP} decay=${STATE_DECAY}/${NAT_DECAY} cap=${CAP_EV.toFixed(2)}`);
