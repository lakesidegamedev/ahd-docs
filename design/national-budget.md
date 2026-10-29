# National Budget & Treasury

Player guide: [National Budget](https://www.ahousedividedgame.com/wiki/national-budget)

## Overview

The federal budget system tracks government revenue, spending, and debt. It integrates with tax policy, regional grants, public enterprises, and sovereign bond issuance.

**Primary modules:** `src/lib/budget/revenue.ts`, `src/lib/budget/spending.ts`, `src/lib/budget/fiscalYear.ts`

**Turn processing:** corporate output refreshes tax bases and revenue during the corporation turn; fiscal-year processing runs at turn 40; budget API/admin routes can recalculate on demand.

## Revenue Calculation

Federal revenue is calculated in `src/lib/budget/revenue.ts` → `calculateFederalRevenue()`:

```typescript
// Revenue = sum of (tax base × tax rate) for each category
const revenue = {
  incomeTax: taxBases.taxableIncome * taxRates.incomeTax,
  domesticCorporateTax:
    taxBases.domesticCorporateProfits * taxRates.domesticCorporateTax,
  foreignCorporateTax:
    taxBases.foreignCorporateProfits * taxRates.foreignCorporateTax,
  payrollTax: taxBases.wagesAndSalaries * taxRates.payrollTax,
  tariffs: taxBases.importValue * taxRates.tariffs,
  salesTax: taxBases.taxableSales * taxRates.salesTax,
  healthcareIncome: publicEnterpriseHealthcareIncome,
  other: publicEnterpriseOtherIncome,
};
```

**GDP fallback:** If no budget is set, uses $27 trillion default.

**Public enterprise revenue:** Included from national corporations (`corporations` collection with `countryId` filter).

### Tax Bases

Tax bases are stored on the `FederalBudget` document. Live wage, trade, and
GDP rates grow them every turn through `processFiscalBaseGrowth`, applying
1/48 of the annual rate per turn. The fiscal-year close does not add another
annual growth jump.

| Category                   | Description                                                  |
| -------------------------- | ------------------------------------------------------------ |
| `taxableIncome`            | Personal taxable income                                      |
| `domesticCorporateProfits` | Corporate profits from corps HQ'd in-country                 |
| `foreignCorporateProfits`  | Corporate profits from foreign-HQ corps operating in-country |
| `wagesAndSalaries`         | Wages subject to payroll tax                                 |
| `importValue`              | Import value subject to tariffs                              |
| `taxableSales`             | Consumer spending subject to sales tax                       |

## Spending Calculation

Federal spending is calculated in `src/lib/budget/spending.ts` → `calculateFederalSpending()`:

```typescript
// Spending = enacted laws by category + state grants + debt interest
const spending = {
  byCategory: {/* category totals from enactedLaws */},
  stateGrants: total,
  debtInterest: annualInterest,
  total: categoryTotal + stateGrants + debtInterest,
};
```

**Cost calculation:** `src/lib/budget/costs.ts` → `calculateEnactedLawAnnualCost()`:

| Cost Type                | Formula                               |
| ------------------------ | ------------------------------------- |
| `gdpPerCapitaMultiplier` | `multiplier × GDP`                    |
| `annualCostPerCapita`    | `perCapitaCost × population`          |
| `annualCostUsd`          | Fixed USD amount                      |
| `budgetCost`             | `(budgetCost / 100) × budgetCapacity` |

Absolute local-currency costs (`annualCostPerCapita`, legacy `annualCostUsd`) are
scaled for pre-2000 presets before being added to spending. This keeps 1991
nominal budgets from importing 2020-calibrated per-capita policy costs. GDP-based
and budget-percentage costs are already ratio-based and are not scaled.

**Grant laws:** Tracked separately in `spending.stateGrants`

**Category laws:** Grouped by `budgetCategory` field (e.g., `"healthcare"`, `"defense"`, `"education"`)

## Debt & Credit Rating

Credit rating and interest rates are calculated in `src/lib/budget/debt.ts`:

### Credit Rating Thresholds

```typescript
const DEBT_THRESHOLDS = [
  {
    rating: "AAA",
    maxRatio: 0.6,
    interestRate: 0.02,
    gdpPenalty: 0,
    trustPenalty: 0,
  },
  {
    rating: "AA",
    maxRatio: 0.8,
    interestRate: 0.025,
    gdpPenalty: 0,
    trustPenalty: 0,
  },
  {
    rating: "A",
    maxRatio: 1.0,
    interestRate: 0.035,
    gdpPenalty: 0.1,
    trustPenalty: 0,
  },
  {
    rating: "BBB",
    maxRatio: 1.2,
    interestRate: 0.05,
    gdpPenalty: 0.2,
    trustPenalty: 0,
  },
  {
    rating: "BB",
    maxRatio: 1.5,
    interestRate: 0.07,
    gdpPenalty: 0.3,
    trustPenalty: 5,
  },
  {
    rating: "B",
    maxRatio: 2.5,
    interestRate: 0.1,
    gdpPenalty: 0.5,
    trustPenalty: 10,
  },
  {
    rating: "CCC",
    maxRatio: Infinity,
    interestRate: 0.14,
    gdpPenalty: 0.7,
    trustPenalty: 15,
  },
];
```

### Interest Rate Calculation

```typescript
const threshold = getDebtThreshold(debtToGdpRatio);
const creditRating = threshold.rating;
const interestRate = threshold.interestRate;
```

**Result:** AAA pays 2%, AA 2.5%, A 3.5%, BBB 5%, BB 7%, B 10%, and CCC 14%. `B`'s 2.5 ratio ceiling is `EXTREME_DISTRESS_DEBT_TO_GDP` (250% debt/GDP); beyond it the sovereign degrades to `CCC`, the floor the `CreditRating` type supports. No live-prod country is anywhere near this band, it only bites in runaway autonomous-world scenarios.

### Annual Debt Processing

`src/lib/budget/debt.ts` → `processAnnualDebt()`:

```typescript
if (surplus < 0) {
  // Deficit: add to debt principal
  budget.debt.principal += Math.abs(surplus);
} else {
  // Surplus: pay down debt
  budget.debt.principal = Math.max(0, budget.debt.principal - surplus);
}
```

## Fiscal Year Processing

Fiscal year processing runs at **turn 40** (October in game time: 48 turns = 1 year):

**Entry point:** `src/lib/budget/fiscalYear.ts` → `processFiscalYear()`

### Growth Sequence

1. **Recalculate inflation each turn**, using the dynamic model below.
2. **Grow fiscal bases each turn**, applying 1/48 of live annual wage, trade, and GDP rates.
3. **Update population**, from state demographics aggregation.
4. **Recalculate revenue**, using current bases and rates.

```typescript
// Nominal growth rate = (1 + realGrowth) × (1 + inflation) - 1
const nominalGrowth = (1 + realGdpGrowth / 100) * (1 + inflation / 100) - 1;
taxBase = taxBase * (1 + nominalGrowth);
```

## Inflation Calculation

Inflation is **dynamic** (not static), calculated from economic conditions:

**Entry point:** `src/lib/budget/inflation.ts` → `calculateCountryInflation()`

### Phillips Curve Model

Inflation = Target + Demand-Pull + Monetary + Fiscal + Cost-Push + Commodity + Forex + Savings + Housing + Policy + Money supply

The table below covers the four core components; the commodity, forex, savings, policy and money-supply terms add further pressure (the housing term is retired, coefficient 0), and where a country has a measured output gap the GDP half of demand-pull uses it instead of growth versus trend (`src/lib/budget/inflation.ts`). The core components are two-sided with asymmetric coefficients: pressure above baseline (inflationary) uses a stronger coefficient than pressure below baseline (deflationary), because prices are stickier on the way down.

| Component       | Formula (above baseline / below baseline)                                                                               | Description                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Demand-pull** | `(NAIRU - unemployment) × 0.3` (tight) or `× 0.2` (slack), plus `(GDP growth - 2%) × 0.2` (hot) or `× 0.15` (recession) | Tight labor/hot GDP → inflation                             |
| **Monetary**    | `(3.0% - effectivePrimeRate) × 0.8` (below neutral) or `× 1.2` (above neutral)                                          | Low rates → inflation; high rates → deflation (1.5× stronger) |
| **Fiscal**      | `deficitToGdp × 0.15` (deficit) or `× 0.08` (surplus), deficit/GDP clamped to [-30, 50] before the coefficient          | Deficits → inflation; surpluses → deflation                 |
| **Cost-push**   | `(tariffs - 3%) × 0.05` (above) or `× 0.025` (below), plus `(wages - 2.5%) × 0.15` (above) or `× 0.08` (below)          | Input costs → inflation                                     |

**Constants:**

- `BASE_TARGET = 2.0%`
- `NAIRU = 5.0%` (Non-Accelerating Inflation Rate of Unemployment)
- `NEUTRAL_RATE = 3.0%`
- `MONETARY_LAG_TURNS = 12` (rate changes propagate over 12 turns)
- `INERTIA = 0.35` (35% previous inflation + 65% new = smoothing)

**Clamps:** `[-2.0%, 100.0%]` (the 100% ceiling is a hard backstop; mean-reversion and the deficit/GDP clamp keep normal play far below it)

### Monetary Policy Lag

Rate changes don't affect inflation immediately, they propagate over 12 turns:

```typescript
// Weight for entry k turns ago = min(1, k / 12)
// Most recent rate (k=0) gets 1/12 weight
// Rate from 12+ turns ago (k≥12) gets full weight
```

### Rules summary

| Constant | Value | Source |
| --- | --- | --- |
| Credit ladder (max debt/GDP, rate, GDP penalty, trust penalty) | AAA 0.6, 2%, 0, 0; AA 0.8, 2.5%, 0, 0; A 1.0, 3.5%, 0.1, 0; BBB 1.2, 5%, 0.2, 0; BB 1.5, 7%, 0.3, 5; B 2.5, 10%, 0.5, 10; CCC above, 14%, 0.7, 15 | `src/lib/budget/debt.ts` |
| `EXTREME_DISTRESS_DEBT_TO_GDP` | 2.5 | `src/lib/budget/debt.ts` |
| `BASE_TARGET`, `NAIRU`, `NEUTRAL_RATE` | 2.0, 5.0, 3.0 | `src/lib/budget/inflation.ts` |
| `MONETARY_COEFF_LOW` / `MONETARY_COEFF_HIGH` | 0.8 / 1.2 | `src/lib/budget/inflation.ts` |
| `FISCAL_COEFF_DEFICIT` / `FISCAL_COEFF_SURPLUS` | 0.15 / 0.08 | `src/lib/budget/inflation.ts` |
| `MONETARY_LAG_TURNS` | 12 | `src/lib/budget/inflation.ts` |
| `INERTIA` | 0.35 | `src/lib/budget/inflation.ts` |
| `MEAN_REVERSION_COEFF` | 0.08 per turn toward the target | `src/lib/budget/inflation.ts` |
| `MAX_PER_TURN_DELTA` | 1.5pp per turn (ordinary moves) | `src/lib/budget/inflation.ts` |
| `MIN_INFLATION` / `MAX_INFLATION` | -2.0 / 100.0 | `src/lib/budget/inflation.ts` |
| `HOUSING_PRESSURE_COEFF` | 0 (term retired) | `src/lib/budget/inflation.ts` |
| `PEGGED_MONEY_GROWTH_COEFF` | 0.08 (0.15 after Bretton Woods exit) | `src/lib/budget/inflation.ts`, `src/lib/monetary/brettonWoods.ts` |
| `DEBT_CEILING_RAISE_TRIGGER` / `DEBT_CEILING_RAISE_HEADROOM` | 0.95 / 1.10 | `src/lib/budget/rules/debtCeilingRaise.ts` |
| `DD_MIN_BORROWING_LIMIT_TO_GDP` | 0.4 (East Germany floor) | `src/lib/budget/borrowingLimit.ts` |
| Fiscal year start | turn 40 of 48 (`FISCAL_YEAR_START_TURN_IN_YEAR`) | `src/lib/budget/fiscalYear.ts` |

Worked example: a country with revenue 900, spending 1,000 (of which 60 is debt interest) runs a deficit of 100. If GDP is 2,000 and debt principal was 1,050 (0.525, AAA at 2%), the close brings it to 1,150 (0.575, still AAA). A second such year gives 1,250 (0.625), which is AA at 2.5%. The deficit also feeds inflation: 100 / 2,000 = 5% of GDP, so the fiscal term is `5 * 0.15 = +0.75pp`, before smoothing.

Why the asymmetric coefficients: prices are stickier on the way down, so a deficit pushes inflation up harder (0.15) than a surplus pulls it down (0.08). The same holds for the monetary term, where the high-rate side is stronger (1.2 vs 0.8) so a rate hike can actually cool an overheated economy.

## Timing

Registry phases (`src/simulation/phases/turnPhaseRegistry.ts`) in order:

1. `incomeTaxBases` refreshes income tax shares early in the turn.
2. `corporationTurn` writes corporate tax bases and taxable sales.
3. `bondTurn` handles sovereign bond issuance and coupons (quarterly issuance, every 12 turns).
4. `fiscalYear` runs only when `isFiscalYearEnd`, at turn 40 of each 48-turn year; otherwise it is recorded as skipped. It processes annual debt, grants, and snapshots.
5. `stateEffectsAndNationalAggregation`: `nationalMetrics`, `fiscalBaseGrowth` (1/48 of the annual rate per turn), `economicModel`, `tradeGrowthMirror`, then `inflationRecalc` (so inflation reads this turn's metrics), then the central bank phases.
6. `playerIncomeTax` and `moneySupplySnapshot` close the turn.

Inflation computed on turn T reaches the prime-rate decision on the same turn (`centralBankChairTurn`) and the savings and loan accruals on turn T+1.

## Edge cases and limits

- Fiscal term: deficit/GDP is clamped to [-30, 50] percentage points before the coefficient, so a runaway debtor cannot inject unbounded inflation.
- Inflation floor -2.0: stops a deflation spiral, because deflation also applies a corporate margin penalty. Ceiling 100.
- Ordinary movement is limited to 1.5pp per turn; recovery from deep deflation (more than 4pp below target, `DEEP_DEFLATION_RECOVERY_GAP`) is allowed a larger upward correction.
- Surplus pays down principal but never below 0.
- Debt/GDP above 2.5 degrades to CCC; no live country is near it.
- Debt ceiling: at fiscal close, if principal is at least 95% of the ceiling the ceiling is raised to 110% of principal. East Germany's effective limit is at least 40% of smoothed GDP.
- No budget set: revenue falls back to a default GDP of 27 trillion.
- Currency: every budget field is stored in the country's own currency; cross-country sums go through the anchor.

Who changes the budget: tax rates and spending commitments change only through enacted legislation (see [Bills and Legislation](./bills-legislation.md) and [Policy System](./policy-system.md)); there is no direct budget edit for players, and the live budget panel shows the result. Fixing a deficit means raising rates, repealing a spending law, or letting growth expand the tax base. The consequences of a deficit are debt principal growth, a possible rating drop at the next fiscal close, higher coupon cost, and an inflation push.

## Connections

Driven by:

- [Policy System](./policy-system.md) and [Bills and Legislation](./bills-legislation.md): enacted laws set tax rates and spending (`calculateEnactedLawAnnualCost` in `src/lib/budget/costs.ts`).
- [Corporations](./corporations.md): corporate output writes tax bases (`corporationTurn`).
- [Monetary System (as shipped)](./monetary-system-as-shipped.md): the effective prime rate feeds the monetary inflation term.
- [Money Supply and QE](./money-supply-and-quantitative-easing.md): M2 growth over GDP growth feeds the money supply term; treasury advances change debt.
- [Ministerial Orders](./ministerial-orders.md): `policyInflationPressure` from orders adds the policy term.
- [Tariffs](./tariffs.md): the tariff rate enters the cost-push term.

Affects:

- [Sovereign Bonds](./sovereign-bonds.md): deficits set quarterly issuance; the rating sets the rate (`applySovereignDebtAdjustment` in `src/lib/bonds/sovereign.ts`).
- [National Metrics](./national-metrics.md): inflation and GDP effects are written back into the metric set.
- Public trust and corporate growth: at fiscal close `applyDebtPenalties` applies the rating's GDP penalty and public trust penalty (BB and worse: trust -5, -10, -15) in `src/lib/budget/fiscalYear.ts`.
- [Monetary System (as shipped)](./monetary-system-as-shipped.md): inflation sets the savings real rate and the chair's Taylor target.

## Budget Document Structure

```typescript
interface FederalBudget {
  _id: BudgetDocumentId; // "federal", "UK", country-specific strings
  countryId: string;
  fiscalYear: number;
  revenue: {
    incomeTax: number;
    domesticCorporateTax: number;
    foreignCorporateTax: number;
    payrollTax: number;
    tariffs: number;
    salesTax: number;
    healthcareIncome: number;
    other: number;
    total: number;
  };
  taxRates: {
    incomeTax: number;
    domesticCorporateTax: number;
    foreignCorporateTax: number;
    payrollTax: number;
    tariffs: number;
    salesTax: number;
  };
  taxBases: {
    taxableIncome: number;
    domesticCorporateProfits: number;
    foreignCorporateProfits: number;
    wagesAndSalaries: number;
    importValue: number;
    taxableSales: number;
  };
  economicFactors: {
    gdpGrowth: number;
    wageGrowth: number;
    inflationRate: number;
    tradeGrowth: number;
    lastUpdated: Date;
  };
  spending: {
    byCategory: Record<string, number>; // healthcare, defense, etc.
    stateGrants: number;
    debtInterest: number;
    total: number;
  };
  surplus: number; // revenue - spending (negative = deficit)
  gdp: number;
  debt: {
    principal: number;
    interestRate: number;
    ceiling: number;
    ceilingLastRaisedYear: number;
  };
  debtToGdpRatio: number;
  creditRating: "AAA" | "AA" | "A" | "BBB" | "BB" | "B" | "CCC";
  currencyCode?: string;
  updatedAt: Date;
}
```

## Sovereign Bond Integration

Sovereign bonds are issued quarterly (every 12 turns) and integrated with the budget:

**Issuance amount:** `quarterlyAmount = annualDeficit / 4`

**Budget adjustment:** `src/lib/bonds/sovereign.ts` → `applySovereignDebtAdjustment()`

```typescript
newPrincipal = oldPrincipal + bond.totalIssued;
newDebtInterest = oldDebtInterest + (couponRate / 100) * totalIssued;
newSurplus = revenue - (spending + newDebtInterest);
```

See [Sovereign Bonds](./sovereign-bonds.md) for full details.

## Turn Processing

Budget updates are split across turn phases and API/admin recalculation paths:

1. **Corporation turn**, writes corporate tax bases, taxable sales, and related budget inputs as corporate output changes.
2. **Revenue refresh**, recalculates federal revenue, spending, and surplus after tax bases move.
3. **Fiscal year boundary**, at turn 40, processes annual debt, updates grants, writes snapshots, and applies debt penalties without a second tax-base growth jump.
4. **Inflation recalculation**, runs after national metrics so central banks and budget-derived indicators stay current.
5. **Bond and admin flows**, sovereign bond issuance, debt-ceiling actions, and heal/admin routes update budget debt or recalculate budget fields on demand.

## Currency storage (v0.2.6)

Every federal- and state-budget money field is stored in the country's currency. Cross-country aggregation (global GDP, global debt totals) anchor-normalizes via `sumAsAnchor`; single-country math stays unit-preserving. UI renders via `formatAmount(anchorValue, nativeCurrencyCode)` so the wallet preference is a display-time concern only.

| Domain                                                                                   | Stored in                                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Federal budget (`revenue.*`, `spending.*`, `taxBases.*`, `debt.*`, `surplus`, `gdp`)     | country's `currencyCode` (stamped on `federalBudget.currencyCode`)                   |
| State budget (`revenue.*`, `spending.*`, `taxBases.*`, `balance`, `surplus`, `stateGdp`) | parent country's currency                                                            |
| `enactedLaws.annualCostUsd`                                                              | country's currency (legacy field name, not USD since v0.2.6)                         |
| Sovereign bond face value / coupon / `totalIssued`                                       | `bond.currencyCode` = country's currency (stamped at issuance)                       |
| `federalBudgetSnapshots.budget.*` history rows                                           | country's currency at time of write (`budget.currencyCode` stamped on each snapshot) |
| `debtToGdpRatio`                                                                         | dimensionless, not scaled                                                            |
| Cross-country sums                                                                       | computed in ₳ via `sumAsAnchor`; displayed via wallet preference                     |

**Tax-base interop:** the corp turn writes `taxBases.domesticCorporateProfits`, `taxBases.foreignCorporateProfits`, and `taxBases.taxableSales` into the budget after multiplying anchor-denominated operating totals by the country's FX rate, so the budget side always reads country-local even when the source corps span multiple currencies. Domestic vs foreign classification uses `corp.countryId === sector.countryId`, see `docs/design/corporations.md` for the full rate-selection logic.

**No migration shipped for v0.2.6:** federal and state budgets, historical snapshots (`federalBudgetSnapshots`), and enacted laws were already stored in each country's currency pre-v0.2.6, seed data writes `currencyCode` from day one (see `src/lib/seeds/reference/budgets.ts`) and budget revenue/spending helpers (`src/lib/budget/revenue.ts`, `spending.ts`) produce country-local values without any ₳ roundtrip. For any stored snapshot missing `budget.currencyCode`, the federal-budget GET route falls back to `resolveCountryCurrencyCode(countryId)` at read time, so no stamp migration is required either.

## Related Documentation

- [Sovereign Bonds](./sovereign-bonds.md), Bond issuance, trading, maturity settlement
- [Policy System](./policy-system.md), How enacted laws affect budget categories
- [National Metrics](./national-metrics.md), GDP, unemployment, inflation aggregation

Last checked: 2026-10-29, version 1.18.0
