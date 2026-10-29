# Economic Systems

Player guide: [National Metrics](https://www.ahousedividedgame.com/wiki/national-metrics). For the prime rate lever see [Central Banks](https://www.ahousedividedgame.com/wiki/central-banks).

## Overview

The economic systems in A House Divided simulate real-time macroeconomic dynamics driven by player decisions. Inflation, GDP growth, and unemployment are not static values but emerge from economic policies and conditions each turn.

**Location:** `src/lib/budget/` and `src/lib/turn/`

**Key files:**

- `src/lib/budget/inflation.ts` - Dynamic inflation calculation per country
- `src/lib/turn/gdpGrowth.ts` - GDP growth and Okun's-law unemployment constants and pure helpers (there is no separate `unemployment.ts`)
- `src/lib/metricEngine/registry/economic.ts` - the metric nodes that compute `sectorGrowth`, `gdpGrowth` and `unemploymentRate` each turn

## Inflation System

### Design Philosophy

Inflation is calculated from real economic drivers that the game tracks:

1. **Demand-pull** (Phillips curve, the observed trade-off between a tight labour market and rising prices): unemployment against the NAIRU, plus the output gap (or, before a country has a measured gap, GDP growth against trend)
2. **Monetary policy**: Central bank prime rate vs neutral rate
3. **Fiscal policy**: Government deficit/surplus as share of GDP
4. **Cost-push**: Tariff rates and wage growth
5. **Other pressures**: commodity prices, currency depreciation, savings flow, central bank policy stance, and money supply growth

The result replaces the static `inflationRate` on `EconomicGrowthFactors` each turn, making inflation emergent from player decisions.

### Inflation Formula

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

### Constants

| Constant             | Value | Description                                     |
| -------------------- | ----- | ----------------------------------------------- |
| `BASE_TARGET`        | 2.0%  | Central bank target inflation                   |
| `NEUTRAL_RATE`       | 3.0%  | Neutral real interest rate                      |
| `NAIRU`              | 5.0%  | Non-accelerating inflation rate of unemployment |
| `TREND_GDP_GROWTH`   | 2.0%  | Trend GDP growth rate                           |
| `MONETARY_LAG_TURNS` | 12    | Turns for rate changes to reach full effect     |
| `INERTIA`            | 0.35  | Smoothing weight (35% previous, 65% new)        |
| `MEAN_REVERSION_COEFF` | 0.08 | Share of the gap to target closed each turn after smoothing |
| `MAX_PER_TURN_DELTA` | 1.5 pp | Largest ordinary one-turn move |
| `DEEP_DEFLATION_RECOVERY_GAP` | 4.0 pp | Below target by this much, upward moves may exceed `MAX_PER_TURN_DELTA` when raw inflation is within 1 pp of target |

All constants in this table are in `src/lib/budget/inflation.ts`. Where a country sets its own target or neutral rate (`targetInflation`, `neutralPrimeRate`), those replace `BASE_TARGET` and `NEUTRAL_RATE`.

`INERTIA` was previously 0.2. At that level a persistently-elevated input (e.g. a static seeded `wageGrowth`) became a permanent inflation floor: the raw calculation recomputed the same elevated contribution every turn, and inertia just averaged two equally-high values instead of letting mean-reversion pull the rate back down. Raised to 0.35 in `src/lib/budget/inflation.ts`.

This `INERTIA` is local to `inflation.ts`. GDP growth smoothing uses a separate `INERTIA = 0.4` constant in `src/lib/turn/gdpGrowth.ts`, and unemployment smoothing uses `UNEMPLOYMENT_INERTIA = 0.85` in the same file. They are not the same value and are not read from a shared constant.

### Demand-Pull (Phillips Curve)

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

**Output gap replaces the growth term.** Where a country has a measured output gap, the GDP half uses `OUTPUT_GAP_COEFF_UP = 0.25` (output above trend) and `OUTPUT_GAP_COEFF_DOWN = 0.2` (below trend) times the gap instead of `gGap`. During the cutover a blend weight mixes the two: `gdp = (1 - w) × legacy + w × gapTerm`.

**Rationale:** Upward pressure is stronger than downward because prices are stickier on the way down in the real world.

### Monetary Policy

Monetary policy uses a **trailing weighted average** of prime rates so rate changes take 12 turns to reach full effect.

```typescript
effectiveRate = 0.3 × spotRate + 0.7 × trailingAverage

trailingAverage = Σ(rate[i] × propagation[i]) / totalWeight
propagation[i] = min(1, turnsAgo[i] / MONETARY_LAG_TURNS)
```

**Effect on inflation:**

```typescript
rateGap = NEUTRAL_RATE - effectiveRate
monetary = rateGap >= 0
  ? rateGap × MONETARY_COEFF_LOW   // 0.8, below neutral → stimulative
  : rateGap × MONETARY_COEFF_HIGH  // 1.2, above neutral → deflationary (1.5x low rate)
monetary = monetaryRaw × transmissionMultiplier(centralBankScrutiny)  // 1.0 at full credibility
```

The multiplier (`src/lib/centralBank/credibility.ts`) scales only this term: a bank the market does not believe has to move further for the same effect.

**Interpretation:**

- Rate below neutral (3.0%) → expansionary → inflationary
- Rate above neutral → contractionary → deflationary

### Fiscal Policy

Fiscal policy models the inflationary impact of government deficits and surpluses.

```typescript
deficitPct = clamp(-surplusToGdp × 100, -30, 50)  // Positive = deficit
// FISCAL_DEFICIT_PCT_FLOOR = -30, FISCAL_DEFICIT_PCT_CEILING = 50

fiscal = deficitPct >= 0
  ? deficitPct × FISCAL_COEFF_DEFICIT   // 0.15
  : deficitPct × FISCAL_COEFF_SURPLUS   // 0.08 (weaker)
```

**Rationale:** Deficits are more inflationary than surpluses are deflationary. The clamp stops a runaway debt-service spiral from feeding an unbounded term into inflation; a genuinely catastrophic deficit still adds up to 7.5 pp.

### Cost-Push

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

### Other pressures

These terms are added to the raw sum; each is in `src/lib/budget/inflation.ts`.

| Term | Signal | Coefficient | Clamp on signal |
| --- | --- | --- | --- |
| Commodity | median annualised change in the national commodity basket (0.10 = +10 percent a year) | 10.0 up, 10.0 down | +0.3 / -0.15 |
| Forex | currency depreciation, `rate / baseRate - 1` | 8.0 up, 4.0 down | plus or minus 0.25 |
| Savings | net 12-turn savings flow over an effective stock | 1.0 up (withdrawals), 0.5 down (deposits) | -1 to +1 |
| Housing | cost-of-living deviation | 0 (retired) | none |
| Policy stance | active central bank stance, orders and emergency, in pp | 1:1 | none |
| Money supply | `(M2 growth - GDP growth) × coeff` | 0.08 pegged (`PEGGED_MONEY_GROWTH_COEFF`); the post-Bretton-Woods coefficient comes from `monetary/brettonWoods.ts` | result clamped to -1.5..+2.5 pp |

The deflationary forex arm is attenuated when inflation already sits below target: it is multiplied by `4 / (4 + depth)` (`FOREX_DEFLATION_ATTENUATION_HALFLIFE = 4.0`), where depth is how far previous inflation is below target. This breaks the loop where a weak currency and deflation feed each other.

### Worked turn

Inputs: unemployment 4.0, GDP growth 3.0 (no measured output gap), effective prime rate 4.0, deficit 3 percent of GDP, tariff 3.0, wage growth 2.5, all other pressures 0, previous inflation 2.0, full credibility.

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

### Clamping

Final inflation is clamped to realistic bounds:

```typescript
inflation = clamp(rawInflation, MIN_INFLATION, MAX_INFLATION);
// MIN_INFLATION = -2.0% (deflation floor; load-bearing, see below)
// MAX_INFLATION = 100.0% (hyperinflation ceiling)
```

The -2.0 floor is load-bearing: without it, a forex or demand deflation impulse compounds unbounded and, via the corp-margin deflation penalty, applies an uncapped negative margin modifier that bankrupts every company (the t1166 deflation-spiral incident). Beyond `MIN_INFLATION`/`MAX_INFLATION`, the calculation also clamps the per-turn change to `MAX_PER_TURN_DELTA = 1.5` percentage points, so no single turn can jump the rate more than 1.5pp regardless of how extreme the inputs are. The one exception is deep-deflation recovery: when previous inflation is more than `DEEP_DEFLATION_RECOVERY_GAP = 4.0` below target and raw inflation is back within 1 pp of target, the upward move may be as large as the gap to target. In multiplayer, a half tick at :30 applies half the step (`stepFraction = 0.5`) and the hourly turn applies the rest, with the per-turn limits scaled to match.

### Effective Prime Rate Calculation

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

### DB-Aware Calculation

`calculateCountryInflation()` in `src/lib/budget/inflation.ts` reads `stateMetrics` (unemployment, GDP growth), `centralBanks` (prime rate and its history), and the country's `FederalBudget` (deficit, tariff rate, wage growth, previous inflation), the same inputs described above. Its current signature also takes commodity, forex, savings, policy-stance, and money-supply-growth pressure terms:

```typescript
export async function calculateCountryInflation(
  db: Db,
  countryId: CountryId,
  budget: FederalBudget,
  commodityPressure = 0.0,
  forexPressure = 0.0,
  savingsPressure = 0.0,
  policyStancePressure = 0.0,
  moneySupplyGrowthPct = 0.0,
): Promise<number>;
```

The coefficients of those additional terms are in the Other pressures table above.

## GDP Growth System

### Sector-Driven Growth, Not Okun's Law

GDP growth is not derived from unemployment. The headline rate is the `economic.gdpGrowth` node (`src/lib/metricEngine/registry/economic.ts`), which is the measured real output growth from the `economic.sectorGrowth` node: the revenue-weighted sector rate (trailing revenue trend and constant-price output), adjusted by the consumption-tax wedge and a net-exports impulse.

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

Worked example: a sector signal of 3.0, total sales tax 2 points above neutral, and trade growth 1.0 above baseline gives `3.0 - 2 × 0.05 + 0.15 × 1.0 = 3.05`.

### Inertia Smoothing

GDP growth uses its own inertia constant to prevent volatile swings:

```typescript
smoothedGdpGrowth = INERTIA × previousGdpGrowth + (1 - INERTIA) × calculatedGdpGrowth
// INERTIA = 0.4 in src/lib/turn/gdpGrowth.ts (separate from inflation.ts's INERTIA = 0.35)
```

This creates gradual economic cycles rather than turn-to-turn volatility.

## Unemployment System

### Employment-driven, with an Okun fallback

The `economic.unemploymentRate` node reads the metric phase's **regional employment counts** (employed headcount against civilian labour force) directly, with no second smoothing pass and no direct policy-point bonuses. The Okun's-law path below is the fallback used only when civilian labour-force data is unavailable.

### Okun's Law (fallback path)

Okun's law runs off the output gap (GDP growth against the economy's own measured trend, falling back to potential growth, then `NEUTRAL_GDP_GROWTH = 2.0`), then smooths with its own inertia:

