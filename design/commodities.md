# Commodities

Player guide: [Commodities](https://www.ahousedividedgame.com/wiki/commodities)

## Summary

Commodities model inputs and outputs between corporate sectors. Prices move with global and regional supply and demand, and feed into sector profit margins.

Supply is not an abstract number: under the live market mode (`marketSystemMode: "plants"`, see [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md)) a sector's commodity output comes from real plant capacity it built and staffed. A sector still under construction, or mothballed, contributes nothing to supply even though it exists on paper. Sold units, not nameplate revenue, are what move the D/S ratio below. Beyond the margin modifiers described here, commodity prices also scale sector revenue directly through **price realization** (see that section below), and under the deeper clearing/capital tiers, revenue itself is derived from what capacity actually sold, not asserted from a growth rate. See [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md) and the in-game [Market System guide](/wiki/market-system-guide) for the full production side of this loop.

## Rules

### The 27 commodities

27 commodity types trade across the economy (`COMMODITY_TYPES`, `src/lib/constants/commoditiesCore.ts`):

| Category       | Commodities                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extractable    | Iron Ore, Coal, Crude Oil, Rare Earth Minerals (merged with copper), Natural Gas, Timber                                                                             |
| Industrial     | Steel, Electronics, Chemicals, Plastics, Ordnance                                                                                                                    |
| Energy & Fuels | Electricity (Energy), Fertilizers, Pharmaceuticals, Vehicles                                                                                                         |
| Food           | Food Products                                                                                                                                                        |
| Construction   | Building Materials, Construction Services                                                                                                                            |
| Services       | Software, Financial Services, Healthcare Services, Real Estate Services, Advertising, Consulting Services, Freight, Retail, Network Services                                                       |

Each sector type supplies and demands specific commodities at rates tied to sector revenue (units are `sector daily revenue x rate / basePrice`, with the rate tables `SECTOR_SUPPLY` and `SECTOR_DEMAND` in `src/lib/constants/commodities.ts`). A sector's production policy scales its flows through `getOutputMultiplier` and `getInputMultiplier` (`src/lib/utils/productionPolicy.ts`): policy is clamped to -25 to +25, and at +25 supply is x1.15 and input demand x1.10, at -25 supply is x0.90 and input demand x0.85, linear in between. **Retail** demands many inputs and supplies the Consumer Goods (`retail`) commodity. Only **owned** corporate sectors participate in a state's commodity flow. State-owned sectors count at `NATCORP_COMMODITY_MULTIPLIER = 1.0`.

Base prices (`COMMODITY_BASE_PRICES`, same file) are in dollars per unit, for example steel 800 per ton, oil 80 per barrel, energy 60 per MWh, vehicles 25,000, rare earth 21,000 per ton (a demand-weighted copper and rare-earth blend). Worlds on an earlier-era unit basis divide them by the era unit scale (`eraScaledBasePrices`).

### Pricing

Each turn, prices update from supply and demand using logarithmic scaling with no hard cap:

```
ratio = demand / supply
if ratio >= 1: price = basePrice × (1 + 0.7 × ln(ratio))    # shortage
else:          price = basePrice / (1 + 0.7 × ln(1/ratio))   # oversupply
```

The 0.7 is `COMMODITY_PRICE_LOG_SCALE` (`src/lib/constants/commoditiesCore.ts`); the formula is `computeMarketPrice` in the same file.

Blended price for display: **50% wide leg** + **25% national** (country aggregate) + **25% regional** (state-level) (`GLOBAL_PRICE_WEIGHT`, `NATIONAL_PRICE_WEIGHT`, `REGIONAL_PRICE_WEIGHT`, `src/lib/constants/commoditiesCore.ts`, blended by `blendPrice`). The wide leg is the price of the market a country can actually reach when it has a reachable book, and the plain global price otherwise (`priceCommodity`, `src/lib/turn/commodity/pricing.ts`). The 50/25/25 price blend is fixed. Tariffs do not move it: they shift the weights of the margin blend only, through `getTariffBlendWeights` (`src/lib/tariffs/tariffEffects.ts`), linearly from 50/25/25 with no tariff stack to 25/50/25 at a full stack (`TARIFF_BLEND_SHIFT_AT_FULL = 0.25`, `src/lib/tariffs/rules/tariffCurves.ts`; the local leg stays 25%); see [Tariffs](./tariffs.md).

Drift and damping:

- State and global prices drift toward their target at `COMMODITY_PRICE_DRIFT_RATE = 0.06` per turn (`src/lib/constants/commodities.ts`), so a gap is about 95% closed after 48 turns.
- National prices step `NATIONAL_PRICE_ADJUSTMENT_RATE = 0.5` of the way to their target each turn (`adjustNationalPrice`), which damps an exporter price cobweb.
- A global stabilizer on each side prevents extreme swings. It is sized per commodity (`COMMODITY_STABILIZER`, 1,500 for vehicles, ordnance, up to 50,000 for electronics, energy, chemicals, advertising, retail, iron, oil and natural gas, `src/lib/constants/commodities.ts`, read by `getCommodityStabilizer`). `BASE_COMMODITY_SUPPLY_DEMAND = 50,000` in the same file is only the fallback for a commodity missing from that table.
- A national stabilizer (`NATIONAL_COMMODITY_STABILIZER = 500`, same file) prevents degenerate ratios in small countries. In plain terms, a stabilizer is a fixed amount of pretend supply and demand added to both sides so a tiny market cannot show a huge ratio from a few units.

Raw supply/demand pressure is compressed by a soft-knee (a point past which extra pressure counts for much less) before it reaches the price formula. In `computeEffectiveCommodityPressureRatio` (`src/lib/constants/commoditiesCore.ts`), with `L = |ln(raw ratio)|` and `K = ln(knee)`, effective log pressure is `L` when `L <= K`, otherwise `K + (L - K) x COMMODITY_PRESSURE_TAIL_SLOPE`, with the sign of the original pressure. Both supply and demand are floored at `MIN_COMMODITY_FLOW_UNITS = 0.01` before the ratio is taken. Pressure stays at full fidelity up to `COMMODITY_PRESSURE_SOFT_KNEE = 3` (3x shortage/oversupply, `src/lib/constants/commoditiesCore.ts`), beyond which the tail is compressed at `COMMODITY_PRESSURE_TAIL_SLOPE = 0.25`. Worked example: a raw 5x shortage has `L = 1.609`, `K = 1.099`, so effective pressure is `exp(1.099 + 0.510 x 0.25)` = 3.41x and the price is `basePrice x (1 + 0.7 x ln 3.41)` = 1.86x base. The six extractable resources (iron, coal, oil, natural gas, timber, rare earth) use a wider knee for PRICE math only, `EXTRACTABLE_PRESSURE_SOFT_KNEE = 8` (`src/lib/constants/commodities.ts`, chosen by `getPriceSoftKnee`), so scarcity in those markets keeps signalling further before compression kicks in. Margin math always uses the default 3x knee, even for extractables.

Macro-driven commodities (financial services, healthcare services, advertising, real estate services) use a 50/50 global/national blend because state-level activity is meaningless for nationally-driven demand (`COMMODITIES_NATIONAL_REGIONAL_PRICE_BLEND`, `src/lib/constants/commodities.ts`).

Extra demand that does not come from sectors, all in `src/lib/constants/commodities.ts`:

| Demand source | Constant | Value |
| --- | --- | --- |
| Government healthcare spending to healthcare services | `GOVT_HEALTHCARE_DEMAND_RATE` | 0.015 |
| GDP to network services | `NETWORK_SERVICES_GDP_DEMAND_FRACTION` | 4e-6 |
| GDP to construction services | `CONSTRUCTION_SERVICES_GDP_DEMAND_FRACTION` | 5e-7 |
| GDP to building materials | `BUILDING_MATERIALS_GDP_DEMAND_FRACTION` | 2e-4 |
| GDP to real estate services | `REAL_ESTATE_GDP_DEMAND_FRACTION` | 0.00002 |
| Marketing budget to advertising | `MARKETING_ADVERTISING_DEMAND_RATE` | 0.9, with elasticity `MARKETING_ADVERTISING_DEMAND_ELASTICITY` 0.85 |
| State media to advertising | `STATE_MEDIA_DEMAND_RATE` | 0.09 |
| Government defence spending to ordnance | `GOVT_DEFENSE_ORDNANCE_DEMAND_RATE` | 0.005 |
| Bond issuance to financial services | `FINANCIAL_DEMAND_ISSUANCE_FRACTION` | 0.000022, scaled by a rate multiplier clamped 0.6 to 1.4 around `FINANCIAL_NEUTRAL_RATE` 2.75 |
| Retail GDP demand | `RETAIL_GDP_DEMAND_SCALE` | 15, multiplier clamped 0.5 to 2.0, weighted 0.5 national and 0.5 regional |

Per-country national demand multiplier (`COUNTRY_COMMODITY_DEMAND_MULTIPLIER`): only DD `construction_services` x18, applied to that country's national demand leg only; every other pair defaults to 1.

### Margins

Margin modifiers are computed independently at global, national, and state level, then blended 50/25/25 by default, or by the tariff-shifted weights above:

```
globalMod   = -K × Σ(rate_i × ln(D_global_i / S_global_i))
nationalMod = -K × Σ(rate_i × ln(D_national_i / S_national_i))
stateMod    = -K × Σ(rate_i × ln(D_state_i / S_state_i))
rawMod = 0.5 × globalMod + 0.25 × nationalMod + 0.25 × stateMod
```

Each `ln` term uses the soft-knee effective ratio, and each commodity's contribution is rounded to 2 decimals. With `COMMODITY_LOG_K = 40`, shortages are meaningful but manageable:

| Scenario (rate=0.25) | Ratio | Margin hit |
| -------------------- | ----- | ---------- |
| Mild shortage        | 1.1×  | -1.0%      |
| Moderate             | 1.4×  | -3.4%      |
| Severe               | 2.0×  | -6.9%      |
| Extreme              | 5.0×  | -12.3%     |

The 5.0x row is a raw ratio: the 3x soft-knee compresses it to an effective 3.41x before the formula, so the hit is `40 x 0.25 x ln 3.41` = 12.3%. Rows at or below 3x are unaffected.

Sellers in scarce markets get an equivalent **surplus bonus** (same formula, positive sign); sellers in a glut take the matching negative.

**Per-commodity soft cap:** No single commodity can contribute more than ±50 percentage points to the modifier (`COMMODITY_PER_ITEM_CAP = 50`).

All margin constants live in `src/lib/constants/commodities.ts`, and the blend is computed by `computeBlendedMarginModifiers` in the same file, which takes the tariff-aware weights.

**Aggregate caps:** After blending, the input leg is floored at `−COMMODITY_AGGREGATE_INPUT_CAP (30)` and the surplus leg is capped at `+COMMODITY_AGGREGATE_SURPLUS_CAP (30)`. If input plus surplus falls below `−COMMODITY_COMBINED_FLOOR (15)`, both legs are scaled by `15 / |combined|` so the combined channel cannot go below −15 percentage points.

**State stabilizers:** A state-level stabilizer prevents extreme ratios when a state has zero local supply, applied only in the margin path (state prices remain fully dynamic).

- Standard commodities: `STATE_COMMODITY_SUPPLY_DEMAND = 250` (`src/lib/constants/commodities.ts`)
- Extractable resources (oil, gas, iron, timber, coal, rare earth, rare earth also covers copper): `EXTRACTABLE_RESOURCE_STATE_STABILIZER = 2500` (`src/lib/constants/commodities.ts`), these are globally traded so local absence doesn't mean local unavailability.

**Retail penalty:** Retail sectors take only **25%** of negative input penalties (`RETAIL_NEGATIVE_COMMODITY_PENALTY_FACTOR`, `src/lib/constants/commodities.ts`), reflecting substitution power. It is applied before the aggregate input floor.

### Price realization

Beyond the margin modifiers above, commodity prices scale sector revenue directly (when the market system tier is enabled):

```
factor = clamp((price / basePrice) ^ 0.5, 0.7, 2.0)
sectorRealization = supply-rate-weighted mean of factors across a sector's outputs
realizedRevenue = baseRevenue × sectorRealization
```

Prices are lagged one turn to break the price-to-revenue-to-supply feedback loop, and realization alone moves revenue by at most -30% to +100% (the clamp). This is on top of, not instead of, the margin modifiers: shortages now reward producers with more top-line revenue, not just a better margin percentage, and gluts bleed revenue even when the margin looks tolerable. The constants are `PRICE_REALIZATION_MIN = 0.7`, `PRICE_REALIZATION_MAX = 2.0` and an exponent of 0.5, in `src/lib/market/priceRealization.ts`. A missing, non-finite or non-positive price ratio is treated as 1, and a sector with no positive supply rates realizes exactly 1. Worked example: a sector selling steel at 2x base gets `2 ^ 0.5` = 1.41x revenue; at 0.5x base it gets 0.71x; at 8x base it is capped at 2.0x.

## Data

| Collection | Fields | Player-visible |
| --- | --- | --- |
| `commodityPrices` (written, one doc per commodity) | `basePrice`, `globalPrice`, `globalSupply`, `globalDemand`, `statePrices`, `stateSupply`, `stateDemand`, `nationalPrices`, `nationalSupply`, `nationalDemand`, `reachablePrices`, `scarcityMult`, `scarcityMultByCountry`, `hardPeg`, `stateHardPegs`, `nudgePrice`, `stateNudges`, `priceAttribution`, `turn`, `updatedAt` | prices, supply, demand: yes. Pegs, scarcity multipliers and attribution: admin or detail views |
| `commodityPriceHistory` | per-turn price snapshot per commodity, pruned beyond 240 turns | yes, as the price chart |
| `commodityFlows` | per-turn flow ledger (supplied, demanded, cleared, unmet, unsold), kept `COMMODITY_FLOW_RETENTION_TURNS = 240` turns, written when `marketSystemMode` is at least `ledger` | partly |
| `tradeFlowSnapshots` | trade clearing snapshot for the map | yes |
| `corporateSectors` (read) | `sectorType`, `revenue`, `stateId`, `countryId`, strategy and production policy | yes |
| `macroMetrics`, `states`, `federalBudget`, `stateBudgets`, `bonds`, `centralBanks`, `exchangeRates` (read) | GDP, budgets, issuance and rates that feed the latent demand sources | yes |
| `tariffs`, `tradeEmbargoes`, `organizationMemberships` (read) | tariff and embargo posture | yes |
| `stateResourceCapacity`, `extractionContracts` (read) | extraction capacity and contracts | yes |
| `gameConfig` (read) | the flags in Configuration | no |

Types are in `src/lib/db/types/commodityPrice.ts`.

## Configuration

Behaviour that depends on `gameConfig` (`src/lib/db/types/gameConfig.ts`, document `_id: "default"`). Every flag is off, unset or 0 unless an operator sets it, and an absent `marketSystemMode` resolves to `"off"` (`getMarketSystemMode`, `src/lib/market/featureFlag.ts`).

| Field | Default | Effect |
| --- | --- | --- |
| `marketSystemMode` | `"off"` when absent; live worlds run `"plants"` | Graduated tier ladder from `off` up to `plants`; `plants` makes supply come from real plant capacity, `ledger` and above write the flow ledger |
| `productLinesV2Enabled` | off | Product-project reads; needs plants tier |
| `commandEconomyEnabled` | off | Planned economies get administered national prices (dual-track by planned share) |
| `extractionOutputScaleEnabled` | off | Applies `EXTRACTION_OUTPUT_SCALE` to extraction supply: rare earth 2.5, natural gas 2.0, iron 1.8, timber 1.6, oil 1.4; coal omitted (`src/lib/constants/commodities.ts`) |
| `demographicsDemandEnabled` | off, uncalibrated | Income demographics add consumer demand |
| `householdConsumptionEnabled` | off, uncalibrated | Household ledger demand, supersedes retail's input proxy and the demographics flag |
| `householdConsumptionPerCapita` | unset | Optional per-world sizing override |
| `commodityScarcityDriftEnabled` | off | Persistent imbalance ratchets a per-commodity price multiplier (`scarcityMult`) |
| `commodityFixStage` | 0 | Treadmill fix stages 0 to 6, advanced one per turn by an operator (`src/lib/market/commodityFixStages.ts`) |
| `marketRecoveryStage` | 0 | Market recovery program stage (`src/lib/market/marketRecoveryStages.ts`) |
| `stockCoverCapEnabled` | off | Extra spoilage on stock above the cover cap |
| `producerFundedBookStage` | 0 | Prices from the funded market's measured book |
| `commodityNominalPriceIndex`, `retailDemandTransitionStartTurn`, `producerPriceMaxMove`, `producerPriceMaxMultiplier` | unset | Nominal price index, retail demand transition, funded price pace limits |

Constants such as `COMMODITY_PRICE_DRIFT_RATE`, the knees and the stabilizers are code constants, not config. The era unit scale (`eraScaledBasePrices`) and the DD demand multiplier are the only preset or country variants.

## Timing

Order within one turn (`src/simulation/phases/turnPhaseNames.ts`, `src/simulation/phases/turnPhaseRegistry.ts`):

1. `corporationTurn` runs first. Sector margins and price realization read the stored prices from the previous turn, which is the one-turn lag.
2. `macroCountryTurn` updates the national figures (GDP, budgets) that feed the latent demand sources.
3. `commodityPrices` runs `processCommodityPriceTurn` (`src/lib/turn/commodityPriceTurn.ts`), in parallel with `bondTurn`. It builds supply and demand from owned sectors and the latent sources, computes global, national and state prices, drifts them, and saves history.
4. `contractSettlement` follows, settling extraction contracts at the new prices.

```
corporationTurn (reads last turn's prices) -> macroCountryTurn -> [commodityPrices || bondTurn] -> contractSettlement
```

So a supply change made this turn shows up in the price this turn, but reaches sector revenue and margins on the next turn.

## Worked trace

One steel market, one manufacturer, at a turn where `currentTurn` is not supplied to the drift term, so no unowned drift is added. Steel base price 800, global stabilizer 41,000 (`COMMODITY_STABILIZER`).

Global price:

1. Owned sectors supply 60,000 units of steel and demand 100,000. With the stabilizer on both sides: supply 101,000, demand 141,000.
2. Ratio 141,000 / 101,000 = 1.3960, below the 3x knee, so effective pressure is unchanged. `ln` = 0.3336.
3. Target price = 800 x (1 + 0.7 x 0.3336) = 800 x 1.2335 = 986.84.
4. Previous global price was 900. Drift: 900 + 0.06 x (986.84 - 900) = 905.21 stored as `globalPrice`.

Margin for a manufacturer with a steel input rate of 0.2:

1. Global: -40 x 0.2 x 0.3336 = -2.67.
2. National book as is, 20,000 supply and 30,000 demand: ratio 1.5, `ln` 0.4055, so -40 x 0.2 x 0.4055 = -3.24.
3. State book 100 supply and 400 demand, plus the 250 state stabilizer on each side: 350 and 650, ratio 1.8571, `ln` 0.6190, so -4.95.
4. Blend: 0.5 x -2.67 + 0.25 x -3.24 + 0.25 x -4.95 = -1.335 - 0.81 - 1.2375 = -3.38 percentage points. It is above the -30 floor, so it stands.

Price realization next turn for a steel producer: price over base is 905.21 / 800 = 1.1315, `^0.5` = 1.0637, inside 0.7 to 2.0, so its revenue is multiplied by 1.064.

## Edge cases and limits

- A supply or demand of 0 (or both) does not divide by zero: flows are floored at 0.01 units, and both sides at 0 gives a ratio of 1 and the base price.
- There is no hard cap on price; the soft-knee and log curve slow the climb instead. Margin effects are capped (per-item 50, aggregate 30, combined floor 15).
- A state with no local supply uses the state stabilizer (250, or 2,500 for extractables) in the margin path only; state prices stay fully dynamic.
- Unowned sectors contribute no supply or demand. Separately, every commodity's global supply and demand get a small bounded oscillation sized from its own stabilizer (`UNOWNED_DRIFT_AMPLITUDE = 0.06`, `UNOWNED_DRIFT_PERIOD_TURNS = 40`, opposite phases for supply and demand), so commodities nothing produces still show a moving price. It is skipped when no turn number is passed.
- A hard peg or nudge on a commodity overrides the computed price at that scope, with state pegs first, then state nudges, then global peg, then global nudge.
- Rescaled ledger demand on era-scaled worlds is capped at `PLANTS_LEDGER_DEMAND_SUPPLY_CAP = 1.5` times supply, never below its unscaled level.
- Copper has no market of its own; it is merged into rare earth.
- Entertainment Services is no longer a commodity; media companies still supply advertising.
- Retail takes only 25% of negative input penalties, but gets the full surplus bonus.
- Under plants mode, a sector under construction or mothballed supplies nothing.

## Invariants

- Both sides of every ratio are at least 0.01 units: `MIN_COMMODITY_FLOW_UNITS` in `computeCommodityPressureRatio`, covered in `src/lib/constants/commodities.test.ts` (zero supply, both sides zero).
- Price is monotonic in pressure and symmetric around 1x: the soft-knee transform keeps sign; the knee and no-cap behaviour are covered in `src/lib/constants/commodities.test.ts`.
- Margin modifiers stay within the caps: per-item 50, input leg -30, surplus leg +30, combined at least -15; covered in `src/lib/constants/commodities.test.ts`.
- Price realization stays within 0.7 to 2.0: `src/lib/market/priceRealization.test.ts`.
- All 27 commodities get a price document each turn: the loop in `processCommodityPriceTurn` covers every `COMMODITY_TYPES` entry; no separate runtime check.
- Supply equals what plants actually produce under plants mode: enforced in the plants tests under `src/lib/constants/plantsSupplyScaledUnits.test.ts` and `src/lib/corporations/corpCommodityFlows.test.ts`.

## Failure and recovery

- **Stale prices**: if the `commodityPrices` phase fails, the previous turn's price documents stay in place and sectors keep realizing against them. The next successful turn recomputes everything from live sector data.
- **Absurd price after a data fault** (for example a runaway supply or demand): the soft-knee and drift limit the move per turn, and an operator can peg or nudge a commodity back to a sane value until the inputs are fixed. Pegs and nudges are stored on the price document.
- **Chronic shortage or glut** on a thin market: the optional scarcity drift, the extraction output scale and the fix stages exist for this and are advanced one stage per turn with a health check, and can be rolled back by lowering the stage.
- **Funded or ledger inconsistencies**: the funded pricing path throws if the settled supply and demand for the turn are missing, which stops the phase rather than pricing on partial data. A rerun of the turn phase after the market settles repairs it.

## Connections

**Driven by:**

- [Corporations](./corporations.md): owned sector revenue and rates set supply and demand (`processCommodityPriceTurn`).
- [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md): plant capacity decides how much a sector actually supplies.
- [Tariffs](./tariffs.md): tariff pressure moves the margin blend weights (`getTariffBlendWeights`).
- National budgets and GDP: latent demand for healthcare, network and construction services.

**Affects:**

- [Corporations](./corporations.md): margins (`computeBlendedMarginModifiers`) and revenue (`computePriceRealization`).
- [Stock Market](./stock-market.md): sector profitability feeds share prices.
- Extraction contract settlement (`src/lib/turn/extraction/contractSettlement.ts`): settles at commodity prices.

Related pages:

- [Corporations](./corporations.md), Sectors, splits, revenue, and corporate bonds
- [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md), Plants, build queue, and how capacity turns into commodity supply
- [Stock Market](./stock-market.md), Where market-wide instruments are listed
- [Formula Deep-Dive](./formula-deep-dive.md), Turnout, influence, and other numeric systems

## Tests

- `src/lib/constants/commodities.test.ts`: price curve, knee, margins, caps, blend. `src/lib/constants/commoditiesCore.test.ts` only checks the re-exported tables and labels.
- `src/lib/market/priceRealization.test.ts`, `src/lib/market/globalCommodityPrice.test.ts`, `src/lib/market/commodityNominalIndex.test.ts`, `src/lib/market/commodityFixStages.test.ts`.
- `src/lib/turn/commodityPriceTurn.test.ts` (plus the `latentShortage`, `debtWindow` and `fxAnchor` variants), `src/lib/turn/commodity/pricing.test.ts`, `src/lib/turn/commodity/nationalPriceAdjustment.test.ts`.
- `src/lib/constants/countryCommodityDemandMultiplier.test.ts`, `src/lib/constants/eraCommodityPrice.test.ts`, `src/lib/constants/commodityDemandCalibration.test.ts`, `src/lib/constants/plantsSupplyScaledUnits.test.ts`.
- `src/lib/commodity-map/nationalBalances.test.ts`: map aggregation.
- Gaps: no test found that pins the per-commodity `COMMODITY_STABILIZER` table to real activity, and the commodity detail page itself has component tests only for some panels.

## Known issues and history

- `EXTRACTION_OUTPUT_SCALE` is a calibration stabilizer, not the durable fix: its code comment marks it as static, to be re-tuned, and flags rare earth's 2.5 as needing a review before the flag is turned on.
- `householdConsumptionEnabled` and `demographicsDemandEnabled` are documented in code as uncalibrated, default off, and not to be enabled together.
- The player wiki still gives the global stabilizer as a flat 50,000; the code uses the per-commodity table (see Rules). The code wins.
- Per the code comments, thin markets were once flattened to near 1.0x by the flat 50,000 stabilizer (audit of turn 786); the per-commodity table replaced it for that reason.

## Commodity Page

The commodity detail page shows:

- **Hero image**, A banner image sourced from Wikimedia Commons giving each commodity a visual identity
- **Stats strip**, Key metrics (price, supply, demand, balance) in a compact hero strip at the top
- **Combined charts**, Price history and supply/demand charts merged into a single card with a toggle button
- **World map**, Interactive map showing supply or demand intensity per country with color-coded shading. Click a country to see a stat card, then drill into state/region-level breakdowns (US states, UK regions). Toggle between supply and demand views. Powered by `src/lib/commodity-map/` utility layer
- **Regional breakdown**, Collapsible table grouped by country with friendly region names, sorted by volume
- **Top producers and consumers** by volume
- **Synthetic demand sources**, "Base Economic Demand" (stabilizer) and "GDP-Scaled Retail Demand" (retail channel demand) appear as system entries in the Top Consumers list, showing where non-corporate demand originates

In-game UI: `/commodity/[type]` is the detail page; sector pages link their commodity rows into it; for sector economics see [Corporations](./corporations.md).

Key files:

- `src/lib/constants/commodities.ts`, All commodity constants, supply/demand maps, pricing, and margin modifier functions
- `src/lib/market/priceRealization.ts`, Price-to-revenue scaling (price realization)
- `src/lib/turn/commodityPriceTurn.ts`, Per-turn price calculation and history snapshots
- `src/lib/turn/commodity/pricing.ts`, The per-commodity pricing pass (global, national, state legs)
- `src/lib/commodity-map/`, World map utilities: aggregation, color scales, country→SVG registry, region mappings
- `src/app/commodity/[type]/page.tsx`, Commodity detail page with hero, map, charts
- `src/app/commodity/[type]/components/`, World map, stat card, drill-down, region map, legend, and mode toggle components
- `src/app/api/commodities/`, Commodity API routes

Last checked: 2026-10-29, version 1.18.0
