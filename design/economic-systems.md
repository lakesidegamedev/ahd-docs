# Economic Systems

## Summary

Player guide: [National Metrics](https://www.ahousedividedgame.com/wiki/national-metrics). For the prime rate lever see [Central Banks](https://www.ahousedividedgame.com/wiki/central-banks).

The economic systems in A House Divided simulate real-time macroeconomic dynamics driven by player decisions. Inflation, GDP growth, and unemployment are not static values but emerge from economic policies and conditions each turn.

**Location:** `src/lib/budget/` and `src/lib/turn/`

**Key files:**

- `src/lib/budget/inflation.ts` - Dynamic inflation calculation per country
- `src/lib/turn/inflationRecalc.ts` - the per-turn orchestrator that gathers the pressure terms and persists the result
- `src/lib/turn/gdpGrowth.ts` - GDP growth and Okun's-law unemployment constants and pure helpers (there is no separate `unemployment.ts`)
- `src/lib/metricEngine/registry/economic.ts` - the metric nodes that compute `sectorGrowth`, `gdpGrowth` and `unemploymentRate` each turn
- `src/lib/labour/rules/employment.ts` - the employment stock that sets the primary unemployment rate

## Rules

### Inflation System

#### Design Philosophy

Inflation is calculated from real economic drivers that the game tracks:

1. **Demand-pull** (Phillips curve, the observed trade-off between a tight labour market and rising prices): unemployment against the NAIRU, plus the output gap (or, before a country has a measured gap, GDP growth against trend)
2. **Monetary policy**: Central bank prime rate vs neutral rate
3. **Fiscal policy**: Government deficit/surplus as share of GDP
4. **Cost-push**: Tariff rates and wage growth
5. **Other pressures**: commodity prices, currency depreciation, savings flow, central bank policy stance, and money supply growth

The result replaces the static `inflationRate` on `EconomicGrowthFactors` each turn, making inflation emergent from player decisions.

#### Inflation Formula

```typescript
inflation = BASE_TARGET + demandPull + monetary + fiscal + costPush
          + commodity + forex + savings + housing + policy + moneySupply

// Housing is retired (coefficient 0). Where a country has a measured output gap,
// the GDP half of demandPull uses the output gap (OUTPUT_GAP_COEFF_UP 0.25,
// OUTPUT_GAP_COEFF_DOWN 0.2) instead of growth versus trend.

// Smoothed with inertia, then pulled toward the target
smoothed = INERTIA × previousInflation + (1 - INERTIA) × inflation
newInflation = smoothed + MEAN_REVERSION_COEFF × (targetInflation - smoothed)

// Then the step is limited and the result clamped (see Clamping)
newInflation = previousInflation + clamp(newInflation - previousInflation, -1.5, +1.5)
```

#### Constants

| Constant             | Value | Description                                     |
| -------------------- | ----- | ----------------------------------------------- |
| `BASE_TARGET`        | 2.0%  | Central bank target inflation                   |
| `NEUTRAL_RATE`       | 3.0%  | Neutral real interest rate                      |
| `NAIRU`              | 5.0%  | Non-accelerating inflation rate of unemployment |
| `TREND_GDP_GROWTH`   | 2.0%  | Trend GDP growth rate                           |
| `MONETARY_LAG_TURNS` | 12    | Turns for rate changes to reach full effect     |
| `SPOT_RATE_IMMEDIATE_WEIGHT` | 0.3 | Share of the spot prime rate that acts at once |
| `INERTIA`            | 0.35  | Smoothing weight (35% previous, 65% new)        |
| `MEAN_REVERSION_COEFF` | 0.08 | Share of the gap to target closed each turn after smoothing |
| `STEP_ALPHA`         | 0.678 | `1 - (1 - 0.08) × 0.35`: share of the gap to the turn target closed in one turn |
| `MAX_PER_TURN_DELTA` | 1.5 pp | Largest ordinary one-turn move |
| `DEEP_DEFLATION_RECOVERY_GAP` | 4.0 pp | Below target by this much, upward moves may exceed `MAX_PER_TURN_DELTA` when raw inflation is within 1 pp of target |
| `MIN_INFLATION` / `MAX_INFLATION` | -2.0 / 100.0 | Absolute bounds |

All constants in this table are in `src/lib/budget/inflation.ts`. Where a country sets its own target or neutral rate (`targetInflation`, `neutralPrimeRate`), those replace `BASE_TARGET` and `NEUTRAL_RATE`. They come from the country's monetary baseline (`MONETARY_BASELINES` in `src/lib/constants/currencies.ts`) or, for early eras, an era-authored anchor (`getEraMonetaryBaseline` in `src/lib/constants/monetaryEra.ts`, keyed on the current in-game year so a long-lived world graduates to later anchors).

`INERTIA` was previously 0.2. At that level a persistently-elevated input (e.g. a static seeded `wageGrowth`) became a permanent inflation floor: the raw calculation recomputed the same elevated contribution every turn, and inertia just averaged two equally-high values instead of letting mean-reversion pull the rate back down. Raised to 0.35 in `src/lib/budget/inflation.ts`.

This `INERTIA` is local to `inflation.ts`. GDP growth smoothing uses a separate `INERTIA = 0.4` constant in `src/lib/turn/gdpGrowth.ts`, and unemployment smoothing uses `UNEMPLOYMENT_INERTIA = 0.85` in the same file. They are not the same value and are not read from a shared constant.

#### Demand-Pull (Phillips Curve)

The Phillips curve models inflation from labor market and GDP conditions. **Two-sided** coefficients mean:

- Tight labor market (low unemployment) → inflationary
- Slack labor market (high unemployment) → deflationary (weaker effect)

```typescript
uGap = NAIRU - unemployment  // Positive = tight, negative = slack
unemploymentPressure = uGap >= 0
  ? uGap × UNEMPLOYMENT_COEFF_UP    // 0.3
  : uGap × UNEMPLOYMENT_COEFF_DOWN  // 0.2 (weaker)

gGap = gdpGrowth - TREND_GDP_GROWTH
gdpPressure = gGap >= 0
  ? gGap × GDP_GROWTH_COEFF_UP    // 0.2
  : gGap × GDP_GROWTH_COEFF_DOWN  // 0.15 (weaker)

demandPull = unemploymentPressure + gdpPressure
```

**Output gap replaces the growth term.** Where a country has a measured output gap, the GDP half uses `OUTPUT_GAP_COEFF_UP = 0.25` (output above trend) and `OUTPUT_GAP_COEFF_DOWN = 0.2` (below trend) times the gap instead of `gGap`. During the cutover a blend weight mixes the two: `gdp = (1 - w) × legacy + w × gapTerm`. The gap is the GDP-weighted national gap from the country's `states` documents (`nationalOutputGap`, `src/lib/metricEngine/outputTrend.ts`).

**Rationale:** Upward pressure is stronger than downward because prices are stickier on the way down in the real world.

#### Monetary Policy

Monetary policy uses a **trailing weighted average** of prime rates so rate changes take 12 turns to reach full effect.

```typescript
effectiveRate = 0.3 × spotRate + 0.7 × trailingAverage

trailingAverage = Σ(rate[i] × propagation[i]) / totalWeight
propagation[i] = max(1 / MONETARY_LAG_TURNS, min(1, turnsAgo[i] / MONETARY_LAG_TURNS))
```

**Effect on inflation:**

```typescript
rateGap = NEUTRAL_RATE - effectiveRate
monetary = rateGap >= 0
  ? rateGap × MONETARY_COEFF_LOW   // 0.8, below neutral → stimulative
  : rateGap × MONETARY_COEFF_HIGH  // 1.2, above neutral → deflationary (1.5x low rate)
monetary = monetaryRaw × transmissionMultiplier(centralBankScrutiny)  // 1.0 at full credibility
```

The multiplier (`src/lib/centralBank/credibility.ts`) is `TRANSMISSION_FLOOR + (1 - TRANSMISSION_FLOOR) × (1 - scrutiny / 100)` with `TRANSMISSION_FLOOR = 0.6` and scrutiny taken from the bank's `chairInfamy` (0 to 100). It scales only this term: a bank the market does not believe has to move further for the same effect. A fully ruined bank still transmits 60 percent.

**Interpretation:**

- Rate below neutral (3.0%) → expansionary → inflationary
- Rate above neutral → contractionary → deflationary

#### Fiscal Policy

Fiscal policy models the inflationary impact of government deficits and surpluses.

```typescript
deficitPct = clamp(-surplusToGdp × 100, -30, 50)  // Positive = deficit
// FISCAL_DEFICIT_PCT_FLOOR = -30, FISCAL_DEFICIT_PCT_CEILING = 50

fiscal = deficitPct >= 0
  ? deficitPct × FISCAL_COEFF_DEFICIT   // 0.15
  : deficitPct × FISCAL_COEFF_SURPLUS   // 0.08 (weaker)
```

`surplusToGdp` is `federalBudget.surplus / federalBudget.gdp` (with a fallback GDP of 27 trillion when the budget carries none).

**Rationale:** Deficits are more inflationary than surpluses are deflationary. The clamp stops a runaway debt-service spiral from feeding an unbounded term into inflation; a genuinely catastrophic deficit still adds up to 7.5 pp.

#### Cost-Push

Cost-push inflation from tariffs and wages. **Two-sided** like demand-pull.

```typescript
tariffGap = tariffRate - TARIFF_BASELINE  // Baseline: 3.0 (TARIFF_INFLATION_BASELINE, src/lib/tariffs/rules/tariffInflationExposure.ts)
tariffPush = tariffGap >= 0
  ? tariffGap × TARIFF_COEFF_UP    // 0.05
  : tariffGap × TARIFF_COEFF_DOWN  // 0.025 (weaker)

wageGap = wageGrowth - WAGE_GROWTH_BASELINE  // Baseline: 2.5%
wagePush = wageGap >= 0
  ? wageGap × WAGE_COEFF_UP    // 0.15
  : wageGap × WAGE_COEFF_DOWN  // 0.08 (weaker)

costPush = tariffPush + wagePush
```

The tariff rate fed in is the turn's measured tariff inflation exposure (`measuredTariffInflationRate`, `src/lib/tariffs/tariffInflationExposure.ts`). Non-turn callers fall back to `computeCountryTariffPressure` over the active tariff layers, with free trade agreement coverage neutralising the partnered share.

#### Other pressures

These terms are added to the raw sum; each is in `src/lib/budget/inflation.ts`.

| Term | Signal | Coefficient | Clamp on signal |
| --- | --- | --- | --- |
| Commodity | median annualised change in the national commodity basket over the last half game year (`COMMODITY_INFLATION_LOOKBACK_TURNS` = 24 turns; 12 turns in a young world), where 0.10 = +10 percent a year (`src/lib/turn/commodityInflationPressure.ts`) | 10.0 up, 10.0 down | +0.3 / -0.15 |
| Forex | annualised bounded change of the exchange rate over a 12-turn lookback (`FX_INFLATION_LOOKBACK_TURNS`, `src/lib/turn/rules/fxInflationPressure.ts`); positive when the currency has weakened | 8.0 up, 4.0 down | plus or minus 0.25 (`FX_INFLATION_PRESSURE_CAP`) |
| Savings | net 12-turn savings flow (withdrawals minus deposits) over an effective stock, `max(reported stock, 5,000,000, 0.25 × gross flow)` (`src/lib/budget/savingsFlowPressure.ts`) | 1.0 up (withdrawals), 0.5 down (deposits) | -1 to +1 |
| Housing | cost-of-living deviation | 0 (retired) | none |
| Policy stance | active central bank stance, orders and emergency, in pp (`centralBanks.policyInflationPressure`) | 1:1 | none |
| Money supply | `(M2 growth - GDP growth) × coeff` | 0.08 pegged (`PEGGED_MONEY_GROWTH_COEFF`); 0.15 after a Bretton Woods exit (`BW_POST_EXIT_MONEY_COEFF`, `src/lib/monetary/brettonWoods.ts`) | result clamped to -1.5..+2.5 pp |

The deflationary forex arm is attenuated when inflation already sits below target: it is multiplied by `4 / (4 + depth)` (`FOREX_DEFLATION_ATTENUATION_HALFLIFE = 4.0`), where depth is how far previous inflation is below target. This breaks the loop where a weak currency and deflation feed each other.

The money supply term is live only when `moneySupplyEnabled` is on in the game config and the M2 growth observation exists (it needs at least `MIN_MONEY_GROWTH_BASE_TURNS` = 12 turns of history); otherwise M2 growth defaults to GDP growth and the term is zero.

#### Clamping

Final inflation is clamped to realistic bounds:

```typescript
inflation = clamp(rawInflation, MIN_INFLATION, MAX_INFLATION);
// MIN_INFLATION = -2.0% (deflation floor; load-bearing, see below)
// MAX_INFLATION = 100.0% (hyperinflation ceiling)
```

The -2.0 floor is load-bearing: without it, a forex or demand deflation impulse compounds unbounded and, via the corp-margin deflation penalty, applies an uncapped negative margin modifier that bankrupts every company (the t1166 deflation-spiral incident). Beyond `MIN_INFLATION`/`MAX_INFLATION`, the calculation also clamps the per-turn change to `MAX_PER_TURN_DELTA = 1.5` percentage points, so no single turn can jump the rate more than 1.5pp regardless of how extreme the inputs are. The one exception is deep-deflation recovery: when previous inflation is more than `DEEP_DEFLATION_RECOVERY_GAP = 4.0` below target and raw inflation is back within 1 pp of target, the upward move may be as large as the gap to target. In multiplayer, a half tick at :30 applies half the step (`stepFraction = 0.5`) and the hourly turn applies the rest, with the per-turn limits scaled to match. The final rate is rounded to 2 decimals.

#### Effective Prime Rate Calculation

The effective prime rate blends immediate and lagged effects:

```typescript
export function computeEffectivePrimeRate(
  spotRate: number,
  history?: number[],
): number {
  if (!history || history.length === 0) return spotRate;

  const window = history.slice(-MONETARY_LAG_TURNS);
  const n = window.length;

  // Trailing weighted average: older entries get more weight
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const turnsAgo = n - 1 - i;
    const propagation = Math.max(
      1 / MONETARY_LAG_TURNS,
      Math.min(1, turnsAgo / MONETARY_LAG_TURNS),
    );
    weightedSum += window[i] * propagation;
    totalWeight += propagation;
  }

  const trailingAvg = totalWeight > 0 ? weightedSum / totalWeight : spotRate;

  // 30% spot (immediate) + 70% trailing (lagged propagation)
  return 0.3 * spotRate + 0.7 * trailingAvg;
}
```

**Behavior:**

- After 12 turns at constant rate: effective ≈ spot
- Rate change today: 30% immediate effect, 70% over 12 turns

#### DB-Aware Calculation

`calculateCountryInflation()` in `src/lib/budget/inflation.ts` reads `macroMetrics` (national unemployment, GDP growth, cost of living), `centralBanks` (prime rate, its history in `interestRateHistory`, and `chairInfamy`), `states` (output gap), and the country's `FederalBudget` (deficit, wage growth, previous inflation), the same inputs described above. Its current signature also takes commodity, forex, savings, policy-stance, and money-supply-growth pressure terms, a money growth coefficient, a measured tariff rate and a step fraction:

```typescript
export async function calculateCountryInflation(
  db: Db,
  countryId: CountryId,
  budget: FederalBudget,
  commodityPressure = 0.0,
  forexPressure = 0.0,
  savingsPressure = 0.0,
  policyStancePressure = 0.0,
  moneySupplyGrowthPct?: number,
  moneyGrowthCoeff?: number,
  tariffRateOverride?: number,
  stepFraction?: number,
): Promise<number>;
```

The coefficients of those additional terms are in the Other pressures table above.

### GDP Growth System

#### Sector-Driven Growth, Not Okun's Law

GDP growth is not derived from unemployment. The headline rate is the `economic.gdpGrowth` node (`src/lib/metricEngine/registry/economic.ts`), which passes through the `economic.sectorGrowth` node. That node's sector signal depends on the market stage. Below the plants stage it is the revenue-weighted average of sector `currentGrowthRate`, with unowned sectors at `DEFAULT_UNOWNED_GROWTH_RATE = 0.5`. At the plants stage it is the trailing host-currency realized-revenue trend deflated by lagged inflation (falling back to the one-turn realized delta, then the legacy average), with the constant-price output signal blended in by `(historySpan - 8) / 40` (`blendOutputGrowthSignal`, `src/lib/metricEngine/rules/outputVolume.ts`). The signal is then adjusted by the consumption-tax wedge and a net-exports impulse.

```typescript
sectorImpulse = sectorGrowth - taxGap × SALES_TAX_GROWTH_COEFFICIENT
              + TRADE_NX_WEIGHT × (tradeGrowthPrev - WORLD_TRADE_BASELINE)
taxGap = clamp(federal + state sales tax above the country's neutral rates, -30, +30)
gdpGrowth = sectorImpulse   // when realOutputBlendWeight = 1 (every fresh world)
```

The legacy form (`potentialGrowth + realizedOutputGapChange`) survives only to blend a live world across the cutover to measured output, weighted by `realOutputBlendWeight`.

Okun's law runs the other direction: it derives **unemployment** from the GDP growth signal, not GDP growth from unemployment. See the Unemployment System section below.

| Constant | Value | Source |
| --- | --- | --- |
| `SALES_TAX_GROWTH_COEFFICIENT` | 0.05 | `src/lib/turn/gdpGrowth.ts` |
| `SALES_TAX_GAP_CLAMP` | 30 | `src/lib/turn/gdpGrowth.ts` |
| `TRADE_NX_WEIGHT` | 0.15 | `src/lib/metricEngine/registry/economic.ts` |
| `WORLD_TRADE_BASELINE` | 2.5 | `src/lib/metricEngine/registry/economic.ts` |
| `INERTIA` (GDP growth) | 0.4 | `src/lib/turn/gdpGrowth.ts` |
| `MAX_POLICY_DELTA` | 4 | `src/lib/turn/gdpGrowth.ts` |
| `SECTOR_SIGNAL_MIN` / `SECTOR_SIGNAL_MAX` | -10 / 15 | `src/lib/turn/gdpGrowth.ts` |
| `GDP_GROWTH_BOUND` (headline) | -15 / 15 | `src/lib/metricEngine/outputGap.ts` |
| `policyDeltaDecay` (`sectorGrowth` node) | 0.9 per turn | `src/lib/metricEngine/registry/economic.ts` |
| `NEUTRAL_GDP_GROWTH` | 2.0 | `src/lib/turn/gdpGrowth.ts` |

Worked example: a sector signal of 3.0, total sales tax 2 points above neutral, and trade growth 1.0 above baseline gives `3.0 - 2 × 0.05 + 0.15 × 1.0 = 3.05`.

#### Inertia Smoothing

GDP growth uses its own inertia constant to prevent volatile swings. The smoothing sits on the `sectorGrowth` node (inertia `INERTIA`, policy-delta cap `MAX_POLICY_DELTA`, bounds -10 to 15); the `gdpGrowth` node itself has inertia 0 and passes the smoothed value through, bounded to -15..15:

```typescript
baseline = clamp(INERTIA × previousBaseline + (1 - INERTIA) × target, -10, 15)
sectorGrowth = baseline + clamp(policyDelta, -4, +4) × 0.9
// INERTIA = 0.4 in src/lib/turn/gdpGrowth.ts (separate from inflation.ts's INERTIA = 0.35)
// evaluated by the shared node evaluator in src/lib/metricEngine/coexistence.ts
```

The smoothing runs on the stored baseline (`economic.sectorGrowth.simBaseline`), not on last turn's displayed value. International organization nudges are added to the target before smoothing. The headline `gdpGrowth` node has inertia 0 and `maxPolicyDelta` 0, so any write to `economic.gdpGrowth.value` before the engine runs is overwritten that turn (see Known issues).

This creates gradual economic cycles rather than turn-to-turn volatility. Crisis rate shocks land on the `sectorGrowth` node as a policy delta capped at `MAX_POLICY_DELTA` that erodes 10 percent per turn after the crisis ends (see [Crisis System](./crisis-system.md)).

### Unemployment System

#### Employment-driven, with an Okun fallback

The `economic.unemploymentRate` node reads the metric phase's **regional employment counts** (employed headcount against civilian labour force) directly, with no second smoothing pass and no direct policy-point bonuses. The Okun's-law path below is the fallback used only when civilian labour-force data is unavailable.

The employment stock advances in `advanceEmployment` (`src/lib/labour/rules/employment.ts`):

```typescript
structural = clamp(matchingFriction(4.5 default) - 1.5×matching - 0.5×transport - 0.5×childcare, 1, 15)
cyclicalRate = clamp(structural - OUTPUT_GAP_UNEMPLOYMENT_COEFFICIENT × clamp(outputGap, -15, 15), 1, 15)   // coefficient 0.4
backgroundTarget = max(0, laborForce × (1 - cyclicalRate/100 - referenceCorporateShare) + publicJobs)
backgroundRate   = 1 - 0.5^((0.5 + skill/100) / (turnsPerYear × 0.5))      // half-life 24 turns at skill 50
corporateFill    = 1 - 0.5^((0.5 + skill/100) / 2)                          // CORPORATE_VACANCY_HALF_LIFE_TURNS = 2
matchable        = min(room under 0.99 × laborForce, (laborForce - employed) × (1 - exp(-12 / turnsPerYear)))
unemployment     = clamp(100 × (laborForce - corporateEmployed - backgroundEmployed) / laborForce, 1, 100)
```

`matching`, `transport` and `childcare` are 0 to 1 policy levels from funded programmes (`src/lib/labour/rules/employmentPolicy.ts`). Corporate openings fill faster than the background economy drifts back, so a plant is not left short while the region has double-digit unemployment.

#### Okun's Law (fallback path)

Okun's law runs off the output gap (GDP growth against the economy's own measured trend, falling back to potential growth, then `NEUTRAL_GDP_GROWTH = 2.0`), then smooths with its own inertia:

