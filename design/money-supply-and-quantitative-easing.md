# Money Supply and Quantitative Easing

This page covers the money-supply aggregates (M1/M2), open market operations (QE/QT), the NPP autonomous monetary-operations policy, and how all of it feeds back into inflation. It is a companion to [Monetary System (as shipped)](./monetary-system-as-shipped.md), which covers the prime rate, FOMC, forex and lines of credit; those systems are not repeated here except where they interact directly with money supply. The whole feature is gated behind `gameConfig.moneySupplyEnabled` (`isMoneySupplyEnabledFromConfig` in `src/lib/moneySupply/featureFlag.ts`): every entry point below is a no-op when the flag is off.

## M1 and M2

`calculateMoneyAggregates` in `src/lib/moneySupply/rules/calculate.ts` sums per-currency components into two aggregates. Every component is normalized to zero first if it is negative or non-finite (`money()`).

- **M1** = householdLiquid + campaignLiquid + nppLiquid + corporateLiquid + partyLiquid + governmentLiquid + fundLiquid + organizationLiquid.
- **M2** = M1 + householdSavings + externalBroadMoney + bankDeposits.
- **Bank reserves** (`bankReserves`) and **credit outstanding** are tracked and reported for diagnostics only. They are never folded into M1 or M2, to avoid double counting base money against deposits.

### Where each component comes from

`snapshotMoneySupply` in `src/lib/moneySupply/snapshot.ts` is the single place that walks every collection and buckets balances by currency:

| Component | Source |
| --- | --- |
| `householdLiquid` / `householdSavings` | `characters.currencyBalances.personal` / `.savings` (or legacy `cashOnHand`/`savingsOnHand`), plus a demographic estimate for the unplayed population (below) |
| `campaignLiquid` | `characters.currencyBalances.campaign` (or legacy `character.funds`) |
| `nppLiquid` | `npps.funds`, `npps.currencyBalances.personal`, and `npps.nppInvestmentCashAnchor` (booked in USD) |
| `corporateLiquid` | `corporations.liquidCapital`, keyed by the corp's `liquidCurrencyCode` |
| `partyLiquid` | `politicalParties.treasury` |
| `governmentLiquid` | Funded Treasury cash (`federalBudget.treasuryCashLocal`) when the treasury cash ledger is enabled, otherwise `max(0, federalBudget.treasuryBalance)` (see below) |
| `fundLiquid` | `indexFunds.cashAnchor`, converted from the internal anchor through the live exchange-rate table |
| `organizationLiquid` | `organizationFunds.balanceLocal` (already native) |
| `bankDeposits` / part of `creditOutstanding` | chartered private banks: `corporations.bankCharter.totalDeposits` / `.totalLoans` |
| `creditOutstanding` (player leg) | `characters.lineOfCredit.balances` + `.arrears` |
| `externalBroadMoney` | `centralBanks.externalBroadMoney`, passed through `effectiveExternalBroadMoney` |
| `bankReserves` | `centralBanks.reserveBalance` (diagnostic only) |
| `sovereignBondsOutstanding` / `centralBankBondHoldings` | `bonds.totalIssued` / `bonds.centralBankHoldings × BOND_UNIT_FACE_VALUE` |

**Government liquid is deliberately one-sided.** `governmentLiquidFromSpendableCash` (funded Treasury cash) and `governmentLiquidFromTreasury` in `src/lib/moneySupply/rules/assemble.ts` take `max(0, value)`. For the signed balance this is because `federalBudget.treasuryBalance` is signed: positive is surplus cash, negative is `-debt.principal`. Taking the absolute value would count national debt as government deposits; an indebted treasury contributes 0 to M1 instead.

### Household money for the unplayed population

`addHouseholdMoneyFromDemography` derives a household money stock from population and median income, because the `characters` collection only ever holds players and an NPP-run world has none. Constants in `src/lib/moneySupply/rules/assemble.ts`:

