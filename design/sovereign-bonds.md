# Sovereign Bonds

Sovereign bonds are **government-issued** debt instruments that finance national deficits. They reuse the corporate bond trading infrastructure but integrate with the federal budget system.

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
| `countryId`     | Any configured country code (for example `"US"`, `"UK"`)                                                                                  |
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

Auction demand is evaluated once per fiscal year (turn 40) as a demand ratio: >=1.0 is subscribed (healthy), 0.7-1.0 is undersubscribed (warning), below 0.7 is a failed auction. A default crisis triggers after **3 consecutive failed auctions**.

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

After resolution, the country's bond market is closed for **48 turns** before new sovereign auctions can resume, forcing primary surpluses or IMF reliance during that window.

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

## Admin Testing

### Test Issuance

Admins can manually issue sovereign bonds for testing:

```bash
POST /api/admin/sovereign-debt/
{
  "countryId": "US" | "UK",
  "faceValue": number, // optional; defaults to quarterly deficit amount
  "maturityTurns": 48 | 96 | 240
}
```

### Collections

| Collection      | Purpose                                       |
| --------------- | --------------------------------------------- |
| `bonds`         | Bond documents with `issuerType: "sovereign"` |
| `bondHistory`   | Per-turn price and interest snapshots         |
| `federalBudget` | US federal debt principal and interest        |
| `centralBanks`  | Prime rate for pricing                        |

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