```typescript
gdpDeviation = gdpGrowth - reference
okunCoeff = gdpDeviation > 0 ? OKUN_COEFFICIENT_DOWN : OKUN_COEFFICIENT_UP
okunTarget = clamp(previousUnemployment - gdpDeviation × okunCoeff, UNEMPLOYMENT_MIN, UNEMPLOYMENT_MAX)
target = clamp(okunTarget + labourPressure, UNEMPLOYMENT_MIN, UNEMPLOYMENT_MAX)
newUnemployment = UNEMPLOYMENT_INERTIA × previousUnemployment + (1 - UNEMPLOYMENT_INERTIA) × target
// labourPressure = labour wage-index, automation-index and labour-tightness terms
```

**Okun coefficients** (`src/lib/turn/gdpGrowth.ts`): `OKUN_COEFFICIENT_UP = 0.25` (GDP below trend → unemployment rises), `OKUN_COEFFICIENT_DOWN = 0.2` (GDP above trend → unemployment falls). Not a single 0.5 coefficient. `UNEMPLOYMENT_INERTIA = 0.85` (85% previous, 15% new): unemployment smooths far more slowly than inflation or GDP growth. Bounds: `UNEMPLOYMENT_MIN = 1.0`, `UNEMPLOYMENT_MAX = 15.0`. When no previous value exists the fallback assumes 4.5.

