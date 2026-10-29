# Budget Calculations

Player guide: [National Budget](https://www.ahousedividedgame.com/wiki/national-budget)

## Scope and source of truth

This page describes the current fiscal calculation pipeline. `src/lib/budget/`, `src/lib/turn/fiscalBaseGrowth.ts`, and `src/lib/turn/treasuryTurn.ts` are authoritative when a formula changes. The database type still uses the historical names `FederalBudget` and `federalBudget`, but the same national pipeline processes every country budget.

Player-facing fiscal behavior is covered in [National Budget](./national-budget.md). Sovereign debt and crisis resolution are covered in [Sovereign Bonds](./sovereign-bonds.md) and [IMF Sovereign Facility](./imf-sovereign-facility.md).

## Two cadences

Fiscal accounting is split between per-turn accrual and the shared fiscal-year rollover.

### Every turn

`processFiscalBaseGrowth()` reads the latest national and regional metric rates, then applies one forty-eighth of each annual display rate to the relevant tax bases. National bases use national `gdpGrowth`, `wageGrowth`, and `tradeGrowth`; regional bases use their own regional rates. Inflation comes from the owning country's budget state.

After growing the national bases, the phase recomputes national revenue. Regional revenue is reconciled at fiscal-year rollover.

`processTreasuryTurn()` then moves one forty-eighth of the current primary balance into `treasuryBalance`, less live debt service and any enforcement cost:

```text
primaryPerTurn = (annualRevenue - annualPrimarySpending) / 48
annualPrimarySpending = spending.total - spending.debtInterest
debtServicePerTurn = stock * stockServiceRate / 48
nextTreasuryBalance = currentTreasuryBalance + primaryPerTurn - debtServicePerTurn - enforcementCost
```

`stockServiceRate` (`src/lib/budget/rules/sovereignDebtService.ts`) is blended. Outstanding sovereign bonds are serviced at the coupons they were issued with; any stock not yet represented by bonds is serviced at the current marginal ladder rate. An active sovereign IMF program caps the blended rate at `IMF_SOVEREIGN_DEFAULT_RATE`. This stops a country's whole debt being repriced the turn its ratio crosses a rating band.

A positive treasury balance is cash. `treasuryBalance` and `debt.principal` are separate: principal belongs to the bond ledger (`src/lib/bonds/sovereignPrincipal.ts`) and always equals the sum of outstanding sovereign bonds, so a country can hold cash and bond debt at the same time. The annual rollover does not add the deficit a second time. Enacted tax-rate changes also phase toward their targets in this phase (`advanceTaxRatePhaseIn()`).

A country whose cabinet runs on the v2 reset system settles its revenue and department spending elsewhere, so this phase books only debt service, enforcement, bank claims and tax phase-in for it (the primary slice is zeroed to avoid spending the same revenue twice).

### Fiscal-year rollover

The current engine uses one shared rollover boundary: turn 40 of each 48-turn year (`fiscalYearStartTurnInYear: 40` in each country's `institutionsFacts.ts`; `getSharedFiscalYearStartTurnInYear()` in `src/lib/countrySystems/fiscalCalendar.ts` refuses to run if any country's value differs). `processFiscalYear(db, newFiscalYear, currentTurn)` walks every valid national budget independently.

For each country it:

1. reads national and regional metrics;
2. recalculates inflation and refreshes stored economic factors;
3. derives national GDP from the sum of regional GDP when regional levels exist, with an annual-compounding fallback for unreconciled data;
4. smooths GDP for debt-to-GDP risk calculations;
5. recalculates national revenue and spending;
6. processes debt interest and rating state without duplicating the per-turn primary deficit;
7. applies any active sovereign-IMF austerity cap;
8. reconciles regional budgets using each region's GDP growth;
9. applies debt penalties and saves a fiscal-year snapshot;
10. evaluates the country's sovereign auction outcome.

One malformed budget is skipped and logged without aborting other countries.

## Revenue

`calculateFederalRevenue()` is the national revenue calculator despite its legacy name. It combines normalized tax rates, current tax bases, enacted-law revenue, tariffs, corporate and resource revenue, and country-specific sources. Money remains in the owning country's currency. Cross-country inputs are converted before they enter the budget.

`calculateStateRevenue()` performs the corresponding regional calculation. US states also receive the result of the formula-grant system. Other countries route central-to-regional transfers through enacted laws marked as grants, rather than through the US formula-grant pool.

## Spending

`calculateFederalSpending()` builds national spending from enacted laws, baseline categories, debt interest, and grants. `calculateStateSpending()` does the same for regional budgets. Historical absolute policy costs are era-scaled before totals are computed; GDP fractions and budget-percentage costs already scale with the live economy.

During an active sovereign IMF program, `applyAusterityCap()` proportionally reduces national spending categories, grants, and debt interest when total spending would exceed revenue.

## Debt and sovereign risk

`processAnnualDebt()` reconciles the annual debt view from the already-accrued fiscal position. Ratings use the current smoothed debt-to-GDP ratio against fixed bands. The stored sovereign-risk anchor is kept only as seed and migration provenance and does not rescale live risk. Investor confidence can add a borrowing premium. An active sovereign IMF facility caps the live debt rate at the program rate when that is cheaper.

Debt pressure can reduce GDP growth and public trust. The statutory debt-ceiling crisis is US-only. Sovereign auction evaluation runs for every processed country and feeds the separate failed-auction/default pipeline.

## Rules and constants

| Constant | Value | Source |
| --- | --- | --- |
| `TURNS_PER_YEAR` | 48 turns per game year; the per-turn slice is 1/48 | `src/lib/constants/calendar.ts` |
| `fiscalYearStartTurnInYear` | 40, the rollover turn (October) | `src/lib/countries/<id>/institutionsFacts.ts` |
| `DEBT_CEILING_RAISE_TRIGGER` | 0.95: the ceiling is raised at fiscal close when principal reaches 95% of it | `src/lib/budget/rules/debtCeilingRaise.ts` |
| `DEBT_CEILING_RAISE_HEADROOM` | 1.10: the new ceiling is 110% of principal | `src/lib/budget/rules/debtCeilingRaise.ts` |
| `DD_MIN_BORROWING_LIMIT_TO_GDP` | 0.4: East Germany's borrowing limit cannot fall below 40% of GDP | `src/lib/budget/borrowingLimit.ts` |
| `EXTREME_DISTRESS_DEBT_TO_GDP` | 2.5 (250%), the top of the B band | `src/lib/budget/debt.ts` |
| Income tier cut-offs | Low under 0.75 x state median income, Medium under 2 x median, High above | `src/lib/budget/rules/incomeTaxTiers.ts` |
| Income tier relative earnings | Low 0.5, Medium 1, High 2 (so High earns 4x Low in revenue weighting) | `src/lib/budget/rules/incomeTaxTiers.ts` |
| `DEFAULT_INCOME_POPULATION` | Low 30, Medium 50, High 20 | `src/lib/budget/rules/incomeTaxTiers.ts` |
| `LOOKBACK_TURNS` | 12: earnings window used to pick a player's tier | `src/lib/budget/playerIncomeTax.ts` |
| `DEBT_TO_GDP_MAX_PENALTY` | -5 (corporate margin points) | `src/lib/constants/corporations.ts` |
| `DEFICIT_MARGIN_BONUS_PER_PERCENT` / `DEFICIT_MARGIN_MAX_BONUS` | +0.5 margin points per 1% of GDP deficit, capped at +5 | `src/lib/constants/corporations.ts` |

### Credit ladder

`DEBT_THRESHOLDS` in `src/lib/budget/debt.ts`. The first band whose `maxRatio` is at or above the current smoothed debt-to-GDP ratio applies.

| Debt-to-GDP up to | Rating | Marginal interest rate | Corporate GDP drag | Public trust penalty at fiscal close |
| --- | --- | --- | --- | --- |
| 60% | AAA | 2.0% | 0 | 0 |
| 80% | AA | 2.5% | 0 | 0 |
| 100% | A | 3.5% | -0.1% | 0 |
| 120% | BBB | 5.0% | -0.2% | 0 |
| 150% | BB | 7.0% | -0.3% | -5 |
| 250% | B | 10.0% | -0.5% | -10 |
| above 250% | CCC | 14.0% | -0.7% | -15 |

The GDP drag is a corporate margin effect applied in the per-turn economy, not a write to the printed GDP metric. Trust penalties are applied by `applyDebtPenalties()` in `src/lib/budget/fiscalYear.ts`.

### Debt-to-GDP margin modifier

`getDebtToGdpMarginModifier()` in `src/lib/constants/corporations.ts` returns the corporate margin modifier for a country's debt ratio, in margin points:

- at or below 50%: 0
- 50% to 100%: -0.5 per 10 percentage points over 50 (so -2.5 at 100%)
- above 100%: -2.5 plus -1 per 10 percentage points over 100, floored at -5 (`DEBT_TO_GDP_MAX_PENALTY`)

### Surplus and debt ratio

```text
surplus = revenue - spending          (spending already includes debt interest)
debtToGdpRatio = totalPrincipal / GDP
```

## Worked example

A country has annual revenue of 1,200, primary spending (excluding debt interest) of 1,000, bond principal of 600 serviced at a blended 4% and no enforcement cost. Each turn:

- primary slice: (1,200 - 1,000) / 48 = +4.17
- debt service: 600 x 0.04 / 48 = 0.50
- treasury change: +3.67 per turn, about +176 over a 48-turn year

If its GDP is 800, debt-to-GDP is 75%, so it sits in the AA band (2.5% marginal rate, no drag, no trust penalty). If the same country carried 1,000 of debt on 800 GDP (125%), it would be BB: 7.0% marginal rate on new borrowing, -0.3% corporate GDP drag, -5 public trust at fiscal close, and a corporate margin modifier of -2.5 + -(25/10) = -5.0 (the floor).

## Timing

- `fiscalBaseGrowth` runs inside the state-effects phase group (`src/simulation/phases/stateEffectsPhase.ts`), after `nationalMetrics` (fresh growth rates) and before the trade-growth mirror and inflation recalculation, which read the factors it writes.
- `treasuryTurn` runs in the turn phase registry (`src/simulation/phases/turnPhaseRegistry.ts`) in parallel with `caucusTax`; the two touch disjoint state. It reads the revenue that `fiscalBaseGrowth` computed on the previous turn, so a tax-base change reaches cash one turn later.
- `bondTurn` runs after it in the same registry and owns bond issuance and principal.
- The `fiscalYearBoundary` step runs `processFiscalYear()` only when the turn in the year is 40; every other turn it is skipped.

## Edge cases and limits

- A country with a null treasury balance is initialised to 0 and logged; the bond stock is not touched.
- The accrual is claimed atomically per budget and turn: a budget already accrued for the turn is not accrued twice, and the claim retries up to three times before throwing.
- One malformed budget is skipped and logged without aborting other countries at rollover.
- CCC (14.0%) is the worst rating the type supports. A post-default repudiation also stamps CCC.
- Debt interest is already inside `spending.total`, so surplus does not subtract it again.
- The statutory debt ceiling crisis is US-only. It does not block bond issuance on its own; the real costs of high debt come from the credit ladder and the margin modifier. The ceiling is raised at fiscal close, not blocked.
- The austerity cap applies only while a sovereign IMF program is active, scales categories, grants and debt interest proportionally, and forces the planned deficit to zero.
- Corporate margin drag from deficits is positive (a stimulus), capped at +5, so a fiscal surplus does not earn a bonus.
- Regional revenue is reconciled only at fiscal-year rollover, not per turn. In the US, formula grants (Medicaid, Highway Trust Fund, Education Block Grants, SNAP) are paid at fiscal close; the UK and Japan route regional grants through enacted laws and recalculate them every turn.

## Connections

Driven by:

- [National Metrics](./national-metrics.md): `fiscalBaseGrowth` reads national and regional `gdpGrowth`, `wageGrowth` and `tradeGrowth` from `macroMetrics`.
- [Bills and Legislation](./bills-legislation.md): enacted laws add permanent revenue and spending entries read by `calculateFederalRevenue()` and `calculateFederalSpending()`; tax-rate bills feed `advanceTaxRatePhaseIn()`.
- [Sovereign Bonds](./sovereign-bonds.md): the bond ledger sets `debt.principal` and the coupon book used in `sovereignStockServiceRate()`.
- [IMF Sovereign Facility](./imf-sovereign-facility.md): an active program applies the austerity cap and the capped debt rate.
- Player earnings: income-tax assessments (`src/lib/budget/playerIncomeTax.ts`) fill the national and state treasuries.

Affects:

- [Economic Systems](./economic-systems.md): the debt ratio feeds `getDebtToGdpMarginModifier()` and the deficit feeds the deficit margin bonus in the corporate margin stack (`src/lib/turn/corporation/sectorTurn/marginStack.ts`).
- Public trust: `applyDebtPenalties()` lands the trust penalty on the political board at fiscal close.
- Sovereign default: the auction outcome at rollover feeds the failed-auction and default pipeline.
- Regional budgets (`stateBudgets`): reconciled with grants at rollover.
- Credit rating and borrowing cost: the new rating sets the marginal rate on the next issuance.

## Core collections

| Collection               | Role                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `federalBudget`          | One national budget per country, including tax bases, annual flows, treasury balance, debt, GDP, and ratings |
| `stateBudgets`           | Regional tax bases, revenue, spending, grants, and fiscal state                                              |
| `macroMetrics`           | National and regional growth and inflation inputs used by the fiscal phases                                  |
| `federalBudgetSnapshots` | Fiscal-year history                                                                                          |
| `sovereignBonds`         | Market debt instruments and scheduled issuance                                                               |

## Key implementation files

- `src/lib/turn/fiscalBaseGrowth.ts`, per-turn tax-base growth and national revenue refresh
- `src/lib/turn/treasuryTurn.ts`, per-turn primary balance, debt service, and derived fiscal state
- `src/lib/budget/fiscalYear.ts`, shared annual reconciliation
- `src/lib/budget/revenue.ts`, national and regional revenue
- `src/lib/budget/spending.ts`, national and regional spending
- `src/lib/budget/debt.ts`, rating, interest, and debt-ceiling logic
- `src/lib/budget/grants.ts`, US formula grants
- `src/lib/budget/inflation.ts`, country inflation calculation
- `src/lib/budget/treasuryBalance.ts`, signed-balance derivation helpers

## Related pages

- [Economic Systems](./economic-systems.md)
- [National Metrics](./national-metrics.md)
- [Bills and Legislation](./bills-legislation.md)
- [Turn Processing](./turn-processing.md)

Last checked: 2026-10-29, version 1.18.0
