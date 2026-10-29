# Corporations

The corporation system lets players found and manage businesses that operate across state economies. Corporations generate revenue, employ workers, and interact with state metrics to create economic feedback loops between legislation and business outcomes.

## Summary

Player guide: [Corporations](https://www.ahousedividedgame.com/wiki/corporations)

A corporation is a company a character founds and runs as CEO. It owns sectors (physical capacity in a state, under the live `plants` market mode), pays corporate tax to the host country, pays a CEO salary and dividends, and has a tradable share price. This page is the exact-rules reference: constants with their source files, formulas, data written, timing and edge cases. The sections below sit under the fixed technical headings; the original feature write-ups are kept as subsections of Rules.

Scope notes:

- The live market mode is `plants` (top tier of `src/lib/market/modes.ts`). Several formulas below are the legacy growth-slider model; each is marked where the plants model replaces it. See [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md) for the current revenue model.
- Other systems own their own detail: [Labour](./labour.md), [Stock market](./stock-market.md), [Corporate bonds](./corporate-bond-defaults.md), [Subsidiary corporations](./subsidiary-corporations.md), [Mergers and acquisitions](./corporate-mergers-and-acquisitions.md).

## Rules

### Founding a Corporation

- **Cost and starter plant:** In plants worlds, founding charges an era-scaled entry fee plus a discounted starter build. The build is queued at zero capital stock and comes online after its shortened greenfield construction time.
- **CEO shares:** Founder equity is created by the founding flow; IPO structure and dual-class selection can change voting control.
- **Requirement:** One active CEO seat per character. Founding starts a 96-turn per-user cooldown before that user can re-found after leaving.
- **Starting marketing strength:** 10 (`marketingStrength`, used for market capture; grows further from marketing spend each turn)

| Constant | Value | Source |
| -------- | ----- | ------ |
| `CORPORATION_FOUNDING_COST` | 1,000,000 (era-scaled by world preset) | `src/lib/constants/corporations.ts` |
| `CORPORATION_STARTING_CAPITAL` | 1,000,000 default treasury | `src/lib/constants/corporations.ts` |
| `MIN_CORPORATION_STARTING_CAPITAL` / `MAX_CORPORATION_STARTING_CAPITAL` | 1,000,000 / 50,000,000 | `src/lib/constants/corporations.ts` |
| `CORPORATION_FOUNDING_COOLDOWN_TURNS` | 96, starts when the previous corporation ends | `src/lib/constants/corporations.ts` |
| `CEO_INITIAL_SHARES` | 10,000,000 | `src/lib/constants/corporations.ts` |
| `DEFAULT_SHARE_PRICE` | 0.10 | `src/lib/constants/corporations.ts` |
| `CEO_SALARY_MAX_REVENUE_MULTIPLE` | 1.25 | `src/lib/constants/corporations.ts` |
| `CORP_OVERHEAD_MAX_REVENUE_MULTIPLE` | 1.5 | `src/lib/constants/corporations.ts` |
| `TURNS_PER_DAY` | 24 (one turn is one real hour) | `src/lib/constants/corporationsClient.ts` |
| `MIN_CORPORATION_DISSOLUTION_AGE_TURNS` | 24, minimum age before a player can dissolve | `src/lib/constants/corporations.ts` |
| `CORPORATION_RENAME_COST` / `CORPORATION_RENAME_MS_PENALTY` / `CORPORATION_RENAME_COOLDOWN_TURNS` | 500,000 (₳) / 25% of marketing strength lost / 48 turns | `src/lib/constants/corporations.ts` |
| `SECTOR_EXPANSION_BASE_COST` | 100,000 (legacy expansion charge; plants uses era-scaled build prices) | `src/lib/constants/corporations.ts` |
| `DISSOLUTION_SECTOR_SALVAGE_FRACTION` / `RESTRUCTURE_SECTOR_SALVAGE_FRACTION` | 0.20 on dissolution / 0.85 on bond-default restructuring, of sector NPV | `src/lib/constants/corporations.ts` |
| `DEFAULT_PROFIT_MARGIN` | 35 (base margin for new sectors, %) | `src/lib/constants/corporations.ts` |
| `RELOCATION_COST_FRACTION` / `CROSS_COUNTRY_RELOCATION_MULTIPLIER` | 0.07 / 2 | `src/lib/constants/corporationsClient.ts` |
| `MAX_DIVIDEND_RATE` | 25 (%) | `src/lib/constants/corporationsClient.ts` |

Players choose from 17 sector types (the 15 `CorporationType` values in `CORPORATION_TYPES` plus the `manufacturing_vehicles` and `media_entertainment` lines; list in `OPERATING_SECTOR_TYPES`, `src/lib/constants/corporationsClient.ts`):

| Sector              | Label               |
| ------------------- | ------------------- |
| financial           | Financial           |
| media               | Media               |
| manufacturing       | Manufacturing       |
| healthcare          | Healthcare          |
| retail              | Retail              |
| manufacturing_vehicles | Automobiles (vehicles line of manufacturing) |
| technology          | Technology          |
| energy              | Energy              |
| agriculture         | Agriculture         |
| real_estate         | Real Estate         |
| defense             | Defense             |
| telecommunications  | Telecommunications  |
| media_entertainment | Entertainment (entertainment line of media) |
| logistics           | Logistics           |
| extraction          | Extraction & Mining |
| chemical_industries | Chemical Industries |
| construction        | Construction        |

### Sector Expansion

Under plants, corporations expand by founding a sector and queueing physical
capacity. The entry fee and starter-build price are era-scaled. A new plant
begins with zero `capitalStock`; it does not receive a fixed $1 million revenue
or 500-worker allocation.

- **Sector choice:** Any sector may be founded. Primary and secondary industry types affect margin bonuses rather than entry eligibility.
- **Revenue:** Derived from owned capacity, realized output, and clearing rather than a fixed starter value.
- **Workers and cost:** Derived from the sector's plants model and era-scaled build order.

#### Market Capture

Unowned market share can be captured via "splits":

- **Cash cost:** 5% of unowned sector revenue (`SPLIT_COST_FRACTION`)
- **MS cost:** Escalates with each split, 1 MS, then 2, 4, 8, 16... (formula: `2^splitEscalation`)
- **Escalation decay:** Each turn, escalation level decreases by 1 (cost halves). After reaching 4 MS cost, next turn it's 2, then 1.
- **Base capture:** 5% of unowned sector at 0 marketing strength (`SPLIT_BASE_CAPTURE_FRACTION`)
- **Marketing bonus:** Capture is multiplied by `1 + marketingStrength / 100` (`MS_CAPTURE_DIVISOR`)
- **Unowned bonus:** Capture is multiplied by 1.25 (`UNOWNED_CAPTURE_BONUS_MULTIPLIER`), because unowned sectors have no defense. A tariff-based multiplier (`getSplitCaptureMultiplier()`) and a strength multiplier also apply. Capture is rounded and capped at the unowned amount (`src/app/api/country/[code]/region/[id]/economy/attack/route.ts`).
- **Plants floor:** Under plants the cash cost is the larger of the 5% figure and `unitsReceived x capacityPricePerUnit x 1.15` (`ATTACK_BUILD_PRICE_PREMIUM`, in `src/lib/constants/capacityEconomy.ts`; `attackCostAnchorUnderPlants()` in `src/lib/corporations/capacityCapture.ts`), so a split can never be cheaper than building. Under plants the captured amount also becomes `capitalStock` units for the buyer.
- **Split strength:** `full` (1.0) or `half` (0.5) multiplies both capture and cash cost; half strength costs `max(1, floor(2^escalation x 0.5))` MS (`SPLIT_STRENGTH_MULTIPLIERS` and `calculateSplitMsCostForStrength()` in `src/lib/corporations/marketActionCosts.ts`).
- **Tariff multiplier:** `getSplitCaptureMultiplier()` gives `1 + rate/100 x 0.5` to a domestic corporation and `1 - rate/100 x 0.5` to a foreign one (`SPLIT_CAPTURE_SWING_AT_FULL`, `src/lib/tariffs/rules/tariffCurves.ts`).

The escalation prevents spam-splitting while the decay ensures the cost resets over time. Players must balance split frequency against MS reserves.

#### Unowned Sector Regeneration

In pre-plants modes, unowned sectors grow at half the average owned growth rate,
with the legacy fallback. In plants worlds, unowned headroom grows from the
state's `economic.gdpGrowth`. See `src/lib/turn/unownedSectorGrowth.ts`.

#### Vacant CEO market decay

Player corporations with **no active CEO** (`ceoId` unset/null or `ceoVacant: true`) lose **10% per turn** (`VACANT_CEO_SECTOR_SHED_RATE = 0.1`) of each owned sector. Under the live `plants` market mode the shed removes `rate x capitalStock` units of plant from the corporation and credits the same quantity of headroom to the matching `(stateId, sectorType)` unowned sector (`shedSectorsForCorps()` in `src/lib/turn/corporation/corporationSectorShed.ts`); revenue is not touched because it is re-derived from capital stock each turn. Workers shed at the same 10%. Below the plants tier the shed instead moves 10% of sector revenue and workers (`$inc` into the unowned sector document). On the turn a sector first adopts plants (`plantsStartTurn` still null) the unit shed is deferred one turn and only workers shed. **State-owned / nationalized** corporations (`countryOwnerId` set or `isNationalized`) and suspended corporations are excluded so public enterprises and frozen shells do not bleed, and a state-controlled sector bucket is not re-seeded with unowned capacity. Runs inside `processCorporationTurn` after lookups and caretaker installs, before sector P&L (`src/lib/turn/corporation/vacantCeoSectorShed.ts`).

**Inactive CEO shed.** A corporation whose character CEO has not been active for `INACTIVE_CEO_TURN_THRESHOLD = 72` turns (72 real hours) sheds at the same 10% rate (capacity under plants, revenue below it) immediately after the vacant pass (`src/lib/turn/corporation/inactiveCeoSectorShed.ts`). The CEO keeps full authority and the shed stops the turn after they return. Excluded: vacant, autopilot, imperial or NPP-run, nationalized and country-owned corporations.

### Sector Calculations

The steps below are the legacy growth-slider model. It is still the mechanic under the earlier `marketSystemMode` tiers, but the **live market mode is `"plants"`**, the top tier of `src/lib/market/modes.ts`: a sector no longer earns from a self-compounding growth rate at all. It owns priced, buildable capacity, staffs it with workers, and revenue is derived each turn from what that capacity actually produced and sold into the clearing market. See [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md) for the current model end to end (build queue, capacity pricing, the sector turn, staffing, and valuation); it supersedes steps 1-2 below wherever plants is enabled.

For each sector (legacy growth-slider tiers):

1. **Revenue growth:** `newRevenue = revenue × (1 + growthRate / TURNS_PER_DAY / 100)`
2. **Growth cost:** `calculateDailyGrowthCost(newRevenue, perTurnGrowthRate, primeRate)`, scales with prime rate
3. **Profit margin modifiers:** 15+ additive modifiers (unemployment, grid, corruption, commodities, tariffs, subsidies, etc.)
4. **Effective margin:** `baseMargin + totalModifier`, linear up to `MARGIN_SOFT_CAP_KNEE = 80`, then bent by a tanh soft cap toward `MARGIN_HARD_CEILING = 100` without reaching it (`src/lib/constants/corporations.ts`). It can go negative (loss-making).
5. **Maintenance:** `hourlyRevenue × (1 - effectiveMargin / 100)`
6. **Sector NPV:** `yearlyProfit / 0.15` (15% discount rate, `NPV_ANNUAL_DISCOUNT_RATE`), for balance sheet valuation

Under plants, margin modifiers (step 3) still apply, but revenue and maintenance (steps 1, 2, 5) are replaced by the physical production-and-clearing pass described in [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md): `sector.revenue` becomes the nameplate `capitalStock × mixPrice`, and profit is realized revenue minus physical cost lines, not a margin percentage applied to an asserted revenue figure.

### Corporate Tax

**Entry point:** `src/lib/turn/corporation/sectorCalculations.ts` (per-sector apportionment loop)

Each jurisdiction sets two independent corporate tax rates, a **domestic rate** (applied to corps headquartered in the same country as the sector) and a **foreign rate** (applied to corps headquartered elsewhere). Rates are selected per-sector:

```typescript
const isDomestic = corp.countryId === sector.countryId;
const federalRate = isDomestic
  ? (lookups.domesticCorpTaxRateByCountry.get(sector.countryId) ?? 0)
  : (lookups.foreignCorpTaxRateByCountry.get(sector.countryId) ?? 0);
const stateRate = isDomestic
  ? (lookups.domesticStateCorpTaxRateByState.get(sector.stateId) ?? 0)
  : (lookups.foreignStateCorpTaxRateByState.get(sector.stateId) ?? 0);
```

- **Tax base:** Per-sector apportioned operating income.
- **Classification:** `isDomestic = corp.countryId === sector.countryId`. A US-HQ corp with a UK sector pays the UK **foreign** rate on that sector's profits; a UK-HQ corp with a UK sector pays the UK **domestic** rate. State tier follows the same rule (country-level match, not state-level).
- **Foreign is all-or-nothing:** there is no country-targeting lever. Each country sets one foreign rate, applied symmetrically to every non-domestic corp operating there.
- **Bond coupon income** is taxed at the corp's home-country **domestic** rate (always domestic from the corp's perspective). State tier never taxes bond interest.
- **Losses:** No tax credits, unprofitable sectors pay $0 regardless of classification. Loss-making corps with all-negative sectors pay 0 in both tiers.

