# The Capacity Economy (as shipped)

Under the live market mode (`marketSystemMode: "plants"`, the top tier of `src/lib/market/modes.ts`), a corporation's sector no longer earns from a self-compounding revenue number. It owns physical capacity (`capitalStock`, measured in output units per day), buys more of it through a priced build queue, staffs it with workers, and earns only what those plants actually produce and sell into a clearing market. This document describes that system as it runs today, from the player-visible loop down to the constants and formulas in `src/lib/constants/capacityEconomy.ts`, `src/lib/market/capital.ts`, and `src/lib/turn/corporation/sectorTurn.ts`. It supersedes the older market-mode sections of `design/corporations.md` and `design/economic-systems.md` where they describe growth-slider revenue as current behavior.

Player guide: [Running a Corporation under the Plants System](https://www.ahousedividedgame.com/wiki/plants-corp-guide) and [Market System: A Player's Guide](https://www.ahousedividedgame.com/wiki/market-system-guide)

## The player-visible loop

1. **Found or expand.** A CEO opens a sector in a (state, sectorType) cell. Founding builds are priced at `CAPACITY_FOUNDING_DISCOUNT` = 0.1 of the standing capacity price (legacy calibrations only; the 1991 preset pays the full basis, see "How a build is priced").
2. **Build capacity.** `POST .../build-capacity` (`src/lib/corporations/commands/sectorOperations/buildCapacity.ts`) charges cash now; the order sits in the sector's `buildQueue` and comes online `CAPACITY_BUILD_TURNS(type)` turns later (base table in `src/lib/constants/capacityEconomy.ts`: 12 for retail, 24 for media, financial and technology, 36 logistics, 48 construction, healthcare and agriculture, 60 telecommunications and real estate, 72 manufacturing, vehicles and defense, 84 chemicals, 96 energy and extraction; default `CAPACITY_BUILD_TURNS_DEFAULT` = 48; 48 turns = one game year). `investmentBuildTurns` in `src/lib/corporations/investment/rules.ts` then halves founding builds and any base of 72 or more (`heavyBuildTimeMultiplier` = 0.5), and tech growth-cost reductions shorten the schedule further (`techBuildTurns`, `TECH_BUILD_TIME_PER_GROWTH_REDUCTION` = 0.6 in `src/lib/constants/techTree/effects.ts`; never below 1 turn). Cancelling refunds `CAPACITY_BUILD_CANCEL_REFUND` = 0.75 of the paid cost. A sector holds at most 20 outstanding orders (`MAX_OUTSTANDING_BUILD_ORDERS` in `buildCapacity.ts`); a single order is capped at `MAX_BUILD_UNITS_PER_ORDER` = 10,000,000 units.
3. **Run the plants.** Each turn the sector produces up to its capacity, throttled by inputs, disasters, strikes, and its production-policy slider; it sells into the clearing market at its chosen pricing posture (`clampPricingPosture`, −20% to +20%); revenue is derived from units sold, not asserted.
4. **Pay real costs.** Labour (workers × wages), physical input purchases, idle upkeep, compliance, and the residual opex line. Idle capacity is not free: cost basis is `utilization + IDLE_UPKEEP_FRACTION × (1 − utilization)` with `IDLE_UPKEEP_FRACTION` = 0.3. Mothballing (`action: "mothball"`) cold-stows the plants: zero output, upkeep at `MOTHBALL_UPKEEP_FRACTION` = 0.05 of running maintenance (an alias of `COLD_CAPACITY_UPKEEP_FRACTION` in `src/lib/corporations/investment/rules.ts`). A partial mothball (`activeCapacityPercent`, 0 to 100) parks only part of the stock: the parked share pays the 0.05 cold rate, the active share pays idle upkeep only on units the owner idled (`capacityUpkeepUnits`). Capacity idled by the demand throttle rather than the owner pays `THROTTLE_IDLE_UPKEEP_SHARE` = 0.33 of the idle rate, so overbuilding still costs something.
5. **Grow, shrink, retool, or fight.** Depreciation (`CAPITAL_DEPRECIATION_PER_TURN` = 0.0005, about 12% over five game years) erodes capacity that is not replaced. Retooling to another production strategy rescales the stock so the nameplate is invariant (D9, below). Corporate attacks transfer capacity at `ATTACK_CAPTURE_EFFICIENCY` = 0.6 (the rest is destroyed) and are floored at the build price of the received units times `ATTACK_BUILD_PRICE_PREMIUM` = 1.15, so war is always dearer than building.

The interface counts in **facilities**, not raw units. `src/lib/constants/facilityQuantum.ts` sizes one facility per sector so its nameplate lands near `FACILITY_TARGET_DAILY_REVENUE_ANCHOR` = ₳25,000/day (energy: 250 units per power station; automobiles: 1 unit per assembly plant; retail: 80 per store). `src/lib/constants/facilityVocabulary.ts` supplies the display nouns and verbs: you open a store, build an arsenal, sink a mine. Neither file changes a number; the engine, storage, and market share stay in units.

## The unit of capacity and RPU

One unit of capacity is "one output unit per day". Its money value hangs on one quantity, the unit yield

```
k(type) = Σ over output commodities (rate_c / basePrice_c)   [units per ₳ of daily revenue]
RPU(type) = 1 / k(type)                                       [₳ of daily revenue per unit]
```

exactly the per-revenue slope of `impliedOutputUnits` in `src/lib/market/capital.ts`. RPU is a harmonic-style mix price dominated by the cheap legs of the output basket, which is why an energy unit is worth about ₳92/day while an automobile unit is worth about ₳50,000/day. `plantsMixPrice` in `sectorTurn.ts` is the same number, so the stored pair always satisfies `revenue === capitalStock × mixPrice` exactly (capacity is persisted unrounded for this reason).

Two derived anchors, both scale-free and both pinned by tests against the legacy tables:

- **Identity B (price).** `capacityPricePerUnit(type, year, unitScale, strategyId, ...preset) = GROWTH_COST_MULTIPLIER × RPU(strategy) × capacityEraPriceIndex(year)`, with `GROWTH_COST_MULTIPLIER` = 3.0 (`src/lib/constants/corporationsClient.ts`). Capacity is priced at the RPU of the strategy it will run, not the sector default. At the 1953 calibration anchor (`CAPACITY_ANCHOR_YEAR` = 1953) the era index is exactly 1.0, so building through the queue costs exactly what the legacy growth slider charged for the same increment. The 1991 preset is the exception: its construction price is one day of nominal output per unit (`CAPACITY_INVESTMENT_REVENUE_DAYS` = 1 via `constructionPriceForDailyRevenue`), with no era index and no 3.0 multiplier. That basis is chosen by `uses1991Construction`, from the originating preset when known (so a 1991 world keeps its basis as it ages), else from `year === 1991`.
- **Identity A (labour).** `laborIntensity(type, year, unitScale) = RPU / CAPACITY_REVENUE_PER_WORKER × capacityEraLaborIndex(year)`, with `CAPACITY_REVENUE_PER_WORKER` = ₳2,000 in `src/lib/constants/capacityEconomy.ts` (kept in lockstep with the module-private `REVENUE_PER_WORKER` = ₳2,000 behind `calculateWorkers` in `src/lib/constants/corporations.ts`). At 1953 the labour index is 1.0, so capacity staffed from this table carries exactly the headcount `calculateWorkers` gives it.

## How a build is priced

`computeBuildCost` is the single pure function the command, the UI preview, NPP behavior, and the tests all share:

```
total = units × capacityPricePerUnit(type, year, eraUnitScale)
              × dominanceMult(share)          // local vs national share, harsher leg wins
              × rateMult(primeRate, acumen)   // max(0.5, 1 + primeRate/10 × acumenRateSensitivity)
              × acumenMult(acumen)            // flat CEO Business Acumen discount
              × techMult                      // capped tech growth-cost reduction, clamped (0, 1]
              × hostPriceMult(costOfLiving)   // host state's index / 100, clamped [0.6, 1.6]
              × foundingMult                  // 0.1 on the founding build (1 under the 1991 preset), else 1
              × expansionMult                 // 0.8 on non-founding builds, 1 on founding
```

Dominance detail: the local leg is `getDominanceGrowthCostMultiplier(localShare)`, the national leg `getNationalDominanceGrowthCostMultiplier(nationalShare)`, both convex ramps (`DOMINANCE_RAMP_EXPONENT` = 2) from 1.0 at the threshold (`DOMINANCE_MARKET_SHARE_THRESHOLD` = 50, `DOMINANCE_NATIONAL_SHARE_THRESHOLD` = 30) to `DOMINANCE_GROWTH_COST_MULT_AT_FULL` = 3.0 at 100% share, all in `src/lib/constants/corporations.ts`. The toll's excess over 1.0 is scaled by `dominanceDensityFactor(competitorCount)` (0.35 with no rivals, rising linearly to 1.0 at `DOMINANCE_DENSITY_CROWDED_COMPETITORS` = 4) and by one minus the tech dominance shield (capped at 0.95). A separate commodity toll from `src/lib/corporations/rules/commodityDominanceRamp.ts` (free below `COMMODITY_DOMINANCE_FREE_RATIO` = 0.5, 3x at parity, 10x at double) is not discounted by density or shield. The build is charged the larger of the two. `expansionMult` is `SECTOR_INVESTMENT_POLICY.expansionCostMultiplier` = 0.8 in `src/lib/corporations/investment/rules.ts`. `acumenMult` is `max(0.5, 1 - (acumen - 50) × ACUMEN_GROWTH_COST_SLOPE)`.

The host multiplier reads the state's `costOfLiving` metric (a real index, deliberately not an exchange rate, which would create a weak-currency carry trade); the clamp band is `HOST_BUILD_PRICE_INDEX_MIN` = 0.6 to `HOST_BUILD_PRICE_INDEX_MAX` = 1.6. Under plants, dominance is tolled here and only here: the old permanent dominance margin penalty and regulatory-burden revenue tax are faded out over the plants ramp in `sectorTurn.ts`, so market leadership is a barrier to expansion, not a tax on operating.

## Era money scale

The base-price tables are 2019-calibrated. Each world carries an era unit scale, `getEraUnitScale(preset)` in `src/lib/constants/sectorSeedEra.ts` (1 for modern worlds, roughly 70 for 1953), threaded as a required parameter through every ₳-to-units conversion so a 1953 economy does not collapse into a handful of modern-sized units. The era price column is a set of anchors in `CAPACITY_ERA_PRICE_ANCHORS` (`src/lib/constants/capacityEconomy.ts`), interpolated geometrically between them by `capacityEraPriceIndex`: 1.0 at 1953 (held flat before it), 1.4 at 1971, 2.6 at 1979, 3.6 at 1991, 5.0 at `MODERN_ERA_START_YEAR` = 1999 (`src/lib/constants/monetaryEra.ts`), held at 5.0 after, and 5.0 when the year is missing. Equal year steps inside a span change the price by equal proportions, so there is no price jump at an era boundary. The column is flagged provisional in code. the labour column derives live from `eraLaborMultiplier` renormalized to 1.0 at 1953. Facility sizes are era-invariant by construction: RPU and "meaningful revenue" shrink by the same nominal ratio.

## The sector turn

`processSector` in `src/lib/turn/corporation/sectorTurn.ts` runs each sector once per turn inside the `corporationTurn` phase:

1. **Deliver builds, advance capacity.** Orders with `onlineTurn <= currentTurn` convert into stock (smooth orders deliver a slice per turn); their cash moves from construction-in-progress into `capacityBookAnchor`, the depreciated paid basis. Capacity then advances by `advanceCapitalStock`: `stock × (1 + growth − CAPITAL_DEPRECIATION_PER_TURN)`, with growth pinned at 0 under plants (the slider no longer builds capacity). Queue writes are `$pull`/`$inc` deltas, never whole-array `$set`, so an order placed mid-turn survives.
2. **Produce.** `producedUnits = capacity × productionFactor`, where the production factor multiplies the disaster physical leg, the production-policy slider, nationalization transition shock, the extraction geological hard ceiling (`plantsExtractionHardMin`, the deposit is a second hard min on units with no 0.5 floor), input throughput (Leontief on lagged global balances), tech output multipliers, and the strike throttle (`STRIKE_REVENUE_THROTTLE`). A mothballed sector produces 0.
3. **Sell and derive revenue.** `plantsDerivedHourlyRevenue = producedUnits × mixPrice / TURNS_PER_DAY × clearingRevenueLeg × embargoRevenueFactor`. The clearing leg comes from `src/lib/market/clearing.ts`: sellers post a posture in [−0.2, +0.2], demand (lagged one turn) fills cheapest-first, and the leg factor is `soldFraction × (1 + posture) × priceRealizationFactor`. Quality scales only the premium portion of a positive posture (multiplier clamped [0.5, 1.5]).
4. **Governor.** The derived amount is blended against the pre-flip counterfactual baseline by `softenedMarketRealizationAmount` (`src/lib/market/capital.ts`): deviation is capped at `MARKET_REALIZATION_DEVIATION_CAP` = 0.15 of baseline and ramped in over `MARKET_REALIZATION_RAMP_TURNS` = 240 turns, and the cap widens as `cap / (1 − λ)` so it releases entirely at full ramp. λ = 0 on the flip turn makes enabling plants a byte-identical no-op; a fully ramped world stands on its physical result alone. The same λ (`plantsRampLambda`) fades in every other plants-only economics change (idle upkeep, dominance consolidation, the extraction hard min, the disaster physical leg).
5. **Cost the plants physically.** Under plants the margin-formula cost is replaced by physical lines (`src/lib/corporations/physicalPnl.ts`): inputs bought at lagged market prices for what was actually produced, labour, idle/mothball upkeep, compliance, financial legs, and a calibrated residual (`otherOpexPerUnitAnchor`, solved once on the first producing turn so the flip reproduces the old cost exactly, then held per unit). Profit is revenue minus these lines; the reported margin becomes an output (`profit ÷ revenue`), not an input.
6. **Write back.** `sector.revenue` is restated as the nameplate `capitalStock × mixPrice` (never realized revenue, which would compound the realization legs into the base at roughly −7%/turn); `realizedRevenue`, `producedUnits`, `soldUnits`, utilization, and clearing/throughput telemetry are persisted for display only.

## Staffing and the labour market

Headcount is `calculateWorkers(revenue, workforceSkill)`: `revenue / 2,000` at neutral skill 50, with a skill multiplier down to 0.70× at skill 100. When the labour system is on (`labourSystemMode >= "wages"`), a labour cost is carved out of maintenance as workers × wage-per-worker, scaled by the CEO wage slider, the minimum-wage Kaitz floor, tech automation, and the union premium; the split is profit-invariant at baseline. Unionization trends toward a condition-driven target each turn (wages vs cost of living, unemployment, union law, owned-union membership pressure), and strikes trigger with hysteresis and cooldowns (`src/lib/labour/strikes.ts`), throttling revenue and hitting margin (`STRIKE_MARGIN_PENALTY_PP`) while active. Per-state wage and automation indices are accumulated during the sector pass and feed the state labour metrics.

## Market share and dominance

`src/lib/corporations/marketShare.ts`: share = sector revenue ÷ effective market × 100, where the effective market is the larger of the GDP-derived floor (`SECTOR_MARKET_GDP_FRACTION` of state GDP split across sector types) and the owned-plus-unowned revenue sum, all in anchor ₳. Two dominance legs exist: the local (state, sectorType) share with a 50% threshold, and the national share (weighted average across states, 30% threshold); every toll charges the harsher leg. Under plants those tolls collapse into the build-price multiplier, as above.

## Valuation

`sectorNPV` is a perpetuity on current yearly profit (`NPV_ANNUAL_DISCOUNT_RATE`). Under capital and plants, valuation is floored by `advanceCapitalBookAnchor`: seeded at NPV on first exposure, ratcheting up with NPV, decaying at the depreciation rate when NPV falls, so a corp that owns real capacity through a transient profit dip is not valued as if it owns nothing. The paid basis (`capacityBookAnchor`) depreciates with the stock, so a half-worn plant books at half what was paid, never at half list price. Free capacity (grants, R&D) dilutes the per-unit basis deliberately: it cannot be exited for cash it never cost.

## Retooling (D9)

Capacity units are not commensurable across production strategies (a coal mix prices around ₳60/unit, rare earths in the tens of thousands). On a strategy change, `rescaleCapacityForStrategyChange` multiplies the stock (and in-flight `unitsOrdered`) by `RPU_old / RPU_new` so the nameplate `capacity × RPU` is invariant: a retool is a re-aim, not a capital grant. The rescale happens once at commit against the final rates; the 12-turn transition blend (`STRATEGY_TRANSITION_TURNS`) misprices the nameplate briefly, decaying to zero, which is accepted for auditability.

## Worked example

An energy corporation in a modern world on the legacy price basis (not the 1991 preset), neutral CEO, no tech, no dominance, a host state with cost of living 100, orders 1,000 units as an expansion. The RPU of energy is about ₳92 per unit per day (see above).

- Unit price: `3.0 × 92 × 5.0` (modern era index) = ₳1,380.
- Order total: `1,000 × 1,380 × 0.8` (expansion multiplier) = ₳1,104,000, charged now.
- Online: base 96 turns, halved to 48 because 96 is 72 or more.
- Nameplate once delivered: `1,000 × 92` = ₳92,000 per day, before the clearing leg, utilization, labour, inputs and upkeep.
- If the same corp holds 60% local share with four or more rivals, `dominanceMultiplier` gives ramp `t = (60 - 50) / 50` = 0.2, squared 0.04, so the toll is `1 + (3.0 - 1) × 0.04` = 1.08 and the order costs 8% more.

## Timing

The sector pass runs inside the `corporationTurn` phase of `src/simulation/phases/turnPhaseRegistry.ts`, concurrently with `actionRefresh` and `fundGeneration`, and before NPP corporate aggression, which reads the turn's settled finances and market share. Inside the phase `src/lib/turn/corporation/clearingPrePass.ts` computes the clearing factors for every sector first (from lagged demand and the previous turn's output), then `processSector` in `sectorTurn.ts` runs the six steps above per sector. Build orders are placed outside the turn by the `build-capacity` command and only deliver inside step 1. Because demand and input balances are lagged one turn, a plant that restarts or lands its first capacity runs at `RESTART_RUN_SHARE` = 0.25 that turn (`src/lib/constants/capacityEconomy.ts`), since there is no last-turn output on the market to sell.