Worked example (fallback path): previous unemployment 5.0, GDP growth 1.0 against a trend of 2.0. Deviation is -1.0, so `okunTarget = 5.0 + 1.0 × 0.25 = 5.25`; new unemployment `0.85 × 5.0 + 0.15 × 5.25 = 5.04`. It takes many turns of weak growth to move unemployment visibly, which is why players see it lag the GDP number.

### Common questions

| Question | Answer |
| --- | --- |
| How do I reduce inflation? | Raise the prime rate above neutral (1.2 pp off per 1 pp, lagged 12 turns), run a smaller deficit or a surplus (0.15 per point of deficit), lower tariffs above 3.0 (0.05 per point), and let wage growth cool toward 2.5 (0.15 per point). The prime rate is set by the central bank chair. |
| Why is inflation not moving after a rate hike? | 30 percent of the rate acts at once, the rest over 12 turns, and inflation itself closes only a fixed share of its gap to the turn target each turn (`STEP_ALPHA = 1 - (1 - 0.08) × 0.35 = 0.678`), bounded by the 1.5 pp limit. Expect several turns. |
| Why did real GDP fall? | GDP growth follows the sectors: their growth rates below the plants stage, their inflation-adjusted sales and physical output at the plants stage. Falling sector revenue, higher consumption taxes (0.05 per point above neutral), weak trade growth (0.15 per point below 2.5) or a crisis shock pull it down. Interest rates and public investment move potential growth, not the headline. |
| Why is unemployment rising? | Employment counts fell, or on the fallback path growth is below trend (0.25 per point). Unemployment moves slowly because of its 85 percent inertia. |
| What is the prime rate? | The central bank's policy rate. It is set by the chair (`src/lib/turn/centralBankChairTurn.ts`), see [Currency Exchange](./currency-exchange.md) and [Monetary System](./monetary-system-as-shipped.md). |

