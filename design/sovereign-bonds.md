# Sovereign Bonds

## Summary

Sovereign bonds are **government-issued** debt instruments that finance national deficits. They reuse the corporate bond trading infrastructure but integrate with the federal budget system.

Player guide: [Sovereign Bonds](https://www.ahousedividedgame.com/wiki/sovereign-bonds)


- **Issuers**: Every registered country with a national budget, using its configured treasury and currency labels
- **Trading**: Same `/api/bonds/` routes as corporate bonds; appear on country stock exchange pages
- **Settlement**: Maturity payments deducted from federal budget debt principal
- **Countries supported**: All configured countries; issuance is not limited to the US and UK

## Rules

### Issuance cycle


#### Quarterly Automatic Issuance

Sovereign bonds are issued automatically every **12 turns** (quarterly in game time: 48 turns = 1 year), for every registered country that has a national budget (`issueScheduledSovereignBondSeries`, `src/lib/bonds/sovereign.ts`). A country dissolved by a merge is skipped even if its budget remains:

```typescript
export const SOVEREIGN_ISSUANCE_INTERVAL_TURNS = 12;
export const SOVEREIGN_BOND_MATURITY_TURNS = 48; // 1 year; default for single-series callers
```

The quarter's issue amount is not one bond. It is split over a **maturity ladder** taken from the budget's `sovereignBondProfile`, or `SOVEREIGN_RECONCILE_DISTRIBUTION` (48 turns 25%, 96 turns 35%, 240 turns 40%) when none is set. Each rung is floored to whole 1,000 units and rungs under one unit are skipped (`planSovereignTranches`). When `sovereignIssuanceConsolidationEnabled` is on, rungs below `SOVEREIGN_MIN_TRANCHE_UNITS` (1,000 units, a face of 1,000,000) fold into the largest rung (`consolidateSovereignTranches`).

#### Issuance Amount

Each quarter the issued face value is the sum of two components:

```typescript
issueAmount = rolloverAmount + deficitAmount;
```

**Deficit component**, quarter share of the annual budget deficit (derived from `federalSurplus(budget)`, not the cached `surplus` field), rounded to whole 1,000 bond units:

```typescript
const quarterlyAmount = annualDeficit / 4;
const deficitAmount = Math.floor(quarterlyAmount / 1000) * 1000;
```

If the budget is in surplus, `deficitAmount` is zero. If `issueAmount` is under one unit (1,000), nothing is issued. A country is also skipped when a non-reconcile sovereign bond already exists for that turn, or when the scheduled settlement key `sovereign-primary:scheduled:<country>:<turn>` already exists (idempotent rerun).

**Rollover component**, total `totalIssued` of active sovereign bonds maturing in the upcoming quarter (`[turn, turn + 12)`), rounded to whole bond units. This refinances maturing debt so the public float stays liquid even when the country is running a surplus.

Without rollover, a surplus country's bonds mature out of circulation and the trading market eventually empties. With it, the bond float is replenished each quarter at the current prime rate, matching real-world Treasury rollover behavior.

#### Coupon Rate

`couponRate = round2(primeRate + termPremium + credibilitySpread + issuerRiskSpread)` where the credibility term already includes the democratic-health spread (`calculateSovereignCouponRate`, `src/lib/bonds/rules/sovereignCreditSpread.ts`; `getSovereignCouponRate`, `src/lib/bonds/sovereign.ts`). Each spread is floored at 0 and the sum is rounded to two decimals:

```typescript
const termPremium = SOVEREIGN_BOND_TERM_PREMIUMS[maturityTurns] ?? 0; // 48t: 0, 96t: 0.25pp, 240t: 0.75pp
const credibilitySpread = sovereignCredibilitySpread(centralBank.chairInfamy ?? 0); // 0 with no bank
const issuerRiskSpread = sovereignCreditSpreadPp(budget.creditRating); // CREDIT_RATING_SPREADS
const democraticSpread = democraticHealthSovereignSpread(health);       // up to 2pp
```

| Rating | AAA | AA | A | BBB | BB | B | CCC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Issuer risk spread (pp) | 0 | 0.5 | 1.5 | 3 | 5 | 8 | 12 |

- **Term premium** rewards holding longer-dated paper (steeper yield curve for longer maturities).
- **Credibility spread** is a B4 market-effects penalty driven by the central bank chair's infamy: linear from 0 (full credibility) to `SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP` (1.5) at zero credibility. A clean or absent bank contributes 0.
- **Issuer risk spread** is the country's credit rating spread from `CREDIT_RATING_SPREADS` (`src/lib/db/types/centralBank.ts`).
- **Democratic spread** scales with democratic-health severity up to 2pp (`DEMOCRATIC_HEALTH_SOVEREIGN_SPREAD_MAX`).

#### Bond Structure

| Field           | Value                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `issuerType`    | `"sovereign"`                                                                                                            |
| `countryId`     | Any configured country code (for example `"US"`, `"UK"`)                                                                 |
| `faceValue`     | $1,000 per unit (`BOND_UNIT_FACE_VALUE`)                                                                                 |
| `maturityTurns` | 48 (1yr), 96 (2yr) or 240 (5yr) turns; scheduled issuance spreads across all three by the ladder above |
| `marketPrice`   | Starts at 1.0 (par)                                                                                                      |
| `publicFloat`   | All units start in public float (AI market maker)                                                                        |
| `holders`       | Players/corporations who purchase                                                                                        |

### Budget integration


#### Issuance Accounting

When bonds are issued, the federal budget is updated:

```typescript
// src/lib/bonds/sovereign.ts:171 applySovereignDebtAdjustment()
newPrincipal = Math.max(0, oldPrincipal + principalDelta);
newDebtInterest = Math.max(0, oldDebtInterest + annualInterestDelta);
newSurplus = revenue.total - (spending.total + annualInterestDelta);
debtToGdpRatio = newPrincipal / gdpSmoothed; // falls back to raw gdp if unset
creditRating = calculateCreditRating(debtToGdpRatio, sovereignRiskAnchor);
interestRate =
  calculateInterestRate(
    debtToGdpRatio,
    imfSovereignBailoutActive,
    sovereignRiskAnchor,
  ) + getSovereignConfidencePremium(investorConfidence);
```

#### Per-Turn Processing

In `processBondTurn()` (`src/lib/turn/bondTurn.ts`):

1. **Coupon payments**, Paid to bond holders (character cash / corporate capital)
2. **Market price update**, Based on country prime rate and time to maturity
3. **Maturity settlement**, Face value returned to holders; principal deducted from budget
4. **History snapshot**, `bondHistory` collection tracks price and cumulative interest

#### Maturity Settlement

When sovereign bonds mature:

```typescript
// src/lib/bonds/sovereign.ts:696 settleSovereignBondMaturity()
const annualCouponCost = (bond.couponRate / 100) * bond.totalIssued;
const budgetUpdate = applySovereignDebtAdjustment(
  budget,
  -bond.totalIssued,
  -annualCouponCost,
);
// budgetUpdate.debt.principal, spending.debtInterest, and surplus are written back
```

### Turn processing pipeline


`processBondTurn()` in `src/lib/turn/bondTurn.ts` handles sovereign bonds:

| Phase                | Action                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| **Pre-processing**   | `issueScheduledSovereignBondSeries()`, issues new bonds every 12 turns  |
| **Coupon payment**   | Pay holders (characters + corporations) from issuer budget              |
| **Price update**     | `calculateBondMarketPrice()` using country prime rate                   |
| **Maturity check**   | Settle matured bonds via `settleSovereignBondMaturity()`                |
| **History snapshot** | Insert `bondHistory` document with market price and cumulative interest |

Sovereign bonds skip the corporate liquidity default check (`liquidCapital < 0`), but a country CAN and does default via a separate sovereign-default crisis subsystem, described below.

### Sovereign default crisis


Sovereign default is a full crisis subsystem (`src/lib/sovereignDefault/`), always active, no feature flag. It is driven by failing bond auctions, not by a missed coupon payment.

#### Trigger: failed auctions

Auction demand is evaluated once per country at fiscal-year close (`src/lib/budget/fiscalYear.ts` calling `evaluateSovereignAuctionForCountry` in `src/lib/sovereignDefault/crisisDetection.ts`) as a demand ratio, capped by the real fill ratio of the latest quarterly auction when that fill is below 1: >=1.0 is subscribed (healthy), 0.7-1.0 is undersubscribed (warning), below 0.7 is a failed auction. A default crisis triggers after **3 consecutive failed auctions** (`FAILED_AUCTION_COUNT_FOR_CRISIS`).

Demand ratio starts from `BASE_DEMAND (1.2)` and sums several components, floored at 0 overall (not 0.6):

- **Debt-to-GDP:** once debt/GDP exceeds 0.6, penalty is `-(debtToGdp - 0.6) x 0.3`.
- **Debt-to-GDP cliff:** once debt/GDP exceeds 2.0, an additional `-(debtToGdp - 2.0) x 0.4` stacks on top.
- **Inflation:** once inflation exceeds 5%, penalty is `-(inflation - 0.05) x 2.0`.
- **FX depreciation:** `-depreciation x 1.5` (10-turn lookback), only ever a penalty, never a bonus.
- **Default scar:** while inside the 100-turn scar window, `-(100 - turnsSinceLastDefault) x 0.01`.
- **Trust modifier:** `(trust - 0.5) x 0.4`, can be positive or negative.
- **Coupon premium:** offering yield above the 4% global benchmark buys demand, `(couponRate/100 - 0.04) x 5.0`.
- **Entity holdings (Model B):** domestic/foreign holders of existing bonds prop up demand, capped at `+0.4`.

(`src/lib/sovereignDefault/marketDemand.ts`, `src/lib/sovereignDefault/constants.ts`)

#### Warning and decision windows

A 3-turn warning precedes the formal crisis trigger. Once triggered, the executive has 12 turns to propose a resolution, and each legislative chamber has 24 turns to vote. Windows that expire without action escalate to forced resolution, governance collapse, or automatic repudiation depending on the country's constitution.

#### Resolution paths

The executive selects one of four resolutions:

| Path            | GDP penalty                                            | Description                                                                                            |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Repudiate**   | -12% GDP over 3 turns                                             | Refuse to pay; bondholders take the full hit                                                           |
| **Restructure** | -6% GDP over 2 turns                                              | Haircut + maturity extension for bondholders                                                           |
| **IMF Bailout** | none                                                   | Accept an IMF facility                                                                                 |
| **Monetize**    | handled via the inflation pipeline, not a flat GDP hit | Print money to cover the debt; gated off when current inflation exceeds 8% (`MONETIZE_GATE_INFLATION`) |

#### Default scar and corporate spillover

Every resolution leaves a **100-turn scar**: a -1%/turn economic drag that decays over that window. Corporations headquartered in the defaulting country take an additional sector margin penalty that also decays over `DEFAULT_MARGIN_FULL_PENALTY_TURNS` (48 turns full, `DEFAULT_MARGIN_DECAY_TURNS` = 24 turns to taper out), sized by resolution path: Repudiate -18pp, Restructure -9pp, Bailout -4.5pp, Monetize 0pp (that path's damage runs through inflation instead). Foreign corporations in other countries absorb a partial **contagion** version of the same penalty, scaled by the defaulting country's GDP share of world GDP times `GLOBAL_CONTAGION_MULTIPLIER` (0.5).

Bond-holder insolvency also **cascades up to 3 levels deep**: if a major bondholder is wiped out by the haircut, its own creditors are stressed, and so on.

#### Recovery floor

After resolution the country enters recovery, which lasts at least `RECOVERY_FLOOR_TURNS` (48) turns. Market access lockouts differ by path: Repudiate `REPUDIATE_LOCKOUT_TURNS` (48) and Restructure `RESTRUCTURE_LOCKOUT_TURNS` (16), forcing primary surpluses or IMF reliance during that window (`src/lib/sovereignDefault/constants.ts`).

### Trading


#### Player Purchases

Players can buy sovereign bond units from the public float:

- **Route**: `POST /api/bonds/:id/buy`
- **Payment**: Deducted from character `cashOnHand`
- **Income**: Coupon payments added to `cashOnHand` each turn
- **Maturity**: Face value ($1,000/unit) returned to `cashOnHand`

#### Corporate Purchases

Corporations can buy sovereign bonds as investments:

- **Route**: `POST /api/bonds/:id/buy?corporationId=...`
- **Payment**: Deducted from corporate `liquidCapital`
- **Income**: Coupon payments added to `liquidCapital`


#### Market Price Dynamics

Sovereign bonds share the same pricing function as corporate bonds, `calculateBondMarketPrice()` in `src/lib/constants/bonds.ts`. Price is the present value of the coupon annuity plus the present value of the par redemption, expressed as a fraction of face value (1.0 = par):

```typescript
const yearsRemaining = turnsRemaining / TURNS_PER_YEAR;
const r = currentRate / 100; // credit tier's current effective annual rate
const c = couponRate / 100; // bond's fixed coupon rate

const discountFactor = Math.pow(1 + r, -yearsRemaining);
const annuityFactor = (1 - discountFactor) / r;
const price = c * annuityFactor + discountFactor; // PV(coupons) + PV(face value)
```

Rounded to four decimals and clamped to `[0.05, 2.0]`. A defaulted bond prices at a flat 0.1 (10 cents on the dollar) recovery value; a bond at or past maturity prices at 1.0; a non-positive rate prices at `1 + c x yearsRemaining`.

When current rates rise above the bond's fixed coupon, price falls below par (and vice versa).

**Pull-to-Par Convergence:**
As `turnsRemaining` shrinks toward 0, `yearsRemaining` shrinks with it, so the discount factor and annuity factor both converge and the formula naturally pulls the price toward 1.0 (par) as maturity approaches, no separate dampening scalar is applied.

**Payment obligation:**
Coupon payments are paid from the federal budget each turn. A country that cannot sustain demand for its debt runs into the sovereign-default crisis subsystem below. "Monetize" (print money to cover the debt) is one of the four executive-selected resolution paths in that subsystem, not an automatic fallback that fires on every missed payment, see Resolution paths below.

### Constants


| Constant | Value | Source |
| --- | --- | --- |
| `SOVEREIGN_ISSUANCE_INTERVAL_TURNS` | 12 | `src/lib/bonds/sovereign.ts` |
| `SOVEREIGN_BOND_MATURITY_TURNS` | 48 | `src/lib/bonds/sovereign.ts` |
| `SOVEREIGN_BOND_TERM_PREMIUMS` | 48t: 0, 96t: 0.25pp, 240t: 0.75pp | `src/lib/bonds/sovereign.ts` |
| `BOND_UNIT_FACE_VALUE` | 1,000 | `src/lib/constants/bonds.ts` |
| `SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP` | 1.5 | `src/lib/centralBank/marketEffects.ts` |
| Market price clamp | 0.05 to 2.0; defaulted bond 0.1 | `calculateBondMarketPrice`, `src/lib/constants/bonds.ts` |
| `BASE_DEMAND` | 1.2 | `src/lib/sovereignDefault/constants.ts` |
| `DGDP_PENALTY_FLOOR` / `RATE` | 0.6 / 0.3 | same |
| `DGDP_CLIFF_FLOOR` / `RATE` | 2.0 / 0.4 | same |
| `INFLATION_PENALTY_FLOOR` / `RATE` | 0.05 / 2.0 | same |
| `FX_DEPREC_PENALTY_RATE`, `FX_DEPRECIATION_LOOKBACK_TURNS` | 1.5, 10 | same |
| `DEFAULT_SCAR_DURATION`, `DEFAULT_SCAR_PER_TURN` | 100 turns, 0.01 | same |
| `TRUST_MODIFIER_RATE` | 0.4 | same |
| `COUPON_PREMIUM_RATE`, `GLOBAL_BENCHMARK_RATE` | 5.0, 0.04 | same |
| `ENTITY_DEMAND_CAP` | 0.4 | same |
| `DEMAND_FULL_THRESHOLD` / `DEMAND_UNDERSUBSCRIBED_THRESHOLD` | 1.0 / 0.7 | same |
| `FAILED_AUCTION_COUNT_FOR_CRISIS` | 3 | same |
| `EXECUTIVE_DECISION_TURNS`, `LEGISLATIVE_VOTE_TURNS_PER_CHAMBER` | 12, 24 | same |
| `MONETIZE_GATE_INFLATION` | 0.08 | same |
| `REPUDIATE_GDP_PENALTY` / `RESTRUCTURE_GDP_PENALTY` | 0.12 / 0.06 | same |
| `RESTRUCTURE_HAIRCUT`, `RESTRUCTURE_MATURITY_EXTENSION_TURNS` | 0.4, 60 | same |
| `DEFAULT_MARGIN_PENALTY_*` | Repudiate -0.18, Restructure -0.09, Bailout -0.045, Monetize 0 | same |
| `DEFAULT_MARGIN_FULL_PENALTY_TURNS`, `DEFAULT_MARGIN_DECAY_TURNS` | 48, 24 | same |
| `GLOBAL_CONTAGION_MULTIPLIER`, `CASCADE_MAX_LEVELS` | 0.5, 3 | same |
| `RECOVERY_FLOOR_TURNS` | 48 | same |

| Additional constant | Value | Source |
| --- | --- | --- |
| `SOVEREIGN_RECONCILE_DISTRIBUTION` | 48t 0.25, 96t 0.35, 240t 0.40 (default ladder) | `src/lib/bonds/sovereign.ts` |
| `SOVEREIGN_MIN_TRANCHE_UNITS` | 1,000 units | `src/lib/bonds/sovereignIssueDiagnostics.ts` |
| `CREDIT_RATING_SPREADS` | AAA 0, AA 0.5, A 1.5, BBB 3, BB 5, B 8, CCC 12 (pp) | `src/lib/db/types/centralBank.ts` |
| `DEMOCRATIC_HEALTH_SOVEREIGN_SPREAD_MAX` | 2 pp (module-private) | `src/lib/governanceStyle/rules/democraticConsequences.ts` |
| `REPUDIATE_GDP_PENALTY_TURNS` / `RESTRUCTURE_GDP_PENALTY_TURNS` | 3 / 2 | `src/lib/sovereignDefault/constants.ts` |
| `RESTRUCTURE_LOCKOUT_TURNS` / `REPUDIATE_LOCKOUT_TURNS` | 16 / 48 | same |
| `AUTONOMOUS_CRISIS_MIN_DEBT_TO_GDP` | 2.0 | same |
| Coupon per turn | `couponRate / 100 x face / 48` (`perTurnCouponPayment`) | `src/lib/constants/bonds.ts` |


## Data

| Collection and fields | Written by | Player-visible |
| --- | --- | --- |
| `bonds` (`issuerType: "sovereign"`, `countryId`, `faceValue`, `couponRate`, `maturityTurns`, `issuedAtTurn`, `maturityTurn`, `marketPrice`, `totalIssued`, `publicFloat`, `requestedUnits`, `unsoldUnits`, `primaryFillRatio`, `holders`, `defaulted`, `defaultedAtTurn`; `src/lib/db/types/bond.ts`) | scheduled and admin issuance, bond turn, buy, sell and buyback routes, default resolution | Yes: bond pages, exchange listings, holdings |
| `bondHistory` (`bondId`, `turn`, `marketPrice`, `totalInterestPaid`) | `processBondTurn` snapshot step | Yes: price charts |
| `federalBudget` (`debt.principal`, `spending.debtInterest`, `surplus`, `debtToGdpRatio`, `creditRating`, `interestRate`, `sovereignBondProfile`, `sovereignBondProfileLastChangedTurn`, `lastPrimaryFillRatio`, `lastAuctionDemandRatio`, `sovereignCrisisState`) | `applySovereignDebtAdjustment`, issuance, maturity settlement, crisis detection | Partly: debt, rating and interest on budget pages; auction ratio on the sovereign watch |
| `centralBanks` (`primeRate`, `chairInfamy`) | central bank systems | Prime rate yes |
| `gameConfig.sovereignIssuanceConsolidationEnabled` | admin config | No |

Holder balances change in character `cashOnHand`, corporate `liquidCapital`, fund and non-player investor accounts, all through the coupon and maturity steps.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `sovereignIssuanceConsolidationEnabled` | `true` on fresh worlds and resets; absent means off (historical ladder) | `src/lib/seeds/reference/featureFlagDefaults.ts`, read in `issueScheduledSovereignBondSeries` |
| `federalBudget.sovereignBondProfile` | unset (uses 25/35/40 ladder); changeable by the cabinet bond-profile route with a rate limit | `src/app/api/country/[code]/executive/cabinet/[positionId]/bond-profile/route.ts` |
| `treasuryCashLedgerEnabled` | `true` on fresh worlds | funded treasury cash capture of issuance proceeds (`bondTurn.ts` config) |
| Sovereign default constants | see Rules | `src/lib/sovereignDefault/constants.ts` (no feature flag; always active) |
| Country access (players enabled / NPP governed) | per country | admin panel; gates whether a country can tip into default |

## Timing


`bondTurn` runs inside the turn pipeline (`src/simulation/phases/turnPhaseRegistry.ts`) in parallel with `commodityPrices`. Within `processBondTurn`: scheduled issuance (every 12 turns), coupon payments, price update, maturity settlement, history snapshot. Auction demand and the failed-auction counter are evaluated separately at fiscal-year close (`src/lib/budget/fiscalYear.ts`), so a crisis is detected at year end, not in the bond turn. Resolution windows then run on their own turn counters (12 for the executive, 24 per chamber).

## Worked trace

Country with annual deficit 2,400,000 and 600,000 of bonds maturing in the next quarter, prime rate 4.0%, rating A, no central bank scrutiny, no democratic spread, turn 120 (a multiple of 12).

| Step | Calculation | Result |
| --- | --- | --- |
| Deficit component | floor(2,400,000 / 4 / 1,000) x 1,000 | 600,000 |
| Rollover component | floor(600,000 / 1,000) x 1,000 | 600,000 |
| Issue amount | 600,000 + 600,000 | 1,200,000 (1,200 units) |
| Ladder, flag off | 48t 0.25 -> 300,000; 96t 0.35 -> 420,000; 240t 0.40 -> 480,000 | three bonds, total 1,200,000 |
| Ladder, flag on | each rung under 1,000,000 face, so all fold into the largest | one 240-turn bond of 1,200,000 |
| Coupons, flag off | 4.0 + term + 1.5 (A) | 5.50, 5.75, 6.25 |
| Coupon, flag on | 4.0 + 0.75 + 1.5 | 6.25 |
| Per-unit coupon per turn at 6.25% | 0.0625 x 1,000 / 48 | 1.3021 |
| Annual coupon added to `debt.interest` | 1,200,000 x 0.0625 | 75,000 |
| Price if market rate is 7.5%, 240 turns left | discount 1.075^-5 = 0.6966; annuity (1 - 0.6966) / 0.075 = 4.0459; 0.0625 x 4.0459 + 0.6966 | 0.9494 |

At maturity `settleSovereignBondMaturity` subtracts `totalIssued` from `debt.principal` and the annual coupon cost from `spending.debtInterest` (both floored at 0), then recomputes the debt-to-GDP ratio, rating and interest rate.

Auction demand at fiscal-year close, debt/GDP 1.2, inflation 8%, currency down 10% over 10 turns, no default history, trust 0.4, coupon 5.5%, no entity holdings:

| Component | Calculation | Value |
| --- | --- | --- |
| Base | `BASE_DEMAND` | 1.2 |
| Debt-to-GDP | -(1.2 - 0.6) x 0.3 | -0.18 |
| Inflation | -(0.08 - 0.05) x 2.0 | -0.06 |
| FX depreciation | -0.10 x 1.5 | -0.15 |
| Trust | (0.4 - 0.5) x 0.4 | -0.04 |
| Coupon premium | (0.055 - 0.04) x 5.0 | +0.075 |
| Total | | 0.845 |

0.845 is between 0.7 and 1.0, so the auction is undersubscribed (a warning, counter unchanged). If the latest quarterly primary fill ratio were 0.6, the effective ratio would be min(0.845, 0.6) = 0.6, a failed auction that adds 1 to the consecutive-failure counter.

## Edge cases and limits


- **Surplus.** The deficit component is 0; the rollover component still issues so the float does not empty.
- **Rounding.** Issuance is rounded down to whole 1,000 units; amounts under one unit are skipped.
- **Price bounds.** Market price is clamped to 0.05 to 2.0; defaulted paper prices at 0.1.
- **No central bank.** The credibility spread is 0.
- **Debt cannot go negative.** `applySovereignDebtAdjustment` floors principal and debt interest at 0.
- **No corporate liquidity default.** Sovereign bonds skip the `liquidCapital < 0` check; default comes only through the crisis subsystem.
- **Monetize gate.** Unavailable when inflation exceeds 8%.
- **Entity holdings.** Add at most 0.4 to auction demand.
- **Player-disabled countries.** Do not tip into a default crisis unless extreme autonomous-world fundamentals apply (`crisisDetection.ts`).
- **Merged countries.** A dissolved country keeps its budget but is no longer issued to.
- **Funded settlement.** Maturity and coupon settlement for funded treasuries go through frozen quotes and a settlement journal (`freezeFundedSovereignBondMaturityQuote`), so a retry replays rather than pays twice.
- **Recovering countries** that reflate past extreme distress become eligible for crisis detection again.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Debt principal and debt interest never go negative | `Math.max(0, ...)` in `applySovereignDebtAdjustment`; `sovereign.test.ts` |
| Ladder tranches sum to the issue amount after consolidation | `consolidateSovereignTranches` moves face only between rungs; `sovereignIssueDiagnostics.test.ts` |
| A scheduled issue happens at most once per country and turn | settlement key plus existing-series check; `sovereignPrimary.integration.test.ts` |
| Market price stays in 0.05 to 2.0 (0.1 when defaulted) | `calculateBondMarketPrice`; `src/lib/constants/bonds` tests |
| Auction classification is deterministic and NaN fails the auction | `auctionOutcome.test.ts` |
| Bond principal on the books matches the bond stock | `resyncSovereignPrincipalFromBonds` repairs drift; no per-turn assertion |

## Failure and recovery

Typical failures: debt principal drifting away from the sum of outstanding bonds (repaired by the reconcile and resync paths, which re-derive principal from the bonds or issue tranches for uncovered debt), a placement that leaves units unsold because the underwriting pool lacks cash (shows as a low primary fill ratio and feeds the auction cap), a stuck maturity settlement (retried from the settlement journal with the frozen quote), and a crisis state stuck after a partial resolution (repaired by a heal of the budget's crisis fields or a rerun of the resolution step). Admin reconcile can issue tranches to cover a gap; it stamps them so the scheduler does not skip the next regular issue.

## Connections


**Driven by**
- [National Budget & Treasury](./national-budget.md): the annual deficit sizes issuance (`src/lib/bonds/sovereign.ts`).
- Central bank: prime rate and chair infamy set the coupon (`src/lib/centralBank/marketEffects.ts`).
- Investor confidence and inflation: feed auction demand (`src/lib/sovereignDefault/marketDemand.ts`).

**Affects**
- [National Budget & Treasury](./national-budget.md): debt principal, interest and credit rating (`applySovereignDebtAdjustment`).
- [Stock Market](./stock-market.md): bonds appear on country exchange pages.
- [IMF Sovereign Facility](./imf-sovereign-facility.md): one of the four resolution paths.
- [Corporations](./corporations.md): default margin penalty and contagion on headquartered firms.

### Key files


| File                         | Purpose                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `src/lib/bonds/sovereign.ts` | Sovereign bond issuance, settlement, budget integration |
| `src/lib/turn/bondTurn.ts`   | Per-turn coupon payments, price updates, maturity       |
| `src/lib/budget/debt.ts`     | Credit rating and interest rate calculations            |
| `src/app/api/bonds/`         | Bond trading API routes                                 |
| `src/app/bond/[id]/page.tsx` | Bond detail page with buy panel                         |

### Related documentation

- [Corporations](./corporations.md), Corporate bonds (credit rating, trading, defaults)
- [National Budget & Treasury](./national-budget.md), Federal budget, debt, deficit mechanics
- [Stock Market](./stock-market.md), NYSE/FTSE listings where sovereign bonds appear

## Tests

- `src/lib/bonds/sovereign.test.ts`, `sovereignRollover.test.ts`, `sovereignPrimary.integration.test.ts`, `sovereignIssueDiagnostics.test.ts`: issuance, rollover, ladder, primary placement.
- `src/lib/bonds/sovereignMaturity.test.ts`, `sovereignMaturityBatch.test.ts`, `sovereignMaturityRefunding.test.ts`, `sovereignMaturityPayoutTargets.test.ts`: maturity settlement.
- `src/lib/turn/bondTurn.test.ts`, `bondTurnHelpers.test.ts`, `bondTurnLedger.test.ts`: coupons, prices, history.
- `src/lib/sovereignDefault/__tests__/` (`marketDemand.test.ts`, `auctionOutcome.test.ts`, `crisisDetection.test.ts`, `crisisState.test.ts`, `debtSpiralRegression.test.ts`, `imfSovereignFacility.test.ts`, `phase10E2eScenarios.test.ts` and others): default subsystem.
- Gap: no test pins the coupon spread sum across rating, credibility and democratic inputs end to end.

## Known issues and history

- The earlier version of this page said scheduled issuance was a single 48-turn series and that the IMF bailout carries a -2% GDP penalty. Code differs: scheduled issuance is a three-rung ladder (or one consolidated rung), and the bailout sets no GDP penalty (matching the player page).
- The earlier coupon description left out the issuer credit-rating spread and the democratic spread; both are in the code.
- The Sovereign Bonds player page states that the standard maturity is 48 turns and its worked example gives a coupon equal to the prime rate with a single 60,000,000 issue. Code differs: the quarterly issue is split over 48, 96 and 240 turn paper (unless consolidated) and the coupon includes the rating spread. The player page's flat 48-turn description and worked example are therefore incomplete.
- The `federalBudget` collection is per country, not US only.

Last checked: 2026-10-29, version 1.18.0
