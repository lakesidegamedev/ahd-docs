# Economic Systems

## Overview

The economic systems in A House Divided simulate real-time macroeconomic dynamics driven by player decisions. Inflation, GDP growth, and unemployment are not static values but emerge from economic policies and conditions each turn.

**Location:** `src/lib/budget/` and `src/lib/turn/`

**Key files:**

- `src/lib/budget/inflation.ts` - Dynamic inflation calculation per country
- `src/lib/turn/gdpGrowth.ts` - GDP growth and Okun's-law unemployment constants and pure helpers (there is no separate `unemployment.ts`; the turn phase that applies them lives in `src/lib/metricEngine`)

## Inflation System

### Design Philosophy

Inflation is calculated from real economic drivers that the game tracks:

1. **Demand-pull** (Phillips curve): GDP growth and unemployment
2. **Monetary policy**: Central bank prime rate vs neutral rate
3. **Fiscal policy**: Government deficit/surplus as share of GDP
4. **Cost-push**: Tariff rates and wage growth

The result replaces the static `inflationRate` on `EconomicGrowthFactors` each turn, making inflation emergent from player decisions.

### Inflation Formula

```typescript
inflation = BASE_TARGET + demandPull + monetary + fiscal + costPush
          + commodity + forex + savings + housing + policy + moneySupply

// Housing is retired (coefficient 0). Where a country has a measured output gap,
// the GDP half of demandPull uses the output gap (OUTPUT_GAP_COEFF_UP 0.25,
// OUTPUT_GAP_COEFF_DOWN 0.2) instead of growth versus trend.

// Smoothed with inertia
smoothed = INERTIA × previousInflation + (1 - INERTIA) × inflation
newInflation = smoothed + 0.08 × (targetInflation - smoothed)
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

`INERTIA` was previously 0.2. At that level a persistently-elevated input (e.g. a static seeded `wageGrowth`) became a permanent inflation floor: the raw calculation recomputed the same elevated contribution every turn, and inertia just averaged two equally-high values instead of letting mean-reversion pull the rate back down. Raised to 0.35 in `src/lib/budget/inflation.ts` line 208.

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
```

**Interpretation:**

- Rate below neutral (3.0%) → expansionary → inflationary
- Rate above neutral → contractionary → deflationary

### Fiscal Policy

Fiscal policy models the inflationary impact of government deficits and surpluses.

```typescript
deficitPct = -surplusToGdp × 100  // Positive = deficit

fiscal = deficitPct >= 0
  ? deficitPct × FISCAL_COEFF_DEFICIT   // 0.15
  : deficitPct × FISCAL_COEFF_SURPLUS   // 0.08 (weaker)
```

**Rationale:** Deficits are more inflationary than surpluses are deflationary.

### Cost-Push

Cost-push inflation from tariffs and wages. **Two-sided** like demand-pull.

```typescript
tariffGap = tariffRate - TARIFF_BASELINE  // Baseline: 3.0%
tariffPush = tariffGap >= 0
  ? tariffGap × TARIFF_COEFF_UP    // 0.05
  : tariffGap × TARIFF_COEFF_DOWN  // 0.025 (weaker)

wageGap = wageGrowth - WAGE_GROWTH_BASELINE  // Baseline: 2.5%
wagePush = wageGap >= 0
  ? wageGap × WAGE_COEFF_UP    // 0.15
  : wageGap × WAGE_COEFF_DOWN  // 0.08 (weaker)

costPush = tariffPush + wagePush
```

### Clamping

Final inflation is clamped to realistic bounds:

```typescript
inflation = clamp(rawInflation, MIN_INFLATION, MAX_INFLATION);
// MIN_INFLATION = -2.0% (deflation floor; load-bearing, see below)
// MAX_INFLATION = 100.0% (hyperinflation ceiling)
```

The -2.0 floor is load-bearing: without it, a forex or demand deflation impulse compounds unbounded and, via the corp-margin deflation penalty, applies an uncapped negative margin modifier that bankrupts every company (the t1166 deflation-spiral incident). Beyond `MIN_INFLATION`/`MAX_INFLATION`, the calculation also clamps the per-turn change to `MAX_PER_TURN_DELTA = 1.5` percentage points, so no single turn can jump the rate more than 1.5pp regardless of how extreme the inputs are.

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

`calculateCountryInflation()` in `src/lib/budget/inflation.ts` reads `stateMetrics` (unemployment, GDP growth), `centralBanks` (prime rate and its history), and the country's `FederalBudget` (deficit, tariff rate, wage growth, previous inflation), the same inputs described above. Its current signature also takes commodity, forex, savings, policy-stance, and money-supply-growth pressure terms that feed additional cost-push channels beyond demand-pull, monetary, fiscal, and tariff/wage cost-push:

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

