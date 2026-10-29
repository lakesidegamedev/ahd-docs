# Price Indexing & Nominal Repricing

**Status:** Partially shipped. The household price index described below now
exists; full nominal repricing of constants remains a plan.
Player guide: [Household Demand & Price Level](https://www.ahousedividedgame.com/wiki/household-economy) (the shipped household price index and real-income display). The nominal repricing layer in sections 2 to 9 has no player page because it is not shipped.

**Scope:** Cumulative price-level index per country, global weighted inflation series for the forex page, and a nominal-repricing layer for in-game constants (commodity base prices, action costs, startup capital).

**Reviewed against:** `src/lib/budget/inflation.ts`, `src/lib/turn/inflationRecalc.ts`, `src/lib/turn/interestRateSnapshot.ts`, `src/lib/db/types/marketCapHistory.ts`, `src/lib/constants/exchangeRegistry.ts`, `src/lib/constants/commodities.ts`, `docs/design/currency-exchange.md`.

---

## Shipped rules

| Constant | Value | Source |
| --- | --- | --- |
| `HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH` | 0.75 | `src/lib/economy/rules/householdPriceIndex.ts` |
| `HOUSEHOLD_PRICE_INDEX_BASELINE` | 1 | `src/lib/economy/rules/householdPriceIndex.ts` |
| `MIN_ANNUAL_INFLATION_PERCENT` | -100 | `src/lib/economy/rules/householdPriceIndex.ts` |
| `TURNS_PER_YEAR` | 48 | `src/lib/constants/turnTime.ts` |
| `FOREX_AND_MACRO_CHART_HISTORY_TURNS` | 240 (`TURNS_PER_YEAR * 5`) | `src/lib/constants/turnTime.ts` |
| `INERTIA` (inflation smoothing) | 0.35 | `src/lib/budget/inflation.ts` |
| `MEAN_REVERSION_COEFF` | 0.08 | `src/lib/budget/inflation.ts` |
| `MODERN_PRICE_LEVEL` | 1 | `src/lib/campaigns/rules/priceLevel.ts` |

Per-turn household price factor, with `x` the settled annual CPI in percent (clamped to at least -100):

```
annualFactor = 1 + 0.75 * x / 100
factor = annualFactor ^ (stepFraction / 48)      (stepFraction = 1 for a full turn, 0.5 for the half tick)
index_next = max(epsilon, index_prev * factor)
```

A year held at CPI `x` therefore moves the index by exactly `1 + 0.75 * x / 100`. Worked example: CPI held at 4% for 48 turns gives annualFactor 1.03, so the index ends the year at 1.03 (not 1.04). Median income of 50,000 deflated by an index of 1.03 reads as 48,544 in launch-price terms (`householdPriceAdjustedValue`).

The index is stored on `budget.economicFactors.householdPriceIndex` and read by the real-economy outlook (`src/lib/economy/queries/countryEconomyOutlook.ts`).

### Era campaign price level (shipped, separate from the index)

A second shipped repricing: `ERA_PRICE_LEVEL` in `src/lib/campaigns/rules/priceLevel.ts` scales campaign action fund costs and campaign income by world era so a 1953 world does not charge modern dollar amounts. It is gated by `campaignEraPriceLevelEnabled` (`src/lib/seeds/reference/featureFlagDefaults.ts`, on by default). Values are the US GDP per capita of the era divided by the 2019 value.

| Era | Price level |
| --- | --- |
| 1953 | 0.03673 |
| 1979 | 0.16688 |
| 1991 | 0.35808 |
| 1999 | 0.49707 |
| 2007 | 0.6562 |
| 2019 | 1 |
| 2023 | 1.14996 |
| 2027 | 1.28579 |

## Timing

The household index is advanced inside `inflationRecalc` (`src/lib/turn/inflationRecalc.ts`) immediately after that turn's inflation is settled, so it reads the settled rate. `interestRateSnapshot` runs later and independently. The half tick at :30 advances the index by half a turn and is stamped so a retried tick never applies twice. The era price level is not a turn pass; it is resolved at the shell boundary (action execute route and fund generation) from the world preset.

## Edge cases and limits

- **Missing, non-finite or non-positive previous index** reads as the baseline 1.
- **Missing or non-finite CPI** counts as 0, so the index holds still.
- **CPI below -100%** is clamped, which keeps the factor above 0. Deflation moves the index down; there is no upper cap.
- **One way only.** Nothing in inflation reads the index, so a price level can never feed back into CPI.
- **Not repriced:** commodity base prices, action costs, startup capital and forex baselines (sections 6c and 6d). Only the real-income display and the era campaign scalar use a price level today.
- **Unknown preset** resolves the era price level to 1 (modern behaviour).

## Connections

**Driven by**
- [Economic Systems](./economic-systems.md): the settled annual CPI from `src/lib/budget/inflation.ts` through `inflationRecalc`.
- [Currency Exchange](./currency-exchange.md): forex baselines stay fixed and are the cost-push reference.

**Affects**
- Real-income display: `countryEconomyOutlook.ts` deflates median income by the index.
- Campaign actions and fund generation: the era price level scales costs and income (`src/lib/campaigns/rules/priceLevel.ts`).

---

## 1. What the stored inflation value actually represents

The per-turn `budget.economicFactors.inflationRate` is an **annualized inflation estimate for this turn's conditions**. It is not a measured trailing 48-turn rate. Inflation uses `INERTIA = 0.35` plus mean reversion in `src/lib/budget/inflation.ts`.

The shipped country household index lives in
`src/lib/economy/rules/householdPriceIndex.ts`. It starts at 1.0 and advances each
turn by the 48th root of the annual passthrough factor (formula in the next section). The real-economy
panel uses it to deflate median income. It does not yet reprice commodity bases,
action costs, startup capital, or the other constants proposed later in this
document.

Consequence: we cannot sum/average these values across turns to get "cumulative inflation." We need a separately-maintained **price-level index**.

## 2. Price-level index - math bridge

- Fix `TURNS_PER_YEAR = 48` (already constant in `turnTime.ts`).
- Convention: the per-turn compounding factor is
  `factor_t = (1 + π_t/100)^(1/48)`
  where `π_t` is the stored annualized rate for turn `t`.
- Country price level: `P_{t+1}^c = P_t^c × factor_t^c`, with `P_0^c = 100` at a fixed **base turn** (recommend the first turn the index ships; or game genesis, with backfill from existing `inflationHistory` for the subset of turns still retained).
- "Cumulative inflation since base" = `P_t / P_0 - 1` (derive in UI; don't store the delta).

**Note on convention:** This is a forward-looking compounding of a rolling annualized estimate - not a retrospective YoY. Document this so nobody later "fixes" it by replacing with a 48-turn trailing average (which would subtly change the meaning of the index).

## 3. Storage - a separate, uncapped collection

`CentralBank.inflationHistory` is pruned to `FOREX_AND_MACRO_CHART_HISTORY_TURNS` (240 turns = 5 in-game years). A cumulative index **must not** live in a capped ring buffer or it loses its base.

Proposal:

- **New collection `priceLevelHistory`**
  ```ts
  interface PriceLevelSnapshot {
    _id: ObjectId;
    countryId: CountryId; // or "global"
    turn: number;
    level: number; // P_t, with P at baseTurn = 100
    yoyAnnualized: number; // source signal that was compounded this turn (for audit)
  }
  ```
  Indexed `{ countryId: 1, turn: 1 }` unique, and `{ turn: 1 }` for global queries. **Uncapped.**
- **New doc `priceLevels` (one per country + one `_id: "global"`)**
  ```ts
  interface PriceLevelState {
    _id: CountryId | "global";
    baseTurn: number;
    baseValue: 100;
    level: number; // current P_t
    lastTurn: number;
    updatedAt: Date;
  }
  ```
  Single-row "current" read path; the history collection is for charting and backfill.

Why two: the "current" doc gives O(1) reads for the repricing resolver (hot path); the history collection gives charting without inflating the central-bank document.

## 4. Global weighted inflation series

For the forex page's per-turn global number:

```
π_global_t = Σ_c w_{c,t} × π_{c,t}
```

### 4a. Weight choice - recommended default: GDP

Market-cap weighting creates a feedback loop: high-inflation country → nominal market cap up → larger weight in global inflation → loops back into macro signals the chart plots. Options:

| Weight                                      | Pros                                      | Cons                                         |
| ------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| **GDP (same-turn)**                         | Smoother, inflation-neutral in real terms | Also drifts w/ nominal GDP growth            |
| **Real market cap** (cap / own price level) | Removes inflation feedback                | Adds one extra division, less intuitive      |
| **Lagged market cap (t-1)**                 | Simple, breaks tight feedback             | Still nominal; minor feedback at cycle scale |
| **Market cap (same-turn)**                  | Most "financial-markets" flavor           | Strong feedback loop (reject)                |

**Default for the cumulative global index: GDP-weighted.**
**Acceptable for the forex-page YoY chart (where financial-market context is appropriate): lagged market cap, read from `marketCapHistory.exchangeCaps`** via `exchangeRegistry`'s 1:1 exchange↔country mapping. These can legitimately be two different series - label both clearly.

### 4b. Global price level

Compound the weighted per-period factor into a **global** `priceLevels` row keyed `_id: "global"`. Use the **same weights** each turn for internal consistency (weight by GDP share **or** cap share - don't mix per panel).

## 5. API + chart

- Extend `GET /api/forex/monetary-policy` (or add a sibling `/api/forex/inflation-global`) to return:
  - per-country `inflationHistory` (already shipped - YoY per turn)
  - per-country `priceLevelHistory` (new, cumulative)
  - global `inflationHistory` (weighted YoY per turn)
  - global `priceLevelHistory` (cumulative)
  - the weight basis used (`"gdp"` or `"marketCap_t-1"`) so the client can label the series honestly.
- **New dedicated chart** on the forex monetary-policy tab - "Global inflation tracker" - with two modes:
  - **YoY** (shows per-country lines + global weighted line)
  - **Cumulative** (shows per-country `P_t/P_0 - 1` + global `P_t/P_0 - 1`)
- Do **not** overload `GlobalMonetaryPolicyChart.tsx` - it already multiplexes inflation/interest/GDP with a metric picker.

## 6. Nominal repricing layer

### 6a. Rule

- **Constants stay in real (2020-era) terms.** `COMMODITY_BASE_PRICES`, any startup-capital scalar, action-cost scalars.
- **In-flight balances stay nominal.** `currencyBalances.*`, party treasury, corporation cash. Do not re-scale these - doing so double-scales when they are spent against a nominal constant that is also being scaled.
- A single resolver converts constants → runtime amounts at read time:
  ```ts
  nominalCredits(realBase: number, countryId: CountryId | "global", turn?: number): number
  ```
  Implementation: `realBase × priceLevels[{countryId or "global"}].level / 100`.

### 6b. Per-country vs global deflator

Default: **per-country**. A US player's action cost is scaled by US's price level; a JP player's by JP's. This is fairer cross-country.

Override to global: a small whitelist (effectively "the world market") - e.g. `COMMODITY_BASE_PRICES`, the anchor for `commodityPressure`. The resolver accepts `"global"` as an explicit scope.

### 6c. Forex baselines and commodity base prices are NOT repriced

- `ExchangeRate.baseRate` - "initial calibration, never changes" per `currency-exchange.md`. **Leave fixed.** `forexPressure = rate/baseRate - 1` is the cost-push signal - rebasing kills it.
- `COMMODITY_BASE_PRICES` - anchors `commodityPressure = P_national/basePrice - 1`. **Leave fixed.** If we later want basePrice to track inflation, `commodityPressure` must be redefined as a velocity signal; that is a **separate** design decision and out of scope for this doc.

### 6d. What the resolver applies to (audit)

The plan's "inventory" must be a grep-based discovery, not a guess. Starting commands:

```bash
grep -rn "funds:\s*[0-9]\|cashOnHand:\s*[0-9]" src/     # startup/hardcoded funds
grep -rn "estimatedCost\|COST\|_COST\s*=" src/lib        # action/fundraise cost constants
grep -rn "COMMODITY_BASE_PRICES\|basePrice\b" src/       # commodity anchors (most are off-limits - see 6c)
grep -rn "STARTING_\|INITIAL_\|DEFAULT_" src/lib/constants
```

For each hit, decide: (a) real constant → route through resolver, (b) already nominal balance → leave alone, (c) locked anchor (forex baseline, commodity base) → **do not touch**.

## 7. Feedback-loop check (mandatory before ship)

Add a test that simulates a one-shot rate shock and verifies inflation/forex/commodity-pressure **converge** rather than diverge over, say, 100 turns. Flag anything that explodes.

## 8. Golden tests

- Flat 2% YoY for 48 consecutive turns → cumulative `P_48/P_0 - 1 ≈ 0.02` (within a documented ε for the compounding approximation).
- `nominalCredits(realBase, c, t)` round-trip: `realFromNominal(nominalCredits(x, c, t), c, t) === x` within ε.
- Global weighted YoY for a hand-constructed 3-country fixture matches manual arithmetic under both GDP and market-cap weights.
- Turn-ordering test: index writer runs **after** `inflationRecalc` (so it reads the settled rate) and **independently of** `interestRateSnapshot` (which still writes the capped history for charts).

## 9. Phased sequencing

1. **Math + storage** - write `priceLevels` + `priceLevelHistory`, add the writer phase, seed one base snapshot. No consumers yet.
2. **Validate** - let it run one game-day (48 turns) in dev; sanity-check that a flat 2% produces ~2% cumulative.
3. **Forex page series** - add API fields + dedicated "Global inflation tracker" chart. Only after (2) is stable.
4. **Repricing layer** - introduce `nominalCredits()` resolver; audit constants via greps in 6d; route real constants through the resolver. Nominal balances untouched.
5. **Docs** - update `currency-exchange.md` and `economic-systems.md` with links to this doc and the weight-basis decision.

## 10. Known tensions / open questions

- **Index base turn when backfilled vs fresh start.** If we backfill from existing `inflationHistory` (which only retains the last 240 turns), the base will be "240 turns ago," not game genesis. Fine for a soft launch but the chart legend should say "since turn N" rather than "since game start."
- **Currency redenomination is not in scope.** If inflation runs very hot for a very long time, nominal balances will eventually look absurd ("¥500,000 action cost"). Handling that is a future product decision (either redenominate or cap cumulative drift), not something this layer solves.
- **Admin debug UI** - a single page showing each country's current `level`, weight-basis used, and last N periods of compounding factors would make the feedback-loop check and balance tuning dramatically easier. Not required for v1 but strongly recommended before shipping the repricing layer.

Last checked: 2026-10-29, version 1.18.0
