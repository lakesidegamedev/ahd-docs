# The Capacity Economy (as shipped)

## Summary

Under the live market mode (`marketSystemMode: "plants"`, the top tier of `src/lib/market/modes.ts`), a corporation's sector no longer earns from a self-compounding revenue number. It owns physical capacity (`capitalStock`, measured in output units per day), buys more of it through a priced build queue, staffs it with workers, and earns only what those plants actually produce and sell into a clearing market. This document describes that system as it runs today, from the player-visible loop down to the constants and formulas in `src/lib/constants/capacityEconomy.ts`, `src/lib/market/capital.ts`, and `src/lib/turn/corporation/sectorTurn.ts`. It supersedes the older market-mode sections of `design/corporations.md` and `design/economic-systems.md` where they describe growth-slider revenue as current behavior.

Player guide: [Running a Corporation under the Plants System](https://www.ahousedividedgame.com/wiki/plants-corp-guide) and [Market System: A Player's Guide](https://www.ahousedividedgame.com/wiki/market-system-guide)

## Rules

### The player-visible loop

1. **Found or expand.** A CEO opens a sector in a (state, sectorType) cell. Founding builds are priced at `CAPACITY_FOUNDING_DISCOUNT` = 0.1 of the standing capacity price (legacy calibrations only; the 1991 preset pays the full basis, see "How a build is priced").
2. **Build capacity.** `POST .../build-capacity` (`src/lib/corporations/commands/sectorOperations/buildCapacity.ts`) charges cash now; the order sits in the sector's `buildQueue` and comes online `CAPACITY_BUILD_TURNS(type)` turns later (base table in `src/lib/constants/capacityEconomy.ts`: 12 for retail, 24 for media, financial and technology, 36 logistics, 48 construction, healthcare and agriculture, 60 telecommunications and real estate, 72 manufacturing, vehicles and defense, 84 chemicals, 96 energy and extraction; default `CAPACITY_BUILD_TURNS_DEFAULT` = 48; 48 turns = one game year). `investmentBuildTurns` in `src/lib/corporations/investment/rules.ts` then halves founding builds and any base of 72 or more (`heavyBuildTimeMultiplier` = 0.5, rounded up), and tech growth-cost reductions shorten the schedule further (`techBuildTurns`, `TECH_BUILD_TIME_PER_GROWTH_REDUCTION` = 0.6 in `src/lib/constants/techTree/effects.ts`; never below 1 turn). Cancelling refunds `CAPACITY_BUILD_CANCEL_REFUND` = 0.75 of the paid cost. A sector holds at most 20 outstanding orders (`MAX_OUTSTANDING_BUILD_ORDERS` in `buildCapacity.ts`); a single order is capped at `MAX_BUILD_UNITS_PER_ORDER` = 10,000,000 units.
3. **Run the plants.** Each turn the sector produces up to its capacity, throttled by inputs, disasters, strikes, and its production-policy slider; it sells into the clearing market at its chosen pricing posture (`clampPricingPosture`, −20% to +20%); revenue is derived from units sold, not asserted.
4. **Pay real costs.** Labour (workers × wages), physical input purchases, idle upkeep, compliance, and the residual opex line. Idle capacity is not free: cost basis is `utilization + IDLE_UPKEEP_FRACTION × (1 − utilization)` with `IDLE_UPKEEP_FRACTION` = 0.3. Mothballing (`action: "mothball"`) cold-stows the plants: zero output, upkeep at `MOTHBALL_UPKEEP_FRACTION` = 0.05 of running maintenance (an alias of `COLD_CAPACITY_UPKEEP_FRACTION` in `src/lib/corporations/investment/rules.ts`). A partial mothball (`activeCapacityPercent`, 0 to 100) parks only part of the stock: the parked share pays the 0.05 cold rate, the active share pays idle upkeep only on units the owner idled (`capacityUpkeepUnits`). Capacity idled by the demand throttle rather than the owner pays `THROTTLE_IDLE_UPKEEP_SHARE` = 0.33 of the idle rate, so overbuilding still costs something.
5. **Grow, shrink, retool, or fight.** Depreciation (`CAPITAL_DEPRECIATION_PER_TURN` = 0.0005 in `src/lib/market/capital.ts`, about 12% over five game years) erodes capacity that is not replaced. Retooling to another production strategy rescales the stock so the nameplate is invariant (D9, below). Corporate attacks transfer capacity at `ATTACK_CAPTURE_EFFICIENCY` = 0.6 (the rest is destroyed) and are floored at the build price of the received units times `ATTACK_BUILD_PRICE_PREMIUM` = 1.15, so war is always dearer than building.

The interface counts in **facilities**, not raw units. `src/lib/constants/facilityQuantum.ts` sizes one facility per sector so its nameplate lands near `FACILITY_TARGET_DAILY_REVENUE_ANCHOR` = ₳25,000/day (energy: 250 units per power station; automobiles: 1 unit per assembly plant; retail: 80 per store). `src/lib/constants/facilityVocabulary.ts` supplies the display nouns and verbs: you open a store, build an arsenal, sink a mine. Neither file changes a number; the engine, storage, and market share stay in units.

### The unit of capacity and RPU

One unit of capacity is "one output unit per day". Its money value hangs on one quantity, the unit yield

```
k(type) = Σ over output commodities (rate_c / basePrice_c)   [units per ₳ of daily revenue]
RPU(type) = 1 / k(type)                                       [₳ of daily revenue per unit]
```

exactly the per-revenue slope of `impliedOutputUnits` in `src/lib/market/capital.ts`. RPU is a harmonic-style mix price dominated by the cheap legs of the output basket, which is why an energy unit is worth about ₳92/day (exactly 1200/13 = 92.31 in a modern world) while an automobile unit is worth about ₳50,000/day. `plantsMixPrice` in `sectorTurn.ts` is the same number, so the stored pair always satisfies `revenue === capitalStock × mixPrice` exactly (capacity is persisted unrounded for this reason).

Two derived anchors, both scale-free and both pinned by tests against the legacy tables:

- **Identity B (price).** `capacityPricePerUnit(type, year, unitScale, strategyId, ...preset) = GROWTH_COST_MULTIPLIER × RPU(strategy) × capacityEraPriceIndex(year)`, with `GROWTH_COST_MULTIPLIER` = 3.0 (`src/lib/constants/corporationsClient.ts`). Capacity is priced at the RPU of the strategy it will run, not the sector default. At the 1953 calibration anchor (`CAPACITY_ANCHOR_YEAR` = 1953) the era index is exactly 1.0, so building through the queue costs exactly what the legacy growth slider charged for the same increment. The 1991 preset is the exception: its construction price is one day of nominal output per unit (`CAPACITY_INVESTMENT_REVENUE_DAYS` = 1 via `constructionPriceForDailyRevenue`), with no era index and no 3.0 multiplier. That basis is chosen by `uses1991Construction`, from the originating preset when known (so a 1991 world keeps its basis as it ages), else from `year === 1991`.
- **Identity A (labour).** `laborIntensity(type, year, unitScale) = RPU / CAPACITY_REVENUE_PER_WORKER × capacityEraLaborIndex(year)`, with `CAPACITY_REVENUE_PER_WORKER` = ₳2,000 in `src/lib/constants/capacityEconomy.ts` (kept in lockstep with the module-private `REVENUE_PER_WORKER` = ₳2,000 behind `calculateWorkers` in `src/lib/constants/corporations.ts`). At 1953 the labour index is 1.0, so capacity staffed from this table carries exactly the headcount `calculateWorkers` gives it.

### How a build is priced

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

Dominance detail: the local leg is `getDominanceGrowthCostMultiplier(localShare)`, the national leg `getNationalDominanceGrowthCostMultiplier(nationalShare)`, both convex ramps (`DOMINANCE_RAMP_EXPONENT` = 2) from 1.0 at the threshold (`DOMINANCE_MARKET_SHARE_THRESHOLD` = 50, `DOMINANCE_NATIONAL_SHARE_THRESHOLD` = 30) to `DOMINANCE_GROWTH_COST_MULT_AT_FULL` = 3.0 at 100% share, all in `src/lib/constants/corporations.ts`. The toll's excess over 1.0 is scaled by `dominanceDensityFactor(competitorCount)` (`DOMINANCE_DENSITY_MIN_FACTOR` = 0.35 with no rivals, rising linearly to 1.0 at `DOMINANCE_DENSITY_CROWDED_COMPETITORS` = 4; an unknown count counts as 1.0) and by one minus the tech dominance shield (capped at 0.95). A separate commodity toll from `src/lib/corporations/rules/commodityDominanceRamp.ts` (free below `COMMODITY_DOMINANCE_FREE_RATIO` = 0.5, 3x at parity, 10x at double) is not discounted by density or shield. The build is charged the larger of the two. `expansionMult` is `SECTOR_INVESTMENT_POLICY.expansionCostMultiplier` = 0.8 in `src/lib/corporations/investment/rules.ts`. `acumenMult` is `max(0.5, 1 - (acumen - 50) × ACUMEN_GROWTH_COST_SLOPE)` with `ACUMEN_GROWTH_COST_SLOPE` = 0.03.

The host multiplier reads the state's `costOfLiving` metric (a real index, deliberately not an exchange rate, which would create a weak-currency carry trade); the clamp band is `HOST_BUILD_PRICE_INDEX_MIN` = 0.6 to `HOST_BUILD_PRICE_INDEX_MAX` = 1.6. Under plants, dominance is tolled here and only here: the old permanent dominance margin penalty and regulatory-burden revenue tax are faded out over the plants ramp in `sectorTurn.ts`, so market leadership is a barrier to expansion, not a tax on operating.

### Era money scale

The base-price tables are 2019-calibrated. Each world carries an era unit scale, `getEraUnitScale(preset)` in `src/lib/constants/sectorSeedEra.ts` (1 for modern worlds, roughly 70 for 1953), threaded as a required parameter through every ₳-to-units conversion so a 1953 economy does not collapse into a handful of modern-sized units. The era price column is a set of anchors in `CAPACITY_ERA_PRICE_ANCHORS` (`src/lib/constants/capacityEconomy.ts`), interpolated geometrically between them by `capacityEraPriceIndex`: 1.0 at 1953 (held flat before it), 1.4 at 1971, 2.6 at 1979, 3.6 at 1991, 5.0 at `MODERN_ERA_START_YEAR` = 1999 (`src/lib/constants/monetaryEra.ts`), held at 5.0 after, and 5.0 when the year is missing. Equal year steps inside a span change the price by equal proportions, so there is no price jump at an era boundary. The column is flagged provisional in code. The labour column derives live from `eraLaborMultiplier` renormalized to 1.0 at 1953. Facility sizes are era-invariant by construction: RPU and "meaningful revenue" shrink by the same nominal ratio.

### The sector turn

`processSector` in `src/lib/turn/corporation/sectorTurn.ts` runs each sector once per turn inside the `corporationTurn` phase:

1. **Deliver builds, advance capacity.** Orders with `onlineTurn <= currentTurn` convert into stock (smooth orders deliver a slice per turn); their cash moves from construction-in-progress into `capacityBookAnchor`, the depreciated paid basis. Capacity then advances by `advanceCapitalStock`: `stock × (1 + growth − CAPITAL_DEPRECIATION_PER_TURN)`, with growth pinned at 0 under plants (the slider no longer builds capacity). Queue writes are `$pull`/`$inc` deltas, never whole-array `$set`, so an order placed mid-turn survives.
2. **Produce.** `producedUnits = capacity × productionFactor`, where the production factor multiplies the disaster physical leg, the production-policy slider, nationalization transition shock, the extraction geological hard ceiling (`plantsExtractionHardMin`, the deposit is a second hard min on units with no 0.5 floor), input throughput (Leontief on lagged global balances), tech output multipliers, and the strike throttle (`STRIKE_REVENUE_THROTTLE` = 0.25 in `src/lib/labour/strikes.ts`). A mothballed sector produces 0.
3. **Sell and derive revenue.** `plantsDerivedHourlyRevenue = producedUnits × mixPrice / TURNS_PER_DAY × clearingRevenueLeg × embargoRevenueFactor`, with `TURNS_PER_DAY` = 24 (`src/lib/constants/corporationsClient.ts`). The clearing leg comes from `src/lib/market/clearing.ts`: sellers post a posture in [−0.2, +0.2], demand (lagged one turn) fills cheapest-first, and the leg factor is `soldFraction × (1 + posture) × priceRealizationFactor`. Quality scales only the premium portion of a positive posture (multiplier clamped [0.5, 1.5]).
4. **Governor.** The derived amount is blended against the pre-flip counterfactual baseline by `softenedMarketRealizationAmount` (`src/lib/market/capital.ts`): deviation is capped at `MARKET_REALIZATION_DEVIATION_CAP` = 0.15 of baseline and ramped in over `MARKET_REALIZATION_RAMP_TURNS` = 240 turns, and the cap widens as `cap / (1 − λ)` so it releases entirely at full ramp. λ = 0 on the flip turn makes enabling plants a byte-identical no-op; a fully ramped world stands on its physical result alone. The same λ (`plantsRampLambda`) fades in every other plants-only economics change (idle upkeep, dominance consolidation, the extraction hard min, the disaster physical leg).
5. **Cost the plants physically.** Under plants the margin-formula cost is replaced by physical lines (`src/lib/corporations/physicalPnl.ts`): inputs bought at lagged market prices for what was actually produced, labour, idle/mothball upkeep, compliance, financial legs, and a calibrated residual (`otherOpexPerUnitAnchor`, solved once on the first producing turn so the flip reproduces the old cost exactly, then held per unit). Profit is revenue minus these lines; the reported margin becomes an output (`profit ÷ revenue`), not an input.
6. **Write back.** `sector.revenue` is restated as the nameplate `capitalStock × mixPrice` (never realized revenue, which would compound the realization legs into the base at roughly −7%/turn); `realizedRevenue`, `producedUnits`, `soldUnits`, utilization, and clearing/throughput telemetry are persisted for display only.

### Staffing and the labour market

Headcount is `calculateWorkers(revenue, workforceSkill)`: `revenue / 2,000` at neutral skill 50, with a skill multiplier down to 0.70× at skill 100. When the labour system is on (`labourSystemMode >= "wages"`), a labour cost is carved out of maintenance as workers × wage-per-worker, scaled by the CEO wage slider, the minimum-wage Kaitz floor, tech automation, and the union premium; the split is profit-invariant at baseline. Unionization trends toward a condition-driven target each turn (wages vs cost of living, unemployment, union law, owned-union membership pressure), and strikes trigger with hysteresis and cooldowns (`src/lib/labour/strikes.ts`: `STRIKE_DURATION_TURNS` = 4, `STRIKE_COOLDOWN_TURNS` = 12), throttling revenue and hitting margin (`STRIKE_MARGIN_PENALTY_PP` = −8) while active. Per-state wage and automation indices are accumulated during the sector pass and feed the state labour metrics.

### Market share and dominance

`src/lib/corporations/marketShare.ts`: share = sector revenue ÷ effective market × 100, where the effective market is the larger of the GDP-derived floor (`SECTOR_MARKET_GDP_FRACTION` = 100 of state GDP split across sector types, in `src/lib/constants/corporations.ts`) and the owned-plus-unowned revenue sum, all in anchor ₳. Two dominance legs exist: the local (state, sectorType) share with a 50% threshold, and the national share (weighted average across states, 30% threshold); every toll charges the harsher leg. Under plants those tolls collapse into the build-price multiplier, as above.

### Valuation

`sectorNPV` is a perpetuity on current yearly profit (`NPV_ANNUAL_DISCOUNT_RATE` = 0.15). Under capital and plants, valuation is floored by `advanceCapitalBookAnchor`: seeded at NPV on first exposure, ratcheting up with NPV, decaying at the depreciation rate when NPV falls, so a corp that owns real capacity through a transient profit dip is not valued as if it owns nothing. The paid basis (`capacityBookAnchor`) depreciates with the stock, so a half-worn plant books at half what was paid, never at half list price. Free capacity (grants, R&D) dilutes the per-unit basis deliberately: it cannot be exited for cash it never cost.

### Retooling (D9)

Capacity units are not commensurable across production strategies (a coal mix prices around ₳60/unit, rare earths in the tens of thousands). On a strategy change, `rescaleCapacityForStrategyChange` multiplies the stock (and in-flight `unitsOrdered`) by `RPU_old / RPU_new` so the nameplate `capacity × RPU` is invariant: a retool is a re-aim, not a capital grant. The rescale happens once at commit against the final rates; the 12-turn transition blend (`STRATEGY_TRANSITION_TURNS` in `src/lib/constants/sectorStrategyTypes.ts`) misprices the nameplate briefly, decaying to zero, which is accepted for auditability. In-flight orders keep their `costPaidAnchor` untouched, because that is cash already spent and the cancellation refund must report what was paid.

## Data

Sector state lives on `corporateSectors` documents and is written by one end-of-turn bulk write per turn (`SectorUpdateOp` in `src/lib/turn/corporation/types.ts`).

| Field | Meaning | Written by | Shown to players |
| --- | --- | --- | --- |
| `capitalStock` | Owned capacity in units/day, persisted unrounded | `sectorTurn.ts`, capture, retool | Yes (as facilities) |
| `buildQueue` | Outstanding orders with `onlineTurn`, `unitsOrdered`, `costPaidAnchor` | `buildCapacity.ts` (push), `sectorTurn.ts` (`$pull` on landing) | Yes |
| `capacityBookAnchor` | Depreciated paid basis of owned capacity | `sectorTurn.ts` | Indirectly (valuation) |
| `capitalBookAnchor` | NPV-floor valuation anchor (rounded) | `sectorTurn.ts` | Indirectly |
| `revenue` | Restated nameplate `capitalStock × mixPrice` | `sectorTurn.ts` | Yes |
| `realizedRevenue`, `producedUnits`, `soldUnits` | Actual output telemetry (units rounded to 2 decimals) | `sectorTurn.ts` | Yes |
| `capitalUtilization`, `capacityUtilization`, `throughputFactor`, `throughputBindingInput` | Display telemetry, never read back into the economy | `sectorTurn.ts` | Yes |
| `mothballed`, `activeCapacityPercent` | Owner idling controls | sector operation commands | Yes |
| `operatingCapacityUnits`, `operatingCapacityTurn`, `plantCount`, `plantUnitRemainder`, `plantsStartTurn`, `demandIdleTurns` | Plants bookkeeping and ramp anchor | `sectorTurn.ts` | Partly |
| `transitionFromStrategyId`, `transitionStartTurn`, `transitionCooldownUntilTurn` | Retool blend state, cleared after `STRATEGY_TRANSITION_TURNS` | strategy commands, `sectorTurn.ts` | Yes |

Reads per turn: `gameConfig` (mode flags), the lagged commodity balances and clearing factors from the pre-pass, state metrics (`costOfLiving`, wages), corporation and CEO stats (acumen, workforce skill). Build-cost previews read the same inputs through `computeBuildCost`.

## Configuration

| Setting | Default | Where the default is set |
| --- | --- | --- |
| `gameConfig.marketSystemMode` | `"plants"`; ladder `off`, `realization`, `ledger`, `clearing`, `capital`, `plants` | `src/lib/seeds/reference/featureFlagDefaults.ts`, ladder in `src/lib/market/modes.ts` |
| `gameConfig.labourSystemMode` | `"full"` | `src/lib/seeds/reference/featureFlagDefaults.ts` |
| Era unit scale | 1 modern, about 70 for 1953 | `getEraUnitScale` in `src/lib/constants/sectorSeedEra.ts` |
| 1991 construction basis | one day of nominal output per unit | `uses1991Construction`, `CAPACITY_INVESTMENT_REVENUE_DAYS` in `src/lib/corporations/investment/rules.ts` |
| Investment policy | `expansionCostMultiplier` 0.8, `heavyBuildTimeMultiplier` 0.5 | `SECTOR_INVESTMENT_POLICY` in `src/lib/corporations/investment/rules.ts` |

The mode is read live from `gameConfig` (`_id: "default"`) by `src/lib/market/featureFlag.ts`; an absent or unknown value reads as `"off"`. Flipping a world needs an explicit admin action, preceded by the plants preflight check and followed by a soak watch (`scripts/ops/plantsPreflight.ts`, `scripts/ops/plantsWatch.ts`). Every numeric constant in the Rules section is a code constant, not a config field; several (the era price column, build-turn table, `ATTACK_CAPTURE_EFFICIENCY`, host index band) are marked provisional in code.

## Timing

The sector pass runs inside the `corporationTurn` phase of `src/simulation/phases/turnPhaseRegistry.ts`, concurrently with `actionRefresh` and `fundGeneration`, and before NPP corporate aggression, which reads the turn's settled finances and market share. Inside the phase `src/lib/turn/corporation/clearingPrePass.ts` computes the clearing factors for every sector first (from lagged demand and the previous turn's output), then `processSector` in `sectorTurn.ts` runs the six steps above per sector. Build orders are placed outside the turn by the `build-capacity` command and only deliver inside step 1. Because demand and input balances are lagged one turn, a plant that restarts or lands its first capacity runs at `RESTART_RUN_SHARE` = 0.25 that turn (`src/lib/constants/capacityEconomy.ts`), since there is no last-turn output on the market to sell.

