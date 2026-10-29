# The Capacity Economy (as shipped)

Under the live market mode (`marketSystemMode: "plants"`, the top tier of `src/lib/market/modes.ts`), a corporation's sector no longer earns from a self-compounding revenue number. It owns physical capacity (`capitalStock`, measured in output units per day), buys more of it through a priced build queue, staffs it with workers, and earns only what those plants actually produce and sell into a clearing market. This document describes that system as it runs today, from the player-visible loop down to the constants and formulas in `src/lib/constants/capacityEconomy.ts`, `src/lib/market/capital.ts`, and `src/lib/turn/corporation/sectorTurn.ts`. It supersedes the older market-mode sections of `design/corporations.md` and `design/economic-systems.md` where they describe growth-slider revenue as current behavior.

## The player-visible loop

1. **Found or expand.** A CEO opens a sector in a (state, sectorType) cell. Founding builds are priced at `CAPACITY_FOUNDING_DISCOUNT` = 0.1 of the standing capacity price.
2. **Build capacity.** `POST .../build-capacity` (`src/lib/corporations/commands/sectorOperations/buildCapacity.ts`) charges cash now; the order sits in the sector's `buildQueue` and comes online `CAPACITY_BUILD_TURNS(type)` turns later (12 turns for retail up to 96 for energy and extraction; default 48; 48 turns = one game year). Cancelling refunds `CAPACITY_BUILD_CANCEL_REFUND` = 0.75 of the paid cost. A sector holds at most 20 outstanding orders; a single order is capped at `MAX_BUILD_UNITS_PER_ORDER` = 10,000,000 units.
3. **Run the plants.** Each turn the sector produces up to its capacity, throttled by inputs, disasters, strikes, and its production-policy slider; it sells into the clearing market at its chosen pricing posture (`clampPricingPosture`, −20% to +20%); revenue is derived from units sold, not asserted.
4. **Pay real costs.** Labour (workers × wages), physical input purchases, idle upkeep, compliance, and the residual opex line. Idle capacity is not free: cost basis is `utilization + IDLE_UPKEEP_FRACTION × (1 − utilization)` with `IDLE_UPKEEP_FRACTION` = 0.3. Mothballing (`action: "mothball"`) cold-stows the plants: zero output, upkeep at `MOTHBALL_UPKEEP_FRACTION` = 0.05 of running maintenance.
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

- **Identity B (price).** `capacityPricePerUnit(type, year, unitScale) = GROWTH_COST_MULTIPLIER × RPU × capacityEraPriceIndex(year)`, with `GROWTH_COST_MULTIPLIER` = 3.0 (`src/lib/constants/corporations.ts`). At the 1953 calibration anchor the era index is exactly 1.0, so building through the queue costs exactly what the legacy growth slider charged for the same increment.
- **Identity A (labour).** `laborIntensity(type, year, unitScale) = RPU / CAPACITY_REVENUE_PER_WORKER × capacityEraLaborIndex(year)`, with `CAPACITY_REVENUE_PER_WORKER` = ₳2,000 (mirroring the module-private `REVENUE_PER_WORKER` behind `calculateWorkers`, also ₳2,000). At 1953 the labour index is 1.0, so capacity staffed from this table carries exactly the headcount `calculateWorkers` gives it.

## How a build is priced

`computeBuildCost` is the single pure function the command, the UI preview, NPP behavior, and the tests all share:

```
total = units × capacityPricePerUnit(type, year, eraUnitScale)
              × dominanceMult(share)          // local vs national share, harsher leg wins
              × rateMult(primeRate, acumen)   // max(0.5, 1 + primeRate/10 × acumenRateSensitivity)
              × acumenMult(acumen)            // flat CEO Business Acumen discount
              × techMult                      // capped tech growth-cost reduction, clamped (0, 1]
              × hostPriceMult(costOfLiving)   // host state's index / 100, clamped [0.6, 1.6]
              × foundingMult                  // 0.1 on the founding build, else 1
```

The host multiplier reads the state's `costOfLiving` metric (a real index, deliberately not an exchange rate, which would create a weak-currency carry trade); the clamp band is `HOST_BUILD_PRICE_INDEX_MIN` = 0.6 to `HOST_BUILD_PRICE_INDEX_MAX` = 1.6. Under plants, dominance is tolled here and only here: the old permanent dominance margin penalty and regulatory-burden revenue tax are faded out over the plants ramp in `sectorTurn.ts`, so market leadership is a barrier to expansion, not a tax on operating.

## Era money scale

The base-price tables are 2019-calibrated. Each world carries an era unit scale, `getEraUnitScale(preset)` in `src/lib/constants/sectorSeedEra.ts` (1 for modern worlds, roughly 70 for 1953), threaded as a required parameter through every ₳-to-units conversion so a 1953 economy does not collapse into a handful of modern-sized units. The era price column (`CAPACITY_ERA_PRICE_SPANS`) steps 1.0 (through 1970), 1.4 (1971 to 1978), 2.6 (1979 to 1990), 3.6 (1991 to the modern boundary), and 5.0 modern; the labour column derives live from `eraLaborMultiplier` renormalized to 1.0 at 1953. Facility sizes are era-invariant by construction: RPU and "meaningful revenue" shrink by the same nominal ratio.

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