```typescript
gdpDeviation = gdpGrowth - reference
okunCoeff = gdpDeviation > 0 ? OKUN_COEFFICIENT_DOWN : OKUN_COEFFICIENT_UP
okunTarget = clamp(previousUnemployment - gdpDeviation × okunCoeff, UNEMPLOYMENT_MIN, UNEMPLOYMENT_MAX)
target = clamp(okunTarget + labourPressure, UNEMPLOYMENT_MIN, UNEMPLOYMENT_MAX)
newUnemployment = UNEMPLOYMENT_INERTIA × previousUnemployment + (1 - UNEMPLOYMENT_INERTIA) × target
// labourPressure = labour wage-index, automation-index and labour-tightness terms
```

**Okun coefficients** (`src/lib/turn/gdpGrowth.ts`): `OKUN_COEFFICIENT_UP = 0.25` (GDP below trend → unemployment rises), `OKUN_COEFFICIENT_DOWN = 0.2` (GDP above trend → unemployment falls). Not a single 0.5 coefficient. `UNEMPLOYMENT_INERTIA = 0.85` (85% previous, 15% new): unemployment smooths far more slowly than inflation or GDP growth. Bounds: `UNEMPLOYMENT_MIN = 1.0`, `UNEMPLOYMENT_MAX = 15.0`.