```
command (any time): build-capacity -> cash charged -> buildQueue push
turn, corporationTurn phase:
  1. clearingPrePass          clearing factors for all sectors (lagged demand)
  2. processSector, per sector:
       deliver builds -> advance capacity -> produce -> sell/derive revenue
       -> governor blend -> physical costs -> write back
  3. one bulk write to corporateSectors
after: NPP corporate aggression reads settled finances and share
```

## Worked trace

An energy corporation in a modern world (year 2020) on the legacy price basis (not the 1991 preset), neutral CEO (acumen 50), prime rate 0, no tech, no dominance, a host state with cost of living 100, orders 1,000 units as an expansion. Values below were computed with the live `computeBuildCost`.

1. RPU of energy = 1200/13 = ₳92.3077 per unit per day.
2. Unit price = `3.0 × 92.3077 × 5.0` (era index at 2019 and later) = ₳1,384.62.
3. Multipliers: dominance 1.0, rate `max(0.5, 1 + 0)` = 1.0, acumen 1.0, tech 1.0, host 1.0, founding 1.0, expansion 0.8.
4. Order total = `1,000 × 1,384.62 × 0.8` = ₳1,107,692.31, charged now (about ₳1,104,000 if RPU is rounded to 92).
5. Online: base 96 turns, 96 is 72 or more so halved to 48 turns (`CAPACITY_BUILD_TURNS("energy")` returns 48).
6. On landing, 1,000 units enter `capitalStock`, and the paid cost moves from construction-in-progress to `capacityBookAnchor`. The first turn's advance gives `1,000 × (1 + 0 − 0.0005)` = 999.5 units.
7. Stored nameplate `revenue` = `999.5 × 92.3077` = ₳92,261.54 per day. At full production factor 1.0 and a clearing leg of 1.0, hourly derived revenue is `999.5 × 92.3077 / 24` = ₳3,844.23 per turn before the governor and costs.
8. If the same corp held 60% local share with four or more rivals: ramp `t = (60 − 50) / 50` = 0.2, squared 0.04, so the toll is `1 + (3.0 − 1) × 0.04` = 1.08 (density factor 1.0), and the order costs 8% more: ₳1,196,307.69.

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
- **Unknown sector type:** `revenuePerCapacityUnitForStrategy` returns 0 and the rescale ratio reads 0 as "nothing to do", so a legacy sector type never errors a retool route.
- **Invalid scale or year:** `safeUnitScale` treats a missing, non-finite or non-positive unit scale as 1; a missing year prices at the modern era index.

