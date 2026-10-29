# Price Indexing & Nominal Repricing

## Summary

**Status:** Partially shipped. The household price index exists and drives the real-income display, and the era campaign price level scales campaign costs and income. Full nominal repricing of constants remains a plan and is kept below under Rules as a proposal.

Player guide: [Household Demand & Price Level](https://www.ahousedividedgame.com/wiki/household-economy) (the shipped household price index and real-income display). The planned nominal repricing layer has no player page because it is not shipped.

**Scope:** a cumulative household price index per country, an era campaign price scalar, and (planned) a global weighted inflation series for the forex page plus a nominal-repricing layer for in-game constants (commodity base prices, action costs, startup capital).

**Reviewed against:** `src/lib/budget/inflation.ts`, `src/lib/turn/inflationRecalc.ts`, `src/lib/turn/interestRateSnapshot.ts`, `src/lib/economy/rules/householdPriceIndex.ts`, `src/lib/campaigns/rules/priceLevel.ts`, `src/lib/db/types/marketCapHistory.ts`, `src/lib/constants/exchangeRegistry.ts`, `src/lib/constants/commodities.ts`, [Currency Exchange](./currency-exchange.md).

## Rules

### Shipped household price index

| Constant | Value | Source |
| --- | --- | --- |
| `HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH` | 0.75 | `src/lib/economy/rules/householdPriceIndex.ts` |
| `HOUSEHOLD_PRICE_INDEX_BASELINE` | 1 | `src/lib/economy/rules/householdPriceIndex.ts` |
| `MIN_ANNUAL_INFLATION_PERCENT` | -100 (module-private, not exported) | `src/lib/economy/rules/householdPriceIndex.ts` |
| `TURNS_PER_YEAR` | 48 | `src/lib/constants/turnTime.ts` |
| `FOREX_AND_MACRO_CHART_HISTORY_TURNS` | 240 (`TURNS_PER_YEAR * 5`) | `src/lib/constants/turnTime.ts` |
| `INERTIA` (inflation smoothing, module-private) | 0.35 | `src/lib/budget/inflation.ts` |
| `MEAN_REVERSION_COEFF` (module-private) | 0.08 | `src/lib/budget/inflation.ts` |
| `MODERN_PRICE_LEVEL` | 1 | `src/lib/campaigns/rules/priceLevel.ts` |

Per-turn household price factor, with `x` the settled annual CPI in percent (clamped to at least -100):

```
annualFactor = 1 + 0.75 * x / 100
factor = annualFactor ^ (stepFraction / 48)      (stepFraction = 1 for a full turn, 0.5 for the half tick)
index_next = max(epsilon, index_prev * factor)   (epsilon = Number.EPSILON)
```

A year held at CPI `x` therefore moves the index by exactly `1 + 0.75 * x / 100`. When CPI changes between turns, each turn contributes its own 48th root of its own annual factor, so a year of varying CPI lands on the geometric mean of the observed annual factors. Worked example: CPI held at 4% for 48 turns gives annualFactor 1.03, so the index ends the year at 1.03 (not 1.04). Median income of 50,000 deflated by an index of 1.03 reads as 48,544 in launch-price terms (`householdPriceAdjustedValue`, which divides by the index).

The index is stored on `federalBudget.economicFactors.householdPriceIndex` and read by the real-economy outlook (`src/lib/economy/queries/countryEconomyOutlook.ts`).

### Era campaign price level (shipped, separate from the index)

A second shipped repricing: `ERA_PRICE_LEVEL` in `src/lib/campaigns/rules/priceLevel.ts` scales campaign action fund costs and campaign income by world era so a 1953 world does not charge modern dollar amounts. It is gated by `campaignEraPriceLevelEnabled` on `gameConfig`; the shell reads it with the world preset in `loadCampaignPriceLevel` (`src/lib/campaigns/campaignCurrency.ts`) and passes the resolved scalar into the pure cost formulas (`getCampaignFundCost`, `fundraiseYieldAnchor` and others in `src/lib/actions/rules.ts`). Values are the US nominal GDP per capita of the era divided by the 2019 value, rounded to 5 decimals.

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

`resolveCampaignPriceLevel(enabled, presetOrEra)` returns 1 unless `enabled === true`. `eraPriceLevelFor` accepts an era id or a reset preset id; anything unrecognised folds onto the 2019 era and resolves to 1.


### Planned nominal repricing layer (not shipped)

Everything under this heading is a proposal. None of it exists in code: a search of `src` finds no `priceLevels` or `priceLevelHistory` collection and no `nominalCredits` resolver. Section numbers are kept so earlier references still resolve.

#### 1. What the stored inflation value actually represents

The per-turn `budget.economicFactors.inflationRate` is an **annualized inflation estimate for this turn's conditions**. It is not a measured trailing 48-turn rate. Inflation uses `INERTIA = 0.35` plus mean reversion in `src/lib/budget/inflation.ts`.

The shipped country household index lives in
`src/lib/economy/rules/householdPriceIndex.ts`. It starts at 1.0 and advances each
turn by the 48th root of the annual passthrough factor (formula in the next section). The real-economy
panel uses it to deflate median income. It does not yet reprice commodity bases,
action costs, startup capital, or the other constants proposed later in this
document.

Consequence: we cannot sum/average these values across turns to get "cumulative inflation." We need a separately-maintained **price-level index**.

#### 2. Price-level index - math bridge

- Fix `TURNS_PER_YEAR = 48` (already constant in `turnTime.ts`).
- Convention: the per-turn compounding factor is
  `factor_t = (1 + π_t/100)^(1/48)`
  where `π_t` is the stored annualized rate for turn `t`.
- Country price level: `P_{t+1}^c = P_t^c × factor_t^c`, with `P_0^c = 100` at a fixed **base turn** (recommend the first turn the index ships; or game genesis, with backfill from existing `inflationHistory` for the subset of turns still retained).
- "Cumulative inflation since base" = `P_t / P_0 - 1` (derive in UI; don't store the delta).

**Note on convention:** This is a forward-looking compounding of a rolling annualized estimate - not a retrospective YoY. Document this so nobody later "fixes" it by replacing with a 48-turn trailing average (which would subtly change the meaning of the index).

#### 3. Storage - a separate, uncapped collection

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

#### 4. Global weighted inflation series

For the forex page's per-turn global number:

```
π_global_t = Σ_c w_{c,t} × π_{c,t}
```

##### 4a. Weight choice - recommended default: GDP

Market-cap weighting creates a feedback loop: high-inflation country → nominal market cap up → larger weight in global inflation → loops back into macro signals the chart plots. Options:

| Weight                                      | Pros                                      | Cons                                         |
| ------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| **GDP (same-turn)**                         | Smoother, inflation-neutral in real terms | Also drifts w/ nominal GDP growth            |
| **Real market cap** (cap / own price level) | Removes inflation feedback                | Adds one extra division, less intuitive      |
| **Lagged market cap (t-1)**                 | Simple, breaks tight feedback             | Still nominal; minor feedback at cycle scale |
| **Market cap (same-turn)**                  | Most "financial-markets" flavor           | Strong feedback loop (reject)                |

**Default for the cumulative global index: GDP-weighted.**
**Acceptable for the forex-page YoY chart (where financial-market context is appropriate): lagged market cap, read from `marketCapHistory.exchangeCaps`** via `exchangeRegistry`'s 1:1 exchange↔country mapping. These can legitimately be two different series - label both clearly.

##### 4b. Global price level

Compound the weighted per-period factor into a **global** `priceLevels` row keyed `_id: "global"`. Use the **same weights** each turn for internal consistency (weight by GDP share **or** cap share - don't mix per panel).

#### 5. API + chart

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

#### 6. Nominal repricing layer

##### 6a. Rule

- **Constants stay in real (2020-era) terms.** `COMMODITY_BASE_PRICES`, any startup-capital scalar, action-cost scalars.
- **In-flight balances stay nominal.** `currencyBalances.*`, party treasury, corporation cash. Do not re-scale these - doing so double-scales when they are spent against a nominal constant that is also being scaled.
- A single resolver converts constants → runtime amounts at read time:
  ```ts
  nominalCredits(realBase: number, countryId: CountryId | "global", turn?: number): number
  ```
  Implementation: `realBase × priceLevels[{countryId or "global"}].level / 100`.

##### 6b. Per-country vs global deflator

Default: **per-country**. A US player's action cost is scaled by US's price level; a JP player's by JP's. This is fairer cross-country.

Override to global: a small whitelist (effectively "the world market") - e.g. `COMMODITY_BASE_PRICES`, the anchor for `commodityPressure`. The resolver accepts `"global"` as an explicit scope.

##### 6c. Forex baselines and commodity base prices are NOT repriced

- `ExchangeRate.baseRate` - "initial calibration, never changes" per `currency-exchange.md`. **Leave fixed.** `forexPressure = rate/baseRate - 1` is the cost-push signal - rebasing kills it.
- `COMMODITY_BASE_PRICES` - anchors `commodityPressure = P_national/basePrice - 1`. **Leave fixed.** If we later want basePrice to track inflation, `commodityPressure` must be redefined as a velocity signal; that is a **separate** design decision and out of scope for this doc.

##### 6d. What the resolver applies to (audit)

The plan's "inventory" must be a grep-based discovery, not a guess. Starting commands:

```bash
grep -rn "funds:\s*[0-9]\|cashOnHand:\s*[0-9]" src/     # startup/hardcoded funds
grep -rn "estimatedCost\|COST\|_COST\s*=" src/lib        # action/fundraise cost constants
grep -rn "COMMODITY_BASE_PRICES\|basePrice\b" src/       # commodity anchors (most are off-limits - see 6c)
grep -rn "STARTING_\|INITIAL_\|DEFAULT_" src/lib/constants
```

For each hit, decide: (a) real constant → route through resolver, (b) already nominal balance → leave alone, (c) locked anchor (forex baseline, commodity base) → **do not touch**.

#### 7. Feedback-loop check (mandatory before ship)

Add a test that simulates a one-shot rate shock and verifies inflation/forex/commodity-pressure **converge** rather than diverge over, say, 100 turns. Flag anything that explodes.

#### 8. Golden tests

- Flat 2% YoY for 48 consecutive turns → cumulative `P_48/P_0 - 1 ≈ 0.02` (within a documented ε for the compounding approximation).
- `nominalCredits(realBase, c, t)` round-trip: `realFromNominal(nominalCredits(x, c, t), c, t) === x` within ε.
- Global weighted YoY for a hand-constructed 3-country fixture matches manual arithmetic under both GDP and market-cap weights.
- Turn-ordering test: index writer runs **after** `inflationRecalc` (so it reads the settled rate) and **independently of** `interestRateSnapshot` (which still writes the capped history for charts).

#### 9. Phased sequencing

1. **Math + storage** - write `priceLevels` + `priceLevelHistory`, add the writer phase, seed one base snapshot. No consumers yet.
2. **Validate** - let it run one game-day (48 turns) in dev; sanity-check that a flat 2% produces ~2% cumulative.
3. **Forex page series** - add API fields + dedicated "Global inflation tracker" chart. Only after (2) is stable.
4. **Repricing layer** - introduce `nominalCredits()` resolver; audit constants via greps in 6d; route real constants through the resolver. Nominal balances untouched.
5. **Docs** - update `currency-exchange.md` and `economic-systems.md` with links to this doc and the weight-basis decision.

## Data

| Collection and field | Written by | Read by | Player-visible |
| --- | --- | --- | --- |
| `federalBudget.economicFactors.householdPriceIndex` | `runInflationRecalc` (turn and half tick); seeded to 1 by `src/lib/seeds/reference/budgets.ts` unless the country config sets one | `countryEconomyOutlook.ts`, the sim metrics in `src/lib/sim/metrics.ts` | Indirectly: the real-economy panel shows median income deflated by it (`RealEconomyPanel.tsx`) |
| `federalBudget.economicFactors.inflationRate` | `runInflationRecalc` | the index writer (same call), the central bank snapshot | Yes (inflation figures across the economy pages) |
| `federalBudget.subhourStep`, `federalBudget.subhourBase.inflation` | half tick: stamp that the half step ran, plus the pre-step `inflationRate` and `householdPriceIndex` | the next full turn, which restores the pre-step values before recomputing | No |
| `centralBanks.inflationHistory` | `snapshotInterestRateHistory` (`src/lib/turn/interestRateSnapshot.ts`), capped at 240 entries | forex monetary-policy charts | Yes (charts) |
| `gameConfig.campaignEraPriceLevelEnabled` | seed and admin config | `loadCampaignPriceLevel` | No (changes costs and income) |
| `gameState.preset` | world reset | `loadCampaignPriceLevel` | No |

The index is a single number per country with no history of its own. Only the latest value is kept, so a past index cannot be read back except from backups.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `gameConfig.campaignEraPriceLevelEnabled` | `true` on fresh worlds and resets; absent (treated as off) on a world that never stamped it | `src/lib/seeds/reference/featureFlagDefaults.ts` (type in `src/lib/db/types/gameConfig.ts`) |
| `economicFactors.householdPriceIndex` in a country's budget seed config | falls back to `HOUSEHOLD_PRICE_INDEX_BASELINE` (1) | `src/lib/seeds/reference/budgets.ts` |
| Pass-through, baseline, inflation floor | constants, no runtime override | `src/lib/economy/rules/householdPriceIndex.ts` |
| Era price table | constants; `priceLevel.test.ts` fails if they drift from the GDP baseline table | `src/lib/campaigns/rules/priceLevel.ts` |

## Timing

The household index is advanced inside `inflationRecalc` (`recalculateInflationPerTurn`, called from `src/simulation/phases/stateEffectsPhase.ts`) immediately after that turn's inflation is settled, so it reads the settled rate. `interestRateSnapshot` runs later in the same phase file and independently. The half tick at :30 (`src/lib/turn/subhour/inflationHalfStep.ts`) calls the same function with `stepFraction` 0.5, advances the index by half a turn, and is stamped so a retried tick never applies twice. The next full turn finds the stamp, restores the pre-half-step index (`restoreMultiplicative`) and advances a full turn from there, so the half step is replaced, not added (`inflationHalfStep.test.ts` checks the turn lands where a no-tick turn lands). The era price level is not a turn pass; it is resolved at the shell boundary (action execute route and fund generation) from the world preset.

## Worked trace

Household index, one country, previous index 1.0, settled CPI 4%:

| Step | Calculation | Result |
| --- | --- | --- |
| Annual factor | 1 + 0.75 x 4 / 100 | 1.03 |
| Full-turn factor | 1.03 ^ (1/48); ln 1.03 = 0.029559, divided by 48 = 0.000616 | 1.000616 |
| Index after the turn | 1.0 x 1.000616 | 1.000616 |
| Half-tick factor | 1.03 ^ (0.5/48) | 1.000308 |
| Two half ticks | 1.000308 ^ 2 | 1.000616 (equals one turn) |
| After 48 turns at 4% | 1.000616 ^ 48 | 1.03 |
| Median income 50,000 in launch prices | 50,000 / 1.03 | 48,543.69, shown as 48,544 |

Era price level, a 1953 world with the flag on, a campaign action at tier 2 with a regional multiplier of 1.0: `round(round(20,000 x 2 x 1.0 / 1,000) x 1,000 x 0.03673)` = round(40,000 x 0.03673) = 1,469. With the flag off the same action costs 40,000. (`CAMPAIGN_BASE_FUND_COST` is 20,000 in `src/lib/actions/rules.ts`.)

## Edge cases and limits

- **Missing, non-finite or non-positive previous index** reads as the baseline 1.
- **Missing or non-finite CPI** counts as 0, so the index holds still.
- **CPI below -100%** is clamped, which keeps the factor above 0. Deflation moves the index down; there is no upper cap.
- **Underflow guard.** The written value is never below `Number.EPSILON`, and a non-finite result keeps the prior value.
- **One way only.** Nothing in inflation reads the index, so a price level can never feed back into CPI.
- **Not repriced:** commodity base prices, action costs, startup capital and forex baselines (sections 6c and 6d). Only the real-income display and the era campaign scalar use a price level today.
- **Unknown preset** resolves the era price level to 1 (modern behaviour). Prototype keys such as `constructor` also fall through to the modern value.
- **Era price level is an approximation.** It uses US GDP per capita as a proxy and the source calls it an upper bound on pure inflation.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| The index is always finite and above 0 | `householdPriceIndex.test.ts` ("clamps impossible deflation and keeps the index positive and finite", "never writes a non-finite level from an extreme prior") |
| A year at CPI `x` moves the index by exactly `1 + 0.75 x / 100` | `householdPriceIndex.test.ts` ("compounds whole years multiplicatively") |
| A half tick compounds to half a turn; a retried half tick never double applies | `src/lib/turn/subhour/inflationHalfStep.test.ts`, `rewindHalfTick.test.ts` |
| Era table matches the GDP baseline table | `src/lib/campaigns/rules/priceLevel.test.ts` |
| CPI never reads the index | Not enforced by a test; true by construction (the inflation calculation takes no price index input) |

## Failure and recovery

The index is a running product, so a bad CPI value stays baked in. Typical failures: a corrupt or missing budget field (the writer falls back to the baseline 1, and the real-income panel reads as unadjusted), or a stuck half-tick stamp (the next full turn restores the stamped base and clears it). A wrong stored index is repaired by a data heal that rewrites the field on the affected country budgets, or by a reseed of the budget document, which restarts it at 1. Because no history is kept, a heal needs the intended value recomputed or taken from a backup.

## Connections

**Driven by**
- [Economic Systems](./economic-systems.md): the settled annual CPI from `src/lib/budget/inflation.ts` through `inflationRecalc`.
- [Currency Exchange](./currency-exchange.md): forex baselines stay fixed and are the cost-push reference.

**Affects**
- Real-income display: `countryEconomyOutlook.ts` deflates median income by the index.
- Campaign actions and fund generation: the era price level scales costs and income (`src/lib/campaigns/rules/priceLevel.ts` through `src/lib/actions/rules.ts`).

## Tests

- `src/lib/economy/householdPriceIndex.test.ts`: the factor, compounding, missing input, deflation clamp.
- `src/lib/turn/inflationRecalc.test.ts`, `src/lib/turn/subhour/inflationHalfStep.test.ts`, `src/lib/turn/subhour/rewindHalfTick.test.ts`: writer, half tick, rewind.
- `src/lib/economy/queries/countryEconomyOutlook.test.ts`, `src/components/economy/RealEconomyPanel.test.tsx`: real-income display.
- `src/lib/seeds/reference/budgets.test.ts`: seeding the baseline.
- `src/lib/campaigns/rules/priceLevel.test.ts`, `src/lib/campaigns/queries/campaignQueries.test.ts`: era price level and the flag gate.
- Gaps: none of the planned tests (section 7 feedback-loop check, section 8 golden tests) exist.

## Known issues and history

- The `campaignEraPriceLevelEnabled` comment in `src/lib/db/types/gameConfig.ts` says the flag defaults off. Code differs for fresh worlds: `featureFlagDefaults.ts` sets it to `true`. The comment is stale.
- The planned layer is not started. Open questions carried over from the plan:

- **Index base turn when backfilled vs fresh start.** If we backfill from existing `inflationHistory` (which only retains the last 240 turns), the base will be "240 turns ago," not game genesis. Fine for a soft launch but the chart legend should say "since turn N" rather than "since game start."
- **Currency redenomination is not in scope.** If inflation runs very hot for a very long time, nominal balances will eventually look absurd ("¥500,000 action cost"). Handling that is a future product decision (either redenominate or cap cumulative drift), not something this layer solves.
- **Admin debug UI** - a single page showing each country's current `level`, weight-basis used, and last N periods of compounding factors would make the feedback-loop check and balance tuning dramatically easier. Not required for v1 but strongly recommended before shipping the repricing layer.

Last checked: 2026-10-29, version 1.18.0