## Data

**Read by inflation** (`calculateCountryInflation` and `recalculateInflationPerTurn`):

| Collection | Fields | Notes |
| --- | --- | --- |
| `macroMetrics` | national `economic.unemploymentRate`, `economic.gdpGrowth`, `economic.costOfLiving` | national document per country (`getNationalDocId`) |
| `centralBanks` | `primeRate`, `interestRateHistory`, `chairInfamy`, `policyInflationPressure`, `nationalSavingsBalance` | shared banks (eurozone) serve every member country |
| `federalBudget` | `surplus`, `gdp`, `economicFactors.wageGrowth`, `economicFactors.inflationRate`, `economicFactors.householdPriceIndex` | |
| `states` | `gdp`, `outputGap`, `outputTrendGrowth`, `realOutputStartTurn` | for the national output gap |
| `exchangeRates` | `rateHistory`, `monetaryRegime` | forex pressure and Bretton Woods coefficient |
| `commodityPrices`, `commodityPriceHistory` | national prices now and one lookback ago | commodity pressure |
| `savingsLedger` | `type` (`deposit`, `withdraw`), `amount`, `countryId`, `turn` (last 12 turns) | savings pressure |
| `moneySupplySnapshots` | `annualizedM2GrowthPct`, `currencyCode` | money supply term |
| `tariffs`, `corporateSectors`, `corporations` | tariff layers and sector exposure | tariff pressure when no measured rate is passed |
| `gameState` | `currentYear`, `startingYear`, `currentTurn` | era anchors |
| `gameConfig` | `commandEconomyEnabled`, `moneySupplyEnabled` | feature switches |