Worked example (fallback path): previous unemployment 5.0, GDP growth 1.0 against a trend of 2.0. Deviation is -1.0, so `okunTarget = 5.0 + 1.0 × 0.25 = 5.25`; new unemployment `0.85 × 5.0 + 0.15 × 5.25 = 5.04`. It takes many turns of weak growth to move unemployment visibly, which is why players see it lag the GDP number.

## Integration with Turn Processing

Turn phases run as a single ordered list, not numbered groups (`BASE_TURN_PHASE_NAMES` in `src/simulation/phases/turnPhaseNames.ts`). The economics-relevant phases run in this order:

| Phase             | System                                                         |
| ----------------- | -------------------------------------------------------------- |
| `policyEffects`   | Policy-driven economic metric updates                          |
| `metricEngine`    | GDP growth, unemployment, other derived metrics                |
| `nationalMetrics` | National metric aggregation                                    |
| `fiscalBaseGrowth` | Tax bases grow by 1/48 of the live annual rates               |
| `economicModel`   | Sector-driven GDP growth model                                 |
| `inflationRecalc` | Inflation (`calculateCountryInflation`, recomputed every turn) |
| `centralBankChairTurn` | Central bank chair decisions, including the prime rate    |

Because `inflationRecalc` runs before `centralBankChairTurn`, a prime rate change decided this turn first reaches inflation next turn, 30 percent at once and the rest over the 12-turn lag. Inflation reads this turn's GDP growth and unemployment, which `metricEngine` has just written.