## Invariants

- **Stored pair:** `revenue === capitalStock × mixPrice` exactly, which is why capacity is persisted unrounded. Pinned by `sectorTurn.plants.test.ts` and `sectorTurn.units.test.ts`.
- **Retool nameplate:** `capacity × RPU` unchanged across a strategy change. Pinned by `src/lib/constants/capacityEconomy.d9.test.ts` and `src/lib/corporations/physicalPnl.retoolAnchor.test.ts`.
- **Flip identity:** enabling plants on the flip turn is a no-op (λ = 0). Pinned by `sectorTurn.p3aFlipIdentity.test.ts` and `sectorTurn.flipIdentityNastyStates.test.ts`.
- **Anchor year:** both era columns are exactly 1.0 at 1953, and price is monotonic with no era-boundary jump. Pinned by `capacityEconomy.test.ts`.
- **Labour lockstep:** `CAPACITY_REVENUE_PER_WORKER` matches `calculateWorkers` live behavior. Pinned by `capacityEconomy.test.ts`.
- **Capacity conservation:** found, shed, attack and restore flows neither mint nor lose units beyond the stated attrition. Pinned by `src/lib/corporations/capacityConservation.test.ts`.
- **Queue safety:** an order placed mid-turn survives the end-of-turn write. Pinned by `sectorTurn.buildQueue.test.ts`.
- Not enforced at runtime: the 20-order cap is checked by the command only, and the provisional constants have no automated drift check beyond their tests.

