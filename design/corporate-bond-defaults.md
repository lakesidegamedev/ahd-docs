# Corporate Bond Defaults

Corporate bond defaults occur when a corporation cannot meet its debt obligations. The system handles default detection, credit penalties, distressed debt trading, and dissolution settlements.

Player guide: [Corporate Bonds](https://www.ahousedividedgame.com/wiki/corporate-bonds)

**Entry point:** `src/lib/turn/bondTurn.ts` (default detection), `src/lib/bonds/corporateBondDefault.ts` (helpers), `src/lib/turn/bondTurnAutoResolve.ts` (lingering defaults)

## Overview

- **Trigger:** Corporation `liquidCapital < 0` after coupon payments, AND a solvency gate confirms assets (valued on the same basis the restructure planner uses) cannot cover the debt. A corp that can cover its shortfall from a positive bond buyback escrow, or whose assets exceed its debt, does not default merely for being cash-negative that turn.
- **Penalty:** 96 turns credit rating floor at CCC
- **Trading:** Defaulted bonds trade at 10% recovery value
- **CEO options:** Pay defaulted principal in cash, refinance it (at most twice in a corporation's life), restructure (sell the fewest sectors that repay holders in full), or dissolve
- **Auto-resolution:** A default still standing on a later turn is resolved by the turn processor (refinance, then restructure, else it stands for dissolution)
- **Dissolution:** Bond holders paid first from remaining assets

## Rules

Every constant on this page, with its value and source.

| Constant | Value | Source |
| --- | --- | --- |
| `BOND_DEFAULT_CREDIT_PENALTY_TURNS` | 96 turns (2 game years at 48 turns per year) | `src/lib/constants/bonds.ts` |
| Defaulted bond market price | 0.10 of face | `calculateBondMarketPrice` in `src/lib/constants/bonds.ts` |
| Live bond price clamp | 0.05 to 2.0 | `calculateBondMarketPrice` in `src/lib/constants/bonds.ts` |
| Score cap during penalty | 12 (rating forced to CCC) | `src/lib/bonds/rules/corporateCreditScore.ts` |
| `MAX_BOND_DEFAULT_REFINANCES` | 2 per corporation, lifetime | `src/lib/constants/bonds.ts` |
| `EX_CEO_BOND_PURCHASE_BLOCK_TURNS` | 120 turns | `src/lib/constants/bonds.ts` |
| `BOND_UNIT_FACE_VALUE` | 1,000 per unit | `src/lib/constants/bonds.ts` |
| `MIN_BOND_ISSUANCE` | 100,000 | `src/lib/constants/bonds.ts` |
| `BOND_ISSUANCE_MIN_HEADROOM` | 10,000 (below this, bonds are unavailable) | `src/lib/constants/bonds.ts` |
| `MAX_BOND_ISSUANCE_FRACTION` | 2.0 times equity, minus existing debt | `src/lib/constants/bonds.ts` |
| `MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION` | 1.0 times exit equity, minus existing debt | `src/lib/constants/bonds.ts` |
| `MAX_BOND_ISSUANCE_REVENUE_FRACTION` | 25% of annual revenue per issue | `src/lib/constants/bonds.ts` |
| `DISSOLUTION_SECTOR_SALVAGE_FRACTION` | 0.20 | `src/lib/constants/corporations.ts` |
| `CREDIT_RATING_WEIGHTS` | debt to equity 0.30, interest coverage 0.25, profitability 0.25, liquidity 0.20 | `src/lib/constants/bonds.ts` |
| Inertia smoothing | 75% new score, 25% previous | `src/lib/bonds/rules/corporateCreditScore.ts` |
| `CORPORATE_BOND_SPREAD_PREMIUM` | 1.0 percentage point | `src/lib/constants/bonds.ts` |
| `CORPORATE_BOND_TERM_PREMIUMS` | 48 turns 0, 96 turns 0, 240 turns 1.0, 336 turns 1.75 (corporate issuance offers 96, 240, 336) | `src/lib/constants/bonds.ts`, `src/lib/db/types/bond.ts` |

Formulas for the credit score components, thresholds and spreads are in the Credit Rating Calculation section below.

## Timing

Default handling runs inside `processBondTurn` (turn phase `bondTurn`, registered in `src/simulation/phases/turnPhaseRegistry.ts`). It runs after the corporation turn has produced the turn's income, in parallel with the `commodityPrices` phase, and before `recomputeSharePrices`, which re-prices shares from the post-bond cash position.

Inside `bondTurn` the order is:

1. Phase 1: coupons paid; Phase 1.5 and 2: maturity flows pre-computed and all per-corporation cash changes applied in one delta.
2. Phase 3: default detection (cash negative, escrow cover, solvency gate).
3. Phase 3.5: cascade, holder corporations pushed negative by a defaulted issuer also default; the issuer's maturity flows are rolled back.
4. Phase 3.6: credit penalty applied once to every defaulted corporation.
5. Phase 4: bonds marked defaulted at price 0.10.
6. Phase 5 and 6: matured bonds settled, bulk writes applied.
7. Phase 7: `autoResolveLingeringDefaults`, for corporations whose default is at least one turn old.

Detection is skipped entirely while corporation actions are paused (coupons and maturities still settle), because the pause removes the corporation's income and the shortfall would not be the corporation's fault.

## Edge cases and limits

- **Cash negative is not insolvency.** A corporation with negative cash but assets above its debt (on the restructure planner's exit basis) is illiquid, not defaulted. A positive buyback escrow can also cover the shortfall first.
- **Cascade defaults skip the solvency gate.** A holder corporation that goes negative because an issuer failed to pay defaults without the asset test, since a counterparty genuinely failed to pay it.
- **Penalty extends, never shortens.** A new default sets the end turn to the later of the old end and `turn + 96`.
- **Score cap overrides notches.** An active default penalty forces CCC and a score of at most 12, ahead of the insider-concentration downgrade and the index-fund upgrade.
- **Sovereign bonds cannot default** through this path; lingering-default auto-resolution selects only non-sovereign issuers.
- **Auto-resolution exclusions.** National corporations and IMF-managed corporations are never auto-resolved, and national corporations cannot refinance or cash-pay.
- **Refinance limit.** After 2 refinances the route returns "Refinance limit reached"; restructure or dissolution are the remaining exits. The limit stops default-and-refinance cash-extraction loops.
- **Dissolution cash is net of arrears.** Cash available to bondholders is liquid capital minus operating-cash and federal-tax arrears, floored at zero.
- **Under the plants market mode** dissolution salvage applies the 0.20 fraction to sector book value, not NPV, so salvage is always below build cost and build-then-dissolve cannot mint money.
- **Defaulted holders stay put.** A defaulted bond keeps its `holders`; they are not moved to the public float.
- **Zero cases.** If total bond claims are zero the recovery percentage is reported as 100. If equity is zero or negative, the 2x cap is zero and no new issuance is possible.

## Worked example

A corporation owes 200,000 of bonds. Coupon and maturity payments leave its liquid capital at -3,000, it has no buyback escrow, and its assets on the exit basis are worth 90,000 (equity 90,000, sector value 450,000). It fails both checks and defaults.

1. Turn T: bonds marked defaulted at price 0.10; credit rating forced to CCC with score at most 12 until turn T + 96.
2. A holder with 100 units sees each unit trade at 100 (0.10 of the 1,000 face).
3. On turn T + 1 the CEO has not acted. Auto-resolution checks refinance: the cap is 2 x 90,000 - 200,000 = -20,000, floored to 0, so it fails. Restructure needs the sectors to repay 200,000, which 90,000 of assets cannot, so the default stands.
4. The CEO dissolves. Assets for bondholders are cash plus 0.20 of sector value. Cash counts as 0 (negative cash is floored). With sector value 450,000: 0 + 0.2 x 450,000 = 90,000 against claims of 200,000, so holders recover 45% pro-rata and shareholders get nothing.

## Default Detection

Defaults are checked each turn during bond processing:

```typescript
// src/lib/turn/bondTurn.ts (Phase 3 / 3.5 / 3.6)

// Phase 3: candidates are corps with liquidCapital < 0 after coupon payments.
// A positive bond buyback escrow can cover the shortfall first
// (coverBondShortfallsFromEscrow); survivors then pass a solvency gate
// (filterInsolventCorps) that checks whether the corp's assets, valued on the
// same exit basis the restructure planner uses, could cover its debt. Only
// corps that fail BOTH checks are added to defaultedCorps.
const stillNegative = await coverBondShortfallsFromEscrow(db, negativeNonNatcorp, now);
const solvencyChecked = await filterInsolventCorps(db, stillNegative, { ... });
for (const idStr of solvencyChecked) defaultedCorps.add(idStr);

// Phase 3.5: cascade, rolling back a defaulted issuer's maturity flows can
// push its own bondholders negative, adding them to defaultedCorps too.
await rollbackDefaultedIssuerMaturityFlows({ db, bondMaturityFlows, defaultedCorps, ... });

// Phase 3.6: apply credit penalty once, after cascade resolution, to every
// corp in defaultedCorps (initial + cascaded).
for (const corpIdStr of defaultedCorps) {
  const nextUntil = turn + BOND_DEFAULT_CREDIT_PENALTY_TURNS; // 96 turns
  const prevUntil = c.bondDefaultCreditPenaltyUntilTurn ?? 0;
  const newUntil = Math.max(prevUntil, nextUntil);
  // ...bulkWrite bondDefaultCreditPenaltyUntilTurn: newUntil
}
```

### Bond Marking

Bonds are marked as defaulted in the same turn:

```typescript
// src/lib/turn/bondTurn.ts (Phase 4)

const isDefaulted = isCorporateBond(bond) ? defaultedCorps.has(corpIdStr) || bond.defaulted : false;

if (isDefaulted && !bond.defaulted) {
  await db.collection("bonds").updateOne(
    { _id: bond._id },
    {
      $set: {
        defaulted: true,
        defaultedAtTurn: turn,
        marketPrice: 0.1,
        updatedAt: now,
      },
    }
  );
}
```

Note: unlike a matured bond (which clears `holders`/`publicFloat` on redemption), a defaulted bond keeps its existing `holders` array; holders are not automatically moved to the public float.

## Credit Penalty

After default, the corporation's credit rating is floored for 96 turns:

```typescript
// src/lib/bonds/rules/corporateCreditScore.ts (applied last)

if (options?.bondDefaultCreditPenaltyActive) {
  rating = "CCC";
  compositeScore = Math.min(compositeScore, 12);
}
```

| Metric           | Value                                       |
| ---------------- | ------------------------------------------- |
| **Duration**     | 96 turns (2 game years)                     |
| **Rating floor** | CCC (lowest tier)                           |
| **Score cap**    | 12 (below CCC threshold of 15)              |
| **Extension**    | Multiple defaults extend the penalty window |

The penalty prevents corporations from immediately re-accessing credit markets at favorable rates.

## Distressed Debt Trading

### Market Price

Defaulted bonds trade at a fixed recovery value:

```typescript
// calculateBondMarketPrice, src/lib/constants/bonds.ts

if (defaulted) return 0.1; // 10 cents on the dollar
```

| State     | Price                         |
| --------- | ----------------------------- |
| Defaulted | 0.10 (10% of face)            |
| Matured   | 1.00 (par)                    |
| Active    | Market-based (0.05-2.0 range) |

### CEO Self-Buy Block

This is not specific to defaulted bonds: a CEO, pending CEO, or a character who was CEO within the last `EX_CEO_BOND_PURCHASE_BLOCK_TURNS` (120 turns) cannot purchase ANY of their own corporation's bonds, defaulted or not (CEO ⊥ bondholder invariant):

```typescript
// src/app/api/bonds/[bondId]/buy/route.ts

if (
  issuingCorp?.ceoId?.toString() === character._id.toString() ||
  issuingCorp?.pendingCeoCharacterId?.toString() === character._id.toString()
) {
  return NextResponse.json({ error: "Cannot buy your own corporation's bonds" }, { status: 400 });
}
if (wasCeoWithinTurns(issuingCorp, character._id, currentTurn, EX_CEO_BOND_PURCHASE_BLOCK_TURNS)) {
  return NextResponse.json(
    { error: "Previous CEOs cannot buy bonds in this corporation at this time." },
    { status: 400 }
  );
}
```

**Rationale:** Prevents CEOs (current, pending, or recently departed) from profiting off their own corporation's distress by buying its debt cheaply, including retiring defaulted debt at face value via buyback.

### CEO Debt Retirement

CEOs can retire bond units from the public float (`POST /api/bonds/[bondId]/buyback`). Non-defaulted bonds are bought at the pool ask; defaulted bonds are bought at **full face value** ($1,000/unit), which stops a CEO profiting by buying distressed debt cheaply:

```typescript
// src/app/api/bonds/[bondId]/buyback/route.ts

const pricePerUnit = bond.defaulted ? BOND_UNIT_FACE_VALUE : quote.askPerUnit;
const costLocal = units * pricePerUnit;

// Deduct from corporate liquidCapital
// Reduce bond.totalIssued and publicFloat
```

**Strategy:** Allows gradual debt reduction even when the corporation's bonds trade at distressed prices.

## Refinancing Defaulted Debt

CEOs can refinance defaulted principal by issuing new bonds:

```typescript
// src/lib/bonds/corporateBondDefault.ts (previewRefinanceIssuance)

export function previewRefinanceIssuance(params: {
  corporation: Corporation;
  liquidCapitalAnchor: number; // ₳-normalized, caller-converted
  allNonMaturedBonds: Bond[];
  actualFaceAnchor: number; // new-bond face value in ₳
  sectorNpv: number;
  annualIncome: number;
  primeRate: number;
  currentTurn: number;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  maturityTurns?: BondMaturityTurns;
}): {
  creditRating: ReturnType<typeof calculateCreditScore>;
  couponRate: number;
};
```

### Eligibility Check

```typescript
// src/lib/bonds/corporateBondDefault.ts (canRefinanceDefaultedDebt)

export function canRefinanceDefaultedDebt(params: {
  equity: number;
  existingDebtAllNonMatured: number;
  defaultedPrincipal: number;
}): { ok: boolean; requiredFace: number; maxAllowedFace: number };

const requiredFace = roundFaceToBondUnits(params.defaultedPrincipal);
const maxAllowed = maxNewIssuanceFaceValue(params.equity, params.existingDebtAllNonMatured);
// ok = requiredFace <= maxAllowed && requiredFace >= MIN_BOND_ISSUANCE
```

### 2× Equity Cap

New bond issuance is capped at 2× equity minus existing debt. For ordinary issuance there is also a tighter exit-equity ceiling (1.0× exit equity minus existing debt) and a per-issue cap of 25% of annual revenue (`effectiveBondIssuanceWindow`); refinancing of defaulted debt checks the 2× rule through `canRefinanceDefaultedDebt` below:

```typescript
// src/lib/bonds/corporateBondDefault.ts (maxNewIssuanceFaceValue)

export function maxNewIssuanceFaceValue(equity: number, existingDebt: number): number {
  const cap = Math.max(0, equity * MAX_BOND_ISSUANCE_FRACTION - existingDebt);
  return roundFaceToBondUnits(cap); // Rounded to $1k units
}
```

| Equity | Existing Debt | Max New Issuance |
| ------ | ------------- | ---------------- |
| $1M    | $500k         | $1.5M            |
| $500k  | $1M           | $0               |
| $2M    | $2M           | $2M              |

## Dissolution Settlement

When a corporation dissolves, bond holders have priority claims on remaining assets.

### Settlement Preview

```typescript
// src/lib/bonds/corporateBondDefault.ts (previewDissolveSettlement)

export function previewDissolveSettlement(
  corp: Corporation,
  sectorNpv: number,
  bonds: Bond[],
  liquidCapitalAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  options?: { plantsEnabled?: boolean; sectorBookAnchor?: number }
): DissolveSettlementPreview {
  const lc = Math.max(0, liquidCapitalAnchor);
  // Only a salvage fraction of sector value is recoverable on dissolution
  // (sectors are abandoned to the unowned market, no buyer at going-concern price).
  const salvageBasis =
    options?.plantsEnabled === true ? (options.sectorBookAnchor ?? 0) : sectorNpv;
  const salvagedSectorNpv = DISSOLUTION_SECTOR_SALVAGE_FRACTION * Math.max(0, salvageBasis); // 0.2
  const totalAssets = lc + salvagedSectorNpv;
  const totalBondClaims = sumNonMaturedBondPrincipal(bonds, fxByCurrency);
  const bondRecoveryPool = Math.min(totalAssets, totalBondClaims);
  const shareholderPool = Math.max(0, totalAssets - bondRecoveryPool);
  const bondRecoveryPct =
    totalBondClaims > 0 ? Math.round((bondRecoveryPool / totalBondClaims) * 10_000) / 100 : 100;
}
```

Sector value counts at only **20%** on dissolution (`DISSOLUTION_SECTOR_SALVAGE_FRACTION`, `src/lib/constants/corporations.ts`), not at full NPV. Assets available for bond recovery are `(liquidCapital - cash arrears) + 0.2 x sectorValue`, not `liquidCapital + sectorValue`. Under the plants market mode the sector value used is book value, not NPV. Cash arrears are unpaid operating-cash and federal-tax liabilities.

### Payout Priority

1. **Bond holders**, Paid first from `bondRecoveryPool` (up to total bond claims)
2. **Shareholders**, Receive `shareholderPool` (remaining assets after bond claims)

| Scenario      | Bond Recovery | Shareholder Recovery |
| ------------- | ------------- | -------------------- |
| Assets > Debt | 100%          | Remaining            |
| Assets = Debt | 100%          | 0%                   |
| Assets < Debt | Pro-rata      | 0%                   |

### Shareholder Allocation

```typescript
// src/lib/bonds/corporateBondDefault.ts (allocateShareholderPool)

export function allocateShareholderPool(
  corp: Corporation,
  shareholderPool: number,
  nameById: Map<string, string>
): ShareholderAllocation {
  const totalShares = corp.totalShares ?? 0;
  for (const sh of corp.shareholders ?? []) {
    const payout = Math.floor((shareholderPool * sh.shares) / totalShares);
    // routed into characterRows, corporationRows, fundRows, or publicFloatRow
    // depending on the holder type
  }
}
```

## Bond Holder Merging

When multiple bonds default, holder positions are merged for consolidated tracking:

```typescript
// src/lib/bonds/corporateBondDefault.ts (mergeDefaultedBondHolders)

export function mergeDefaultedBondHolders(defaultedBonds: Bond[]): {
  holderUnits: Map<string, { characterId: ObjectId; units: number }>;
  imperialHolderUnits: Map<string, { imperialCharacterId: ObjectId; units: number }>;
  corpHolderUnits: Map<string, { corporationId: ObjectId; units: number }>;
  publicFloat: number;
};
```

**Purpose:** Aggregates holdings across multiple defaulted bonds for settlement calculations.

## Resolution Routes

All routes live under `src/app/api/corporations/[id]/bond-default/`, are CEO-only, and are blocked while an admin has paused corporation actions.

| Route | Effect |
| --- | --- |
| `cash` | Pay defaulted principal from liquid capital (may draw on a positive buyback escrow) and mature those bonds |
| `refinance` | Issue a replacement bond for the full defaulted principal and roll holders in; max 2 per corporation; 2x equity rule applies |
| `restructure` | Sell the minimum set of sectors that repays defaulted holders in full, cure the bonds, corporation survives; 400 if even selling everything cannot cover the debt |
| `dissolve` | Pay holders pro-rata from assets, remainder to shareholders; requires `confirm: true` |

If the CEO does nothing, `autoResolveLingeringDefaults` (Phase 7, `src/lib/turn/bondTurnAutoResolve.ts`) tries refinance, then restructure, then leaves the default standing. It notifies the CEO and writes an audit row for each action.

## Credit Rating Calculation

The composite credit score uses four weighted components:

```typescript
// src/lib/constants/bonds.ts (CREDIT_RATING_WEIGHTS)

export const CREDIT_RATING_WEIGHTS = {
  debtToEquity: 0.3, // Lower ratio = better
  interestCoverage: 0.25, // Higher coverage = better
  profitability: 0.25, // Positive ROE = better
  liquidity: 0.2, // Cash vs interest obligations
};
```

### Component Formulas

| Component         | Formula                                                    | Range |
| ----------------- | ---------------------------------------------------------- | ----- |
| Debt-to-Equity    | `100 - (D/E / 3) × 100`                                    | 0-100 |
| Interest Coverage | `coverage × 20`                                            | 0-100 |
| Profitability     | `40 + ROE × 350` (positive) / `40 - 50 × √loss` (negative) | 5-100 |
| Liquidity         | `20 + liquidityRatio × 40`                                 | 0-100 |

### Inertia Smoothing

Credit scores blend 75% new + 25% previous to prevent single-turn volatility:

```typescript
// src/lib/bonds/rules/corporateCreditScore.ts (inertia smoothing)

if (options?.previousCompositeScore != null && options.previousCompositeScore > 0) {
  compositeScore = Math.round(0.75 * rawComposite + 0.25 * options.previousCompositeScore);
}
```

### Rating Thresholds

`CREDIT_RATING_SPREADS` (`src/lib/db/types/centralBank.ts`) gives the base spread over prime by tier; corporate coupons add two more legs on top (see below).

| Rating | Threshold | Spread (over prime) |
| ------ | --------- | ------------------- |
| AAA    | 85+       | 0%                  |
| AA     | 70+       | 0.5%                |
| A      | 55+       | 1.5%                |
| BBB    | 40+       | 3%                  |
| BB     | 25+       | 5%                  |
| B      | 15+       | 8%                  |
| CCC    | 0+        | 12%                 |

### Corporate Coupon Rate

`getBondCouponRate` (`src/lib/constants/bonds.ts`) builds the actual **corporate** bond coupon from four legs, not the tier spread alone:

```
couponRate = primeRate + CREDIT_RATING_SPREADS[rating] + CORPORATE_BOND_SPREAD_PREMIUM + termPremium
```

- `CORPORATE_BOND_SPREAD_PREMIUM` = 1.0pp, added on every corporate issuance (sovereign/treasury issuance skips this leg and uses prime + tier spread alone).
- `termPremium` comes from `CORPORATE_BOND_TERM_PREMIUMS`, keyed by maturity in turns: 0pp at 48 and 96 turns, 1.0pp at 240 turns, 1.75pp at 336 turns.

## Key Files

| File                                          | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `src/lib/turn/bondTurn.ts`                    | Default detection, penalty application, bond marking |
| `src/lib/bonds/corporateBondDefault.ts`       | Refinance previews, dissolution math, holder merging |
| `src/lib/constants/bonds.ts`                  | Credit scoring, coupon rates, market pricing         |
| `src/app/api/bonds/[bondId]/buy/route.ts`     | Purchase logic (CEO block)                           |
| `src/app/api/bonds/[bondId]/buyback/route.ts` | CEO debt retirement                                  |
| `src/lib/db/types/bond.ts`                    | `Bond`, `defaulted`, `defaultedAtTurn` fields        |

## Connections

**Driven by:**

- [Corporations](./corporations.md): corporate cash, sector value and income decide whether coupons and maturities push a corporation negative (`processCorporationTurn` output read by `processBondTurn`).
- [Currency Exchange](./currency-exchange.md): bonds settle in their own currency, converted to the anchor currency for equity and claim comparisons.
- Central bank prime rate: sets coupon rates and live bond prices (`buildPrimeRateMap` in `src/lib/bonds/corporateBondDefault.ts`).

**Affects:**

- [Corporations](./corporations.md): default forces CCC and blocks cheap credit for 96 turns, can sell sectors (restructure) or end the corporation (dissolve).
- [Stock Market](./stock-market.md): `recomputeSharePrices` re-prices shares from post-default cash; dissolution pays shareholders last.
- [Sovereign Bonds](./sovereign-bonds.md): holders of the defaulted paper (players, funds, other corporations) take the loss; sovereign bonds themselves cannot default through this path.

Last checked: 2026-10-29, version 1.18.0
