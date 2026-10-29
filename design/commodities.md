# Commodities

Commodities model inputs and outputs between corporate sectors. Prices move with global and regional supply and demand, and feed into sector profit margins.

Player guide: [Commodities](https://www.ahousedividedgame.com/wiki/commodities)

Supply is not an abstract number: under the live market mode (`marketSystemMode: "plants"`, see [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md)) a sector's commodity output comes from real plant capacity it built and staffed. A sector still under construction, or mothballed, contributes nothing to supply even though it exists on paper. Sold units, not nameplate revenue, are what move the D/S ratio below. Beyond the margin modifiers described here, commodity prices also scale sector revenue directly through **price realization** (see that section below), and under the deeper clearing/capital tiers, revenue itself is derived from what capacity actually sold, not asserted from a growth rate. See [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md) and the in-game [Market System guide](/wiki/market-system-guide) for the full production side of this loop.

## Overview

27 commodity types trade across the economy:

| Category       | Commodities                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extractable    | Iron Ore, Coal, Crude Oil, Rare Earth Minerals (merged with copper), Natural Gas, Timber                                                                             |
| Industrial     | Steel, Electronics, Chemicals, Plastics, Ordnance                                                                                                                    |
| Energy & Fuels | Electricity (Energy), Fertilizers, Pharmaceuticals, Vehicles                                                                                                         |
| Food           | Food Products                                                                                                                                                        |
| Construction   | Building Materials, Construction Services                                                                                                                            |
| Services       | Software, Financial Services, Healthcare Services, Real Estate Services, Advertising, Consulting Services, Freight, Retail, Network Services                                                       |

Each sector type supplies and demands specific commodities at rates tied to sector revenue (units are `sector daily revenue x rate / basePrice`). A sector's production policy scales its flows through `getOutputMultiplier` and `getInputMultiplier` (`src/lib/utils/productionPolicy.ts`): policy is clamped to -25 to +25, and at +25 supply is x1.15 and input demand x1.10, at -25 supply is x0.90 and input demand x0.85, linear in between. **Retail** demands many inputs and supplies the Consumer Goods (`retail`) commodity. Only **owned** corporate sectors participate in a state's commodity flow.

## Pricing

Each turn, prices update from supply and demand using logarithmic scaling with no hard cap:

```
ratio = demand / supply
if ratio >= 1: price = basePrice × (1 + 0.7 × ln(ratio))    # shortage
else:          price = basePrice / (1 + 0.7 × ln(1/ratio))   # oversupply
```

Blended price for display: **50% global** + **25% national** (country aggregate) + **25% regional** (state-level) (`GLOBAL_PRICE_WEIGHT`, `NATIONAL_PRICE_WEIGHT`, `REGIONAL_PRICE_WEIGHT`, `src/lib/constants/commoditiesCore.ts`). Tariffs shift weight from the global leg to the national leg through `getTariffBlendWeights` (`src/lib/tariffs/tariffEffects.ts`), moving linearly from 50/25/25 with no tariff stack to 25/50/25 at a full stack (the local leg stays 25%); see [Tariffs](./tariffs.md). Prices drift toward the blended target at `COMMODITY_PRICE_DRIFT_RATE = 0.06` per turn (`src/lib/constants/commodities.ts`), so a gap is about 95% closed after 48 turns. A global stabilizer (`BASE_COMMODITY_SUPPLY_DEMAND = 50,000`, `src/lib/constants/commodities.ts`) on each side prevents extreme swings. A national stabilizer (`NATIONAL_COMMODITY_STABILIZER = 500`, same file) prevents degenerate ratios in small countries. In plain terms, a stabilizer is a fixed amount of pretend supply and demand added to both sides so a tiny market cannot show a huge ratio from a few units.

Raw supply/demand pressure is compressed by a soft-knee (a point past which extra pressure counts for much less) before it reaches the price formula. In `computeEffectiveCommodityPressureRatio` (`src/lib/constants/commoditiesCore.ts`), with `L = |ln(raw ratio)|` and `K = ln(knee)`, effective log pressure is `L` when `L <= K`, otherwise `K + (L - K) x COMMODITY_PRESSURE_TAIL_SLOPE`, with the sign of the original pressure. Both supply and demand are floored at `MIN_COMMODITY_FLOW_UNITS = 0.01` before the ratio is taken. Pressure stays at full fidelity up to `COMMODITY_PRESSURE_SOFT_KNEE = 3` (3x shortage/oversupply, `src/lib/constants/commoditiesCore.ts`), beyond which the tail is compressed at `COMMODITY_PRESSURE_TAIL_SLOPE = 0.25`. Worked example: a raw 5x shortage has `L = 1.609`, `K = 1.099`, so effective pressure is `exp(1.099 + 0.510 x 0.25)` = 3.41x and the price is `basePrice x (1 + 0.7 x ln 3.41)` = 1.86x base. The six extractable resources (iron, coal, oil, natural gas, timber, rare earth) use a wider knee for PRICE math only, `EXTRACTABLE_PRESSURE_SOFT_KNEE = 8` (`src/lib/constants/commodities.ts`), so scarcity in those markets keeps signalling further before compression kicks in. Margin math always uses the default 3x knee, even for extractables.

Macro-driven commodities (financial services, healthcare services, advertising, real estate services) use a 50/50 global/national blend because state-level activity is meaningless for nationally-driven demand.

Extra demand that does not come from sectors, all in `src/lib/constants/commodities.ts`:

| Demand source | Constant | Value |
| --- | --- | --- |
| Government healthcare spending to healthcare services | `GOVT_HEALTHCARE_DEMAND_RATE` | 0.015 |
| GDP to network services | `NETWORK_SERVICES_GDP_DEMAND_FRACTION` | 4e-6 |
| GDP to construction services | `CONSTRUCTION_SERVICES_GDP_DEMAND_FRACTION` | 5e-7 |
| Marketing budget to advertising | `MARKETING_ADVERTISING_DEMAND_RATE` | 0.9, with elasticity `MARKETING_ADVERTISING_DEMAND_ELASTICITY` 0.85 |

## Margins

Margin modifiers are computed independently at global, national, and state level, then blended 50/25/25, matching the price blend:

```
globalMod   = -K × Σ(rate_i × ln(D_global_i / S_global_i))
nationalMod = -K × Σ(rate_i × ln(D_national_i / S_national_i))
stateMod    = -K × Σ(rate_i × ln(D_state_i / S_state_i))
rawMod = 0.5 × globalMod + 0.25 × nationalMod + 0.25 × stateMod
```

With `COMMODITY_LOG_K = 40`, shortages are meaningful but manageable:

| Scenario (rate=0.25) | Ratio | Margin hit |
| -------------------- | ----- | ---------- |
| Mild shortage        | 1.1×  | -1.0%      |
| Moderate             | 1.4×  | -3.4%      |
| Severe               | 2.0×  | -6.9%      |
| Extreme              | 5.0×  | -12.3%     |

The 5.0x row is a raw ratio: the 3x soft-knee compresses it to an effective 3.41x before the formula, so the hit is `40 x 0.25 x ln 3.41` = 12.3%. Rows at or below 3x are unaffected.

Sellers in scarce markets get an equivalent **surplus bonus** (same formula, positive sign).

**Per-commodity soft cap:** No single commodity can contribute more than ±50 percentage points to the modifier (`COMMODITY_PER_ITEM_CAP = 50`).

All margin constants live in `src/lib/constants/commodities.ts`, and the blend is computed by `computeBlendedMarginModifiers` in the same file, which takes the same tariff-aware weights as the price blend.

**Aggregate caps:** After blending, the input leg is floored at
`−COMMODITY_AGGREGATE_INPUT_CAP (30)` and the surplus leg is capped at
`+COMMODITY_AGGREGATE_SURPLUS_CAP (30)`. If input plus surplus falls below
`−COMMODITY_COMBINED_FLOOR (15)`, both legs are scaled so the combined channel
cannot go below −15 percentage points.

**State stabilizers:** A state-level stabilizer prevents extreme ratios when a state has zero local supply, applied only in the margin path (state prices remain fully dynamic).

- Standard commodities: `STATE_COMMODITY_SUPPLY_DEMAND = 250` (`src/lib/constants/commodities.ts`)
- Extractable resources (oil, gas, iron, timber, coal, rare earth, rare earth also covers copper): `EXTRACTABLE_RESOURCE_STATE_STABILIZER = 2500` (`src/lib/constants/commodities.ts`), these are globally traded so local absence doesn't mean local unavailability.

**Retail penalty:** Retail sectors take only **25%** of negative input penalties (`RETAIL_NEGATIVE_COMMODITY_PENALTY_FACTOR`, `src/lib/constants/commodities.ts`), reflecting substitution power.

## Price realization

Beyond the margin modifiers above, commodity prices scale sector revenue directly (when the market system tier is enabled):

```
factor = clamp((price / basePrice) ^ 0.5, 0.7, 2.0)
sectorRealization = supply-rate-weighted mean of factors across a sector's outputs
realizedRevenue = baseRevenue × sectorRealization
```

Prices are lagged one turn to break the price-to-revenue-to-supply feedback loop, and the per-turn shock is bounded to [-30%, +100%]. This is on top of, not instead of, the margin modifiers: shortages now reward producers with more top-line revenue, not just a better margin percentage, and gluts bleed revenue even when the margin looks tolerable. The constants are `PRICE_REALIZATION_MIN = 0.7`, `PRICE_REALIZATION_MAX = 2.0` and an exponent of 0.5, in `src/lib/market/priceRealization.ts`. A missing, non-finite or non-positive price ratio is treated as 1, and a sector with no positive supply rates realizes exactly 1. Worked example: a sector selling steel at 2x base gets `2 ^ 0.5` = 1.41x revenue; at 0.5x base it gets 0.71x; at 8x base it is capped at 2.0x.

## Timing

Order within one turn (`src/simulation/phases/turnPhaseNames.ts`, `src/simulation/phases/turnPhaseRegistry.ts`):

1. `corporationTurn` runs first. Sector margins and price realization read the stored prices from the previous turn, which is the one-turn lag.
2. `macroCountryTurn` updates the national figures (GDP, budgets) that feed the latent demand sources.
3. `commodityPrices` runs `processCommodityPriceTurn` (`src/lib/turn/commodityPriceTurn.ts`), in parallel with `bondTurn`. It builds supply and demand from owned sectors and the latent sources, computes global, national and state prices, drifts them, and saves history.
4. `contractSettlement` follows, settling extraction contracts at the new prices.

So a supply change made this turn shows up in the price this turn, but reaches sector revenue and margins on the next turn.

## Edge cases and limits

- A supply or demand of 0 (or both) does not divide by zero: flows are floored at 0.01 units, and both sides at 0 gives a ratio of 1 and the base price.
- There is no hard cap on price; the soft-knee and log curve slow the climb instead. Margin effects are capped (per-item 50, aggregate 30, combined floor 15).
- A state with no local supply uses the state stabilizer (250, or 2,500 for extractables) in the margin path only; state prices stay fully dynamic.
- Unowned sectors contribute no supply or demand, apart from a small stabilizing drift (`UNOWNED_DRIFT_AMPLITUDE = 0.06`, `UNOWNED_DRIFT_PERIOD_TURNS = 40`).
- Copper has no market of its own; it is merged into rare earth.
- Entertainment Services is no longer a commodity; media companies still supply advertising.
- Retail takes only 25% of negative input penalties, but gets the full surplus bonus.
- Under plants mode, a sector under construction or mothballed supplies nothing.

## Commodity Page

The commodity detail page shows:

- **Hero image**, A banner image sourced from Wikimedia Commons giving each commodity a visual identity
- **Stats strip**, Key metrics (price, supply, demand, balance) in a compact hero strip at the top
- **Combined charts**, Price history and supply/demand charts merged into a single card with a toggle button
- **World map**, Interactive map showing supply or demand intensity per country with color-coded shading. Click a country to see a stat card, then drill into state/region-level breakdowns (US states, UK regions). Toggle between supply and demand views. Powered by `src/lib/commodity-map/` utility layer
- **Regional breakdown**, Collapsible table grouped by country with friendly region names, sorted by volume
- **Top producers and consumers** by volume
- **Synthetic demand sources**, "Base Economic Demand" (stabilizer) and "GDP-Scaled Retail Demand" (retail channel demand) appear as system entries in the Top Consumers list, showing where non-corporate demand originates

## In-game UI

- **Commodity detail**, `/commodity/[type]` with hero image, world map, charts, and market context.
- **Sector pages**, Commodity rows link into that detail.
- **Corporations**, Sector economics interact with commodity flows; see [Corporations](./corporations.md).

### Key Files

- `src/lib/constants/commodities.ts`, All commodity constants, supply/demand maps, pricing, and margin modifier functions
- `src/lib/market/priceRealization.ts`, Price-to-revenue scaling (price realization)
- `src/lib/turn/commodityPriceTurn.ts`, Per-turn price calculation and history snapshots
- `src/lib/commodity-map/`, World map utilities: aggregation, color scales, country→SVG registry, region mappings
- `src/app/commodity/[type]/page.tsx`, Commodity detail page with hero, map, charts
- `src/app/commodity/[type]/components/`, World map, stat card, drill-down, region map, legend, and mode toggle components
- `src/app/api/commodities/`, Commodity API routes

## Connections

**Driven by:**

- [Corporations](./corporations.md): owned sector revenue and rates set supply and demand (`processCommodityPriceTurn`).
- [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md): plant capacity decides how much a sector actually supplies.
- [Tariffs](./tariffs.md): tariff pressure moves the blend weights (`getTariffBlendWeights`).
- National budgets and GDP: latent demand for healthcare, network and construction services.

**Affects:**

- [Corporations](./corporations.md): margins (`computeBlendedMarginModifiers`) and revenue (`computePriceRealization`).
- [Stock Market](./stock-market.md): sector profitability feeds share prices.
- Extraction contract settlement (`src/lib/turn/extraction/contractSettlement.ts`): settles at commodity prices.

## Related pages

- [Corporations](./corporations.md), Sectors, splits, revenue, and corporate bonds
- [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md), Plants, build queue, and how capacity turns into commodity supply
- [Stock Market](./stock-market.md), Where market-wide instruments are listed
- [Formula Deep-Dive](./formula-deep-dive.md), Turnout, influence, and other numeric systems

Last checked: 2026-10-29, version 1.18.0