## Edge cases and limits

- **Order size and count:** 20 outstanding orders per sector, 10,000,000 units per order. Further orders are refused with a message to wait or cancel.
- **Cancel:** refunds 0.75 of the paid cost; the rest is lost.
- **Host index:** clamped to [0.6, 1.6]; a missing or non-positive index prices at 1.0.
- **Rate multiplier:** floored at 0.5, so very low prime rates never make building more than half price through that leg.
- **Business Acumen:** the flat discount floors at 0.5.
- **Tech:** the growth-cost reduction is capped (`TECH_GROWTH_REDUCTION_CAP` = 0.5) and clamped to (0, 1] in the price; the tech dominance shield caps at 0.95.
- **Zero capacity or zero output:** a mothballed sector has nameplate revenue stored as `capitalStock × mixPrice` but produces and sells 0; some systems that read `revenue` (valuation, union busting, transfers) special-case this so a mothballed sector is not treated as free or worthless.
- **Governor ramp:** at `plantsRampLambda` = 0 (the flip turn) enabling plants changes nothing; the 15% deviation cap releases entirely by 240 turns.
- **Retool:** the nameplate (`capacity × RPU`) is preserved, so a retool is never a capital grant or a loss.
- **Free capacity** (grants, research) dilutes the paid per-unit basis on purpose, so it cannot be sold for cash it never cost.