## Timing

Everything on this page runs inside the single ordered turn pipeline above (`src/simulation/phases/turnPhaseNames.ts`, run by `src/simulation/phases/turnPhaseRegistry.ts`), once per turn (48 turns per game year). There is no separate schedule: GDP growth and unemployment update in `metricEngine`, inflation in `inflationRecalc` after them, the prime rate in `centralBankChairTurn` after that. The only sub-turn step is the multiplayer half tick for inflation described under Clamping.
### Fiscal cadence

Inflation is recalculated every turn in the state-effects phase. Fiscal-year
processing still handles annual boundaries such as snapshots and debt work,
but it does not gate inflation. Tax bases grow each turn through
`processFiscalBaseGrowth` at 1/48 of the live annual wage, trade, and GDP rates;
the fiscal-year boundary must not apply a second annual growth jump.

## Edge cases and limits

- **Inflation floor and ceiling**: `MIN_INFLATION = -2.0`, `MAX_INFLATION = 100.0`. The floor is load-bearing (see Clamping).
- **Per-turn step**: at most 1.5 pp either way, except deep-deflation recovery.
- **Deficit clamp**: fiscal deficit share is clamped to -30..+50 percent of GDP before the coefficients apply.
- **Missing inputs**: every input falls back to a neutral value when absent or non-finite (target 2.0, neutral rate 3.0, unemployment at NAIRU, GDP growth at trend, no pressure terms). Missing prime rate history means the spot rate is used as the effective rate.
- **Zero cases**: a rate exactly at neutral contributes 0 from monetary policy; a balanced budget contributes 0 from fiscal.
- **Housing**: coefficient 0, so cost-of-living pressure does not move inflation.
- **Command economies**: when the command economy feature is on and the country counts as one in the current year (`isCommandEconomy`, `src/lib/constants/commandEconomy.ts`), `calculateCountryInflation` returns the country's inflation target and none of the formula above applies. See the [Planned Economies](https://www.ahousedividedgame.com/wiki/planned-economies) player page.
- **Unemployment bounds**: 1.0 to 15.0 on the Okun fallback path; the employment-driven value is bounded below by `UNEMPLOYMENT_MIN` and above by 100.
- **Okun is asymmetric**: a boom lowers unemployment more slowly (0.2) than a slump raises it (0.25).

## Common questions

| Question | Answer |
| --- | --- |
| How do I reduce inflation? | Raise the prime rate above neutral (1.2 pp off per 1 pp, lagged 12 turns), run a smaller deficit or a surplus (0.15 per point of deficit), lower tariffs above 3.0 (0.05 per point), and let wage growth cool toward 2.5 (0.15 per point). The prime rate is set by the central bank chair. |
| Why is inflation not moving after a rate hike? | 30 percent of the rate acts at once, the rest over 12 turns, and inflation itself closes only a fixed share of its gap to the turn target each turn (`STEP_ALPHA = 1 - (1 - 0.08) × 0.35 = 0.678`), bounded by the 1.5 pp limit. Expect several turns. |
| Why did real GDP fall? | GDP growth follows what sectors actually produce, so falling sector revenue, higher consumption taxes (0.05 per point above neutral) or weak trade growth pull it down. |
| Why is unemployment rising? | Employment counts fell, or on the fallback path growth is below trend (0.25 per point). Unemployment moves slowly because of its 85 percent inertia. |
| What is the prime rate? | The central bank's policy rate. It is set by the chair (`src/lib/turn/centralBankChairTurn.ts`), see [Currency Exchange](./currency-exchange.md) and [Monetary System](./monetary-system-as-shipped.md). |

