# Budget Calculations

## Summary

Player guide: [National Budget](https://www.ahousedividedgame.com/wiki/national-budget)

This page describes the current fiscal calculation pipeline. `src/lib/budget/`, `src/lib/turn/fiscalBaseGrowth.ts`, and `src/lib/turn/treasuryTurn.ts` are authoritative when a formula changes. The database type still uses the historical names `FederalBudget` and `federalBudget`, but the same national pipeline processes every country budget.

Player-facing fiscal behavior is covered in [National Budget](./national-budget.md). Sovereign debt and crisis resolution are covered in [Sovereign Bonds](./sovereign-bonds.md) and [IMF Sovereign Facility](./imf-sovereign-facility.md).

Fiscal accounting is split between two cadences: per-turn accrual (tax-base growth and treasury cash) and the shared fiscal-year rollover (rating, interest, ceiling, regional reconciliation, snapshot).

## Rules

### Every turn: tax-base growth

`processFiscalBaseGrowth()` reads the latest national and regional metric rates, then applies one forty-eighth of each annual display rate to the relevant tax bases. National bases use national `gdpGrowth`, `wageGrowth`, and `tradeGrowth`; regional bases use their own regional rates. Inflation comes from the owning country's budget state. The metric fallbacks when a rate is missing or not finite are wage 3.0, trade 2.0 and inflation 2.5.

`growFederalBases()` in `src/lib/budget/revenue.ts` with `g(rate) = 1 + rate / 100 / 48`:

```text
ceiling             = gdpGrowth + max(0, inflation) + TAX_BASE_GROWTH_PREMIUM_CAP     (2.0 points)
taxableIncome       *= g(min(wageGrowth, ceiling))
wagesAndSalaries    *= g(min(wageGrowth, ceiling))
importValue         *= g(min(tradeGrowth, ceiling))
corporate profits   *= g(gdpGrowth + CAPITAL_RETURNS_PREMIUM)                         (1.0 point; domestic and foreign alike)
taxableSales        *= (g(gdpGrowth) + g(min(wageGrowth, ceiling))) / 2
```

After the rate growth, each base is pulled a fraction of the way back toward its baseline share of GDP: `base += (currentGdp * baselineShare - base) * (TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL / 48)`, with `TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL = 0.08` (about an 8 to 9 year half-life). The ceiling stops wage and trade bases outgrowing GDP without bound; the gravity closes an existing gap. A base with no recorded baseline share is not pulled.

After growing the national bases, the phase recomputes national revenue and the cached `surplus`. Regional revenue is reconciled at fiscal-year rollover.

### Every turn: treasury accrual

`processTreasuryTurn()` then moves one forty-eighth of the current primary balance into `treasuryBalance`, less live debt service and any enforcement cost:

```text
primaryPerTurn = (annualRevenue - annualPrimarySpending) / 48
annualPrimarySpending = spending.total - spending.debtInterest
debtServicePerTurn = stock * stockServiceRate / 48
nextTreasuryBalance = round(currentTreasuryBalance + primaryPerTurn - debtServicePerTurn - enforcementCost)
```

The result is rounded to a whole currency unit, and the rounding is recorded as its own component of the accrual receipt. `TURNS_PER_YEAR = 48` is in `src/lib/constants/calendar.ts` (re-exported by `turnTime.ts`).

`stockServiceRate` (`src/lib/budget/rules/sovereignDebtService.ts`) is blended. Outstanding sovereign bonds are serviced at the coupons they were issued with; any stock not yet represented by bonds is serviced at the current marginal rate:

```text
covered = min(stock, book.face)
rate    = (book.annualCoupon * covered / book.face + (stock - covered) * marginalRate) / stock
rate    = min(rate, IMF_SOVEREIGN_DEFAULT_RATE)   when an IMF program is active (0.06)
```

This stops a country's whole debt being repriced the turn its ratio crosses a rating band. The marginal rate is `sovereignDebtTerms().interestRate`, the ladder rate plus the confidence premium (below), with the ladder rate itself capped at 0.06 under an IMF program.

A positive treasury balance is cash. `treasuryBalance` and `debt.principal` are separate: principal belongs to the bond ledger (`src/lib/bonds/sovereignPrincipal.ts`) and always equals the sum of outstanding sovereign bonds, so a country can hold cash and bond debt at the same time. The annual rollover does not add the deficit a second time. Debt service is charged on bond principal, not on the sign of the cash balance, so savings earn nothing and a cash-rich borrower still pays coupons.

Enacted tax-rate changes also phase toward their targets in this phase (`advanceTaxRatePhaseIn()`): a rate moves at most `TAX_RATE_PHASE_IN_MAX_STEP_PP = 1` percentage point per turn (`src/lib/budget/taxRatePhaseIn.ts`) and a change of one point or less applies whole.

A country whose cabinet runs on the v2 reset system settles its revenue and department spending elsewhere, so this phase books only debt service, enforcement, bank claims and tax phase-in for it (the primary slice is zeroed to avoid spending the same revenue twice).

### Fiscal-year rollover

The current engine uses one shared rollover boundary: turn 40 of each 48-turn year (`fiscalYearStartTurnInYear: 40` in each country's `institutionsFacts.ts`; `getSharedFiscalYearStartTurnInYear()` in `src/lib/countrySystems/fiscalCalendar.ts` refuses to run if any country's value differs). `processFiscalYear(db, newFiscalYear, currentTurn)` walks every valid, registered national budget independently.

For each country it:

1. reads national and regional metrics;
2. recalculates inflation and refreshes stored economic factors;
3. derives national GDP from the sum of regional GDP when regional levels exist, with an annual-compounding fallback for unreconciled data;
4. smooths GDP for debt-to-GDP risk calculations (`GDP_SMOOTHING_INERTIA = 0.7`: `smoothed = 0.7 * previous + 0.3 * current`);
5. recalculates national revenue, pays out US formula grants, then runs `processAnnualDebt()` and builds national spending including the annual debt interest, without duplicating the per-turn primary deficit;
6. applies the financial-crisis austerity base if one is in force, otherwise any active sovereign-IMF austerity cap;
7. raises the statutory debt ceiling if due, then writes rate, ratio, rating, revenue, spending and surplus;
8. reconciles regional budgets using each region's GDP growth;
9. applies debt penalties (the trust hit);
10. after all countries, saves a fiscal-year snapshot per processed budget and evaluates each country's sovereign auction outcome.

One malformed budget is skipped and logged without aborting other countries.

### Revenue

`calculateFederalRevenue()` is the national revenue calculator despite its legacy name. It combines normalized tax rates, current tax bases, enacted-law revenue, tariffs, corporate and resource revenue, and country-specific sources. Money remains in the owning country's currency. Cross-country inputs are converted before they enter the budget.

`calculateStateRevenue()` performs the corresponding regional calculation. US states also receive the result of the formula-grant system. Other countries route central-to-regional transfers through enacted laws marked as grants (`isGrant`), rather than through the US formula-grant pool.

### Spending

`calculateFederalSpending()` builds national spending from enacted laws, baseline categories, debt interest, and grants. `calculateStateSpending()` does the same for regional budgets. Historical absolute policy costs are era-scaled before totals are computed; GDP fractions and budget-percentage costs already scale with the live economy.

During an active sovereign IMF program, `applyAusterityCap()` proportionally reduces national spending categories, grants, and debt interest when total spending would exceed revenue.

### Debt and sovereign risk

`processAnnualDebt()` reconciles the annual debt view from the already-accrued fiscal position. Ratings use the current smoothed debt-to-GDP ratio against fixed bands. The stored sovereign-risk anchor is kept only as seed and migration provenance and does not rescale live risk. An active sovereign IMF facility caps the live ladder rate at the program rate when that is cheaper.

Investor confidence adds a borrowing premium (`getSovereignConfidencePremium()`, `src/lib/budget/debt.ts`): zero at or above `INVESTOR_CONFIDENCE_BASELINE = 70`, rising linearly to `SOVEREIGN_CONFIDENCE_PREMIUM_MAX = 0.03` at confidence 0 (`src/lib/nationalization/constants.ts`): `premium = 0.03 * (70 - confidence) / 70`.

Debt pressure can reduce public trust at fiscal close, and the debt ratio feeds the corporate margin modifier. The statutory debt-ceiling crisis is US-only. Sovereign auction evaluation runs for every processed country and feeds the separate failed-auction/default pipeline.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `TURNS_PER_YEAR` | 48 turns per game year; the per-turn slice is 1/48 | `src/lib/constants/calendar.ts` |
| `fiscalYearStartTurnInYear` | 40, the rollover turn (October) | `src/lib/countries/<id>/institutionsFacts.ts` |
| `TAX_BASE_GROWTH_PREMIUM_CAP` | 2.0 points over nominal GDP growth | `src/lib/budget/revenue.ts` |
| `CAPITAL_RETURNS_PREMIUM` | 1.0 point over GDP growth for corporate profit bases | `src/lib/budget/revenue.ts` |
| `TAX_BASE_GDP_SHARE_GRAVITY_ANNUAL` | 0.08 | `src/lib/budget/revenue.ts` |
| `TAX_RATE_PHASE_IN_MAX_STEP_PP` | 1 point per turn | `src/lib/budget/taxRatePhaseIn.ts` |
| `GDP_SMOOTHING_INERTIA` | 0.7 | `src/lib/budget/fiscalYear.ts` |
| `IMF_SOVEREIGN_DEFAULT_RATE` | 0.06 | `src/lib/sovereignDefault/constants.ts` |
| `INVESTOR_CONFIDENCE_BASELINE` / `SOVEREIGN_CONFIDENCE_PREMIUM_MAX` | 70 / 0.03 | `src/lib/nationalization/constants.ts` |
| `DEBT_CEILING_RAISE_TRIGGER` | 0.95: the ceiling is raised at fiscal close when principal reaches 95% of it | `src/lib/budget/rules/debtCeilingRaise.ts` |
| `DEBT_CEILING_RAISE_HEADROOM` | 1.10: the new ceiling is `round(1.10 * principal)`, and only if that exceeds the current ceiling | `src/lib/budget/rules/debtCeilingRaise.ts` |
| `DD_MIN_BORROWING_LIMIT_TO_GDP` | 0.4: East Germany's borrowing limit cannot fall below 40% of GDP | `src/lib/budget/borrowingLimit.ts` |
| `EXTREME_DISTRESS_DEBT_TO_GDP` | 2.5 (250%), the top of the B band | `src/lib/budget/debt.ts` |
| Income tier cut-offs | Low under 0.75 x state median income, Medium (`middle` in code) under 2 x median, High above | `src/lib/budget/rules/incomeTaxTiers.ts` |
| Income tier relative earnings | Low 0.5, Medium 1, High 2 (so High earns 4x Low in revenue weighting) | `src/lib/budget/rules/incomeTaxTiers.ts` |
| `DEFAULT_INCOME_POPULATION` | Low 30, Medium 50, High 20 | `src/lib/budget/rules/incomeTaxTiers.ts` |
| `LOOKBACK_TURNS` | 12: earnings window used to pick a player's tier | `src/lib/budget/playerIncomeTax.ts` |
| `DEBT_TO_GDP_MAX_PENALTY` | -5 (corporate margin points) | `src/lib/constants/corporations.ts` |
| `DEFICIT_MARGIN_BONUS_PER_PERCENT` / `DEFICIT_MARGIN_MAX_BONUS` | +0.5 margin points per 1% of GDP deficit, capped at +5 | `src/lib/constants/corporations.ts` |

### Credit ladder

`DEBT_THRESHOLDS` in `src/lib/budget/debt.ts`. The first band whose `maxRatio` is at or above the current smoothed debt-to-GDP ratio applies.

| Debt-to-GDP up to | Rating | Marginal interest rate | `gdpPenalty` field | Public trust penalty at fiscal close |
| --- | --- | --- | --- | --- |
| 60% | AAA | 2.0% | 0 | 0 |
| 80% | AA | 2.5% | 0 | 0 |
| 100% | A | 3.5% | 0.1 | 0 |
| 120% | BBB | 5.0% | 0.2 | 0 |
| 150% | BB | 7.0% | 0.3 | -5 |
| 250% | B | 10.0% | 0.5 | -10 |
| above 250% | CCC | 14.0% | 0.7 | -15 |

The `gdpPenalty` field is not applied to any GDP or margin value. `applyDebtPenalties()` in `src/lib/budget/fiscalYear.ts` only logs it; the field is read by NPP fiscal-stance logic (`src/lib/nppAutonomy/fiscalStance.ts`, `governingAgenda.ts`) to gauge debt distress. The real corporate effect of debt is the separate margin modifier below. The trust penalty is applied by `applyDebtPenalties()` through `applyLegacyTrustDelta()` onto the political board.

### Debt-to-GDP margin modifier

`getDebtToGdpMarginModifier()` in `src/lib/constants/corporations.ts` returns the corporate margin modifier for a country's debt ratio, in margin points:

- at or below 50%: 0
- 50% to 100%: -0.5 per 10 percentage points over 50 (so -2.5 at 100%)
- above 100%: -2.5 plus -1 per 10 percentage points over 100, floored at -5 (`DEBT_TO_GDP_MAX_PENALTY`)

`getDeficitToGdpMarginModifier()` in the same file is the mirror for deficits: `min(deficitPct * 0.5, 5)`, and 0 for a surplus.

### Surplus and debt ratio

```text
surplus = revenue - spending          (spending already includes debt interest)
debtToGdpRatio = totalPrincipal / smoothed GDP
```

## Data

| Collection | Read | Written | Player-visible |
| --- | --- | --- | --- |
| `federalBudget` | `taxBases`, `taxRates`, `taxRatePhaseIn`, `incomeTaxShares`, `revenue`, `spending`, `debt.principal`, `debt.ceiling`, `gdp`, `gdpSmoothed`, `investorConfidence`, `imfSovereignBailoutActive`, `unionsBanned`, `unionEnforcementPosture`, `treasuryBalance` | `taxBases`, `taxBaseGdpShareBaseline`, `otherRevenueGdpShareBaseline`, `economicFactors.*`, `revenue`, `surplus` (per turn); `treasuryBalance`, `treasuryAccrual`, `bankSovereignClaims`, `taxRates.*` (per turn); `fiscalYear`, `spending`, `gdp`, `gdpSmoothed`, `debt.interestRate`, `debt.ceiling`, `debt.ceilingLastRaisedYear`, `debtToGdpRatio`, `creditRating`, `surplus` (rollover) | Revenue, spending, surplus, debt, rating and ratio on the Budget page |
| `stateBudgets` | Regional tax bases and grants | Regional bases, revenue, spending at rollover | Yes, per state |
| `macroMetrics` | National and regional `gdpGrowth`, `wageGrowth`, `tradeGrowth` | None here | Yes, as metrics |
| `federalBudgetSnapshots` | None | One frozen snapshot per budget and fiscal year (upsert) | Year-on-year comparisons |
| `bonds` | Outstanding sovereign bonds (coupon book) | None here (bond phase owns it) | See Sovereign Bonds |
| `gameState` | Reset-version flags; the `debt_ceiling_crisis` document | The crisis document (US) | Not directly |
| `exchangeRates`, `centralBanks` | Anchor valuation of the receipt; self-heal of missing budgets | None | No |

Bond principal is never written by this system. Trust penalties land on the political board, not on the budget document.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `fiscalYearStartTurnInYear` | 40 in every country definition; must be identical across countries | `src/lib/countries/<id>/institutionsFacts.ts` |
| `gameConfig.treasuryCashLedgerEnabled` | Off; when on, sovereign coupons are funded from payer cash and receipts are journaled | `gameConfig` default document; type in `src/lib/db/types/gameConfig.ts` |
| `gameConfig.privateBankingEnabled` | Off; when on, bank-held coupon cash is reserved from the accrual | same |
| `gameConfig.ledgerShadow` | Off; when on, every receipt needs a priced anchor rate or the phase throws | same |
| `gameConfig.interstateMoneyWiringEnabled` | Off; feeds sourced-import tariff anchors into rollover revenue | same |
| `gameState.regionalLegislationFinanceEnabled` | Off; enables department regional grant pools for the US at rollover | `gameState` current document |
| `gameState` reset system versions (cabinet `v2`) | Per country, resolved by `resetSystemVersionsForCountry()` | `src/lib/resetVersions/rules.ts` |
| Debt ladder, margin curves, caps | Compiled constants listed above | Not configurable at runtime |
| Seed budgets, ceiling (about 10% above opening debt) and tax baselines | Authored per country and era preset | `src/lib/seeds/reference/budgets.ts` |

Era and country variants: Cabinet-v2 countries skip the primary slice; the US alone gets formula grants and the debt-ceiling crisis; East Germany (`DD`) has the borrowing-limit floor.

## Timing

- `fiscalBaseGrowth` runs inside the state-effects phase group (`src/simulation/phases/stateEffectsPhase.ts`), after `nationalMetrics` (fresh growth rates) and before the trade-growth mirror and inflation recalculation, which read the factors it writes.
- `treasuryTurn` runs in the turn phase registry (`src/simulation/phases/turnPhaseRegistry.ts`) in parallel with `caucusTax`; the two touch disjoint state. It reads the revenue that `fiscalBaseGrowth` computed on the previous turn, so a tax-base change reaches cash one turn later.
- `bondTurn` runs after it in the same registry and owns bond issuance and principal.
- The `fiscalYearBoundary` step runs `processFiscalYear()` only when the turn in the year is 40; every other turn it is skipped.
- The end-of-turn budget invariant check (`reconcileFederalBudgetInvariants()`, called from `src/lib/turnSystem.ts`) runs after all of the above.

```text
nationalMetrics (fresh rates)
   -> fiscalBaseGrowth: grow bases 1/48, recompute revenue and surplus
   -> treasuryTurn (with caucusTax): cash += (revenue - primary spending - debt service - enforcement) / 48
   -> bondTurn: issuance, maturity, principal
   -> [turn 40 only] fiscalYearBoundary: rating, interest, ceiling, regional, trust hit, snapshot, auction
   -> end of turn: budget invariants
```

## Worked trace

A country has annual revenue of 1,200, primary spending (excluding debt interest) of 1,000, no enforcement cost, GDP 800 (smoothed 786), investor confidence 55, a statutory ceiling of 620, opening cash of 5,000 and bond principal of 600. Its bond book is 500 face carrying 16 a year in coupons (3.2%).

**Per turn (treasury accrual):**

1. Debt-to-GDP: 600 / 786 = 76.3%, so the ladder band is AA, marginal 2.5%. Premium: `0.03 * (70 - 55) / 70 = 0.00643`, so the marginal rate used is 3.14%.
2. Blended service: covered = min(600, 500) = 500, coupons 16, uncovered 100 at the marginal rate 0.03143 = 3.14. Annual service = 19.14, per turn 19.14 / 48 = 0.3988. (The premium is included because `sovereignDebtTerms()` adds it.)
3. Primary slice: (1,200 - 1,000) / 48 = 4.1667.
4. Raw cash change: 4.1667 - 0.3988 = +3.7679; `round(5,000 + 3.7679) = 5,004`, so `cashDelta = +4` and the rounding component is +0.2321. The receipt components are revenue 25.00, primary spending -20.8333, debt service -0.3988, enforcement 0, rounding 0.2321, summing to 4.

Over a 48-turn year this is about +181 before any change in revenue or the stock.

**At fiscal close (turn 40):**

5. Smoothed GDP: previous 780, new 800: `0.7 * 780 + 0.3 * 800 = 786`. Ratio 76.3%: AA, trust penalty 0.
6. `processAnnualDebt()`: interest payment = annual service on the stock, 19.14, which becomes `spending.debtInterest`. Stored `debt.interestRate = 0.025 + 0.00643 = 0.03143`.
7. Ceiling check: 600 >= 0.95 * 620 = 589, so the raise applies: `round(600 * 1.10) = 660 > 620`, new ceiling 660.

If the same country carried 1,000 of debt on 800 GDP (125%) it would be BB: 7.0% marginal rate on new borrowing, -5 public trust at fiscal close, and a corporate margin modifier of -2.5 + -(25/10) = -5.0 (the floor).

**Tax-base growth (one turn):** taxable income base 1,000, wage growth 4.8%, GDP growth 2%, inflation 2%, current GDP 2,000 with a baseline share of 0.5. Ceiling = 2 + 2 + 2 = 6, so wages are uncapped at 4.8. `g = 1 + 4.8 / 100 / 48 = 1.001`, giving 1,001. Gravity: target = 2,000 * 0.5 = 1,000; pull = 0.08 / 48 = 0.001667; result = 1,001 + (1,000 - 1,001) * 0.001667 = 1,000.998.

## Edge cases and limits

- A country with a null treasury balance is initialised to 0 and logged; the bond stock is not touched.
- The accrual is claimed atomically per budget and turn: a budget already accrued for the turn is not accrued twice, and the claim retries up to three times before throwing.
- Dissolved countries keep a budget document but are skipped by tax-base growth, the accrual (unless they still owe stored coupon claims) and the rollover.
- One malformed budget (missing tax rates or debt) is skipped and logged without aborting other countries at rollover.
- CCC (14.0%) is the worst rating the type supports. A post-default repudiation also stamps CCC.
- Debt interest is already inside `spending.total`, so surplus does not subtract it again.
- The statutory debt ceiling crisis is US-only. It does not block bond issuance on its own; the real costs of high debt come from the credit ladder and the margin modifier. The ceiling is raised at fiscal close, not blocked, for every country; only the US crisis flag is cleared by the raise.
- The austerity cap applies only while a sovereign IMF program is active, scales categories, grants and debt interest proportionally, and forces the planned deficit to zero. A financial-crisis austerity window takes precedence over it.
- Corporate margin drag from deficits is positive (a stimulus), capped at +5, so a fiscal surplus does not earn a bonus.
- A tax-rate change of one point or less applies whole; a larger one ramps at one point per turn and does not skip or delay the start.
- Regional revenue is reconciled only at fiscal-year rollover, not per turn. In the US, formula grants (Medicaid, Highway Trust Fund, Education Block Grants, SNAP) are paid at fiscal close; countries with `isGrant` laws (the UK and Japan are the documented examples) route regional grants through enacted laws and recalculate them every turn.
- `sovereignDebtTerms()` returns a ratio of 0 when GDP is not positive. The base-growth phase refuses to propagate a non-finite inflation reading and substitutes 2.5.

## Invariants

- `surplus = revenue.total - spending.total`. Enforced by `reconcileFederalBudgetInvariants()` at turn end (`src/lib/budget/budgetInvariants.ts`, 1 unit tolerance), which writes a drifted cache back; tested in `budgetInvariants.test.ts`.
- `debt.principal` equals the haircut-adjusted outstanding sovereign bond face. Checked by the same pass and never derived from `treasuryBalance`; tested in `budgetInvariants.test.ts` ("cash cannot overwrite the bond stock").
- A budget is accrued at most once per turn: the claim filters on `treasuryAccrual.turn < turn`; tested in `src/lib/turn/treasuryTurn.test.ts`.
- Every `federalBudget` carries a signed `treasuryBalance`; a null is healed to zero, never to the bond stock. Tested ("heals a null treasuryBalance to zero").
- Receipt components sum to `cashDelta` including the rounding component. Not covered by a dedicated unit test of the sum.
- Tax rates never move more than one point per turn: `taxRatePhaseIn.test.ts`.
- Rollover calendars match across countries: enforced at startup by `getSharedFiscalYearStartTurnInYear()`.

## Failure and recovery

- **Stale cached surplus.** Interleaved writers can leave `surplus` out of date mid-turn. The end-of-turn reconcile corrects it; a persistent mismatch indicates a writer that skips `federalSurplus()`.
- **Principal drift.** If stored `debt.principal` disagrees with the bond ledger, the invariant pass reports the budget. Repair is a data heal that re-derives principal from the bond ledger, not from cash.
- **Missing budget.** A country with a central bank but no `federalBudget` document would never accrue; `ensureFederalBudget()` self-heals it at the start of the treasury phase.
- **NaN tax bases.** A non-finite growth rate would poison every base, revenue, cash and rating. The base-growth phase guards each rate, and `sanitizeStateTaxBases` cleans regional bases.
- **Failed accrual claim.** If four attempts cannot claim the cash write, the phase throws for that budget and the turn reports the phase error. A rerun of the phase is safe because the per-turn claim makes it idempotent.
- **Missing FX anchor.** With the ledger shadow on, a missing anchor rate aborts the whole cohort before any cash accrues, so no country advances partially.
- **Missed rollover.** If the turn 40 step fails for one country, the others are unaffected; the snapshot is an upsert so a retry overwrites rather than duplicates.

## Connections

Driven by:

- [National Metrics](./national-metrics.md): `fiscalBaseGrowth` reads national and regional `gdpGrowth`, `wageGrowth` and `tradeGrowth` from `macroMetrics`.
- [Bills and Legislation](./bills-legislation.md): enacted laws add permanent revenue and spending entries read by `calculateFederalRevenue()` and `calculateFederalSpending()`; tax-rate bills feed `advanceTaxRatePhaseIn()`.
- [Sovereign Bonds](./sovereign-bonds.md): the bond ledger sets `debt.principal` and the coupon book used in `sovereignStockServiceRate()`.
- [IMF Sovereign Facility](./imf-sovereign-facility.md): an active program applies the austerity cap and the capped debt rate.
- Player earnings: income-tax assessments (`src/lib/budget/playerIncomeTax.ts`) fill the national and state treasuries.
- Union enforcement: `enforcementTreasuryCostPerTurn()` (`src/lib/unions/enforcementCosts.ts`) is charged in the accrual.

Affects:

- [Economic Systems](./economic-systems.md): the debt ratio feeds `getDebtToGdpMarginModifier()` and the deficit feeds the deficit margin bonus in the corporate margin stack (`src/lib/turn/corporation/sectorTurn/marginStack.ts`).
- Public trust: `applyDebtPenalties()` lands the trust penalty on the political board at fiscal close.
- Sovereign default: the auction outcome at rollover feeds the failed-auction and default pipeline.
- Regional budgets (`stateBudgets`): reconciled with grants at rollover.
- Credit rating and borrowing cost: the new rating sets the marginal rate on the next issuance.
- NPP governments: the ladder `gdpPenalty` value scales their fiscal-stance distress score.

Related pages: [Economic Systems](./economic-systems.md), [National Metrics](./national-metrics.md), [Bills and Legislation](./bills-legislation.md), [Turn Processing](./turn-processing.md).

Key implementation files:

- `src/lib/turn/fiscalBaseGrowth.ts`, per-turn tax-base growth and national revenue refresh
- `src/lib/turn/treasuryTurn.ts`, per-turn primary balance, debt service, and derived fiscal state
- `src/lib/budget/fiscalYear.ts`, shared annual reconciliation
- `src/lib/budget/revenue.ts`, national and regional revenue
- `src/lib/budget/spending.ts`, national and regional spending
- `src/lib/budget/debt.ts`, rating, interest, and debt-ceiling logic
- `src/lib/budget/grants.ts`, US formula grants
- `src/lib/budget/inflation.ts`, country inflation calculation
- `src/lib/budget/treasuryBalance.ts`, signed-balance derivation helpers (legacy; stored principal and ratios no longer come from here)

## Tests

- `src/lib/turn/treasuryTurn.test.ts`, `treasuryTurn.ledger.integration.test.ts`: accrual, null heal, v2 skip, enforcement, dissolved countries.
- `src/lib/turn/fiscalBaseGrowth.test.ts`, `fiscalBaseGrowthSurplus.test.ts`: per-turn growth, regional fallback, revenue recompute.
- `src/lib/budget/fiscalYear.test.ts`: rollover.
- `src/lib/budget/debt.test.ts`, `confidencePremium.test.ts`, `borrowingLimit.test.ts`: ladder, premium, East Germany floor.
- `src/lib/budget/rules/sovereignDebtService.test.ts`, `debtCeilingRaise.test.ts`, `incomeTaxTiers.test.ts`.
- `src/lib/budget/budgetInvariants.test.ts`, `taxRatePhaseIn.test.ts`, `taxBaseGrowthPremiumCap.test.ts`, `revenue.test.ts`, `spending.test.ts`, `playerIncomeTax.test.ts`.
- `src/simulation/phases/turnPhaseRegistry.test.ts`: `treasuryTurn` and `caucusTax` ordering.

Gaps: no unit test for the receipt components summing to `cashDelta`, and none for the full ten-step rollover order end to end.

## Known issues and history

- The ladder's `gdpPenalty` column is stored and logged but not applied to any GDP or margin value; only the separate debt margin modifier affects corporations. The earlier version of this page described it as a corporate margin effect. The player wiki table correctly omits the column.
- The comment above `getDebtToGdpMarginModifier()` says "capped at -15%"; the code floors at -5 (`DEBT_TO_GDP_MAX_PENALTY`). The code and the player wiki agree on -5.
- The player wiki says regional budgets recalculate every turn in the UK, Japan and Germany. Code does this for any country with `isGrant` laws; Germany has none in `src/lib/countries`, so that claim is unverified.
- History recorded in code comments: debt service moved from the whole stock at the ladder rate to coupons plus marginal on uncovered stock (issue #2089), so a high-debt seed no longer spirals into CCC on a rating-band crossing; `debt.principal` stopped being re-derived from cash (#1975); a tax-rate ramp was added after a single-turn five-point step caused a recession (#1102).
- `ceilingExceeded` is computed by `processAnnualDebt()` but nothing in the rollover acts on it; the ceiling only moves through the raise rule.

Last checked: 2026-10-29, version 1.18.0