## Connections

Driven by:
- Prime rate and CEO Business Acumen (`rateMult`, `acumenMult` in `computeBuildCost`).
- Host state cost of living (`hostBuildPriceIndex`, from the state metrics layer).
- Tech tree growth-cost reduction and dominance shield (`src/lib/constants/techTree/effects.ts`).
- Commodity clearing and prices (`src/lib/market/clearing.ts`, lagged one turn) and global input balances (Leontief throughput).
- Labour market state: wages, unions, strikes (`src/lib/labour/strikes.ts`), minimum wage.
- Disasters (physical leg of the production factor) and embargoes (`embargoRevenueFactor`).
- Era preset (`getEraUnitScale`, `capacityEraPriceIndex`, 1991 construction basis).

Affects:
- Corporation profit, cash and valuation (`sectorNPV`, `advanceCapitalBookAnchor` in `src/lib/market/capital.ts`; see [corporations.md](./corporations.md) and [economic-systems.md](./economic-systems.md)).
- Market share and dominance (`src/lib/corporations/marketShare.ts`), which feeds back into build price.
- State labour metrics (wage and automation indices accumulated in the sector pass).
- Corporate attacks and nationalization, which transfer or convert capacity (`src/lib/nationalization/`, `src/lib/corporations/capacityCapture.ts`).
- Commodity supply seen by the clearing market next turn.

Last checked: 2026-10-29, version 1.18.0