**Written by inflation**: `federalBudget.economicFactors.inflationRate`, `economicFactors.householdPriceIndex`, `economicFactors.lastUpdated`, plus half-tick bookkeeping (`subhourStep`, `subhourBase.inflation`); `centralBanks.currentSavingsPressure` (stored as percent). Inflation is shown to players on the national metrics and budget pages. Household prices trail the settled rate and never feed back into it.

**Written by GDP growth**: `macroMetrics` node values `economic.sectorGrowth`, `economic.gdpGrowth`, and the regional `states.gdp` level (compounded from growth); revenue snapshots for the trailing trend. **Written by unemployment**: `macroMetrics` `economic.unemploymentRate` and the stored employment state per region. All three are player-visible national and state metrics.

### Currency storage (v0.2.6)

Inflation, GDP-growth, and unemployment math reads and writes money fields in each entity's **native currency** (country currency for budgets, `liquidCurrencyCode` for corporate balances, host-state currency for sector revenue). Cross-entity aggregation (global GDP, global debt-to-GDP, commodity flows) anchor-normalizes via `readCorpEconomicAnchor` and the anchor rate map before arithmetic, so a 2% inflation shock against one country doesn't pollute another's base via mixed-currency sums.

| Dimension                                              | Storage                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `FederalBudget.gdp`, `StateBudget.stateGdp`            | country's `currencyCode`                                                 |
| Tax bases (`corporateProfits`, `taxableSales`, etc.)   | country's `currencyCode`                                                 |
| Corporate revenue/income inputs to GDP growth          | host state's currency; the plants signal compares host-to-host sums so FX moves cannot read as growth |
| Inflation multipliers / coefficients / ratios          | dimensionless, storage-agnostic                                          |
| Cross-country totals (global GDP, global money supply) | computed in ₳ by converting each value through the anchor rate map; displayed via wallet preference         |

See [Currency Exchange](./currency-exchange.md) §"Currency storage (v0.2.6)" for the full cross-system invariant table, helper index, and migration scripts. The Phillips-curve and fiscal-coefficient math is currency-agnostic: it operates on ratios (unemployment rate, debt-to-GDP, deficit-to-GDP) that cancel currency units, so no changes were required to the inflation formulas themselves.

## Configuration

The coefficients above are compile-time constants, not live-tunable settings. The settings that change behaviour at run time:

| Setting | Default | Effect | Where set |
| --- | --- | --- | --- |
| `commandEconomyEnabled` | off | With it on, a country that counts as a command economy in the current year (`isCommandEconomy`, `src/lib/constants/commandEconomy.ts`) skips the formula and takes its inflation target | `gameConfig` default document (`src/lib/db/types/gameConfig.ts`) |
| `moneySupplyEnabled` | off | Turns the money supply term on; off means the term is zero | `gameConfig` default document, read through `isMoneySupplyEnabledFromConfig` |
| `forexEnabled` | off | Gates `tradeGrowthMirror`, which supplies the trade growth read by the net-exports impulse | `gameState` |
| Per-country `targetInflation` | `BASE_TARGET` 2.0 | Replaces the base term and the mean-reversion anchor | `MONETARY_BASELINES` and era anchors (`src/lib/constants/currencies.ts`, `src/lib/constants/monetaryEra.ts`) |
| Per-country `neutralPrimeRate` | `NEUTRAL_RATE` 3.0 | Replaces the neutral rate in the monetary term | same |
| Era trend growth | 2.5 for countries with no national doc and no era value | Fallback GDP growth for countries without a national metrics document | `getEraTrendGdpGrowth`, `src/lib/constants/monetaryEra.ts` |
| Cost-of-living neutral index | 50 for seeds 1954 to 1991, else 100 | Only used by the retired housing term (coefficient 0) | `getCostOfLivingNeutralIndex`, keyed on `startingYear` |
| `realOutputBlendWeight` | 1 (fresh worlds) | Blends legacy GDP growth with measured growth across the cutover | metric phase, `src/lib/metricEngine/registry/economic.ts` |
| `labourSystemMode` (macro or higher) | per world | Enables the labour wage-index and automation terms in the unemployment fallback | metric engine |

### Tuning guidelines

When to adjust coefficients:

| Symptom                          | Likely Cause                     | Fix                                       |
| -------------------------------- | -------------------------------- | ----------------------------------------- |
| Inflation too volatile           | Low inertia, high coefficients   | Increase `INERTIA`, reduce coefficients   |
| Inflation unresponsive to policy | High inertia, low coefficients   | Decrease `INERTIA`, increase coefficients |
| Rate changes feel meaningless    | Low `MONETARY_COEFF_LOW`         | Raise it (now 0.8, was 0.4)               |
| Deflation too common             | Asymmetric coefficients too weak | Increase `_DOWN` coefficients             |