Those additional pressure terms (commodity price deviation, currency depreciation, savings withdrawal/deposit flow) are out of scope for this doc's formula walkthrough above; see the constant comments in `inflation.ts` for their coefficients and rationale.

## GDP Growth System

### Sector-Driven Growth, Not Okun's Law

GDP growth is not derived from unemployment. The revenue-weighted sector rate,
adjusted by the consumption-tax wedge, is the sector impulse:

```typescript
sectorImpulse = sectorGrowth - taxGap × SALES_TAX_GROWTH_COEFFICIENT
displayedGdpGrowth = potentialGrowth + realizedOutputGapChange
```

Okun's law runs the other direction: it derives **unemployment** from the GDP growth signal, not GDP growth from unemployment. See the Unemployment System section below.

### Inertia Smoothing

GDP growth uses its own inertia constant to prevent volatile swings:

```typescript
smoothedGdpGrowth = INERTIA × previousGdpGrowth + (1 - INERTIA) × calculatedGdpGrowth
// INERTIA = 0.4 in src/lib/turn/gdpGrowth.ts (separate from inflation.ts's INERTIA = 0.35)
```

This creates gradual economic cycles rather than turn-to-turn volatility.

## Unemployment System

### Okun's Law

Unemployment is calculated in `economic.unemploymentRate` (`src/lib/metricEngine/registry/economic.ts`) off the real output gap (GDP growth vs. potential growth, falling back to `NEUTRAL_GDP_GROWTH = 2.0` when potential isn't seeded), then smoothed with its own inertia:

```typescript
gdpDeviation = gdpGrowth - potentialGrowth
okunCoeff = gdpDeviation > 0 ? OKUN_COEFFICIENT_DOWN : OKUN_COEFFICIENT_UP
okunTarget = clamp(previousUnemployment - gdpDeviation × okunCoeff, UNEMPLOYMENT_MIN, UNEMPLOYMENT_MAX)
newUnemployment = UNEMPLOYMENT_INERTIA × previousUnemployment + (1 - UNEMPLOYMENT_INERTIA) × okunTarget
// plus one-time labour wage-index and automation-index pressure terms, then re-clamped
```

**Okun coefficients** (`src/lib/turn/gdpGrowth.ts`): `OKUN_COEFFICIENT_UP = 0.25` (GDP below potential → unemployment rises), `OKUN_COEFFICIENT_DOWN = 0.2` (GDP above potential → unemployment falls). Not a single 0.5 coefficient. `UNEMPLOYMENT_INERTIA = 0.85` (85% previous, 15% new): unemployment smooths far more slowly than inflation or GDP growth. Bounds: `UNEMPLOYMENT_MIN = 1.0`, `UNEMPLOYMENT_MAX = 15.0`.

## Integration with Turn Processing

Turn phases run as a single ordered list, not numbered groups (`BASE_TURN_PHASE_NAMES` in `src/simulation/phases/turnPhaseNames.ts`). The economics-relevant phases run in this order:

| Phase             | System                                                         |
| ----------------- | -------------------------------------------------------------- |
| `policyEffects`   | Policy-driven economic metric updates                          |
| `metricEngine`    | GDP growth, unemployment (Okun's law), other derived metrics   |
| `nationalMetrics` | National metric aggregation                                    |
| `economicModel`   | Sector-driven GDP growth model                                 |
| `inflationRecalc` | Inflation (`calculateCountryInflation`, recomputed every turn) |

### Fiscal cadence

Inflation is recalculated every turn in the state-effects phase. Fiscal-year
processing still handles annual boundaries such as snapshots and debt work,
but it does not gate inflation. Tax bases grow each turn through
`processFiscalBaseGrowth` at 1/48 of the live annual wage, trade, and GDP rates;
the fiscal-year boundary must not apply a second annual growth jump.

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
| `MONETARY_COEFF_LOW`    | 0.8     | raised from 0.4 (`src/lib/budget/inflation.ts`) |
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

## Related Systems

- **Federal Budget:** `src/lib/budget/` - Budget calculations that feed inflation
- **Central Bank:** `src/lib/turn/centralBankChairTurn.ts` - Interest rate decisions
- **Turn Processing:** `src/lib/turnSystem.ts` - Economic phase orchestration
- **Policy Effects:** `src/lib/policyEffects.ts` - How policies affect economics