- `PERSONS_PER_HOUSEHOLD = 3.2`
- `HOUSEHOLD_LIQUID_RATIO = 0.15` (roughly two months of gross annual household income held as transaction balances)
- `HOUSEHOLD_SAVINGS_RATIO = 0.6` (a bit over half a year's income as time/savings deposits)

For each state with population, `households = population / 3.2`, `annualIncome = households × medianIncome`, and the two ratios split that into liquid and savings. Income is read per state where available (`macroMetrics`), falling back to the country's national-scope doc. The code comments state this is order-of-magnitude, not a precisely calibrated national-accounts series: a 1953 US check (Census median household income ≈ $3,900, population ≈ 158M) recovers about 60% of the seeded M2 stock from households alone, with corporates and the stored external deposits covering the rest.

### External broad money

`externalBroadMoney` on each central bank is the seed-time stand-in for the entire broad-money stock, calibrated as `gdp × broadMoneyToGdpRatio(preset, countryId)` (`seedMoneySupplyBaselines` in `src/lib/moneySupply/seed.ts`). `effectiveExternalBroadMoney` in `src/lib/moneySupply/rules/assemble.ts` now counts the stored external deposits at face value:

```
effective = max(0, externalBroadMoney)
```

The earlier scaling of the seed by an unmodeled external share, with `netMoneyCreatedLifetime` added on top, no longer exists.

### Growth rate

`annualizedMoneyGrowthPct` in `src/lib/moneySupply/rules/calculate.ts` annualizes geometrically: `(closing / opening) ** (TURNS_PER_YEAR / turnsElapsed) - 1`. It returns `null`, not `0`, whenever `opening <= 0`, `closing <= 0`, or `turnsElapsed < MIN_MONEY_GROWTH_BASE_TURNS = 12` (a game quarter). Annualizing a two-turn bootstrap rebase raises the ratio to the 24th power and produces a meaningless number; `null` lets downstream consumers fall back to GDP growth instead of reading a false "money supply is frozen."

## Snapshots: when and how they are written

`snapshotMoneySupply(db, turn)` is registered as the `moneySupplySnapshot` turn phase in `src/simulation/phases/turnPhaseRegistry.ts`, running once per turn after every value-affecting phase (immediately after index funds). It also runs on demand from `seedForex.ts` at world setup (turn 0) and from the monetary-operation API route after every manual action.

For each currency with a central bank, it writes one `moneySupplySnapshots` document (`_id: "{turn}:{currencyCode}"`, upserted) via `writeSnapshot`, computing `annualizedM2GrowthPct` against the prior snapshot at or before `turn - 12`. Countries without a central bank (Warsaw Pact / non-aligned command economies excluded from forex) still accumulate real money-supply components, household demography, government treasury balance, NPP/party liquid, keyed by their own currency, so a second pass over `federalBudget` writes a synthetic snapshot (`bankId = countryId`, `netMoneyCreatedLifetime: 0`) for any currency not already covered by a bank. Without this pass those currencies would silently get zero snapshot rows forever, the same bug class previously found and fixed in `inflationRecalc.ts`'s "unbanked" handling.

## Open market operations: QE and QT

`planOpenMarketOperation` in `src/lib/moneySupply/quantitativeEasing.ts` is the pure planning function. Given a requested unit count, it:

1. Clamps requested units to what is actually available: **QE** is bounded by the sovereign bond's `publicFloat` (units the central bank can buy off the market), **QT** by `centralBankHoldings` (units it can sell back).
2. Prices the consideration at `units × BOND_UNIT_FACE_VALUE × max(0.01, marketPrice)`.
3. Reports `moneySupplyDelta`: positive (money created) for QE, negative (money withdrawn) for QT, this is the consideration amount, signed.
4. Computes `qeSupportRatio = min(1, max(0, centralBankHoldings / totalUnits))`, i.e. what fraction of the bond's total issued units the central bank now holds.

**Price support.** `applyQePriceSupport(rateDerivedPrice, qeSupportRatio)` layers a persistent demand-support premium on top of the bond's ordinary rate-derived price: `support = min(0.2, qeSupportRatio * 0.5)`, capping the boost at 20% when the bank holds all of a bond's units, and the final price is clamped to `[0.05, 2]`. In `executeMonetaryOperation` (`src/lib/moneySupply/operations.ts`) the actual price move applied on execution uses the *change* in support ratio rather than the full ratio: `marketPrice = clamp(bond.marketPrice * (1 + supportDelta * 0.5), 0.05, 2)`, so buying more support pushes price up incrementally rather than resetting it to the full support level every operation.

### Execution: `executeMonetaryOperation`

`src/lib/moneySupply/operations.ts` handles all four `MonetaryOperationType` values (`"qe" | "qt" | "treasury_advance" | "liquidity_injection"`, `MonetaryPolicyDecision` adds `"hold"`; both types in `src/lib/db/types/moneySupply.ts`).

**QE/QT** requires a specific eligible sovereign bond (`issuerType: "sovereign"`, same country, not matured, not defaulted). QT is additionally blocked if the consideration would retire more than the bank's own `externalBroadMoney` (`"QT would retire more external deposits than remain"`). The bond's `publicFloat`, `centralBankHoldings`, `qeSupportRatio` and `marketPrice` are updated, and the bank record gets `$inc`'d on `externalBroadMoney` and `netMoneyCreatedLifetime` by `moneySupplyDelta`.

**Treasury advance** adds `amount` directly to `federalBudget.treasuryBalance` via an optimistic-concurrency `updateOne` (retries the whole operation if the budget changed concurrently), recomputes debt/interest/credit-rating fields through `deriveFiscalState`, and books `moneySupplyDelta = amount` (a treasury advance is unambiguous money creation, no offsetting bond sale).

**Liquidity injection** tries `advanceToPrivateBanks` first: if `isPrivateBankingEnabled()` and any chartered bank exists in this currency, the amount is distributed pro-rata by `bankCharter.totalDeposits` (equal split if no bank holds deposits), landing in each bank's `liquidCapital` and booked as `bankCharter.cbMarginDebt` (so it is a loan, not free money, it repays through the existing margin-repay path). If no chartered bank exists to take it, the operation falls back to the historical behavior: it buffers the central bank's own `reserveBalance` with `moneySupplyDelta: 0`, a genuine no-op for M2 in that case.

### Turn-order caps and cooldowns

From `src/lib/moneySupply/operations.ts`:

- `MONETARY_OPERATION_COOLDOWN_TURNS = 6`
- `DIRECT_ADVANCE_GDP_CAP = 0.01` (treasury advance capped at 1% of GDP per action for a manual player request)
- `LIQUIDITY_INJECTION_GDP_CAP = 0.03` (liquidity injection capped at 3% of GDP)

## Player and manual action: the monetary-operation API

`POST /api/country/[code]/central-bank/monetary-operation` (`src/app/api/country/[code]/central-bank/monetary-operation/route.ts`) is the human-facing entry point, surfaced in the central bank page's Money Supply tab (`src/app/centralbank/[currency]/components/CentralBankMoneySupplyTab.tsx`). It:

1. Rejects with 409 if `moneySupplyEnabled` is off.
2. Requires the bank and country's federal budget to exist (404 otherwise).
3. Authorizes: admins bypass everything; otherwise the caller must be the bank's seated chair (`bank.chairCharacterId`) and `chairControlsLocked` must not be set, else 403.
4. Enforces `MONETARY_OPERATION_COOLDOWN_TURNS` against `bank.lastMonetaryOperationTurn` for non-admins (409 on cooldown).
5. For `treasury_advance` / `liquidity_injection`, enforces the GDP caps above for non-admins (400 with the numeric cap on violation).
6. Calls `executeMonetaryOperation`, then `snapshotMoneySupply(db, turn)` so the UI sees an up-to-date aggregate immediately rather than waiting for the next turn's phase.

## Autonomous (NPP) monetary policy

`chooseNppMonetaryOperation` in `src/lib/moneySupply/nppPolicy.ts` is the pure decision function an autonomous (NPP-chaired) central bank uses each cycle. Inputs: current inflation, target inflation, GDP growth, annualized M2 growth (only trusted when `moneyGrowthReliable`, i.e. the snapshot window has reached 12 turns, otherwise `excessMoneyGrowth` is forced to 0), public float, bond holdings, bank reserves, GDP, and treasury balance. Decision order:

1. **Treasury advance** if `inflationGap ≤ -3pp` (deep deflation), `gdpGrowth ≤ -3%`, and `treasuryBalance ≤ -0.5 × GDP` (acute fiscal stress), `amount = max(1, floor(gdp × 0.001))`.
2. **QT** if `inflationGap > 1pp` OR `excessMoneyGrowth > 6pp`, and the bank holds bond units to sell, `units = max(1, floor(holdings × 0.1))`.
3. **Hold** (explicitly, with a rationale noting rate policy must do the work) if the same tightening condition fires but the bank holds no bonds.
4. **QE** if `inflationGap < -0.5pp` and `gdpGrowth < 1.5%` and there is public float to buy, `units = max(1, floor(publicFloat × 0.01))`.
5. **Liquidity injection** if `gdpGrowth < 0`, `inflationGap ≤ 0`, and `bankReserves < GDP × 0.005` (thin lending reserves), `amount = max(1, floor(gdp × 0.0025))`.
6. **Hold** otherwise (the default, no action needed).

`inflationGap = inflation - targetInflation`; `excessMoneyGrowth = annualizedM2GrowthPct - gdpGrowth` when reliable, else 0.

### Turn wiring: `processNppMonetaryOperations`

Runs as the `nppMonetaryOperations` phase in `src/simulation/phases/stateEffectsPhase.ts`, after `centralBankChairTurn` and `fomcMeetings`, before `centralBankChairExecutiveRemoval`. For every bank with `chairMode: "npp"` and `chairControlsLocked` not true:

- Skips if `turn - bank.lastMonetaryOperationTurn < MONETARY_OPERATION_COOLDOWN_TURNS` (6 turns).
- Pulls the country's federal budget, the most recent eligible sovereign bond (has public float or CB holdings, sorted latest maturity first), and the latest money-supply snapshot for the currency.
- Feeds `chooseNppMonetaryOperation`, then (if not a hold) calls `executeMonetaryOperation` with `actorName: "{bankId} Monetary Committee"`.
- Always writes `centralBanks.lastMonetaryPolicyEvaluation` (the full decision, rationale, and inputs) regardless of whether an operation executed, so every cycle's reasoning is visible even on a hold.

## Feedback into inflation

Money-supply growth is one of thirteen additive pressure terms in `calculateInflationWithBreakdown` (`src/lib/budget/inflation.ts`). `inflationRecalc.ts` (`src/lib/turn/inflationRecalc.ts`) reads the latest `moneySupplySnapshots` row per currency (`turn < currentTurn`, most recent) into `moneyGrowthByCurrency`, then passes `moneySupplyGrowthPct = finiteOr(moneyGrowthByCurrency.get(currencyCode), gdpGrowth)` into the inflation calc, a `null` growth reading (window too short) falls back to GDP growth, i.e. a zero monetary impulse, rather than asserting the money supply is frozen.

Inside `calculateInflationWithBreakdown`:

```
moneySupply = clamp(-1.5, 2.5, (moneySupplyGrowthPct - gdpGrowth) * moneyGrowthCoeff)
```

The coefficient is era dependent: 0.08 while pegged (`PEGGED_MONEY_GROWTH_COEFF` in `src/lib/budget/inflation.ts`) and 0.15 after the Bretton Woods exit (`BW_POST_EXIT_MONEY_COEFF` in `src/lib/monetary/brettonWoods.ts`).

Excess M2 growth over real GDP growth contributes up to +2.5pp of inflation; a money supply contracting faster than GDP contributes down to -1.5pp. This term is one addend among unemployment (Phillips curve), the prime-rate gap (`monetary`, a *separate* term from expected-inflation channel, not to be confused with this money-supply term), fiscal deficit, tariffs, wages, commodities, forex, savings flow, housing, and discretionary policy stance, all summed into `rawInflation`, then smoothed with inertia and pulled toward target by mean reversion. Money supply is a real but bounded driver, not the dominant one: its ±pp cap (-1.5 to +2.5) is comparable in size to several of the other cost-push terms, not larger.

## Key Files

- `src/lib/moneySupply/rules/calculate.ts`, `calculateMoneyAggregates`, `annualizedMoneyGrowthPct`, `MIN_MONEY_GROWTH_BASE_TURNS`
- `src/lib/moneySupply/rules/assemble.ts`, component helpers, household demography derivation, `effectiveExternalBroadMoney`
- `src/lib/moneySupply/snapshot.ts`, `snapshotMoneySupply`, `MONEY_SUPPLY_SNAPSHOTS_COLLECTION`
- `src/lib/moneySupply/seed.ts`, `seedMoneySupplyBaselines`, seeds `externalBroadMoney` from `broadMoneyToGdpRatio`
- `src/lib/moneySupply/quantitativeEasing.ts`, `planOpenMarketOperation`, `applyQePriceSupport`
- `src/lib/moneySupply/operations.ts`, `executeMonetaryOperation`, `advanceToPrivateBanks`, cooldown/cap constants
- `src/lib/moneySupply/nppPolicy.ts`, `chooseNppMonetaryOperation`, `processNppMonetaryOperations`
- `src/lib/moneySupply/featureFlag.ts`, `isMoneySupplyEnabledFromConfig`
- `src/lib/db/types/moneySupply.ts`, `MoneySupplySnapshot`, `MonetaryOperationRecord`, `MonetaryOperationType`, `MonetaryPolicyEvaluation`
- `src/simulation/phases/turnPhaseRegistry.ts`, `moneySupplySnapshot` turn phase registration
- `src/simulation/phases/stateEffectsPhase.ts`, `nppMonetaryOperations` turn phase registration
- `src/app/api/country/[code]/central-bank/monetary-operation/route.ts`, player/chair-facing manual operation endpoint
- `src/app/centralbank/[currency]/components/CentralBankMoneySupplyTab.tsx`, UI for manual QE/QT/advance/injection actions
- `src/lib/turn/inflationRecalc.ts`, reads `annualizedM2GrowthPct` per currency into the inflation calc
- `src/lib/budget/inflation.ts`, `calculateInflationWithBreakdown`, the `moneySupply` pressure term