Recommended ranges:

| Coefficient             | Current | Safe Range |
| ----------------------- | ------- | ---------- |
| `INERTIA`               | 0.35    | 0.2-0.5    |
| `MONETARY_COEFF_LOW`    | 0.8     | no tested range; raised from 0.4 in `src/lib/budget/inflation.ts` |
| `MONETARY_COEFF_HIGH`   | 1.2     | 0.9-1.5    |
| `UNEMPLOYMENT_COEFF_UP` | 0.3     | 0.2-0.5    |
| `FISCAL_COEFF_DEFICIT`  | 0.15    | 0.1-0.25   |

## Timing

Everything on this page runs inside the single ordered turn pipeline (`BASE_TURN_PHASE_NAMES` in `src/simulation/phases/turnPhaseNames.ts`, run by `src/simulation/phases/turnPhaseRegistry.ts`), once per turn (48 turns per game year). There is no separate schedule: GDP growth and unemployment update in `metricEngine`, inflation in `inflationRecalc` after them, the prime rate in `centralBankChairTurn` after that. The economics-relevant phases run in this order:

| Phase             | System                                                         |
| ----------------- | -------------------------------------------------------------- |
| `crisisTurn`      | Crisis shocks written first (rate shocks, inflation `$inc`)    |
| `policyEffects`   | Policy-driven economic metric updates                          |
| `metricEngine`    | `sectorGrowth`, GDP growth, unemployment, other derived metrics |
| `nationalMetrics` | National metric aggregation                                    |
| `fiscalBaseGrowth` | Tax bases grow by 1/48 of the live annual rates               |
| `economicModel`   | Economic-model classification of each country and region       |
| `tradeGrowthMirror` | Trade growth copied to the budget (only when forex is on)    |
| `inflationRecalc` | Inflation (`calculateCountryInflation`, recomputed every turn) |
| `forexTurn`       | Exchange rates, which read this turn's settled inflation       |
| `centralBankChairTurn` | Central bank chair decisions, including the prime rate    |

The state-effects adapter runs `crisisTurn`, then `ministerialOrders`, then `policyEffects` in that serialized order so policy effects read the crisis-shocked values (see [Crisis System](./crisis-system.md)).

```
crisisTurn / policyEffects
   -> metricEngine:  sectorGrowth -> gdpGrowth -> unemploymentRate   (reads employment stock, output gap)
   -> nationalMetrics -> fiscalBaseGrowth -> economicModel -> tradeGrowthMirror
   -> inflationRecalc: reads this turn's gdpGrowth + unemployment, last turn's prime rate, FX, commodities
   -> forexTurn -> centralBankChairTurn (new prime rate, first felt next turn)
```

Because `inflationRecalc` runs before `centralBankChairTurn`, a prime rate change decided this turn first reaches inflation next turn, 30 percent at once and the rest over the 12-turn lag. Inflation reads this turn's GDP growth and unemployment, which `metricEngine` has just written. Exchange rate observations used for forex pressure are the previous turn's settled values, because `inflationRecalc` runs before `forexTurn`.

The only sub-turn step is the multiplayer half tick at :30. It advances inflation by half a step (`stepFraction = 0.5`, `HALF_TICK_FRACTION` in `src/lib/turn/subhour/stepFraction.ts`), and also half-steps GDP level and forex (`src/lib/turn/subhour/`); the hourly turn first restores the pre-half-tick base, then applies the full step, so a retried tick never applies twice.

### Fiscal cadence

Inflation is recalculated every turn in the state-effects phase. Fiscal-year
processing still handles annual boundaries such as snapshots and debt work,
but it does not gate inflation. Tax bases grow each turn through
`processFiscalBaseGrowth` at 1/48 of the live annual wage, trade, and GDP rates;
the fiscal-year boundary must not apply a second annual growth jump.

## Worked trace

**Inflation, one turn.** Inputs: unemployment 4.0, GDP growth 3.0 (no measured output gap), effective prime rate 4.0, deficit 3 percent of GDP, tariff 3.0, wage growth 2.5, all other pressures 0, previous inflation 2.0, full credibility.

| Term | Working | pp |
| --- | --- | --- |
| Base | `BASE_TARGET` | 2.00 |
| Unemployment | `(5.0 - 4.0) × 0.3` | +0.30 |
| GDP growth | `(3.0 - 2.0) × 0.2` | +0.20 |
| Monetary | `(3.0 - 4.0) × 1.2` | -1.20 |
| Fiscal | `3 × 0.15` | +0.45 |
| Tariff, wage | at baseline | 0.00 |
| Raw | | 1.75 |

Smoothing: `0.35 × 2.0 + 0.65 × 1.75 = 1.8375`. Mean reversion: `+0.08 × (2.0 - 1.8375) = +0.013`, giving 1.8505. The change from 2.0 is -0.15, inside the 1.5 pp limit, so the new rate is **1.85**. Had the prime rate been 3.0 (neutral), the monetary term would be 0, raw would be 2.95, and that turn's rate would be 2.57 (the prime rate is what holds it near 1.85 in the first case).

**Effective prime rate.** The bank holds 3.0 for eleven turns, then moves the spot rate to 4.0 (history window of 12, latest entry 4.0). Weights are `max(1/12, turnsAgo/12)`: the newest entry weighs 1/12, older entries weigh 1/12 through 11/12; total weight is 67/12 = 5.5833. Weighted sum is `(3.0 × 66 + 4.0 × 1) / 12 = 16.8333`, so the trailing average is 3.0149. Effective rate is `0.3 × 4.0 + 0.7 × 3.0149 = 3.3105`. The monetary term is `(3.0 - 3.3105) × 1.2 = -0.37`, not the -1.20 the full 4.0 would give. A 1 pp hike therefore acts with about 31 percent of its eventual force on the first turn.

**GDP growth.** Sector signal 3.0, sales tax gap +2, trade growth 1.0 above baseline: node input `3.0 - 2 × 0.05 + 0.15 × 1.0 = 3.05`. With a previous `sectorGrowth` baseline of 2.0 and no policy delta, smoothing gives `0.4 × 2.0 + 0.6 × 3.05 = 2.63`. At `realOutputBlendWeight` 1 the `gdpGrowth` node equals 2.63 (inside -15..15).