Each tax base is blended 75% from a GDP-derived floor (the country's seeded baseline share) and 25% from actual apportioned corporate income, converted to the country's currency (`corporationTurnPhases.ts`). Rates are stored on `federalBudget.taxRates.{domestic,foreign}CorporateTax` and `stateBudgets.taxRates.{domestic,foreign}CorporateTax`, populated by the `*_domestic_corporate_tax_rate` and `*_foreign_corporate_tax_rate` legislation bills per country.

### Tariff & Subsidy Modifiers

**Entry point:** `src/lib/turn/corporation/sectorCalculations.ts:137-162`

**Foreign tariff penalty:** Corps operating outside home country pay margin penalty based on target country's tariff rates against corp's home country.

**Domestic tariff malus:** Home-country corps absorb supply-chain friction from broad tariffs (smaller penalty).

**Tariff blend weights:** Commodity modifiers blend 50% global + 25% national + 25% local (state) prices at baseline; the national weight shifts up (global weight shifts down, local fixed at 25%) as effective tariff coverage rises, up to 25% global / 50% national / 25% local at 100% coverage (`getTariffBlendWeights()`).

**Subsidy bonus:** `+7.5pp` margin per active subsidy (`SUBSIDY_MARGIN_BONUS`, federal + state stack). Qualifying sectors:

- Federal subsidies: Match by `sectorType`
- State subsidies: Match by `sectorType` + `stateId`

Functions: `getForeignTariffMarginModifier()`, `getDomesticTariffMalus()`, `getTariffBlendWeights()`, `getSubsidyMarginModifier()`

### Income Distribution

```typescript
// 1. Corporate tax
corporateTaxOwed = incomePreDividends × (taxRate / 100)

// 2. Dividends (from after-tax income)
afterTaxIncome = incomePreDividends - corporateTaxOwed
hourlyDividendPayout = afterTaxIncome × (dividendRate / 100)

// 3. Final income to corporation
income = incomePreDividends - corporateTaxOwed - hourlyDividendPayout
```

7. **Split escalation decay:** `splitEscalation = max(0, splitEscalation - 1)`, cost halves each turn

Setting a new growth-rate target has no lump-sum cash or MS cost, and downsizing pays no refund; the only cost is the ongoing per-turn `calculateDailyGrowthCost` charge described above (item 2), which scales with the active growth rate and prime rate.

### CEO Salary (implemented)

The CEO can configure a daily salary paid from the corporation's liquid capital each turn. Salary is set via `POST /api/corporations/[id]/settings` as a daily dollar amount and is divided evenly across `TURNS_PER_DAY` turns.

- **DB field:** `Corporation.ceoSalary?: number` (daily dollar amount)
- **Payment:** Deducted from liquid capital each turn; added to the CEO's personal `cashOnHand`
- **No minimum, but a maximum cap:** salary cannot exceed `CEO_SALARY_MAX_REVENUE_MULTIPLE` (1.25×) of the corporation's total daily gross sector revenue; bond proceeds and coupon income are excluded from that revenue figure, so issuing bonds can never raise the ceiling. At zero gross revenue the cap is $0.
- **Effect on share price:** High salaries drain liquid capital and reduce balance sheet value, which depresses share price over time

### Marketing Budget & Marketing Strength (implemented)

Marketing Strength (MS) determines how much unowned market share is captured per split. It grows each turn based on the marketing budget (daily dollar spend), configured via `POST /api/corporations/[id]/settings`.

**Growth formula per turn:**

```
raw = MARKETING_BASE_GAIN_PER_TURN (1.0) + MARKETING_BUDGET_SCALE (0.65) × ln(1 + dailyBudget / 100,000)
excess = max(0, MS − 100)
growth = raw × 100 / (100 + MS + excess)        (0 if the budget is 0)
```

The diminishing factor applies to the whole raw gain, and it halves faster once MS exceeds `MARKETING_DIMINISHING_THRESHOLD = 100`. The formula prevents unlimited MS accumulation through raw spending.

- **Starting MS:** 10
- **Effective range:** 0-200+ (higher MS gives meaningfully more capture per split beyond ~100)
- **Budget is a daily dollar cost** deducted from liquid capital each turn (spread across turns)

Function: `calcMarketingGrowth(dailyBudget, currentStrength)` in `src/lib/constants/corporations.ts`

### R&D Budget & Innovation (implemented)

R&D spending accumulates an **R&D Score** that drives periodic breakthroughs, one-off revenue boosts to a random sector, plus permanent state resource capacity growth for extraction corps. The system mirrors the marketing/logistics pattern for budget handling, score accumulation, and UI surface.

**Score accumulation per turn:** (the daily budget fed into this formula is first multiplied by `rdMoraleFactor(avgWageLevel)`, 0.85 to 1.15, in `sectorCalculations.ts`)

```
raw = RD_BASE_GAIN_PER_TURN (1.2) + RD_BUDGET_SCALE (0.78) × ln(1 + dailyBudget / 100,000)
diminishing = 100 / (100 + score + max(0, score − 100))
growth = raw × diminishing                      (0 if the budget is 0)
newScore = max(0, (1 − RD_DECAY_RATE) × oldScore + growth)
```

- **Starting score:** 0
- **Decay:** 3%/turn (slower than logistics 5%, accumulated R&D degrades more slowly than physical infrastructure)
- **Diminishing returns** above `RD_DIMINISHING_THRESHOLD = 100` mirror marketing. R&D is deliberately 20% stronger than marketing (1.2 and 0.78 versus 1.0 and 0.65) so tech arrives at a playable pace.
- **Budget is a daily dollar cost** deducted from liquid capital each turn via the same `costsBeforeCeo` pipeline as marketing and logistics
- **Budget counts against the 150% overhead cap** (`marketing + logistics + R&D + CEO salary ≤ 1.5 × daily revenue`)

Functions: `calcRdGrowth`, `calcRdScoreAfterTurn` in `src/lib/constants/corporations.ts`.

**Innovation check (every 6 turns):**

Each corporation rolls once every `RD_INNOVATION_INTERVAL` turns. Innovation probability scales linearly with score:

```
probability = min(1, rdScore / RD_INNOVATION_SCORE_THRESHOLD)   // threshold = 200
```

At score 200 every 6-turn window produces a breakthrough; at 100 one in two windows; at 0 none. rdScore only governs how often a breakthrough fires, the magnitude is a separate uniform random roll, not interpolated from score (an earlier score-interpolated version made high-rdScore corps a guaranteed cap-hit, making R&D strictly dominant over Growth). When a breakthrough fires, one sector owned by the corporation is selected (for extraction corps, the sector closest to its capacity limit; otherwise random):

- **Regular corps:** uniform roll in `[RD_REGULAR_BOOST_MIN, RD_REGULAR_BOOST_MAX]` = 2%-10% revenue boost
- **Extraction corps:** uniform roll in `[RD_EXTRACTION_BOOST_MIN, RD_EXTRACTION_BOOST_MAX]` = 1%-10% revenue boost, _plus_ permanent state resource capacity growth

Boosts are `$inc`'d directly on the sector's revenue in corp-local currency, no FX conversion in the boost path. The breakthrough also fires a `rd_breakthrough` notification to the CEO's user.

**Extraction state capacity growth:**

Each extraction breakthrough increases, for every extractable resource in the **sector's active strategy supply map**, the state's capacity for that resource independently, each resource gets its own uniform random roll of `RD_CAPACITY_BOOST_MIN_PCT` to `RD_CAPACITY_BOOST_MAX_PCT` (1%-15%) of that resource's _current_ state capacity:

```
per-resource increase = currentCapacity[resource] × uniformRoll(0.01, 0.15)
```

So the `oil_gas` strategy (produces oil and natural_gas) rolls an independent 1-15% increase for oil and a separate independent 1-15% increase for natural gas, the resources are not splitting a shared pool. States without an existing `stateResourceCapacity` document, or a resource whose current capacity is 0, are skipped.

**Capacity policy (permanent discovery):** capacity is unbounded and has no decay. R&D literally unlocks new deposits, once added, the capacity stays. This contradicts the "fixed capacity per turn" framing in `docs/design/resources.md`; see that doc's note on R&D-driven capacity growth.

States without a `stateResourceCapacity` document are "uncapped" (legacy/pre-migration) and are skipped by the capacity boost, no auto-insertion mid-turn.

**Turn phase:** runs as `Phase 3b` of `processCorporationTurn` (`src/lib/turn/corporation/rdInnovation.ts`), immediately after the base sector writes so the `$inc` composes with the turn's revenue update.

**Key files:**

- `src/lib/turn/corporation/rdInnovation.ts`, innovation phase
- `src/lib/constants/corporations.ts`, `RD_*` constants, `calcRdGrowth`, `calcRdScoreAfterTurn`
- `src/lib/corporations/strengthProjection.ts`, net-change projection for the corp page header
- `src/lib/api/schemas/corporations.ts`, settings validation (`rdBudget`)
- `src/components/corporation/ceo/CeoBudgetPanel.tsx` (inside the single-screen `CeoOfficeTab.tsx`), CEO budget slider + projection readout

### Logistics Budget & Logistics Strength (implemented)

Logistics strength (LS) relieves logistical sprawl and cuts shipping costs. It is set by a daily logistics budget through the settings route and counts against the 150% overhead cap.

```
growth = LOGISTICS_GROWTH_SCALE (2.0) x ln(1 + dailyBudget / LOGISTICS_BUDGET_DENOM (500,000))     (0 if budget is 0)
newLS  = max(0, (1 - LOGISTICS_DECAY_RATE (0.05)) x oldLS + growth)
shippingMultiplier = 1 - LOGISTICS_SHIPPING_DISCOUNT_MAX (0.4) x min(1, LS / LOGISTICS_MAX_SPRAWL_EFFECT (200))
supportedSectors   = floor(SPRAWL_SECTOR_THRESHOLD (15) x (1 + LS / 200))
```

There is no diminishing-returns term on stored LS; the 5% decay limits accumulation. Functions `calcLogisticsGrowth`, `calcLogisticsStrengthAfterTurn`, `getLogisticsShippingMultiplier`, `getLogisticsSupportedSectorCount` in `src/lib/constants/corporations.ts`. The shipping multiplier applies to the freight bill and the landed-price surcharge on out-of-state inputs under plants.

### Production Policy (implemented)

Each sector has a **production policy level**, a continuous numeric scale from **-25 to +25** (not discrete modes). The CEO sets a **target** via the sector settings panel; the active level trends toward the target at 1 unit per turn.

- **Positive values (up to +25):** Higher output volume, lower margins, grows revenue faster ("Aggressive")
- **Zero:** Balanced default ("Normal")
- **Negative values (down to -25):** Lower output, higher margins, preserves profitability ("Conservative")

The UI displays these as Aggressive / Normal / Conservative labels, but the underlying mechanic is the continuous scale. Revenue and margin multipliers are applied via `getRevenueMultiplier(policyLevel)` in `src/lib/utils/productionPolicy.ts`: for level `L >= 0`, `1 + (L / 25) x 0.1`; for `L < 0`, `1 - (|L| / 25) x 0.05`. The output (supply) multiplier runs from 1.15 at +25 to 0.90 at -25, linear in between. Positive levels raise revenue and commodity throughput; negative levels cut output and input consumption more sharply. Every integer level is meaningful. A sector held below zero accumulates the sustained-negative-production penalty (see Edge cases and limits).

- **DB fields:** `CorporateSector.productionPolicy` (target, -25 to 25), `CorporateSector.productionPolicyLevel` (current active level)

### Economic Effects

#### Unemployment -> Profit Margin (implemented)

State unemployment modifies corporate sector profit margins by up to ±5%:

- **Below 3% unemployment:** Tight labor market squeezes margins (linear to -5% at 0%)
- **At 3%:** No modifier (pivot point)
- **Above 3%:** Cheap labor boosts margins (linear to +5% at 10%+)

Formula: `getUnemploymentMarginModifier(unemploymentRate)` in `src/lib/constants/corporations.ts`

#### Corporate-Driven GDP Growth (superseded)

The old revenue-weighted corporate GDP growth step no longer exists. Sector growth now feeds the metric engine as `economic.sectorGrowth`, and reported `economic.gdpGrowth` is potential growth plus the output gap, which equals the sector signal when the gap is zero (`src/lib/metricEngine/`, golden cases in `src/lib/metricEngine/__fixtures__/gdpGrowthGolden.ts`).

#### Power Grid Reliability -> Profit Margin (implemented)

Gated effect: no impact when grid uptime is above 95%. Below 95%, linear penalty scaling to -4% at 85% or lower. Affects ALL sectors, every business needs electricity.

- **Above 95%:** 0% modifier (grid is reliable enough)
- **85-95%:** Linear scale from 0% to -4%
- **Below 85%:** Capped at -4%

Formula: `getGridReliabilityMarginModifier(reliability)` in `src/lib/constants/corporations.ts`

#### Corruption -> Profit Margin (implemented)

Higher corruption increases costs from bribes, unpredictable enforcement, regulatory shakedowns, and contract uncertainty. Affects ALL sectors.

- **At 0 corruption:** 0% modifier
- **Linear scale to -3% at corruption index 100**

Formula: `getCorruptionMarginModifier(corruptionIndex)` in `src/lib/constants/corporations.ts`

#### All Profit Margin Modifiers (implemented)

A single source of truth function `computeAllMarginModifiers()` in `src/lib/constants/corporations.ts` computes all modifiers for both display and turn processing.

| Modifier          | Max Effect        | Sectors Affected                                                                             | Threshold/Pivot                         |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| Sector Type Match | +5% / -15%        | All                                                                                          | Match vs mismatch                       |
| Home Location     | +5% / +2.5%      | All                                                                                          | HQ state = +5%, same country = +2.5%    |
| Unemployment      | ±5%               | All                                                                                          | Pivot at 3%                             |
| Power Grid        | -4%               | All                                                                                          | Gate 95%, floor 85%                     |
| Corruption        | -3%               | All                                                                                          | Linear to index 100                     |
| Inflation         | +2% to -8%        | All (country-wide)                                                                           | Bonus below 2% target; penalty above    |
| Debt-to-GDP       | -5% cap           | All (country-wide)                                                                           | Penalty starts at 50% D/GDP             |
| Deficit-to-GDP    | +5% max           | All (country-wide)                                                                           | Stimulative bonus: +0.5% per 1% deficit |
| Workforce Skill   | ±4%               | Technology, Chemical Industries, Healthcare, Manufacturing, Defense                          | Pivot at skill index 50                 |
| Crime Rate        | -5%               | Retail, Real Estate, Entertainment                                                           | 1500→3500 per 100k                      |
| Broadband Access  | -4%               | Technology, Telecom, Media, Financial                                                        | Gate 70%, floor 40%                     |
| Road Condition    | ±3%               | Manufacturing, Retail, Agriculture, Automobiles, Construction, Logistics, Extraction         | Pivot at condition index 60             |
| Carbon Emissions  | -3%               | Energy, Chemical Industries, Manufacturing, Automobiles, Extraction                          | 3→25 MT/capita                          |
| Cost of Living    | ±3%               | Chemical Industries, Manufacturing, Retail, Agriculture, Construction, Logistics, Extraction | Pivot at index 100                      |
| Commodity Markets | Uncapped          | Sector-dependent                                                                             | Logarithmic D/S ratio                   |
| Subsidies         | +7.5% per subsidy | Qualifying sector types                                                                      | Federal and state stack separately      |
| Logistical Sprawl | Uncapped          | All (corp-wide)                                                                              | >15 sectors threshold                   |
| State specialization | +5% / +2.5%    | A state's primary / secondary sector lane                                                    | `getStateSectorSpecializationMarginBonus()` |
| Type switch       | -10% for 24 turns | All                                                                                          | `TYPE_SWITCH_MARGIN_PENALTY`            |
| Strategy transition | -5% for 12 turns | The sector in transition                                                                    | `STRATEGY_TRANSITION_MARGIN_PENALTY`    |
| Dominance         | 0 to -15%         | Sectors above 50% state share                                                                | `DOMINANCE_MARGIN_PENALTY_AT_FULL`      |
| Sustained negative production | 0 to -45% | Sectors below zero policy level for 48+ turns                                           | `getSustainedNegativeProductionPenalty()` |

The stack is `effective = softCapEffectiveMargin(baseProfitMargin + totalMod)` where `totalMod` sums the state-metric block, commodity, home location, state specialization, type match, sprawl, inflation, debt, deficit, type switch, tariffs, subsidy, strategy transition, dominance, sustained negative production and regional conditions. State-owned sectors skip type match, sprawl and dominance. Sprawl, management overhead and dominance are capped together at 7.5 points (`SIZE_COST_CAP_PP`). A flat `SECTOR_MARGIN_LEVEL_TRIM_PP = 8` charge is applied through the lookup layer. Dominance regulatory burden is deducted from revenue, not added to `totalMod`.

#### Home Location Bonus (implemented)

Sectors in the corporation's HQ state receive a **+5% margin bonus**. Sectors in the same country as the HQ (but a different state) receive a **+2.5% bonus**. Sectors in a foreign country receive no home location bonus. Stacks additively with all other modifiers.

- **HQ state:** `HOME_STATE_MARGIN_BONUS = 5`
- **Same country:** `HOME_NATION_MARGIN_BONUS = 2.5`

Function: `getHomeLocationMarginBonus()` in `src/lib/constants/corporations.ts`

#### Inflation → Profit Margin (implemented)

Country-level inflation modifies all corporate sector margins. The target rate is 2.0% (`INFLATION_TARGET`). Low non-negative inflation gives a modest bonus; deflation and high inflation both hurt margins.

- **At target (2%):** 0% modifier
- **Between 0% and 2%:** Bonus up to +2% at 0% inflation (`INFLATION_LOW_MAX_BONUS`)
- **Below 0% (deflation):** -2 points of margin per point of deflation (`DEFLATION_PENALTY_COEFF = 2`), so -4 at -2% inflation
- **Above 2%:** Linear penalty scaling to **-8% at 10%+ inflation**
- **Applies to all sectors at country level**

Function: `getInflationMarginModifier(inflationRate)` in `src/lib/constants/corporations.ts`

#### Debt-to-GDP → Profit Margin (implemented)

High sovereign debt crowds out private investment, raising borrowing costs and reducing confidence. Applies to all sectors at country level.

- **Below 50% D/GDP:** No modifier
- **50%-100% D/GDP:** Linear penalty, -0.5% per 10 percentage points of debt
- **Above 100% D/GDP:** -2.5% base + additional -1% per 10 pp over 100%, **capped at -5%** (`DEBT_TO_GDP_MAX_PENALTY`; loosened from an earlier -15% floor because the modifier is a feedback loop, lower margins cut corporate tax, which widens the deficit and raises debt further, and -15% was pinning most firms at the floor permanently)

Function: `getDebtToGdpMarginModifier()` in `src/lib/constants/corporations.ts`

#### Deficit-to-GDP → Profit Margin (implemented)

Government deficit spending acts as a short-term economic stimulus, boosting business activity across all sectors. Applies at country level.

- **Modifier:** +0.5% per 1% of GDP deficit
- **Cap:** +5% maximum
- **Surplus budgets provide no bonus**

Function: `getDeficitToGdpMarginModifier()` in `src/lib/constants/corporations.ts`

#### Sector Type Match / Mismatch (implemented)

Sectors that match the parent corporation's primary type receive a **+5% margin bonus**. Sectors matching the **secondary type** (if set) receive **+2.5%**. All other sectors receive a **-15% penalty**. This encourages focused corporations while allowing some diversification via secondary type.

Formula: `getSectorTypeMatchModifier(sectorType, corporationType, secondaryType?)` in `src/lib/constants/corporations.ts`

#### Secondary Corporation Type (implemented)

Corporations can declare a **secondary sector focus** from the CEO page. This provides a half-strength sector type match bonus (+2.5%) for sectors of the secondary type, but doubles the base sprawl penalty from -0.5% to -1.0% per pair over 15 sectors. Logistics spending still reduces the effective penalty. The secondary type cannot be the same as the primary type and can be cleared by setting it to "None".

- **DB field:** `Corporation.secondaryType?: CorporationType | null`
- **Settings API:** `POST /api/corporations/[id]/settings` accepts `secondaryType` and `primaryType`

#### Type Switching Penalty (implemented)

Changing the primary or secondary corporation type incurs a **-10% margin penalty** on ALL sectors for **24 hours** (`TYPE_SWITCH_PENALTY_TURNS = 24`), followed by a **48-hour cooldown** (`TYPE_SWITCH_COOLDOWN_TURNS = 48`) before another type change is allowed. The total lockout is 72 hours (penalty + cooldown).

- **DB fields:** `Corporation.typeSwitchTurn`, `Corporation.typeSwitchCooldownUntilTurn`
- **Turn processor:** Checks `typeSwitchTurn` against current turn to apply penalty
- **Settings API:** Enforces cooldown, rejects changes during cooldown period

#### Logistical Sprawl Penalty (implemented)

Corporations with more than **15 sectors** incur a **-0.5% margin penalty for every 2 sectors** over the threshold (doubled to **-1.0%** if a secondary type is set). A corporation with 15 or fewer sectors has no penalty. Logistics spending reduces both the threshold and penalty slope:

- At LS 0: threshold 15, penalty -0.5% per pair (or -1.0% with secondary type)
- At LS 200 (max): threshold 30, penalty halved (-0.25% or -0.5%)
- Linear interpolation between 0 and 200

Formula: `getSprawlModifier(totalSectors, logisticsStrength?, hasSecondaryType?)` in `src/lib/constants/corporations.ts`

#### Planned Sector Effects

Future state metric effects (not yet implemented):

| Metric            | Effect                                                     | Sectors Affected                             |
| ----------------- | ---------------------------------------------------------- | -------------------------------------------- |
| Population Growth | +0-2% revenue growth bonus                                 | Retail, Real Estate, Healthcare, Agriculture |
| Renewable Energy  | -3% energy margin, +2% manufacturing margin at high levels | Energy, Manufacturing                        |
| Income Inequality | +2% financial margin, -2% retail revenue when high         | Financial, Retail                            |

### Commodity Market (implemented)

27 commodity types trade between sectors (`COMMODITY_TYPES`, `src/lib/constants/commoditiesCore.ts`): Steel, Electronics, Energy (Electricity), Chemicals, Pharmaceuticals, Fertilizers, Food, Building Materials, Construction Services, Healthcare Services, Real Estate Services, Software, Financial Services, Advertising, Vehicles, Consumer Goods (`retail`), Freight, Consulting Services, Iron, Coal, Oil, Rare Earth, Timber, Natural Gas, Ordnance, Plastics and Network Services.

#### Supply & Demand

Each sector type supplies and demands specific commodities at defined rates (fraction of daily revenue). Retail demands all commodities as inputs and also supplies the "Consumer Goods" (`retail`) commodity (rate 0.5). Retail input demand is scaled by GDP growth (50% national + 50% regional). Consumer demand for the retail commodity is also GDP-driven: demand = retail supply × GDP multiplier, so positive GDP growth pushes retail prices up and negative GDP shrinks them. Only owned sectors participate.

Retail sectors face only 25% of negative commodity input penalties (`RETAIL_NEGATIVE_COMMODITY_PENALTY_FACTOR = 0.25`), reflecting their ability to substitute or absorb supply chain shortages. Positive modifiers (oversupply benefits) are unaffected.

Units: `units = (sector daily revenue × rate) / basePrice`

#### Dynamic Pricing

Market price is computed per scope (global / national / regional) from a logarithmic supply/demand pressure ratio, not a simple clamp: `computeMarketPrice()` takes the log of the effective (soft-kneed) supply/demand ratio and applies it as a multiplier on `basePrice` (`COMMODITY_PRICE_LOG_SCALE = 0.7`), with a soft knee at 3x pressure (`COMMODITY_PRESSURE_SOFT_KNEE`) that compresses extreme shortages/oversupply.

Blended price per state = 50% global price + 25% national price + 25% regional (state-level) price (`blendPrice()`, `GLOBAL_PRICE_WEIGHT`/`NATIONAL_PRICE_WEIGHT`/`REGIONAL_PRICE_WEIGHT` in `src/lib/constants/commoditiesCore.ts`).

Prices recalculate each turn via `processCommodityPriceTurn()`.

#### Margin Modifiers (Logarithmic)

Both input cost penalties and output demand bonuses use the same symmetric logarithmic curve:

```
modifier = K × Σ(rate_i × ln(demand_i / supply_i))
```

Where `K = COMMODITY_LOG_K = 40` (`src/lib/constants/commodities.ts`).

**Buyers (input costs):** Modifier is negated, shortage raises costs, oversupply lowers them.
**Sellers (output demand):** Modifier is positive, shortage boosts margins, oversupply compresses them.

Reference values (single commodity, rate = 1.0):

| D/S Ratio     | Modifier |
| ------------- | -------- |
| 0.5×          | ∓27.7%   |
| 1× (balanced) | 0%       |
| 1.5×          | ±16.2%   |
| 2×            | ±27.7%   |
| 3×            | ±43.9%   |
| 5×            | ±64.4%   |
| 10×           | ±92.1%   |

The logarithmic curve is self-balancing (diminishing returns) and uncapped. Near-zero supply is floored at demand/1000 to avoid infinity.

Formula: `computeCommodityMarginModifier()` and `computeCommoditySurplusBonus()` in `src/lib/constants/commodities.ts`

#### Key Files

- `src/lib/constants/commodities.ts`, All commodity constants, supply/demand maps, pricing, and margin modifier functions
- `src/lib/turn/commodityPriceTurn.ts`, Per-turn price calculation and history snapshots
- `src/app/commodity/[type]/page.tsx`, Commodity detail page with price chart
- `src/app/api/commodities/`, Commodity API routes

### Operating Strategies (implemented)

Each sector type has 3-4 operating strategies that alter its commodity supply and demand rates. Every sector defaults to "Standard" but can be switched by the CEO.

#### Switching

- **Cost:** 25% of sector daily revenue (`STRATEGY_RETOOL_COST_FRACTION`)
- **Transition:** 12 turns with a **-5% margin penalty** during transition. Supply/demand rates linearly interpolate from old to new strategy over the transition period.
- **Cooldown:** The 12-turn transition is the lock. Its cooldown field is cleared on completion, so another change is then allowed immediately.

#### Strategy Confirmation

The strategy switch confirmation panel shows:

- Per-commodity comparison (old vs new output/input rates)
- Current market status per commodity (surplus/balanced/shortage)
- Estimated commodity margin impact (before vs after)

#### Key Files

- `src/lib/constants/sectorStrategies.ts`, All strategy definitions, transition/cooldown constants, effective rate interpolation
- `src/app/api/corporations/[id]/sectors/[sectorId]/strategy/route.ts`, Strategy change API (CEO only)
- `src/components/corporation/StrategyChangeConfirm.tsx`, Confirmation panel with margin estimates

### Shares & Dividends

#### Share Trading

Players can buy and sell shares from the Shares tab on any corporation page:

- **Market orders:** Instant buy/sell at current market price via a public float market maker
- **Limit orders:** Place buy/sell orders at a target price; filled automatically each turn when the market price crosses the limit
- **Escrow:** Buy orders hold funds in escrow; sell orders reserve shares until filled or cancelled
- **Public float:** Shares available for purchase. Increased by CEO issuance and sell orders; decreased by buy orders

#### CEO Share Issuance

- **Public issuance:** Issue up to 50% of outstanding shares (`MAX_PUBLIC_ISSUANCE_PERCENT`) to the public float (dilution)
- **Self-issuance:** Issue up to 20% of outstanding shares (`MAX_SELF_ISSUANCE_PERCENT`) to the CEO at a 15% premium (`CEO_SELF_ISSUANCE_PREMIUM`); proceeds go to corporate liquid capital
- **Stock split & reverse split:** The CEO may set a new `targetTotalShares` via `POST /api/corporations/[id]/shares/consolidate`. **All shareholders and `publicFloat` are scaled in proportion** (largest-remainder integer split) so ownership percentages stay the same; `sharePrice`, `lastTradePrice`, and `reportedSharePrice` scale so **market cap is unchanged**. **Reverse split:** new total from **1,000,000** (`SHARE_CONSOLIDATION_MIN_TOTAL_SHARES`) up to current−1. **Forward split:** new total from current+1 up to **100×** current (`MAX_FORWARD_SHARE_SPLIT_MULTIPLIER`). **Cooldown:** `SHARE_STRUCTURE_COOLDOWN_TURNS` (48) between changes; stored on `Corporation.lastShareStructureTurn`. **Open `shareOrders`:** any open orders on the corporation are **auto-cancelled and fully refunded** as part of the restructure (buy-side escrow → placer corp / character wallet; corp sell-side reserved shares → placer shareholder entry) so third-party limit orders cannot block a restructure indefinitely. The response includes `cancelledOpenOrders`. State-owned / nationalized corporations cannot use this.

#### Shareholder Governance Votes

Public corporations use `corporationVotes` for governance changes, HQ relocation, dissolution authorization, and public share issuance. The CEO opens a vote via `POST /api/corporations/[id]/votes`; each cast ballot carries a `voteShares` weight equal to the voter's current holdings.

- **Window:** 24 turns from proposal.
- **Threshold:** `legalStructure.shareholderVoteThreshold`, evaluated against total eligible shares.
- **Early pass:** yes shares reach the threshold.
- **Early fail:** yes shares plus all remaining unvoted shares can no longer reach the threshold.
- **Deadline:** if still uncertain, the deadline tally determines pass/fail.
- **Turn sweep:** `processVoteAutoResolve()` runs during `processCorporationTurn()` and is awaited before the turn returns, so votes finalize even without a vote-detail GET.
- **Atomic claim:** `resolveCorporationVoteIfReady()` flips `{ status: "open" }` to the terminal status with an atomic update and returns `claimed`; only the winning resolver applies effects and notifications.
- **Passed effects:** governance changes update legal structure and cooldown, relocation updates HQ/country and cancels incompatible open votes, share issuance increases `totalShares`, `publicFloat`, and `liquidCapital`, and dissolution unlocks the execute-dissolution route.

#### Dividends

- **Rate:** 0-25% (`MAX_DIVIDEND_RATE`, `corporationsClient.ts`) of net income before dividends (after tax, including bond coupon income), set by CEO. Cleared to 0 in a turn with negative net income; raised by pass-through minimums or a parent floor without changing the stored rate.
- **Cooldown:** 24-hour change cooldown (`Corporation.lastDividendChange`)
- **Distribution:** Paid pro-rata to all shareholders each turn
- **Source:** Deducted from corporate income before liquid capital update

#### CEO election (shareholder vote)

When the CEO office is contested, **each shareholder casts at most one ballot choice**, but the tally is **weighted by shares**: a voter with 500 shares contributes 500 votes to their chosen candidate (not one vote per holder). You may vote for yourself if you are a candidate. Eligible **candidates** must reside in the corporation's **headquarters state** (same rule as accepting the CEO role).

#### Share Price Formula

**Entry point:** `src/lib/corporations/sharePriceFormula.ts` (`computeSharePrices()`), called from the turn's share price step

Three-component fundamental value formula: `fundamentalValue = (1.0 x TBPS + (0.5 x EPPS + 0.15 x GPPS) x reliancePenalty) x subsidiarySprawlMultiplier(subsidiaryCount)`, where TBPS, EPPS and GPPS are tangible book, earnings power and growth premium per share. The result is then multiplied by the insider-concentration and index-inclusion multipliers before the rate limiter. Sentiment and order-flow adjustments are applied afterwards in `recomputeSharePrices()` (`src/lib/turn/corporation/recomputeSharePrices.ts`); this module computes the fundamental leg only. Constants in `src/lib/constants/corporations.ts` unless noted.

```typescript
// 1. Tangible book per share (liquidation floor): cash + 0.75 x chartered-bank equity + sector NPV + construction
// in progress + tech assets + haircut bond holdings, minus issued bond debt.
const tangibleBook =
  liquidCapitalAnchor +
  BANK_EQUITY_VALUATION_WEIGHT * bankEquityAnchor +
  sectorNPVAnchor +
  constructionInProgressAnchor +
  techAssetValueAnchor +
  BOND_INCOME_SHARE_PRICE_DISCOUNT * bondHoldingsAnchor -
  issuedBondDebt;
const tangibleBookPerShare = Math.max(0, tangibleBook) / totalShares;

// 2. Earnings power per share (risk-adjusted earnings capitalized at cost of capital)
const earningsPowerPerShare =
  riskAdjustedEarnings / costOfCapital / totalShares;

// 3. Growth premium per share (Gordon Growth Model terminal value, g capped below costOfCapital)
const growthPremiumPerShare =
  (riskAdjustedEarnings * gCapped) / (costOfCapital - gCapped) / totalShares;

const fundamentalValue =
  FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT * tangibleBookPerShare +
  (FUNDAMENTAL_EARNINGS_POWER_WEIGHT * earningsPowerPerShare +
    FUNDAMENTAL_GROWTH_PREMIUM_WEIGHT * growthPremiumPerShare) *
    reliancePenalty;

// 4. Per-turn rate limiter: raw price can move at most ±35% from the previous price
const rawPrice = rateLimitPrice(fundamentalValue, previousSharePrice);
```

Bond-coupon income over-reliance (>75% of normalized earnings) applies a graduated valuation penalty to the earnings-derived components, ramping to a 0.5x floor at 100% reliance (`bondRelianceValuationPenalty()`). Insider concentration (character CEO holding >65% of shares) applies a quadratic discount reaching -30% at 100% ownership (`insiderConcentrationMultiplier()`); broad index-fund ownership earns a mirrored premium. Public corps mid-cooldown after a stock split/reverse split blend toward the pre-split price instead of the per-turn rate limiter.

**Constants:**

| Constant                            | Value | Description                                                           |
| ----------------------------------- | ----- | --------------------------------------------------------------------- |
| `FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT`  | 1.0   | Weight on tangible-book-per-share                                     |
| `FUNDAMENTAL_EARNINGS_POWER_WEIGHT` | 0.5   | Weight on earnings-power-per-share                                    |
| `FUNDAMENTAL_GROWTH_PREMIUM_WEIGHT` | 0.15  | Weight on growth-premium-per-share                                    |
| `BOND_INCOME_SHARE_PRICE_DISCOUNT`  | 0.75  | Haircut on bond-coupon-derived earnings and held bonds in book        |
| `BOND_INCOME_RELIANCE_THRESHOLD`    | 0.75  | Bond-coupon share of earnings above which the reliance penalty starts |
| `BOND_INCOME_MAX_RELIANCE_PENALTY`  | 0.5   | Floor multiplier on earnings components at 100% bond reliance         |
| `SHARE_PRICE_MAX_TURN_MOVE`         | 0.35  | Max fractional per-turn price move (rate limiter)                     |
| `SHARE_PRICE_RATE_LIMIT_MIN_PREV`   | $1.00 | Rate limiter skipped at/below this previous price                     |
| `INSIDER_CONCENTRATION_THRESHOLD`   | 0.65  | CEO ownership fraction above which the concentration discount starts  |
| `INSIDER_CONCENTRATION_MAX_PENALTY` | 0.3   | Max discount (-30%) at 100% CEO ownership                             |
| `STOCK_SPLIT_PRICE_SMOOTHING_TURNS` | 2     | Turns of post-split smoothing before the rate limiter resumes         |
| `STOCK_SPLIT_SMOOTHING_PREV_WEIGHT` | 0.7   | Weight on previous price during post-split smoothing                  |
| `MIN_SHARE_PRICE`                   | $0.01 | Hard floor on share price                                             |
| `NPV_ANNUAL_DISCOUNT_RATE`          | 0.15  | 15% discount rate for sector NPV                                      |
| `BANK_EQUITY_VALUATION_WEIGHT`      | 0.75  | Share of chartered-bank equity counted in tangible book               |
| `GROWTH_PREMIUM_CAP_BUFFER`         | 0.02  | Growth rate is capped at costOfCapital minus this                     |
| `STOCK_SPLIT_PREV_ANCHOR_MAX_RATIO` | 3     | Post-split previous-price anchor is clamped within 3x of the fundamental |
| `SHARE_EXECUTION_PRICE_BAND_MAX_RATIO` | 5  | Execution price band on share trades                                  |
| `FUNDAMENTAL_ROLLING_AVG_TURNS`     | 3     | Turns in the rolling earnings average                                 |
| `INSIDER_CONCENTRATION_*`, `insiderConcentrationMultiplier()` | see above | `src/lib/corporations/sharePriceFormula.ts` |

#### Collections

- **`shareOrders`**, Limit order documents (type, price, shares, escrow, status)

### Bonds

Corporations can issue bonds to raise capital. Bonds are fixed-income debt instruments.

#### Bond Issuance

- **Minimum issuance:** $100,000
- **Maximum:** Total debt cannot exceed 2× equity (`MAX_BOND_ISSUANCE_FRACTION = 2.0`) nor 1× exit equity (`MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION = 1.0`), and one issue cannot exceed 25% of annual revenue (`MAX_BOND_ISSUANCE_REVENUE_FRACTION`) with a floor of 500,000,000 per issue (`MIN_BOND_ISSUANCE_PER_ISSUE`). Below 10,000 of headroom (`BOND_ISSUANCE_MIN_HEADROOM`) bonds are unavailable; the 100,000 minimum is clamped down to the ceiling. A former CEO cannot buy the old corporation's bonds for 120 turns (`EX_CEO_BOND_PURCHASE_BLOCK_TURNS`). After a default the rating is floored for 96 turns (`BOND_DEFAULT_CREDIT_PENALTY_TURNS`) and refinancing is limited to 2 times (`MAX_BOND_DEFAULT_REFINANCES`).
- **Maturity options:** 96 turns (2yr), 240 turns (5yr), or 336 turns (7yr) (`CORPORATE_BOND_MATURITY_ISSUANCE_OPTIONS`, `src/lib/db/types/bond.ts`). A 48-turn corporate maturity is legacy-only.
- **Coupon rate:** `primeRate + creditRatingSpread + CORPORATE_BOND_SPREAD_PREMIUM (1.0pp) + termPremium`. Term premium by maturity: 48/96 turns = 0, 240 turns = +1.0pp, 336 turns = +1.75pp.
- **Cooldown:** 24 turns between issuances (`BOND_ISSUANCE_COOLDOWN_TURNS`), 12 turns for private corporations (`BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE`), both in `src/lib/constants/bonds.ts`
- **Unit size:** $1,000 face value per unit (`BOND_UNIT_FACE_VALUE`)

#### Credit Rating

Composite score (0-100) from four components:

- Debt-to-equity ratio
- Interest coverage ratio
- Profitability
- Liquidity

Component weights `CREDIT_RATING_WEIGHTS`: debt-to-equity 0.30, interest coverage 0.25, profitability 0.25, liquidity 0.20. Thresholds (`CREDIT_RATING_THRESHOLDS`): AAA 85, AA 70, A 55, BBB 40, BB 25, B 15, CCC 0. An insider-concentration penalty (CEO above 65%) downgrades one notch and index-fund ownership upgrades one notch. Rating determines the credit spread added to the prime rate for the coupon. All in `src/lib/constants/bonds.ts`.

#### Bond Trading

- Players and corporations can buy bond units from the public float at market price
- CEOs can buy for their corporation via `?corporationId=` query param
- Sellers can sell holdings back; issuers can buyback
- Market price fluctuates based on credit conditions

#### Distressed Debt Trading

- **Defaulted bonds can be bought** by any player or corporation on the open market
- **CEO self-buy blocked**, CEOs cannot buy their own corporation's defaulted bonds (prevents self-dealing exploit)
- **CEO buyback at face value**, CEOs can retire defaulted bond units from the public float at full face value ($1,000/unit) via the "Retire Debt" panel on the bond detail page, allowing gradual debt reduction
- **Auto-maturity**, Bonds automatically mature when all units (public float + holders) are fully retired

#### Bond Holdings

The bonds API returns `holdings`, bonds the corporation owns in other companies, with issuer names, units, market values.

#### Collections

- **`bonds`**, Bond documents (corporationId, couponRate, maturityTurn, marketPrice, holders[], publicFloat)
- **`bondHistory`**, Per-turn snapshots (marketPrice, totalInterestPaid)

#### Key Files

- `src/lib/db/types/bond.ts`, `Bond`, `BondHolder`, `CorporateCreditRating` interfaces
- `src/lib/constants/bonds.ts`, Credit scoring, coupon rate calculation
- `src/app/api/bonds/`, Bond CRUD and trading routes
- `src/app/api/corporations/[id]/bonds/route.ts`, Issuance and holdings
- `src/app/bond/[id]/page.tsx`, Bond detail page with buy panel

### National Corporations

National corporations are government-owned enterprises that operate within the budget system. They are not player-founded and cannot be attacked or acquired.

#### Characteristics

- **Sequential IDs:** National corporations have system-assigned sequential IDs and use URL fallbacks for display
- **Market share cap:** National corporation market share is hard-capped at 100% to prevent display errors
- **Attack protection:** Players cannot use economic attack actions against national corporations
- **Budget integration:** National corp revenue is refreshed each turn and displayed in treasury/budget panels
- **Sector display:** National corporations appear alongside private corporations on sector and corporation listing pages

#### UK Public Healthcare (NHS)

The UK has an NHS-style public healthcare corporation seeded at game setup. Healthcare sectors are sized appropriately for the UK economy and appear in the UK treasury panel alongside other government spending categories.

### Sovereign Bonds

Governments can issue sovereign debt instruments, extending the corporate bond system to national-level finance.

- **Issuance:** Every country in `COUNTRY_ORDER` automatically issues scheduled sovereign paper every 12 turns. Admin routes also support testing and reconciliation.
- **Demand:** Demand falls once debt/GDP rises above 0.6, with a steeper cliff above 2.0. Coupon premium, inflation, FX depreciation, trust, holdings, and default scar also contribute.
- **Display:** Sovereign bonds appear on country stock exchange pages alongside corporate bonds
- **Admin testing:** A test issuance route (`/api/admin/sovereign-debt/`) allows admins to create sovereign bond instruments for testing

#### Key Files

- `src/app/api/admin/sovereign-debt/`, Sovereign debt test issuance route
- `src/app/api/bonds/`, Shared bond trading infrastructure (corporate + sovereign)

### HQ Relocation

CEOs can relocate corporate headquarters to another state or region (including in another country) via `POST /api/corporations/[id]/relocate`. This changes the corporation's tax jurisdiction, home-nation sector bonuses, and coupon-rate calculations on future bonds.

- **Cost:** 7% of market capitalization in-country; **14% (2×)** for cross-country moves. Payable from corp Liquid Capital or a 7-year bond (subject to bond cooldown + 2× equity leverage cap).
- **Country update:** Cross-country moves update `corporation.countryId` alongside `headquartersState`.
- **CEO residency:** If the CEO's `homeState` does not match the new HQ state after the move, the corporation's `ceoVacant` is set to `true` and `ceoId` / `userId` are unset, shareholders can then elect a new CEO who lives there. The UI warns the player before submission; the action is not blocked.

Players who are CEOs can also combine their own relocation with a corp HQ move via the region-page "Relocate here" button (see [Relocation](./relocation.md), "Combined character + corporation relocation"). In that flow the CEO role is preserved because the character ends up at the new HQ.

#### Treasury and sector revenue on cross-country relocation

When a cross-country HQ move crosses a currency boundary (e.g. UK → JP), the corp's treasury and sector economics convert from the source currency to the destination currency at the spot FX rate at time of submission:

- **Corp fields rescaled:** `liquidCapital`, `sharePrice`, `marketingBudget`, `logisticsBudget`, `ceoSalary`. `liquidCurrencyCode` updates to the new country's currency.
- **All sectors owned by the corp:** `revenue` and `currentGrowthCost` rescaled by the same factor. Sector country-of-operation (`sector.countryId`) does not change, it's decoupled from the owner's HQ country.
- **Conversion math:** `LOCAL_new = LOCAL_old × (toRate / fromRate)`. Anchor-preserving, total ₳ value unchanged by the conversion itself.
- **No FX fee / spread.** The 14% market-cap cross-country relocation cost is the economic friction; adding an FX haircut would double-penalize.

**What does NOT convert:**

- **Existing bonds** (see below, denomination fixed at issuance).
- **Historical rows** (`corporationHistory`, `marketCapHistory`, `corporationPortfolioHistory`), each row stamped with its own `currencyCode` at write time, so mixed-currency rows across the conversion moment chart correctly.
- **Character wallets**, multi-currency by design.
- **Same-country moves** (e.g. CA → NY, both USD), no-op.
- **Moves to a country with the same currency as the corp's current** (e.g. US corp → CA, both USD), no-op.

**Open share orders + listings cancelled on conversion.** Escrow amounts are denominated in the old currency; the cancel-refund helpers read the corp's current `liquidCurrencyCode` to interpret them, so the conversion must happen AFTER cancellation. Escrow refunds route through the standard share-order / share-listing cancel paths (buyers get their money back in their own native currency). The player is responsible for re-placing orders in the new currency after the move.

**New relocation bond (if selected as payment method) stamps in the NEW currency.** The bond is issued after the conversion completes, so `resolveCorpLiquidCurrencyCode(corporation)` at stamping time returns the destination currency.

**Pre-forex corps (no `liquidCurrencyCode`) are backfilled.** Source rate defaults to 1.0 (₳ passthrough), new currency gets stamped.

All three HQ-move paths converge on the same converter:

- Player `POST /api/corporations/[id]/relocate` (cash or bond)
- Combined character + corp `POST /api/character/relocate-with-corp`
- Admin `PATCH /api/admin/corporations/[id]/hq`

#### Bond denomination on relocation

Bonds retain their original `currencyCode` on any relocation, player-initiated (same-country only) **and** admin-initiated cross-country HQ moves via `PATCH /api/admin/corporations/[id]/hq`. A JPY-denominated corporate bond pays JPY coupons and returns JPY face value at maturity for its entire life, regardless of subsequent HQ moves. This matches real-world bond contracts (denomination fixed at issuance) and keeps `bond.totalIssued`, coupon cash-flows, and market price fluctuations all denominated in the single currency the bond was issued in.

Concretely, post-Task-18B `bond.currencyCode` is the canonical FX key for every bond cash-flow path: turn-processing coupon payouts, maturity face-value payouts, issuer deductions, buy/sell/buyback routes, portfolio valuations, credit scoring, and net-worth aggregation. Code paths must resolve a bond's currency from `bond.currencyCode` (falling back to `COUNTRY_CURRENCY_MAP[bond.countryId]` only for pre-migration rows) and never from the issuing corp's current `countryId`.

### Shareholder Address

CEOs can broadcast a formatted message to all current shareholders as system notifications.

- **Access**: CEO Office > Admin subtab on the corporation page
- **Cooldown**: 12 hours per corporation (enforced via `lastShareholderAddressAt`)
- **Delivery**: Batched shareholder userId lookup via `characters.find`; sent as system notifications
- **UI**: Uses the Mail Composer Modal in `shareholder-address` mode

### CEO Residence Rules

- **Founding:** Corporation HQ is set to the founder's `homeState`
- **Acceptance gate:** Character must have `homeState === corporation.headquartersState` to accept a CEO offer (returns 400 otherwise)
- **Character relocation auto-resign:** If a character relocates without the combined character+corp flow, the corporation's `ceoVacant` is set to `true` and `ceoId` / `userId` are unset, regardless of whether the country changed.
- **Combined character+corp relocation:** If the player uses the region-page "Relocate & Move Corporation" option, both move together and the CEO role is preserved (`performRelocation` is called with `skipCeoResignForCorpId`).
- **HQ-side auto-vacate:** When the HQ moves via the CEO Office and the CEO does not reside at the new HQ state, the CEO seat is auto-vacated.
- **UI warnings:** RelocateButton shows the full effects list on region-page confirm; the CEO Office flow shows an amber warning when the destination differs from the CEO's home state.

### CEO Tab Organization

The CEO Office tab on the corporation page is organized into subtabs:

| Subtab               | Contents                                                        |
| -------------------- | --------------------------------------------------------------- |
| **Overview**         | Corporation summary, sector list, key metrics                   |
| **Budget Dashboard** | Revenue and cost breakdowns per sector, net income analysis     |
| **Settings**         | Dividend rate, growth rates, production modes, share management |

Admin-facing sector cards include +/- buttons for manual growth rate adjustment.

### Stock Exchange

Corporations are listed on country-specific exchanges.

One exchange per country (`src/lib/constants/exchangeRegistry.ts`, names in `countryDisplayLabels.ts`), at `/stockmarket/[country]`: for example NYSE for US-headquartered corporations and FTSE for UK-headquartered ones. Some countries list a state register (`kind: "stateRegister"`) rather than a market.

Exchange pages display: market cap, share price, total revenue, income, CEO info, sector type, and headquarters. Price history is visualized with **OHLC candlestick charts** showing open, high, low, and close prices per period.

### Discord Bot Integration

API routes supporting Discord bot queries:

- `GET /api/discord-bot/corporation?name=`, Look up a corporation by name
- `GET /api/discord-bot/sectors?state=&type=`, Query sectors by state and/or type
- `GET /api/discord-bot/stock-chart`, Market-wide or per-corporation price history chart data (optional corporation and country filters)

### Currency storage (v0.2.6)

Every corp-economic money field is stored in the corp's `liquidCurrencyCode`. Cross-corp aggregation (global market cap, commodity flows, stockmarket totals) anchor-normalizes via `readCorpEconomicAnchor`; intra-corp math stays unit-preserving. UI renders via `formatAmount(anchorValue, nativeCurrencyCode)` so the wallet preference (internal / home / pinned / local) is a display-time concern only.

| Domain                                                                                         | Stored in                                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Corp fields (`liquidCapital`, `marketingBudget`, `logisticsBudget`, `ceoSalary`, `sharePrice`) | `corporation.liquidCurrencyCode`                                                       |
| Sector fields (`revenue`, `currentGrowthCost`)                                                 | parent corp's `liquidCurrencyCode` (not the state's currency)                          |
| Corporate bond face value / coupon / `totalIssued`                                             | `bond.currencyCode` (stamped at issuance from issuing corp's `liquidCurrencyCode`)     |
| Tax bases written from corp turn (`corporateProfits`, `taxableSales`)                          | country's currency (corp turn accumulates in ₳ then multiplies by country FX at write) |
| Cross-corp aggregates (global GDP, global market cap, commodity demand)                        | computed in ₳; displayed via wallet preference                                         |
| `sharePriceFormula` intermediate                                                               | ₳ (anchor), converted to corp-local at persistence boundary                            |
| `corporationHistory`, `marketCapHistory`, `corporationPortfolioHistory` money columns          | corp's `liquidCurrencyCode` at time of write (`currencyCode` stamped on each row)      |

**History backfill (option 3):** the v0.2.6 migration rescales every existing history row at **today's** FX rate so charts stay visually continuous across the migration moment. Historical FX accuracy is intentionally sacrificed.

**Migration scripts** (idempotent via `migrationsRun` markers, run in order):

- `scripts/migrations/corpEconomyToLocalCurrency.ts`
- `scripts/migrations/bondCurrencyStamp.ts`

See `scripts/migrations/README.md` for the dry-run checklist.


## Data

Fields below are the ones the corporation system reads or writes. "Player-visible" means shown in the corporation, sector or stock-market screens; private corporations hide treasury, income, dividend rate, share price and per-sector financials from non-CEO viewers.

### Collections

| Collection | Key fields | Written by | Player-visible |
| --- | --- | --- | --- |
| `corporations` (`src/lib/db/types/corporation.ts`, `Corporation`) | `name`, `type`, `secondaryType`, `ceoId`, `ceoVacant`, `countryId`, `headquartersState`, `liquidCapital`, `liquidCurrencyCode`, `shareholders`, `totalShares`, `publicFloat`, `sharePrice`, `marketingBudget`, `marketingStrength`, `logisticsBudget`, `logisticsStrength`, `rdBudget`, `rdScore`, `ceoSalary`, `dividendRate`, `lastDividendChange`, `splitEscalation`, `typeSwitchTurn`, `typeSwitchCooldownUntilTurn`, `lastShareStructureTurn`, `lastShareholderAddressAt`, `earningsHistory` | Founding, settings routes, `sectorCalculations.ts` (strength deltas, `splitEscalation` decay, income, share price placeholder), relocation, share routes | Public corporations: yes. Private: name, sector, HQ, credit rating only |
| `corporateSectors` (`CorporateSector`) | `corporationId`, `stateId`, `countryId`, `sectorType`, `revenue`, `workers`, `capitalStock`, `strategyId`, `transitionFromStrategyId`, `transitionStartTurn`, `transitionCooldownUntilTurn`, `productionPolicy`, `productionPolicyLevel`, `currentGrowthCost` | Sector turn (`sectorTurn.ts`), shed passes, split and attack routes, R&D `$inc` | Yes to the owning CEO; public corporations show sector lists |
| `unownedSectors` (`UnownedSector`) | `stateId`, `sectorType`, `revenue` (legacy), `headroomUnits` (plants) | Splits (decrement), vacant and inactive CEO shed (increment), unowned regeneration (`src/lib/turn/unownedSectorGrowth.ts`) | Shown as unowned share on region economy pages |
| `shareOrders`, `shareListings` | type, price, shares, escrow, status | Share buy/sell routes, `fillPendingShareOrders()`, restructure cancel path | Order book: yes; owner's own orders only for escrow |
| `corporationVotes` | `status`, `deadlineAtTurn`, ballots with `voteShares` | Votes routes, `processVoteAutoResolve()` | Yes to eligible shareholders |
| `bonds`, `bondHistory` | `corporationId`, `couponRate`, `maturityTurn`, `marketPrice`, `holders[]`, `publicFloat`, `currencyCode` | Bond routes, `bondTurn` | Yes |
| `corporationHistory`, `marketCapHistory`, `corporationPortfolioHistory` | money columns plus a stamped `currencyCode` per row | `snapshotMarketCap()` and the corporation turn | Charts on corporation and stock-market pages |
| `stateResourceCapacity` | per-resource `capacity` for a state | R&D breakthroughs for extraction corporations | Resource pages |
| `federalBudget`, `stateBudgets` | `taxBases.domesticCorporateProfits`, `taxBases.foreignCorporateProfits`, `taxRates.{domestic,foreign}CorporateTax` | Corporation turn (tax bases), tax bills (rates) | Budget pages |
| `characters` | `cashOnHand` (CEO salary and dividends), `homeState` (CEO residence gate) | Corporation turn bulk write, relocation | Own character only |
| `tariffs` | rate and scope per country | Tariff bills; read by sector calculations and the split route | Yes |

### Currency storage (summary)

Every corporate money field is stored in the corporation's `liquidCurrencyCode`; see the "Currency storage" subsection under Rules for the full table.

## Configuration

| Setting | Default | Where set | Effect |
| --- | --- | --- | --- |
| `marketSystemMode` (tier `plants`) | `plants` live | `src/lib/market/modes.ts`, read via `getMarketSystemMode()` in `src/lib/turn/corporation/index.ts` | Below plants, sectors earn from the growth-slider model and the shed moves revenue; at plants the shed moves `capitalStock` and revenue is derived from clearing |
| World preset (era) | per world | game preset, read as `gameState.preset` | Scales the founding fee, the starter build and capacity prices (`eraUnitScale`) |
| `corporationActionsPaused` | false | `gameState.corporationActionsPaused` | Skips the whole `corporationTurn` phase (no revenue, dividends or snapshots); bond coupons still settle |
| `forexEnabled` | per world | game state | Passed to `processFundGeneration()`; gates currency handling for character funds |
| Subsidiary corporations flag | off unless enabled | `isSubsidiaryCorporationsEnabled()` in `src/lib/turn/corporation/index.ts` | Honors parent dividend floors and subsidiary sprawl |
| `BOND_ISSUANCE_FREEZE_UNTIL` | `2026-08-12T00:00:00Z` | `src/lib/constants/bonds.ts` | Launch-window freeze on corporate bond issuance; already in the past |
| Corporate tax rates | 0 if no bill passed | `*_domestic_corporate_tax_rate` and `*_foreign_corporate_tax_rate` bills, stored in `federalBudget.taxRates` and `stateBudgets.taxRates` | Rates used by `sectorCalculations.ts` |
| Legal structure | standard company | `legalStructure` on the corporation (`shareholderVoteThreshold`, `minimumDividendRate`) | Vote threshold; pass-through forms skip company tax and force a minimum payout |
| Command economy | per country | country economy mode | Private corporations cannot be founded |
| `SECTOR_MARGIN_LEVEL_TRIM_PP` | 8 | `src/lib/constants/corporations.ts`, applied through `marginLevelTrimPp` in `buildLookups.ts` | Flat margin charge on every sector's modifier stack |
| `MANAGEMENT_OVERHEAD_FREE_PLANTS` | 300 | `src/lib/constants/corporations.ts` | Plants a corporation may own before management overhead starts; the pp-per-doubling knob defaults to 0, so overhead is off unless a world sets it |

Constants that are not world-configurable (the tables under Rules) are compiled into `src/lib/constants/corporations.ts`, `corporationsClient.ts`, `bonds.ts`, `commodities.ts`, `commoditiesCore.ts` and `sectorStrategyTypes.ts`. A tuning change is a code release, not a config edit.

## Timing

### Processing phases

Every turn (24 turns per game-day), each corporation is processed:

**Entry point:** `src/lib/turn/corporationTurn.ts` → `processCorporationTurn()` (re-exported from `src/lib/turn/corporation/index.ts`, where the real phases live)

The table is the outline of the phases players feel. The live function has many more steps (producer and clearing passes, labour, supply agreements, NPP decisions, advertising, media settlement, fund dividends); see [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md) and [Turn processing](./turn-processing.md).


| Phase | Action                                                           | Code Location                     |
| ----- | ---------------------------------------------------------------- | --------------------------------- |
| 1     | Build lookup maps (states, metrics, budgets, tariffs, subsidies) | `buildCorporationLookups()`       |
| 1b    | Vacant-headline corps shed 10% of sector capacity (revenue below plants) and workers → unowned | `shedVacantCeoSectorsToUnowned()` |
| 2     | Process sectors (revenue, margin, share price, credit)           | `processSectors()`                |
| 3     | Bulk write sector + corp updates                                 | `bulkWrite()`                     |
| 3b    | R&D innovation roll (only on turns divisible by 6)               | `processRdInnovations()`          |
| 4     | Update corporate tax bases in federal + state budgets            | `taxBases.domesticCorporateProfits` / `foreignCorporateProfits` |
| 5     | Refresh national budget revenue (public enterprises)             | `refreshNationalBudgetRevenue()`  |
| 6     | Pay CEO salaries + dividends to characters                       | `characters.bulkWrite()`          |
| 7     | Fill pending share orders                                        | `fillPendingShareOrders()`        |
| 8     | Snapshot market cap + per-corp history                           | `snapshotMarketCap()`             |
| 9     | Auto-resolve open shareholder votes and send closing reminders   | `processVoteAutoResolve()`        |


- Corporate processing runs once per turn inside the `resourceAndFinanceStart` phase group of the turn registry (`src/simulation/phases/turnPhaseRegistry.ts`), in parallel with action refresh and fund generation. Corporate bond coupons (`bondTurn`) and commodity prices (`commodityPrices`) run later in the same group, and `recomputeSharePrices` after them.
- Inside `processCorporationTurn()` (`src/lib/turn/corporation/index.ts`) the order is: lookups, caretaker installs for corps left without a CEO, vacant-CEO shed, inactive-CEO shed, per-sector P&L, NPP corporation decisions, bulk write of sectors and corporations, R&D innovation (only when `turn % 6 === 0`), index-fund and shareholder dividends, share orders, market-cap snapshot, shareholder vote auto-resolve.
- The R&D `$inc` is applied after the base sector writes so it composes with that turn's revenue.
- Forex rates are set in the state-effects phase (see [Currency exchange](./currency-exchange.md)). Corporate money is held in the corporation's own currency and converted to the anchor only for aggregation.
- Dividend rate changes and shareholder addresses use real-time cooldowns, not turn counts: 24 hours (`DIVIDEND_COOLDOWN_MS` in `src/app/api/corporations/[id]/dividends/route.ts`) and 12 hours (`SHAREHOLDER_ADDRESS_COOLDOWN_MS` in `src/app/api/corporations/[id]/shareholder-address/route.ts`). One turn is one real hour, so these equal 24 and 12 turns.
- Votes last 24 turns; the sweep `processVoteAutoResolve()` closes them inside the corporation turn.


### Phase order across systems

```
turn registry (src/simulation/phases/turnPhaseRegistry.ts), group resourceAndFinanceStart
  incomeTaxBases -> autoDisasterTurn / autoCrisisTurn (skipped when paused) -> coldWarTension
  -> autoSectorSeed -> extractionAutoStrategy
  -> in parallel: actionRefresh | fundGeneration | corporationTurn (skipped when paused)
        corporationTurn = processCorporationTurn() in src/lib/turn/corporation/index.ts
          lookups -> caretaker installs -> vacant shed -> inactive shed
          -> per-sector P&L (sectorCalculations.ts / sectorTurn.ts)
          -> NPP decisions -> bulk write sectors and corporations
          -> R&D innovation (turn % 6 === 0) -> index-fund and shareholder dividends
          -> share orders -> market-cap snapshot -> vote auto-resolve
  -> nppCorporateAttacks, offTypeHandover (not when paused)
  -> unionsTurn (reads this turn's corporation results)
  ... later in the same group: bondTurn (coupons), commodityPrices, recomputeSharePrices
```

Split escalation decay, marketing, logistics and R&D strength accrual all happen inside the per-sector pass of the same turn (`sectorCalculations.ts`), not as separate phases. User-triggered actions (splits, attacks, settings, share trades, relocation) run in API routes between turns and take effect on the next corporation turn.

## Worked trace


Split. A sector's unowned pool is 2,000,000 and the corporation has marketing strength 40, no tariff and escalation 0. Cash cost is `2,000,000 x 0.05 = 100,000` (pre-plants figure) and the MS cost is `2^0 = 1`. Capture is `2,000,000 x 0.05 x (1 + 40/100) x 1.25 = 175,000`. A second split the same turn costs 2 MS (escalation 1), a third 4. After a quiet turn escalation drops by 1, so the next split costs half as much MS again.

Marketing. A daily budget of 100,000 at MS 10: `raw = 1.0 + 0.65 x ln(2) = 1.4505`, `diminishing = 100 / (100 + 10) = 0.909`, so growth is `1.3186` MS per turn. At MS 150 the factor is `100 / (100 + 150 + 50) = 0.333`, so the same budget gains `0.4835` per turn.

R&D. Score 50 with a 1,000,000 daily budget: `raw = 1.2 + 0.78 x ln(11) = 3.0703`, `diminishing = 100 / 150 = 0.6667`, growth `2.047`. Next score is `50 x 0.97 + 2.047 = 50.55`. Every 6th turn the breakthrough chance is `50 / 200 = 25%`; a hit gives a regular corporation a uniform 2% to 10% revenue boost on one sector.

Salary cap. A corporation with 400,000 of daily gross sector revenue can set a CEO salary of at most `400,000 x 1.25 = 500,000` a day, and total marketing, logistics, R&D and salary of at most `400,000 x 1.5 = 600,000`.

Margin. A manufacturing corporation (primary type manufacturing) with a sector in its HQ state, 3% unemployment, grid at 98%, corruption 20, inflation 2%, no debt penalty: `+5` type match, `+5` home state, `0`, `0`, `-0.6` corruption (`20/100 x 3`), `0` inflation, summing to `+9.4` points on top of the base margin.


Margin soft cap. A sector whose stacked raw margin reaches 90: `span = MARGIN_HARD_CEILING - MARGIN_SOFT_CAP_KNEE = 100 - 80 = 20`, `tanh((90 - 80) / 20) = tanh(0.5) = 0.4621`, effective margin `80 + 20 x 0.4621 = 89.24`. A raw 80 stays 80; a raw -10 stays -10.

Margin stack with macro terms. Inflation 1%: `(2 - 1) / 2 x 2 = +1.0`. Inflation 6%: `-((6 - 2) / (10 - 2)) x 8 = -4.0`. Debt-to-GDP 80%: `-((80 - 50) / 10) x 0.5 = -1.5`. Debt-to-GDP 130%: `-2.5 - ((130 - 100) / 10) x 1.0 = -5.5`, clamped to `DEBT_TO_GDP_MAX_PENALTY = -5`. A deficit of 3% of GDP: `+0.5 x 3 = +1.5`.

Sprawl. 26 sectors, no secondary type, logistics strength 100: `lsFraction = 100 / 200 = 0.5`, threshold `15 x 1.5 = 22.5`, excess `26 - 22.5 = 3.5`, pairs `floor(3.5 / 2) = 1`, penalty per pair `-0.5 x max(0.5, 1 - 0.25) = -0.375`, so the modifier is `-0.375`. With a secondary type the base doubles to `-1.0`, giving `-0.75`. At logistics strength 0 and 21 sectors: `floor(6 / 2) = 3`, `3 x -0.5 = -1.5`.

Tariff. A foreign corporation facing a 40% effective tariff: margin `-40 x 0.5 = -20` points, and its split capture multiplier is `1 - 0.40 x 0.5 = 0.8`. A domestic corporation in the same market gets `1 + 0.40 x 0.5 = 1.2` on splits.

Vacant CEO shed under plants. A corporation with no active CEO owns a sector with `capitalStock = 1,000` units and 500 workers, and plants capacity is already established (`plantsStartTurn` set). `shedUnits = round(min(1,000, 1,000 x 0.1) x 100) / 100 = 100`. The corporation keeps 900 units, the matching unowned pool gains 100 units of headroom (converted through the nameplate price), and workers shed `round(500 x 0.1) = 50`. Revenue is not touched; it is re-derived next turn from the smaller capital stock. On the one turn when plants is first established for that sector, the unit shed is 0 and only workers shed.

Stock split. A public corporation with 4,000,000 shares at 2.50 sets `targetTotalShares = 8,000,000` (a 2x forward split, within the 100x maximum). Every holder and the public float double (largest-remainder rounding), `sharePrice` becomes `2.50 / 2 = 1.25`, market cap stays `4,000,000 x 2.50 = 10,000,000`, and `lastShareStructureTurn` is stamped so the next structure change waits 48 turns. For the next 2 turns the price blends `0.7 x previous + 0.3 x fundamental` instead of using the 35% rate limiter.

Relocation cost. The same corporation (market cap 10,000,000, anchor rate 1) moving HQ inside its country pays `round(10,000,000 x 0.07 x 1) = 700,000`; moving to another country pays `round(10,000,000 x 0.07 x 2) = 1,400,000`. If the CEO's `homeState` is not the new HQ state, `ceoVacant` is set and the seat is vacated.

Share price rate limiter. Previous price 4.00 and a fundamental of 10.00: the cap is `4.00 x 1.35 = 5.40`, so the stored price is 5.40 (then rounded to 2 decimals). A fundamental of 1.00 gives the floor `4.00 x 0.65 = 2.60`. At a previous price of 1.00 or less the limiter is skipped.

## Edge cases and limits


- Founding: one active CEO seat per character; the 96-turn founding cooldown starts when the previous corporation ends. Private corporations cannot be founded in command economies.
- Salary: capped at 1.25x daily gross sector revenue; bond proceeds and coupons are excluded so bonds cannot lift the cap. At zero revenue the cap is 0. Combined overhead is capped at 1.5x.
- Margin: the effective margin bends below 100 above 80 (soft cap), so stacking modifiers has diminishing returns. Debt-to-GDP penalty is capped at -5. Deficit bonus is capped at +5.
- Losses: unprofitable sectors pay no corporate tax and receive no credit; a loss-making corporation with all-negative sectors pays 0 in both tiers.
- Split escalation never goes below 0; split capture never exceeds the unowned amount.
- Vacant and inactive shed: nationalized and country-owned corporations are excluded so public enterprises do not bleed. Shed revenue goes to the unowned pool, not out of the economy.
- R&D: extraction capacity growth skips states without a `stateResourceCapacity` document and any resource at 0 capacity.
- Stock split: needs 1,000,000 minimum total shares for a reverse split and a 100x maximum forward split; open orders are cancelled and refunded; state-owned corporations cannot restructure shares.
- Cross-country relocation costs 14% of market cap (twice the 7% in-country rate) and vacates the CEO seat if the CEO does not live in the new HQ state.
- Type switching: a 24-turn penalty then a 48-turn cooldown, so the lockout totals 72 turns.
- Bond issuance below the minimum of 100,000 is clamped by available headroom; defaulted bonds cannot be bought by the issuing corporation's own CEO.
- Pass-through legal forms skip company tax; see the player guide for the owner-level tax treatment.

- Split strength: the split route accepts `splitStrength` `full` or `half` (`SPLIT_STRENGTH_MULTIPLIERS` in `src/lib/corporations/marketActionCosts.ts`). Half strength halves both capture and cash cost, and costs `max(1, floor(2^escalation x 0.5))` MS. Each split still adds 1 to the escalation counter.
- Sprawl exemption: logistics sectors never pay the sprawl penalty on their own margin (`isSprawlExemptSectorType()`), but still count toward the sector total for every other sector. State-owned (NatCorp) sectors are exempt from the sprawl, type-mismatch and dominance penalties.
- Size cost cap: sprawl, management overhead and the dominance penalty together can remove at most `SIZE_COST_CAP_PP = 7.5` margin points; each is scaled down by the same factor (`src/lib/corporations/rules/sizeCostCap.ts`).
- Dominance: past 50% market share in a state sector, a margin penalty ramps from 0 to -15 points at 100% (`DOMINANCE_MARGIN_PENALTY_AT_FULL`), and a regulatory burden of up to 5% of revenue applies (`DOMINANCE_REGULATORY_BURDEN_AT_FULL = 0.05`).
- Sustained negative production policy: after 48 turns below zero policy level the margin penalty ramps linearly to -45 points at 144 turns; it clears immediately when the level is non-negative, and the counter decays by 1 per turn at non-negative levels.
- R&D morale: the R&D budget fed into the score formula is multiplied by `rdMoraleFactor(avgWageLevel)`, `clamp(1 + 0.5 x (wage level - 1), 0.85, 1.15)`. With the labour system off the wage level is 1 and the factor is 1.
- Bond issuance window: a corporation can issue only up to the smallest of the per-issuance cap (25% of annual revenue, with a floor of 500,000,000 per issue), the remaining 2x equity headroom, and the remaining 1x exit-equity headroom. Below 10,000 of headroom bonds are unavailable. The flat 100,000 minimum is clamped down to the available ceiling (`effectiveBondIssuanceWindow()`).
- Dividend payout is computed on net income before dividends (after tax, including bond coupon income), cleared to zero when that is negative, and never pays more than the net income. Pass-through legal forms and parent-set floors can force a higher rate than the CEO's setting without changing the stored `dividendRate`.
- A corporation must be at least 24 turns old (`MIN_CORPORATION_DISSOLUTION_AGE_TURNS`) before a player can dissolve it.

## Invariants

- Combined marketing, logistics, R&D and CEO salary never exceed `CORP_OVERHEAD_MAX_REVENUE_MULTIPLE` (1.5x) of daily gross sector revenue, and salary alone never exceeds 1.25x. Enforced at set time by `updateCorporationSettings` and at pay time in `sectorCalculations.ts`. Tested in `src/lib/corporations/commands/capitalOperations/updateCorporationSettings.test.ts` (set time) and `src/lib/turn/corporation/sectorCalculations.test.ts` (pay time).
- Effective margin is strictly below `MARGIN_HARD_CEILING` (100) and equals the raw stack at or below 80. Enforced by `softCapEffectiveMargin()`; tested in `src/lib/constants/softCapEffectiveMargin.test.ts`.
- Split capture never exceeds the unowned amount (`Math.min(Math.round(rawCapture), unowned)` in the attack route) and `splitEscalation` never goes below 0 (`Math.max(0, ...)` in `sectorCalculations.ts`).
- Shed conservation under plants: units removed from a corporation equal units credited to the unowned pool (no market-share mint). Enforced by rounding once and reusing the figure; tested in `src/lib/turn/corporation/vacantCeoSectorShed.test.ts` and `inactiveCeoSectorShed.test.ts`.
- A stock split or reverse split preserves ownership percentages and market cap, and open orders are cancelled and refunded first. Tested in `src/app/api/corporations/[id]/shares/consolidate/route.test.ts`.
- Share price never falls below `MIN_SHARE_PRICE` (0.01) and moves at most 35% per turn when the previous price is above 1.00 outside split smoothing. Enforced in `computeSharePrices()`; tested in `src/lib/corporations/sharePriceFormula.test.ts`.
- A shareholder vote is resolved exactly once: the atomic `{ status: "open" }` claim means only one resolver applies effects. Tested in `src/lib/corporations/votes/voteService.test.ts`.
- A corporation that stays inside its quoted bond ceiling can never be judged insolvent on exit equity (`MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION = 1.0`). No named test pins `effectiveBondIssuanceWindow()` in `src/lib/constants/bonds.test.ts`; the invariant rests on the code path alone.
- Money fields on one corporation share one currency (`liquidCurrencyCode`); bonds keep their issuing `currencyCode`. Enforced by convention and the currency-conversion helpers; there is no single runtime assertion for it.
- Not enforced: one active CEO seat per character is checked in the founding and accept routes only, with no database uniqueness constraint.

## Failure and recovery

- Corporation phase times out or throws. The phase has a time budget (`PHASE_TIMEOUT_MS` from `src/lib/turn/processingLock.ts`, used in `src/lib/turn/corporation/index.ts`); the telemetry shadow run is skipped when most of the budget is used. A failed phase shows as a stuck or slow turn in turn diagnostics, and the economy for that turn is not applied. Recovery is a rerun of the turn after the cause is fixed; no partial state is meant to persist because sector and corporation writes are bulk writes at the end of the pass.
- Admin pause. Setting `corporationActionsPaused` skips the whole corporation phase on purpose. Revenue, dividends and snapshots stop; bond coupons still settle and bond default detection is also gated by the same flag so a pause cannot trigger defaults. Recovery is unpausing; there is no catch-up for missed turns.
- Drift in a corporation's cash or sector units (for example a shed that credits the pool without removing units, or a currency conversion applied twice). Detected by invariant checks and economy diagnostics, repaired with a data heal that rewrites the affected sector or corporation fields and records the change. Historical rows keep their stamped `currencyCode`, so a heal does not rewrite chart history.
- Stale open orders after a currency or structure change. Orders are cancelled and refunded as part of relocation and share restructures; if an order survives, a heal cancels it through the same refund path so escrow is returned in the order's own currency.
- Corporation left without a CEO. The vacant and inactive shed passes bleed its sectors to the unowned pool at 10% per turn; an NPP caretaker can be installed by `installCaretakersForVacantCorps()`. Recovery is a CEO election or acceptance by an eligible character (home state must equal the HQ state).
- Bond default or insolvency. Handled by the bond turn and the bond-default flow (refinance up to `MAX_BOND_DEFAULT_REFINANCES = 2`, restructure at `RESTRUCTURE_SECTOR_SALVAGE_FRACTION = 0.85`, dissolve at `DISSOLUTION_SECTOR_SALVAGE_FRACTION = 0.2`); see [Corporate bonds](./corporate-bond-defaults.md).
- Migration scripts for currency storage are idempotent through `migrationsRun` markers, so a failed run can be repeated.

## Connections


Driven by:

- [Tariffs](./tariffs.md): foreign tariff penalties, domestic malus and the commodity blend weights (`src/lib/tariffs/tariffEffects.ts`, `sectorCalculations.ts`).
- [Subsidies](./subsidies.md): +7.5 points per qualifying subsidy (`src/lib/subsidies/subsidyEffects.ts`).
- [National metrics](./national-metrics.md): unemployment, grid, corruption, inflation, debt and deficit modifiers read from state and national metrics in `computeAllMarginModifiers()`.
- [Commodities](./commodities.md): log supply and demand margin modifiers via `src/lib/constants/commodities.ts`.
- [Legislation and bills](./bills-legislation.md): corporate tax rates per country come from the `*_corporate_tax_rate` bills.
- [Currency exchange](./currency-exchange.md): corporate money fields are stored in `liquidCurrencyCode`.
- [Relocation](./relocation.md): a character move vacates or moves the CEO seat.
- [Labour](./labour.md) and [The Capacity Economy (as shipped)](./capacity-economy-as-shipped.md): staffing and physical revenue under plants.

Affects:

- [National budget](./national-budget.md): corporate profits feed `taxBases.domesticCorporateProfits` and `taxBases.foreignCorporateProfits` in federal and state budgets (`src/lib/turn/corporation/corporationTurnPhases.ts`).
- [Stock market](./stock-market.md): share price, market cap and order fills.
- [Corporate bonds](./corporate-bond-defaults.md) and [Sovereign bonds](./sovereign-bonds.md): credit rating, coupon rates, defaults.
- [Resources](./resources.md): extraction R&D raises state resource capacity.
- [Subsidiary corporations](./subsidiary-corporations.md) and [Mergers and acquisitions](./corporate-mergers-and-acquisitions.md): ownership thresholds.
- State GDP growth: the metric engine (`src/lib/metricEngine/`), potential plus output gap.

### Key files

- `src/lib/constants/corporations.ts`, All constants, sector types, modifier functions, and `computeAllMarginModifiers()` (single source of truth)
- `src/lib/db/types/corporation.ts`, TypeScript interfaces (`Corporation`, `CorporateSector`, `Shareholder`)
- `src/lib/turn/corporationTurn.ts`, Per-turn processing (revenue, costs, marketing, CEO salary)
- `src/lib/metricEngine/`, state GDP growth (sector growth plus output gap)
- `src/app/api/corporations/`, CRUD API routes
- `src/app/stockmarket/[country]/page.tsx`, Stock exchange listing UI
- `src/app/corporations/page.tsx`, Corporation listing/founding UI
- `src/lib/db/types/bond.ts`, Bond type definitions
- `src/lib/constants/bonds.ts`, Credit rating and coupon rate logic
- `src/app/api/character/relocate/route.ts`, CEO auto-resign on relocation
- `src/app/api/corporations/[id]/ceo/accept/route.ts`, CEO residence gate


## Tests

| Area | Test files |
| --- | --- |
| Margin modifiers, soft cap, sprawl, state-owned exemptions, sector focus | `src/lib/constants/softCapEffectiveMargin.test.ts`, `src/lib/constants/marginLogisticsSprawl.test.ts`, `src/lib/constants/marginStateOwned.test.ts`, `src/lib/constants/corporations.sectorFocus.test.ts`, `src/lib/corporations/specialization/rules.test.ts`, `src/lib/corporations/rules/sizeCostCap.test.ts` |
| Constants and client constants | `src/lib/constants/corporationsClient.test.ts`, `src/lib/constants/corporations.logisticsShipping.test.ts`, `src/lib/constants/corporations.rdMorale.test.ts` |
| Turn processing | `src/lib/turn/corporationTurn.test.ts`, `src/lib/turn/corporation/sectorCalculations.test.ts`, `src/lib/turn/corporation/corporationTurnPhases.test.ts` |
| Vacant and inactive CEO shed | `src/lib/turn/corporation/vacantCeoSectorShed.test.ts`, `src/lib/turn/corporation/inactiveCeoSectorShed.test.ts` |
| R&D | `src/lib/turn/corporation/rdInnovation.test.ts`, `src/lib/corporations/strengthProjection.test.ts` |
| Splits and costs | `src/lib/corporations/marketActionCosts.test.ts`, `src/app/api/country/[code]/region/[id]/economy/attack/route.test.ts` |
| Share price and orders | `src/lib/corporations/sharePriceFormula.test.ts`, `src/lib/turn/corporation/sharePriceFormula.test.ts`, `src/lib/turn/corporation/shareOrders.test.ts`, `src/lib/turn/corporation/marketCapSnapshot.test.ts`, `src/app/api/corporations/[id]/shares/*/route.test.ts` |
| Votes | `src/lib/corporations/votes/voteService.test.ts`, `src/lib/corporations/votes/voteEffects.relocation.test.ts`, `src/lib/corporations/votes/voteEffects.dissolution.test.ts`, `src/lib/turn/corporation/voteReminders.test.ts` |
| Bonds | `src/lib/constants/bonds.test.ts` |
| Settings caps | `src/lib/corporations/commands/capitalOperations/updateCorporationSettings.test.ts` |
| Relocation | `src/lib/corporations/relocationCost.test.ts`, `src/app/api/corporations/[id]/relocate/route.test.ts` |
| Commodities | `src/lib/constants/commodities.test.ts`, `src/lib/constants/commoditiesCore.test.ts` |

Gaps: the salary and overhead caps are tested at the command level (`src/lib/corporations/commands/capitalOperations/updateCorporationSettings.test.ts`) rather than the route; `effectiveBondIssuanceWindow()` has no named test; the unemployment, grid, corruption, inflation, deficit and debt curves are covered indirectly through the margin-stack tests rather than one test per curve; the shareholder address and dividend cooldowns (real-time, not turn-based) have no dedicated test; cross-currency relocation is covered by the relocate route tests only for the paths they mock.

## Known issues and history

### Code versus the earlier doc text

Where this page changed during the 2026-10-29 code check:

- Fundamental value weights are `FUNDAMENTAL_EARNINGS_POWER_WEIGHT = 0.5` and `FUNDAMENTAL_GROWTH_PREMIUM_WEIGHT = 0.15` (the earlier text said 0.4 and 0.1). Tangible book also includes `BANK_EQUITY_VALUATION_WEIGHT = 0.75` of chartered-bank equity, and the fundamental is multiplied by `subsidiarySprawlMultiplier()` before the limiter.
- The vacant and inactive CEO shed moves plant capacity (`capitalStock`) to the unowned pool under plants, not revenue. The revenue-and-workers shed is the pre-plants behaviour.
- There are 27 commodity types (`COMMODITY_TYPES` in `src/lib/constants/commoditiesCore.ts`), not 22.
- The commodity price blend weights live in `src/lib/constants/commoditiesCore.ts`; `COMMODITY_LOG_K` is in `commodities.ts`.
- Corporate tax bases are written to `taxBases.domesticCorporateProfits` and `taxBases.foreignCorporateProfits`, blended 75% GDP-derived floor and 25% actual corporate income, not a single `corporateProfits` field.
- Stock exchanges exist for every country (`src/lib/constants/exchangeRegistry.ts`, labels in `countryDisplayLabels.ts`), not only NYSE and FTSE.
- Bond issuance is limited by three ceilings (25% of annual revenue with a 500,000,000 floor, 2x equity, 1x exit equity), not only 2x equity.
- Operating strategy lockout: `STRATEGY_COOLDOWN_TURNS` is 24, set at initiation, but `sectorTurn.ts` clears it when the 12-turn transition completes, so the effective lockout equals the transition length (the earlier text already said this; the constant is recorded here because the two numbers look inconsistent).

### Open issues

- The comment on `MarginModifiers.subsidyModifier` in `src/lib/constants/corporations.ts` says "+15pp per qualifying active subsidy" and the `homeLocationModifier` comment quotes +10 / +5; the real values are `SUBSIDY_MARGIN_BONUS = 7.5`, `HOME_STATE_MARGIN_BONUS = 5`, `HOME_NATION_MARGIN_BONUS = 2.5`. Stale comments only; behaviour matches this page.
- `getDebtToGdpMarginModifier()` doc comment still says "capped at -15%"; the code caps at -5 (`DEBT_TO_GDP_MAX_PENALTY`).
- `CORPORATE_BOND_MATURITY_ISSUANCE_OPTIONS` excludes 48-turn maturities for new corporate bonds although `BondMaturityTurns` and `CORPORATE_BOND_TERM_PREMIUMS` still carry 48.
- Comments in `bonds.ts` describe a turn as "1 in-game week" in one place and one real hour elsewhere; the one-turn-one-hour reading is the one the engine uses.
- Planned effects from the earlier design (population growth to revenue, renewable energy to energy and manufacturing margin, income inequality to financial and retail) are not in the headline modifier list of `computeAllMarginModifiers()`. The strategy-aware state metric profile (`stateMetricsModifier`) may cover part of this; not verified here.
- The split worked trace uses the pre-plants cash cost (5% of the pool). Under plants the cash cost is the larger of that and 115% of the build price of the units received (`ATTACK_BUILD_PRICE_PREMIUM = 1.15`, `attackCostAnchorUnderPlants()`), which is usually higher.
- The Mongo `$inc` of R&D boosts is applied in corp-local currency with no FX conversion, by design.

### Contradictions with the player wiki

No factual contradictions found against `src/lib/seeds/wiki/content/corporations.ts` for the figures both pages carry (founding fee and capital, 96-turn founding cooldown, 10,000,000 starting shares, 150% overhead cap, 1.25x salary cap, 0% to 25% dividend, -25 to +25 production policy, 24-turn votes, split cost and capture, margin table). One wording difference: the wiki says the dividend rate is "of after-tax income" and the code pays it on net income before dividends (after tax, plus bond coupon income), capped at that net income.

### History

- Debt-to-GDP margin floor loosened from -15 to -5 (recorded in the code comment on `DEBT_TO_GDP_MAX_PENALTY`) because the modifier forms a feedback loop with corporate tax and the deficit.
- Margin hard clamp at 100 replaced by a tanh soft cap above 80 (`softCapEffectiveMargin()`).
- R&D innovation magnitude changed from score-interpolated to a uniform roll so high-score corporations are not guaranteed cap hits.
- Currency storage moved to per-corporation local currency in v0.2.6, with history rows rescaled at that day's rate.
- Size costs (sprawl, management overhead, dominance) capped together at 7.5 points by design decision, 2026-10-22 (comment in `sizeCostCap.ts`).

Last checked: 2026-10-29, version 1.18.0
