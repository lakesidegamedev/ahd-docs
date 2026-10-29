# Sovereign Bonds

Sovereign bonds are **government-issued** debt instruments that finance national deficits. They reuse the corporate bond trading infrastructure but integrate with the federal budget system.

Player guide: [Sovereign Bonds](https://www.ahousedividedgame.com/wiki/sovereign-bonds)

## Overview

- **Issuers**: Every national government in `COUNTRY_ORDER`, using its configured treasury and currency labels
- **Trading**: Same `/api/bonds/` routes as corporate bonds; appear on country stock exchange pages
- **Settlement**: Maturity payments deducted from federal budget debt principal
- **Countries supported**: All configured countries; issuance is not limited to the US and UK

## Issuance Cycle

### Quarterly Automatic Issuance

Sovereign bonds are issued automatically every **12 turns** (quarterly in game time: 48 turns = 1 year):

```typescript
// src/lib/bonds/sovereign.ts:14-15
export const SOVEREIGN_ISSUANCE_INTERVAL_TURNS = 12;
export const SOVEREIGN_BOND_MATURITY_TURNS = 48; // 1 year
```

### Issuance Amount

Each quarter the issued face value is the sum of two components:

```typescript
issueAmount = rolloverAmount + deficitAmount;
```

**Deficit component**, quarter share of the annual budget deficit, rounded to whole $1,000 bond units:

```typescript
const quarterlyAmount = annualDeficit / 4;
const deficitAmount = Math.floor(quarterlyAmount / 1000) * 1000;
```

If the budget is in surplus, `deficitAmount` is zero.

**Rollover component**, total `totalIssued` of active sovereign bonds maturing in the upcoming quarter (`[turn, turn + 12)`), rounded to whole bond units. This refinances maturing debt so the public float stays liquid even when the country is running a surplus.

Without rollover, a surplus country's bonds mature out of circulation and the trading market eventually empties. With it, the bond float is replenished each quarter at the current prime rate, matching real-world Treasury rollover behavior.

### Coupon Rate

`couponRate = primeRate + termPremium + credibilitySpread` (`getSovereignCouponRate()`, `src/lib/bonds/sovereign.ts`):

```typescript
const termPremium = SOVEREIGN_BOND_TERM_PREMIUMS[maturityTurns] ?? 0; // 48t: 0, 96t: 0.25pp, 240t: 0.75pp
const credibilitySpread = sovereignCredibilitySpread(
  centralBank.chairInfamy ?? 0,
); // 0 with no bank
const couponRate = primeRate + termPremium + credibilitySpread;
```

- **Term premium** rewards holding longer-dated paper (steeper yield curve for longer maturities).
- **Credibility spread** is a B4 market-effects penalty driven by the central bank chair's infamy: a compromised chair adds a spread on top of prime, scaling toward `SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP` as scrutiny/infamy rises. A clean or absent bank contributes 0.

### Bond Structure

| Field           | Value                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `issuerType`    | `"sovereign"`                                                                                                            |
| `countryId`     | Any configured country code (for example `"US"`, `"UK"`)                                                                 |
| `faceValue`     | $1,000 per unit (`BOND_UNIT_FACE_VALUE`)                                                                                 |
| `maturityTurns` | 48 turns (1yr) for scheduled quarterly issuance; admin/reconcile issuance can also use 96 turns (2yr) or 240 turns (5yr) |
| `marketPrice`   | Starts at 1.0 (par)                                                                                                      |
| `publicFloat`   | All units start in public float (AI market maker)                                                                        |
| `holders`       | Players/corporations who purchase                                                                                        |

## Budget Integration

### Issuance Accounting

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

### Per-Turn Processing

In `processBondTurn()` (`src/lib/turn/bondTurn.ts`):

1. **Coupon payments**, Paid to bond holders (character cash / corporate capital)
2. **Market price update**, Based on country prime rate and time to maturity
3. **Maturity settlement**, Face value returned to holders; principal deducted from budget
4. **History snapshot**, `bondHistory` collection tracks price and cumulative interest

### Maturity Settlement

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

## Turn Processing Pipeline

`processBondTurn()` in `src/lib/turn/bondTurn.ts` handles sovereign bonds:

| Phase                | Action                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| **Pre-processing**   | `issueScheduledSovereignBondSeries()`, issues new bonds every 12 turns  |
| **Coupon payment**   | Pay holders (characters + corporations) from issuer budget              |
| **Price update**     | `calculateBondMarketPrice()` using country prime rate                   |
| **Maturity check**   | Settle matured bonds via `settleSovereignBondMaturity()`                |
| **History snapshot** | Insert `bondHistory` document with market price and cumulative interest |

Sovereign bonds skip the corporate liquidity default check (`liquidCapital < 0`), but a country CAN and does default via a separate sovereign-default crisis subsystem, described below.

## Sovereign Default Crisis

Sovereign default is a full crisis subsystem (`src/lib/sovereignDefault/`), always active, no feature flag. It is driven by failing bond auctions, not by a missed coupon payment.

### Trigger: failed auctions

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

### Warning and decision windows

A 3-turn warning precedes the formal crisis trigger. Once triggered, the executive has 12 turns to propose a resolution, and each legislative chamber has 24 turns to vote. Windows that expire without action escalate to forced resolution, governance collapse, or automatic repudiation depending on the country's constitution.

### Resolution paths

The executive selects one of four resolutions:

| Path            | GDP penalty                                            | Description                                                                                            |
| --------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Repudiate**   | -12% GDP                                               | Refuse to pay; bondholders take the full hit                                                           |
| **Restructure** | -6% GDP                                                | Haircut + maturity extension for bondholders                                                           |
| **IMF Bailout** | -2% GDP                                                | Accept an IMF facility                                                                                 |
| **Monetize**    | handled via the inflation pipeline, not a flat GDP hit | Print money to cover the debt; gated off when current inflation exceeds 8% (`MONETIZE_GATE_INFLATION`) |

### Default scar and corporate spillover

Every resolution leaves a **100-turn scar**: a -1%/turn economic drag that decays over that window. Corporations headquartered in the defaulting country take an additional sector margin penalty that also decays over `DEFAULT_MARGIN_FULL_PENALTY_TURNS` (48 turns full, `DEFAULT_MARGIN_DECAY_TURNS` = 24 turns to taper out), sized by resolution path: Repudiate -18pp, Restructure -9pp, Bailout -4.5pp, Monetize 0pp (that path's damage runs through inflation instead). Foreign corporations in other countries absorb a partial **contagion** version of the same penalty, scaled by the defaulting country's GDP share of world GDP times `GLOBAL_CONTAGION_MULTIPLIER` (0.5).

Bond-holder insolvency also **cascades up to 3 levels deep**: if a major bondholder is wiped out by the haircut, its own creditors are stressed, and so on.

### Recovery floor

After resolution the country enters recovery, which lasts at least `RECOVERY_FLOOR_TURNS` (48) turns. Market access lockouts differ by path: Repudiate `REPUDIATE_LOCKOUT_TURNS` (48) and Restructure `RESTRUCTURE_LOCKOUT_TURNS` (16), forcing primary surpluses or IMF reliance during that window (`src/lib/sovereignDefault/constants.ts`).

## Trading

### Player Purchases

Players can buy sovereign bond units from the public float:

- **Route**: `POST /api/bonds/:id/buy`
- **Payment**: Deducted from character `cashOnHand`
- **Income**: Coupon payments added to `cashOnHand` each turn
- **Maturity**: Face value ($1,000/unit) returned to `cashOnHand`

### Corporate Purchases

Corporations can buy sovereign bonds as investments:

- **Route**: `POST /api/bonds/:id/buy?corporationId=...`
- **Payment**: Deducted from corporate `liquidCapital`
- **Income**: Coupon payments added to `liquidCapital`

### Market Price Dynamics

Sovereign bonds share the same pricing function as corporate bonds, `calculateBondMarketPrice()` in `src/lib/constants/bonds.ts`. Price is the present value of the coupon annuity plus the present value of the par redemption, expressed as a fraction of face value (1.0 = par):

```typescript
const yearsRemaining = turnsRemaining / TURNS_PER_YEAR;
const r = currentRate / 100; // credit tier's current effective annual rate
const c = couponRate / 100; // bond's fixed coupon rate

const discountFactor = Math.pow(1 + r, -yearsRemaining);
const annuityFactor = (1 - discountFactor) / r;
const price = c * annuityFactor + discountFactor; // PV(coupons) + PV(face value)
```

Clamped to `[0.05, 2.0]`. A defaulted bond prices at a flat 0.1 (10 cents on the dollar) recovery value regardless of the formula above.

When current rates rise above the bond's fixed coupon, price falls below par (and vice versa).

**Pull-to-Par Convergence:**
As `turnsRemaining` shrinks toward 0, `yearsRemaining` shrinks with it, so the discount factor and annuity factor both converge and the formula naturally pulls the price toward 1.0 (par) as maturity approaches, no separate dampening scalar is applied.

**Payment obligation:**
Coupon payments are paid from the federal budget each turn. A country that cannot sustain demand for its debt runs into the sovereign-default crisis subsystem below. "Monetize" (print money to cover the debt) is one of the four executive-selected resolution paths in that subsystem, not an automatic fallback that fires on every missed payment, see Resolution paths below.

## Data

### Collections

| Collection      | Purpose                                       |
| --------------- | --------------------------------------------- |
| `bonds`         | Bond documents with `issuerType: "sovereign"` |
| `bondHistory`   | Per-turn price and interest snapshots         |
| `federalBudget` | US federal debt principal and interest        |
| `centralBanks`  | Prime rate for pricing                        |

## Rules and constants

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

Worked example: a country with annual deficit 2,400,000 and 600,000 of bonds maturing in the next quarter issues `floor(600,000 / 1000) * 1000 + floor(2,400,000 / 4 / 1000) * 1000` = 1,200,000 face value (1,200 units). At prime 4.0% a 48-turn bond carries a 4.0% coupon; a 240-turn bond carries 4.75%.

The IMF bailout GDP penalty of -2% shown in the resolution table was not found as a named constant in code and is not verified here.

## Timing

`bondTurn` runs inside the turn pipeline (`src/simulation/phases/turnPhaseRegistry.ts`) in parallel with `commodityPrices`. Within `processBondTurn`: scheduled issuance (every 12 turns), coupon payments, price update, maturity settlement, history snapshot. Auction demand and the failed-auction counter are evaluated separately at fiscal-year close (`src/lib/budget/fiscalYear.ts`), so a crisis is detected at year end, not in the bond turn. Resolution windows then run on their own turn counters (12 for the executive, 24 per chamber).

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

## Key Files

| File                         | Purpose                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `src/lib/bonds/sovereign.ts` | Sovereign bond issuance, settlement, budget integration |
| `src/lib/turn/bondTurn.ts`   | Per-turn coupon payments, price updates, maturity       |
| `src/lib/budget/debt.ts`     | Credit rating and interest rate calculations            |
| `src/app/api/bonds/`         | Bond trading API routes                                 |
| `src/app/bond/[id]/page.tsx` | Bond detail page with buy panel                         |

## Related Documentation

- [Corporations](./corporations.md), Corporate bonds (credit rating, trading, defaults)
- [National Budget & Treasury](./national-budget.md), Federal budget, debt, deficit mechanics
- [Stock Market](./stock-market.md), NYSE/FTSE listings where sovereign bonds appear

Last checked: 2026-10-29, version 1.18.0