**Unemployment, employment path.** A region with structural rate 4.5 (no programmes) and an output gap of +2: `cyclicalRate = 4.5 - 0.4 × 2 = 3.7`. At workforce skill 50 the background economy closes `1 - 0.5^(1/24) = 2.85` percent of its remaining gap each turn (half-life 24 turns) and companies fill `1 - 0.5^0.5 = 29.3` percent of open positions per turn. Unemployment therefore slides toward 3.7 over a few dozen turns rather than jumping.

**Unemployment, Okun fallback.** Previous 5.0, GDP growth 1.0 against trend 2.0: `okunTarget = 5.0 + 1.0 × 0.25 = 5.25`, new value `0.85 × 5.0 + 0.15 × 5.25 = 5.04`.

## Edge cases and limits

- **Inflation floor and ceiling**: `MIN_INFLATION = -2.0`, `MAX_INFLATION = 100.0`. The floor is load-bearing (see Clamping).
- **Per-turn step**: at most 1.5 pp either way, except deep-deflation recovery. A half tick scales the limits by the step fraction.
- **Deficit clamp**: fiscal deficit share is clamped to -30..+50 percent of GDP before the coefficients apply.
- **Missing inputs, pure formula**: every input falls back to a neutral value when absent or non-finite (target 2.0, neutral rate 3.0, unemployment at NAIRU, GDP growth at trend, no pressure terms). Missing prime rate history means the spot rate is used as the effective rate.
- **Missing inputs, database wrapper**: the wrapper applies its own defaults before the formula runs: national unemployment 5.0, GDP growth from the era trend or 2.5, prime rate 3.0, wage growth 3.0 (not the 2.5 baseline, so a country with no wage figure takes +0.075 pp), previous inflation 2.5, fallback GDP 27 trillion. A non-finite result falls back to the previous rate.
- **Zero cases**: a rate exactly at neutral contributes 0 from monetary policy; a balanced budget contributes 0 from fiscal.
- **Housing**: coefficient 0, so cost-of-living pressure does not move inflation.
- **Command economies**: when the command economy feature is on and the country counts as one in the current year (`isCommandEconomy`, `src/lib/constants/commandEconomy.ts`), `calculateCountryInflation` returns the country's inflation target and none of the formula above applies. See the [Planned Economies](https://www.ahousedividedgame.com/wiki/planned-economies) player page.
- **Countries without a central bank** still get a per-turn recompute with all pressure terms zero (`recalculateInflationPerTurn`, unbanked pass).
- **Shared banks**: one eurozone bank recomputes every member country, so members share the prime rate and savings pressure but not their other inputs.
- **Unemployment bounds**: 1.0 to 15.0 on the Okun fallback path; the employment-driven value is bounded below by `UNEMPLOYMENT_MIN` and above by 100. Employment cannot exceed 99 percent of the labour force.
- **Okun is asymmetric**: a boom lowers unemployment more slowly (0.2) than a slump raises it (0.25).
- **GDP growth bounds**: the `sectorGrowth` signal is held to -10..15 and the headline to -15..15, so no shock or policy delta can exceed those.
- **Deliberate exclusions**: GDP growth has no pull toward a calibrated potential. Potential growth (`0.66 × labour-force growth + 0.34 × capital-stock growth + TFP`) is written as `economic.potentialGrowth`, seeds a new region's output trend, serves as the Okun reference and the legacy blend input during the cutover, and does not set the headline at blend weight 1. Interest rates and government spending reach growth only through capital and potential or through corporate revenue; tariffs only through trade growth. Housing cost no longer moves inflation after the 2026 deflation spiral. Household prices follow inflation but never feed back into it.

## Invariants

- Inflation never falls below -2.0: `src/lib/budget/inflation.test.ts` (deflation floor test). The 100.0 ceiling and the 1.5 pp step limit are enforced in code; the ratchet and gravity regression tests exercise the step limit indirectly, with no dedicated ceiling test.
- The inflation breakdown reconciles to the settled rate (the `inertia` row absorbs smoothing, reversion, limits and rounding by construction in `calculateInflationWithBreakdown`); no test asserts the sum across all terms for every branch.
- A turn and its :30 half tick together land on the same value as one full step, within 2-decimal rounding, and a retried half tick is not applied twice: `src/lib/turn/subhour/inflationHalfStep.test.ts`.
- Employment counts stay bounded under extreme demand, a tiny labour force and corrupt inputs: `src/lib/labour/rules/employment.test.ts` (bounds test).
- `sectorGrowth` stays within -10..15: `src/lib/metricEngine/registry/economic.test.ts` (clamp test).
- Unemployment on the fallback path staying in 1.0..15.0 is enforced in code; no test pins that bound directly.
- Command economies return exactly their inflation target: not enforced by a test of the database wrapper.
- Currency units never mix in aggregates: **not enforced** by a test in this area; the convention is documented in Currency Exchange.

## Failure and recovery

- **NaN or non-finite input.** Every read is guarded with a finite check and a default; a non-finite final result falls back to the previous turn's rate and logs a warning. A persisted NaN would otherwise recurse every turn through the inflation history and exchange rates.
- **Deflation spiral.** An unbounded deflation impulse once drove every company's margin down through the corporate deflation penalty (the t1166 incident, July 2026). The -2.0 floor, the forex attenuation, the deficit clamp and the retired housing term are the standing defences. If a country sits at the floor, check the pressure terms with the admin inflation diagnostics before adjusting data.
- **Frozen inflation for some countries.** Before the unbanked pass, countries without a central bank had no per-turn recompute and crisis shocks only accumulated. Shared-bank members once froze when only the anchor country was recomputed. If a country's inflation stops moving, confirm it is covered by a bank scope or the unbanked pass.
- **Missing budget document.** `recalculateInflationPerTurn` self-heals a bank whose budget is missing through `ensureFederalBudget` on the full turn; the half tick skips it.
- **Stuck half tick.** A retried half tick is detected by the stored `subhourStep` stamp and not applied twice; the hourly turn restores the pre-half-tick base before stepping. Repair is rerunning the turn.
- **Bad employment snapshot.** An unusable stored employment state (wrong version, negative counts, over-employed) is discarded and rebuilt from the labour force. Repair is the next turn; no manual write is needed.
- **Wrong tax bases after a rate error.** Tax bases grow by per-turn slices, so a corrupted growth rate shows up as drifting revenue; repair by correcting the rate and letting `fiscalBaseGrowth` proceed, or by a targeted heal of the affected budget.