## Tuning Guidelines

### When to Adjust Coefficients

| Symptom                          | Likely Cause                     | Fix                                       |
| -------------------------------- | -------------------------------- | ----------------------------------------- |
| Inflation too volatile           | Low inertia, high coefficients   | Increase `INERTIA`, reduce coefficients   |
| Inflation unresponsive to policy | High inertia, low coefficients   | Decrease `INERTIA`, increase coefficients |
| Rate changes feel meaningless    | Low `MONETARY_COEFF_LOW`         | Raise it (now 0.8, was 0.4)               |
| Deflation too common             | Asymmetric coefficients too weak | Increase `_DOWN` coefficients             |

### Recommended Ranges

| Coefficient             | Current | Safe Range |
| ----------------------- | ------- | ---------- |
| `INERTIA`               | 0.35    | 0.2-0.5    |
| `MONETARY_COEFF_LOW`    | 0.8     | no tested range; raised from 0.4 in `src/lib/budget/inflation.ts` |
| `MONETARY_COEFF_HIGH`   | 1.2     | 0.9-1.5    |
| `UNEMPLOYMENT_COEFF_UP` | 0.3     | 0.2-0.5    |
| `FISCAL_COEFF_DEFICIT`  | 0.15    | 0.1-0.25   |

## Currency storage (v0.2.6)

Inflation, GDP-growth, and unemployment math reads and writes money fields in each entity's **native currency** (country currency for budgets, `liquidCurrencyCode` for corporations). Cross-entity aggregation (global GDP, global debt-to-GDP, commodity flows) anchor-normalizes via `sumAsAnchor` / `readCorpEconomicAnchor` before arithmetic, so a 2% inflation shock against one country doesn't pollute another's base via mixed-currency sums.

| Dimension                                              | Storage                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| `FederalBudget.gdp`, `StateBudget.stateGdp`            | country's `currencyCode`                                                 |
| Tax bases (`corporateProfits`, `taxableSales`, etc.)   | country's `currencyCode`                                                 |
| Corporate revenue/income inputs to GDP growth          | corp's `liquidCurrencyCode` (anchor-normalized when summed across corps) |
| Inflation multipliers / coefficients / ratios          | dimensionless, storage-agnostic                                          |
| Cross-country totals (global GDP, global money supply) | computed in ₳ via `sumAsAnchor`; displayed via wallet preference         |

See [Currency Exchange](./currency-exchange.md) §"Currency storage (v0.2.6)" for the full cross-system invariant table, helper index, and migration scripts. The Phillips-curve and fiscal-coefficient math is currency-agnostic: it operates on ratios (unemployment rate, debt-to-GDP, deficit-to-GDP) that cancel currency units, so no changes were required to the inflation formulas themselves.

## Connections

**Driven by:**

- [National Budget](./national-budget.md): deficit and tariff and wage inputs (`FederalBudget` read by `calculateCountryInflation`).
- [Tariffs](./tariffs.md): tariff rate and tariff cost-push (`computeCountryTariffPressure`).
- [Labour](./labour.md): wage growth and the labour wage, automation and tightness terms in unemployment.
- [Commodities](./commodities.md): commodity basket signal feeding inflation.
- [Currency Exchange](./currency-exchange.md): forex depreciation pressure.
- [Monetary System](./monetary-system-as-shipped.md) and [Money Supply and QE](./money-supply-and-quantitative-easing.md): prime rate history, policy stance, M2 growth.

**Affects:**

- [Corporations](./corporations.md): inflation adjusts corporate margins (deflation penalty, see the floor note above).
- [Government Approval](./government-approval.md): economic conditions feed approval.
- [National Budget](./national-budget.md): inflation and growth feed tax bases next turn.

## Related Systems

- **Federal Budget:** `src/lib/budget/` - Budget calculations that feed inflation
- **Central Bank:** `src/lib/turn/centralBankChairTurn.ts` - Interest rate decisions
- **Turn Processing:** `src/lib/turnSystem.ts` - Economic phase orchestration
- **Policy Effects:** `src/lib/policyEffects.ts` - How policies affect economics

## Diagram

See the visuals list: inflation components, prime rate, GDP growth and unemployment in turn order.

Last checked: 2026-10-29, version 1.18.0