## Failure and recovery

- **Stale or wrong stored capacity:** repaired with a targeted data heal (recompute `capitalStock` or the construction-in-progress total from the queue). Construction-in-progress is written absolutely from the queue each turn, so stale or negative values self-correct on the next turn.
- **Bad flip to plants:** rolled back by the capital-mode rollback (`src/lib/corporations/capitalModeRollback.ts`, `scripts/migrations/restoreCapitalModeFromShadow.ts`), which restores the pre-flip state from a shadow copy. The preflight and soak scripts exist to catch this early.
- **Queue write races:** the queue is updated with `$pull`/`$inc` deltas rather than a whole-array `$set`, so a build order placed during the sector compute phase is not erased by the end-of-turn write.
- **Retool conversion drift:** because the retool unit conversion must be invertible, any rounding of `capitalStock` is a bug; the repair is to recompute the stock from the nameplate and the destination RPU.

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

## Tests

- Constants and pricing: `src/lib/constants/capacityEconomy.test.ts`, `capacityEconomy.buildCost.test.ts`, `capacityEconomy.buildDensity.test.ts`, `capacityEconomy.hostPricing.test.ts`, `capacityEconomy.strategyPricing.test.ts`, `capacityEconomy.d9.test.ts`.
- Facilities: `src/lib/constants/facilityQuantum.test.ts`, `facilityVocabulary.test.ts`.
- Market: `src/lib/market/capital.test.ts`, `clearing.test.ts`, `plantsTransition.test.ts`, `modes.test.ts`.
- Sector turn: `src/lib/turn/corporation/sectorTurn.plants.test.ts`, `sectorTurn.plantsMultiTurn.test.ts`, `sectorTurn.buildQueue.test.ts`, `sectorTurn.p3aFlipIdentity.test.ts`, `sectorTurn.p35PhysicalPnl.test.ts`, `sectorTurn.longRunAndGovernor.test.ts`, `sectorTurn.p3bExtractionHardMin.test.ts`, `clearingPrePass.test.ts`.
- Costs and capture: `src/lib/corporations/physicalPnl.idleUpkeep.test.ts`, `capacityCapture.test.ts`, `capacityConservation.test.ts`.
- Commands: `src/lib/corporations/commands/sectorOperations/buildCapacity.test.ts`, `bulkBuildCapacity.test.ts`.
- Labour and share: `src/lib/labour/strikes.test.ts`, `src/lib/corporations/marketShare.test.ts`, `marketShareNational.test.ts`.
- Gaps: no test pins the exact worked-trace numbers above end to end, and the 20-order cap is covered only through the command tests.

## Known issues and history

- The era price column, build-turn table, `ATTACK_CAPTURE_EFFICIENCY`, and the host price index band are flagged `PROVISIONAL` in code comments, meaning they are authored shapes awaiting calibration, not derived values.
- During a retool's 12-turn transition blend the nameplate is briefly mispriced, decaying to zero; accepted for auditability.
- No dated change history is recorded in this document.

Last checked: 2026-10-29, version 1.18.0