## Connections

**Driven by:**

- [National Budget](./national-budget.md): deficit and tariff and wage inputs (`FederalBudget` read by `calculateCountryInflation`).
- [Tariffs](./tariffs.md): tariff rate and tariff cost-push (`computeCountryTariffPressure`, `measuredTariffInflationRate`).
- [Labour](./labour.md): wage growth and the labour wage, automation and tightness terms in unemployment (`economic.labourWageIndexDelta`, `economic.automationIndexDelta`, `economic.labourTightness`).
- [Commodities](./commodities.md): commodity basket signal feeding inflation (`loadCommodityPressureSnapshots`).
- [Currency Exchange](./currency-exchange.md): forex depreciation pressure (`calculateFxInflationPressure`).
- [Monetary System](./monetary-system-as-shipped.md) and [Money Supply and QE](./money-supply-and-quantitative-easing.md): prime rate history, policy stance, M2 growth.
- [Crisis System](./crisis-system.md): GDP rate shocks on `economic.sectorGrowth`, inflation `$inc` on `federalBudget.economicFactors.inflationRate`.

**Affects:**

- [Corporations](./corporations.md): inflation adjusts corporate margins (deflation penalty, see the floor note above).
- [Government Approval](./government-approval.md): economic conditions feed approval.
- [National Budget](./national-budget.md): inflation and growth feed tax bases next turn.
- [Currency Exchange](./currency-exchange.md): `forexTurn` reads the settled inflation the same turn.
- [Central Banks](https://www.ahousedividedgame.com/wiki/central-banks): the chair's scrutiny is judged on inflation against target and growth.

Related code:

- **Federal Budget:** `src/lib/budget/` - Budget calculations that feed inflation
- **Central Bank:** `src/lib/turn/centralBankChairTurn.ts` - Interest rate decisions
- **Turn Processing:** `src/lib/turnSystem.ts` - Economic phase orchestration
- **Policy Effects:** `src/lib/policyEffects.ts` - How policies affect economics

## Tests

| File | Covers |
| --- | --- |
| `src/lib/budget/inflation.test.ts` | the pure formula, output-gap demand pull, policy stance, FX deflation feedback, effective prime rate, deficit clamp, ratchet and gravity regressions, commodity as a rate, Bretton Woods coefficient |
| `src/lib/budget/inflationTransmission.test.ts` | credibility transmission multiplier on the monetary term |
| `src/lib/turn/inflationRecalc.test.ts` | the orchestrator: budget id resolution, self-heal, persistence, multi-country counts |
| `src/lib/turn/subhour/inflationHalfStep.test.ts` | half tick plus turn equals one step |
| `src/lib/turn/gdpGrowth.test.ts` | weighted growth, consumption-tax adjustment, realized revenue growth, EMA and baselines |
| `src/lib/metricEngine/registry/economic.test.ts` | `sectorGrowth`, `gdpGrowth` and `unemploymentRate` nodes including labour channels |
| `src/lib/labour/rules/employment.test.ts` | the employment stock and unemployment rate, recession reversibility, vacancy fill, bounds |
| `src/lib/budget/savingsFlowPressure.test.ts` | savings pressure ratio |

Gaps: no test pins the database wrapper defaults (wage 3.0, previous inflation 2.5); the annual `fiscalYear` inflation call has no test of its zeroed pressure inputs; the output-gap blend weight transition is only covered at its endpoints.

## Known issues and history

- **Annual inflation recompute.** `processFiscalYear` (`src/lib/budget/fiscalYear.ts`) still calls `calculateCountryInflation` once a year with commodity, forex, savings, policy stance and money supply all zero and writes the result to `economicFactors.inflationRate`. `inflationRecalc` then steps from that value in the same turn, so the annual boundary can briefly pull inflation toward a zero-pressure estimate, limited by the 1.5 pp step. It does not gate the per-turn calculation.
- **Stale interface comment.** The `forexPressure` doc comment in `inflation.ts` describes `rate / baseRate - 1`; the live signal is the annualised bounded 12-turn change from `calculateFxInflationPressure`. Earlier text of this page repeated the stale form.
- **Database defaults differ from pure defaults.** See Edge cases; the database wrapper uses wage growth 3.0 and previous inflation 2.5 where the pure function defaults to 2.5 and the target.
- **Cabinet growth effects are dead.** Cabinet orders and cabinet infrastructure (Freight Corridor, Airport Upgrade, `src/lib/constants/cabinetInfra.ts`) `$inc` `economic.gdpGrowth.value` in `ministerialOrders` (`src/lib/turn/ministerialOrderProcessing.ts`), which runs before `metricEngine` in the same turn. The headline node has no inertia and no policy delta, so the engine overwrites the increment and the listed GDP growth lift has no effect. Fix options: route these effects to `economic.sectorGrowth` as crises do (`src/lib/crises/rules/metricPath.ts`), or drop the effect and its in-game description. Owner decision, not changed.
- **Mean-reversion comment.** The code comment names `BASE_TARGET` as the anchor, but the live anchor is the country's `targetInflation`.
- **Player wiki.** National Metrics and Central Banks agree with the code on every number checked (35 percent inertia, 1.5 point step, -2.0 floor, 1.2 against 0.8 monetary asymmetry, 0.4 per point output gap on unemployment, 24-turn background half-life, Okun 0.2 and 0.25 with 85 percent inertia). One omission: the wiki says rate changes "feed in gradually over 12 turns" but does not say that 30 percent of the spot rate acts at once.
- **History.** `INERTIA` raised from 0.2 to 0.35 to stop elevated inputs becoming a permanent floor. `MONETARY_COEFF_LOW` raised from 0.4 to 0.8. A deflation spiral (t1165 and t1166, July 2026) restored the -2.0 floor and led to retiring the housing term (coefficient 0) and the era-keyed cost-of-living neutral index. Currency storage moved to native currency per entity in v0.2.6. GDP growth moved from a potential-growth pull to measured real output, and unemployment from pure Okun to the employment stock; both keep a blend or fallback for live worlds. 2026-10-29: the sector signal description is now mode-dependent (below plants versus plants), the smoothing formula is the baseline EMA plus a capped, decaying policy delta, and GDP growth inputs are in host-state currency, not the owner's `liquidCurrencyCode`.

Last checked: 2026-10-29, version 1.18.0
