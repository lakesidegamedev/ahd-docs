# Corporate Bond Defaults

Corporate bond defaults occur when a corporation cannot meet its debt obligations. The system handles default detection, credit penalties, distressed debt trading, and dissolution settlements.

## Summary

Player guide: [Corporate Bonds](https://www.ahousedividedgame.com/wiki/corporate-bonds)

**Entry point:** `src/lib/turn/bondTurn.ts` (default detection), `src/lib/bonds/corporateBondDefault.ts` (helpers), `src/lib/turn/bondTurnAutoResolve.ts` (lingering defaults)

- **Trigger:** Corporation `liquidCapital < 0` after coupon and maturity payments, AND a solvency gate confirms assets (valued on the same basis the restructure planner uses) cannot cover the debt. A corp that can cover its shortfall from a positive bond buyback escrow, or whose assets exceed its debt, does not default merely for being cash-negative that turn.
- **Penalty:** 96 turns credit rating floor at CCC
- **Trading:** Defaulted bonds are priced at 10% recovery value. A defaulted bond pays no coupon.
- **CEO options:** Pay defaulted principal in cash, refinance it (at most twice in a corporation's life), restructure (sell the fewest sectors that repay holders in full), or dissolve
- **Auto-resolution:** A default still standing on a later turn is resolved by the turn processor (refinance, then restructure, else it stands for dissolution)
- **Dissolution:** Bond holders paid first from remaining assets

Why it works this way: `liquidCapital < 0` only says a corporation is short of cash right now. A corporation that spent its cash on plant is cash-negative by construction and is not insolvent, so the default ladder (which can sell its sectors) only starts when the assets genuinely cannot cover the debt. The cures are ordered from least to most destructive: refinance sells nothing, restructure sells just enough, dissolution ends the corporation.

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
| `BOND_UNIT_FACE_VALUE` | 1,000 per unit | `src/lib/constants/bonds.ts`, `src/lib/db/types/bond.ts` |
| `MIN_BOND_ISSUANCE` | 100,000 | `src/lib/constants/bonds.ts` |
| `BOND_ISSUANCE_MIN_HEADROOM` | 10,000 (below this, bonds are unavailable) | `src/lib/constants/bonds.ts` |
| `MAX_BOND_ISSUANCE_FRACTION` | 2.0 times equity, minus existing debt | `src/lib/constants/bonds.ts` |
| `MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION` | 1.0 times exit equity, minus existing debt | `src/lib/constants/bonds.ts` |
| `MAX_BOND_ISSUANCE_REVENUE_FRACTION` | 25% of annual revenue per issue | `src/lib/constants/bonds.ts` |
| `MIN_BOND_ISSUANCE_PER_ISSUE` | 500,000,000 (floor on the per-issue cap regardless of revenue) | `src/lib/constants/bonds.ts` |
| `BOND_ISSUANCE_COOLDOWN_TURNS` | 24 (public corporation), 12 for private (`BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE`); refinance bypasses it | `src/lib/constants/bonds.ts` |
| `DISSOLUTION_SECTOR_SALVAGE_FRACTION` | 0.20 | `src/lib/constants/corporations.ts` |
| `RESTRUCTURE_SECTOR_SALVAGE_FRACTION` | 0.85 of a sector's exit value is raised as cash when it is sold to restructure | `src/lib/constants/corporations.ts` |
| `MIN_CORPORATION_DISSOLUTION_AGE_TURNS` | 24 (a player cannot dissolve a younger corporation; corporations with no `foundedAtTurn` are exempt) | `src/lib/constants/corporations.ts`, `src/lib/corporations/dissolutionAgeGuard.ts` |
| `CREDIT_RATING_WEIGHTS` | debt to equity 0.30, interest coverage 0.25, profitability 0.25, liquidity 0.20 | `src/lib/constants/bonds.ts` |
| Inertia smoothing | 75% new score, 25% previous | `src/lib/bonds/rules/corporateCreditScore.ts` |
| `CORPORATE_BOND_SPREAD_PREMIUM` | 1.0 percentage point | `src/lib/constants/bonds.ts` |
| `CORPORATE_BOND_TERM_PREMIUMS` | 48 turns 0, 96 turns 0, 240 turns 1.0, 336 turns 1.75 (corporate issuance offers 96, 240, 336) | `src/lib/constants/bonds.ts`, `src/lib/db/types/bond.ts` |

Formulas for the credit score components, thresholds and spreads are in the Credit Rating Calculation section below.

### Default detection

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

The solvency gate (`filterInsolventCorps`, `src/lib/turn/bondTurnHelpers.ts`) compares two figures, both in the anchor currency (₳):

```
debt         = sum of face of the issuer's non-matured bonds (all of them, defaulted or not)
exit equity  = (liquidCapital - cash arrears)
             + sector exit value              (book value under the plants market mode, going-concern NPV otherwise)
             + construction in progress       (only below plants; book already includes it)
             + face of non-defaulted bonds the corporation holds as a creditor
insolvent    = exit equity < debt
```

Exit equity is `corpExitEquityAnchor` in `src/lib/bonds/corpExitEquity.ts`. The same figure caps new issuance (`MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION = 1.0`), so a corporation that borrows inside its quoted ceiling can never be judged insolvent by this gate. If the issuer's debt cannot be read (principal 0), or the corporation is missing from the lookup, the gate falls back to defaulting it rather than rescuing on an unreadable figure.

### Bond marking

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

### Credit penalty

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
| **Score cap**    | 12 (below the B threshold of 15)            |
| **Extension**    | Multiple defaults extend the penalty window |

The penalty prevents corporations from immediately re-accessing credit markets at favorable rates. It is active while `currentTurn < bondDefaultCreditPenaltyUntilTurn` (`isBondDefaultCreditPenaltyActive`), and the start of each bond turn unsets the field for any corporation whose end turn is at or before the current turn.

### Distressed debt trading

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

A defaulted bond has no dealer spread: `quoteBondPrices` (`src/lib/bonds/marketPoolQuotes.ts`) returns bid, ask and mid all equal to the stored price. A holder cannot sell a defaulted bond: `src/app/api/bonds/[bondId]/sell/route.ts` rejects it with "Cannot sell a defaulted bond". A buyer can still take units from the public float at the 0.10 price (`src/app/api/bonds/[bondId]/buy/route.ts` has no defaulted check).

#### CEO self-buy block

This is not specific to defaulted bonds: a CEO, pending CEO, or a character who was CEO within the last `EX_CEO_BOND_PURCHASE_BLOCK_TURNS` (120 turns) cannot purchase ANY of their own corporation's bonds, defaulted or not (a CEO can never also be a bondholder of their own corporation):

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

#### CEO debt retirement

CEOs can retire bond units from the public float (`POST /api/bonds/[bondId]/buyback`). Non-defaulted bonds are bought at the pool ask; defaulted bonds are bought at **full face value** ($1,000/unit), which stops a CEO profiting by buying distressed debt cheaply:

```typescript
// src/app/api/bonds/[bondId]/buyback/route.ts

const pricePerUnit = bond.defaulted ? BOND_UNIT_FACE_VALUE : quote.askPerUnit;
const costLocal = units * pricePerUnit;

// Deduct from corporate liquidCapital
// Reduce bond.totalIssued and publicFloat
```

**Strategy:** Allows gradual debt reduction even when the corporation's bonds trade at distressed prices.

### Refinancing defaulted debt

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

A refinance is a debt-for-debt swap (`executeCorporationBondRefinance`, `src/lib/bonds/executeCorporationBondRefinance.ts`). One replacement bond is created for the full defaulted principal, every defaulted holder (and the public float) is rolled into it at par, and the old bonds are set `matured: true, defaulted: false` with `defaultCure: { cureMethod: "refinance", curedAtTurn }`. The corporation receives no cash and no sectors are sold. `bondDefaultRefinanceCount` goes up by one. The replacement is priced on the corporation's actual fundamentals, deliberately without the post-default CCC floor, because the penalty exists to make new borrowing dear and a forced roll of existing paper is not new borrowing.

#### Eligibility check

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

The `equity` passed in is going-concern equity: liquid capital plus sector NPV plus capitalized construction in progress (`totalEquityForBonds`). The exit-equity ceiling is deliberately not applied to a refinance: it governs new borrowing, and a refinance adds no debt, so capping it would lock a defaulted corporation out of the only cure it has.

#### 2x equity cap

New bond issuance is capped at 2x equity minus existing debt. For ordinary issuance there is also a tighter exit-equity ceiling (1.0x exit equity minus existing debt) and a per-issue cap of 25% of annual revenue (`effectiveBondIssuanceWindow`); refinancing of defaulted debt checks the 2x rule through `canRefinanceDefaultedDebt`:

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

The existing debt includes the defaulted bonds being refinanced, so the defaulted principal itself counts against the cap.

### Restructuring

`previewRestructure` (`src/lib/bonds/restructure.ts`) decides which sectors to sell. `executeCorporationBondRestructure` (`src/lib/bonds/executeCorporationBondRestructure.ts`) carries it out.

```
needFromSectors = max(0, defaultedPrincipal - liquidCapital)         (negative cash adds to the hole)
salvage(sector) = max(0, sector exit value) x RESTRUCTURE_SECTOR_SALVAGE_FRACTION   (0.85)
sell sectors in descending salvage order until proceeds >= needFromSectors
```

- Infeasible when total salvage of every sector is below `needFromSectors`.
- **Last-sector guard:** if the plan would sell every sector the corporation owns, it is declared infeasible, because selling the whole business is a dissolution wearing a restructure's message. The default then stands for the CEO to dissolve.
- On success the net cash (proceeds minus principal) is applied to `liquidCapital`, sectors leave through `disposeLeavingSectors`, holders are paid 100% of face, and the bonds get `defaultCure.cureMethod = "restructure"`.
- The sector exit value is book value under the plants market mode and going-concern NPV otherwise (`sectorExitValueByIdAnchor`, `src/lib/bonds/sectorExitBasis.ts`), built by the same helper the CEO-facing preview uses.

### Dissolution settlement

When a corporation dissolves, bond holders have priority claims on remaining assets.

#### Settlement preview

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
  const lc = Math.max(0, liquidCapitalAnchor - liabilitiesAnchor); // cash arrears
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

The executor (`executeCorporationBondDefaultDissolution`, `src/lib/bonds/executeCorporationBondDefaultDissolution.ts`) does more than the preview before it settles. It adds the share buyback escrow balance (positive or negative) to `liquidCapital` before the cash term is floored at zero. It also cashes out any non-matured bonds the dissolving corporation holds as a creditor, selling them to the bond market pool at the current price for whatever the pool can pay, and it distributes the corporation's cross-corporation share holdings in kind to its shareholders rather than at market price.

#### Payout priority

1. **Bond holders**, Paid first from `bondRecoveryPool` (up to total bond claims)
2. **Shareholders**, Receive `shareholderPool` (remaining assets after bond claims)

| Scenario      | Bond Recovery | Shareholder Recovery |
| ------------- | ------------- | -------------------- |
| Assets > Debt | 100%          | Remaining            |
| Assets = Debt | 100%          | 0%                   |
| Assets < Debt | Pro-rata      | 0%                   |

Each holder's payout is `round(ratio x face, 2)` where `ratio = bondRecoveryPool / totalBondClaims`. The bond market pool is a creditor for the public float units it holds and is credited its share.

#### Shareholder allocation

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

The public float slice is paid to the country's central bank reserve. Index-fund shareholders are paid into the fund's cash. Payouts are floored to whole units, so a few cents of rounding can remain undistributed.

#### Bond holder merging

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

**Purpose:** Aggregates holdings across multiple defaulted bonds for refinance and settlement calculations.

### Resolution routes

All routes live under `src/app/api/corporations/[id]/bond-default/`, are CEO-only, and are blocked while an admin has paused corporation actions (`requireCorporationActionsEnabled`).

| Route | Effect |
| --- | --- |
| `cash` | Pay defaulted principal from liquid capital (may draw on a positive buyback escrow) and mature those bonds. Holders receive full face. Not available to national corporations. |
| `refinance` | Issue a replacement bond for the full defaulted principal and roll holders in; max 2 per corporation; 2x equity rule applies; the CEO picks 96, 240 or 336 turns. Not available to national corporations or while an IMF restructuring is active. |
| `restructure` | Sell the minimum set of sectors that repays defaulted holders in full, cure the bonds, corporation survives; 400 if even selling everything cannot cover the debt. Not available to national corporations. |
| `dissolve` | Pay holders pro-rata from assets, remainder to shareholders; requires `confirm: true` (`bondDefaultDissolveSchema`, `src/lib/api/schemas/bondDefault.ts`) and a corporation at least 24 turns old |

If the CEO does nothing, `autoResolveLingeringDefaults` (Phase 7, `src/lib/turn/bondTurnAutoResolve.ts`) tries refinance, then restructure, then leaves the default standing. It notifies the CEO and writes an audit row for each action.

### Credit rating calculation

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

#### Component formulas

| Component         | Formula                                                    | Range |
| ----------------- | ---------------------------------------------------------- | ----- |
| Debt-to-Equity    | `100 - (D/E / 3) x 100` (D/E is 10 when equity is zero or negative and debt is positive, 0 when there is no debt) | 0-100 |
| Interest Coverage | `coverage x 20` (coverage is income / annual interest; 10 with income and no interest, 5 with neither) | 0-100 |
| Profitability     | `40 + ROE x 350` (positive) / `40 - 50 x sqrt(loss)` (negative, loss capped at 100%); ROE is 0 when equity is zero or negative | 5-100 |
| Liquidity         | `20 + liquidityRatio x 40`, then capped at the near-term maturity liquidity score when one is supplied | 0-100 |

`rawComposite = round(0.30 x DE + 0.25 x coverage + 0.25 x profitability + 0.20 x liquidity)`.

#### Inertia smoothing

Credit scores blend 75% new + 25% previous to prevent single-turn volatility:

```typescript
// src/lib/bonds/rules/corporateCreditScore.ts (inertia smoothing)

if (options?.previousCompositeScore != null && options.previousCompositeScore > 0) {
  compositeScore = Math.round(0.75 * rawComposite + 0.25 * options.previousCompositeScore);
}
```

Only the turn smooths. Display surfaces pass `persistedCompositeScore`, which is used verbatim, so a score is never blended twice.

#### Rating thresholds

`CREDIT_RATING_SPREADS` (`src/lib/db/types/centralBank.ts`) gives the base spread over prime by tier; corporate coupons add two more legs on top (see below). Thresholds are `CREDIT_RATING_THRESHOLDS` in `src/lib/constants/bonds.ts`.

| Rating | Threshold | Spread (over prime) |
| ------ | --------- | ------------------- |
| AAA    | 85+       | 0%                  |
| AA     | 70+       | 0.5%                |
| A      | 55+       | 1.5%                |
| BBB    | 40+       | 3%                  |
| BB     | 25+       | 5%                  |
| B      | 15+       | 8%                  |
| CCC    | 0+        | 12%                 |

Outside a default penalty, one notch down applies for insider concentration above 65% on a public corporation, and one notch up for meaningful index-fund ownership; the two net against each other. An active default penalty overrides both.

#### Corporate coupon rate

`getBondCouponRate` (`src/lib/constants/bonds.ts`) builds the actual **corporate** bond coupon from four legs, not the tier spread alone:

```
couponRate = primeRate + CREDIT_RATING_SPREADS[rating] + CORPORATE_BOND_SPREAD_PREMIUM + termPremium
```

- `CORPORATE_BOND_SPREAD_PREMIUM` = 1.0pp, added on every corporate issuance (sovereign/treasury issuance skips this leg and uses prime + tier spread alone).
- `termPremium` comes from `CORPORATE_BOND_TERM_PREMIUMS`, keyed by maturity in turns: 0pp at 48 and 96 turns, 1.0pp at 240 turns, 1.75pp at 336 turns.
- The result is rounded to two decimals. Per-turn coupon per unit is `couponRate / 100 x faceValue / 48` (`perTurnCouponPayment`).

### Key files

| File                                          | Purpose                                              |
| --------------------------------------------- | ---------------------------------------------------- |
| `src/lib/turn/bondTurn.ts`                    | Default detection, penalty application, bond marking |
| `src/lib/turn/bondTurnHelpers.ts`             | Escrow cover, solvency gate, cascade rollback        |
| `src/lib/turn/bondTurnAutoResolve.ts`         | Phase 7 auto-resolution                              |
| `src/lib/bonds/corporateBondDefault.ts`       | Refinance previews, dissolution math, holder merging |
| `src/lib/bonds/executeCorporationBondRefinance.ts`, `executeCorporationBondRestructure.ts`, `executeCorporationBondDefaultDissolution.ts` | The three executors |
| `src/lib/bonds/restructure.ts`, `sectorExitBasis.ts`, `corpExitEquity.ts` | Restructure planner and the shared exit basis |
| `src/lib/constants/bonds.ts`                  | Credit scoring, coupon rates, market pricing         |
| `src/app/api/bonds/[bondId]/buy/route.ts`     | Purchase logic (CEO block)                           |
| `src/app/api/bonds/[bondId]/buyback/route.ts` | CEO debt retirement                                  |
| `src/lib/db/types/bond.ts`                    | `Bond`, `defaulted`, `defaultedAtTurn`, `defaultCure` fields |

## Data

Collections read and written. "Player-visible" means shown in the bond, corporation or notification screens.

| Collection | Fields | Read / written | Player-visible |
| --- | --- | --- | --- |
| `bonds` | `defaulted`, `defaultedAtTurn`, `marketPrice`, `matured`, `defaultCure { cureMethod, curedAtTurn }`, `holders`, `publicFloat`, `totalIssued`, `maturityTurns`, `couponRate`, `currencyCode`, `corporationId`, `issuerType` | Phase 4 writes `defaulted`, `defaultedAtTurn`, `marketPrice`. Cures write `matured`, `defaulted: false`, `defaultCure`. Refinance inserts a new document. | Yes (price, default badge, "Default cured" badge) |
| `corporations` | `liquidCapital`, `shareEscrowBalance`, `bondDefaultCreditPenaltyUntilTurn`, `bondDefaultRefinanceCount`, `bondSettlementInProgressAt`, `operatingCashArrearsByCurrency`, `federalTaxArrearsAnchorByCountry`, `countryOwnerId`, `imfBailoutActive`, `foundedAtTurn`, `shareholders`, `totalShares`, `publicFloat` | Read by detection, cure and dissolution. Written: `liquidCapital` and `shareEscrowBalance` (escrow cover, cures), penalty field, refinance counter, settlement lock. | Cash, rating, penalty yes; the lock and counter no |
| `corporateSectors` | revenue, profit basis, build queue | Read for exit value. Restructure and dissolution release sectors. | Yes |
| `gameState` (`_id: "current"`) | `corporationActionsPaused` | Read: detection and Phase 7 are skipped while true | No |
| `gameConfig` (`_id: "default"`) | `marketSystemMode` | Read: selects book or NPV exit basis | No |
| `centralBanks` | `primeRate`, reserve | Read for prime rates. Dissolution credits the public-float slice to the reserve. | Yes |
| `corporationHistory` | `income` | Read by refinance for annual income | Yes |
| `characters`, `imperialCharacters`, `indexFunds`, `npps` | personal balance, `cashAnchor`, `nppInvestmentCashAnchor` | Written by cash cure, restructure and dissolution payouts | Balance yes |
| `adminLogs`, `actionAuditEntries` | `bond-default-auto-resolved`, `corp.auto_refinance`, `corp.auto_restructure` | Written by Phase 7 | No |
| notifications | `corp_bond_auto_refinanced`, `corp_bond_auto_restructured` | Written by Phase 7, addressed to the CEO | Yes |
| financial transaction log | `bond_maturity`, `bond_issuance` (amount 0 on a refinance), `bond_dissolution_payout`, `corp_dissolution_distribution` | Written by the cures | Admin only |

## Configuration

| Setting | Default | Effect | Where set |
| --- | --- | --- | --- |
| `gameState.corporationActionsPaused` | `false` | While true, default detection and Phase 7 auto-resolution are skipped, and all four cure routes return an error. Coupons and maturities still settle. | `gameState` document; type in `src/lib/db/types/gameState.ts` |
| `gameConfig.marketSystemMode` | `"off"` when absent (`getMarketSystemMode` in `src/lib/market/featureFlag.ts`) | At `"plants"` or above, exit value (solvency gate, restructure, dissolution) uses replacement-cost book value instead of going-concern NPV, and the growth-cost deduction is dropped | `gameConfig` document, type in `src/lib/db/types/gameConfig.ts` |
| `BOND_ISSUANCE_FREEZE_UNTIL` | 2026-08-12 (already past) | Blocked new corporate issuance in the launch window; it does not affect the default or cure paths | `src/lib/constants/bonds.ts` |
| Era unit scale | per world era | Scales the book value basis under plants (`loadWorldEraUnitScale`, `src/lib/currency/gdpAnchorRate.ts`) | Era preset |
| National corporation (`countryOwnerId`) and IMF restructuring (`imfBailoutActive`) | unset | National corporations are never defaulted, auto-resolved, or allowed to cash-pay, refinance or restructure. IMF-managed corporations are never auto-resolved, and cannot refinance. | Corporation document |

All numeric constants are code constants listed under Rules. There is no per-country or per-scenario override of them.

## Timing

Default handling runs inside `processBondTurn` (turn phase `bondTurn`, registered in `src/simulation/phases/turnPhaseRegistry.ts`). It runs after the corporation turn has produced the turn's income, in parallel with the `commodityPrices` phase, and before `recomputeSharePrices`, which re-prices shares from the post-bond cash position.

```
corporationTurn  (income, dividends)
      |
      v
bondTurn  ||  commodityPrices            (parallel)
  |  start: clear expired penalties (bondDefaultCreditPenaltyUntilTurn <= turn)
  |  Phase 1    coupons (defaulted bonds skipped)
  |  Phase 1.5  maturity flows pre-computed
  |  Phase 2    one cash delta per corporation
  |  Phase 3    detect: cash < 0 -> escrow cover -> solvency gate
  |  Phase 3.5  cascade: roll back defaulted issuer's maturity flows, holders may default
  |  Phase 3.6  penalty: max(old end, turn + 96)
  |  Phase 4    mark bonds defaulted, price 0.10
  |  Phase 5/6  settle matured bonds, bulk writes
  |  Phase 7    autoResolveLingeringDefaults (defaultedAtTurn < turn)
      |
      v
recomputeSharePrices  (reads post-bond cash)
```

Inside `bondTurn` the order is:

1. Phase 1: coupons paid; Phase 1.5 and 2: maturity flows pre-computed and all per-corporation cash changes applied in one delta.
2. Phase 3: default detection (cash negative, escrow cover, solvency gate).
3. Phase 3.5: cascade, holder corporations pushed negative by a defaulted issuer also default; the issuer's maturity flows are rolled back.
4. Phase 3.6: credit penalty applied once to every defaulted corporation.
5. Phase 4: bonds marked defaulted at price 0.10.
6. Phase 5 and 6: matured bonds settled, bulk writes applied.
7. Phase 7: `autoResolveLingeringDefaults`, for corporations whose default is at least one turn old (`defaultedAtTurn < turn`).

Detection is skipped entirely while corporation actions are paused (coupons and maturities still settle), because the pause removes the corporation's income and the shortfall would not be the corporation's fault. Phase 7 is skipped too: the CEO's four cure routes are blocked during a pause, so counting paused turns against the CEO's response window would force-sell assets for a deadline they were locked out of. The clock resumes when corporations do.

CEO routes run at request time, not in a phase. They take the corporation settlement lock (`bondSettlementInProgressAt`) and are rejected with 409 if a settlement is already in progress.

## Worked trace

Setup, all in ₳ for simplicity (legacy NPV exit basis, plants off, no escrow, no arrears, no held bonds, no construction in progress). A corporation older than 24 turns has one bond of 200 units at 1,000 face (200,000 total). After Phase 2 its `liquidCapital` is -3,000. Its single sector has going-concern NPV 150,000. A holder owns 100 units.

**Turn T, Phase 3.**
1. Candidate: -3,000 < 0 and not a national corporation.
2. Escrow cover: `computeBondShortfallEscrowCover` with escrow 0 returns 0, so the corporation stays negative.
3. Solvency gate: exit equity = (-3,000 - 0) + 150,000 + 0 + 0 = 147,000. Debt = 200,000. 147,000 < 200,000, so it is insolvent and defaults. (With sector NPV of 450,000 instead, exit equity would be 447,000, above the debt, and the corporation would only be illiquid and would not default.)

**Phase 3.6 and 4.** `bondDefaultCreditPenaltyUntilTurn = max(0, T + 96) = T + 96`. The bond gets `defaulted: true`, `defaultedAtTurn: T`, `marketPrice: 0.1`. The holder's 100 units are worth 100 x 1,000 x 0.10 = 10,000 at the stored price, and the bond pays no coupon.

**Credit rating while the penalty runs.** Assume annual income 24,000 and a 8% coupon, so annual interest is 0.08 x 200,000 = 16,000, and a previous composite of 60.
- Debt-to-equity: D/E = 200,000 / 147,000 = 1.3605, score = 100 - (1.3605 / 3) x 100 = 54.65.
- Interest coverage: 24,000 / 16,000 = 1.5, score = 1.5 x 20 = 30.
- Profitability: ROE = 24,000 / 147,000 = 0.16327, score = 40 + 0.16327 x 350 = 97.14.
- Liquidity: ratio = -3,000 / 16,000 = -0.1875, score = 20 + (-0.1875 x 40) = 12.5.
- Raw composite = round(0.30 x 54.65 + 0.25 x 30 + 0.25 x 97.14 + 0.20 x 12.5) = round(16.39 + 7.5 + 24.29 + 2.5) = round(50.68) = 51.
- Smoothed = round(0.75 x 51 + 0.25 x 60) = round(53.25) = 53, which would be BBB.
- Penalty active: rating is forced to CCC and the score becomes min(53, 12) = 12.

**Turn T + 1, Phase 7.** `defaultedAtTurn` (T) is less than the current turn, so auto-resolution runs.
- Refinance: equity = -3,000 + 150,000 + 0 = 147,000. Existing debt (all non-matured, including the defaulted bond) = 200,000. Max new face = floor_to_1,000(max(0, 2 x 147,000 - 200,000)) = 94,000. Required face = 200,000, which meets the 100,000 minimum but exceeds 94,000. Not eligible ("Cannot refinance within debt limits").
- Restructure: need = max(0, 200,000 - (-3,000)) = 203,000. Total salvage = 0.85 x 150,000 = 127,500, which is below 203,000. Infeasible. The default stands.

**CEO dissolves** (confirm true, corporation older than 24 turns).
- Cash term = max(0, -3,000 - 0) = 0. Salvage = 0.20 x 150,000 = 30,000. Total assets = 30,000.
- Claims = 200,000. Recovery pool = min(30,000, 200,000) = 30,000. Shareholder pool = 0. Recovery = 15%.
- Ratio = 30,000 / 200,000 = 0.15. The holder's 100,000 face receives 0.15 x 100,000 = 15,000.

So in this case dissolution (15,000) pays slightly more than the 0.10 stored price (10,000) implied, and shareholders get nothing.

## Edge cases and limits

- **Cash negative is not insolvency.** A corporation with negative cash but assets above its debt (on the restructure planner's exit basis) is illiquid, not defaulted. A positive buyback escrow can also cover the shortfall first.
- **National corporations never default through this path.** Detection filters them out (`negativeNonNatcorp`), and cascade candidates exclude them too.
- **Cascade defaults skip the solvency gate.** A holder corporation that goes negative because an issuer failed to pay defaults without the asset test, since a counterparty genuinely failed to pay it. The cascade still tries the positive-escrow cover first and converges because each wave adds at least one corporation.
- **Penalty extends, never shortens.** A new default sets the end turn to the later of the old end and `turn + 96`.
- **Score cap overrides notches.** An active default penalty forces CCC and a score of at most 12, ahead of the insider-concentration downgrade and the index-fund upgrade.
- **Sovereign bonds cannot default** through this path; lingering-default auto-resolution selects only non-sovereign issuers.
- **Auto-resolution exclusions.** National corporations and IMF-managed corporations are never auto-resolved, and national corporations cannot refinance or cash-pay.
- **Refinance limit.** After 2 refinances the route returns "Refinance limit reached"; restructure or dissolution are the remaining exits. The limit stops default-and-refinance cash-extraction loops.
- **Refinance minimum.** Defaulted principal below 100,000 (after rounding down to whole units) cannot be refinanced, so a small default goes to restructure or dissolution.
- **Auto-refinance term.** The automatic replacement takes the longest maturity among the defaulted bonds that is above 96, otherwise 96 turns. A 48-turn bond is therefore replaced by a 96-turn bond.
- **Restructure never sells the last sector.** See the last-sector guard under Restructuring.
- **Dissolution cash is net of arrears.** Cash available to bondholders is liquid capital (plus the signed buyback escrow, in the executor) minus operating-cash and federal-tax arrears, floored at zero. A negative balance beyond cash is borne by equity, with no clawback.
- **Under the plants market mode** dissolution salvage applies the 0.20 fraction to sector book value, not NPV, so salvage is always below build cost and build-then-dissolve cannot mint money.
- **Defaulted holders stay put.** A defaulted bond keeps its `holders`; they are not moved to the public float.
- **Zero cases.** If total bond claims are zero the recovery percentage is reported as 100. If equity is zero or negative, the 2x cap is zero and no new issuance is possible. If `totalShares` is zero or the shareholder pool is zero, no shareholder rows are produced.
- **Cash cure funds.** The cash route needs liquid capital plus any positive escrow to cover the full defaulted principal; it draws liquid capital first, then escrow.
- **Self-held paper.** A corporation holding its own bonds counts them as an asset in exit equity, because its debt figure already includes those units.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| A corporation inside its quoted issuance ceiling is never judged insolvent (debt at most exit equity at issuance) | Same exit basis in `effectiveBondIssuanceWindow` and `filterInsolventCorps`; `src/lib/constants/__tests__/bondIssuanceWindow.test.ts`, `src/lib/turn/bondTurnHelpers.test.ts` |
| Preview and executor use one exit basis, so the number a CEO is quoted is the number settled | `src/lib/bonds/sectorExitBasis.test.ts` ("preview/executor basis consistency") |
| Dissolution does not mint or destroy value: bond pool plus shareholder pool equals total assets, and shareholder slices sum to the pool | `src/lib/bonds/corporateBondDefault.test.ts` (reconciliation test); the executor's leg-sum check in `executeCorporationBondDefaultDissolution.test.ts` |
| Refinance moves no cash and sells no sectors; the lifetime cap is 2 | `src/lib/bonds/executeCorporationBondRefinance.test.ts` |
| Restructure pays 100% of face, or is infeasible, and never sells every sector | `src/lib/bonds/restructure.test.ts` |
| No default detection, penalty stamp or auto-resolution while corporation actions are paused | `src/lib/turn/bondTurn.test.ts` ("ticket #1198: corporation actions paused") |
| Auto-resolution order is refinance, then restructure, then stand | `src/lib/turn/bondTurn.test.ts` ("Phase 7 auto-resolution ordering") |
| An expired penalty is cleared | `src/lib/turn/bondTurn.test.ts` ("clears expired bond default credit penalties") |
| A defaulted bond pays no coupon on either side | `bondAccruesCoupon`; covered in `src/lib/turn/bondTurn.test.ts` |
| A CEO, pending CEO or recent ex-CEO cannot buy their corporation's bonds | Route check in `buy/route.ts`; not covered by a dedicated test in this area |
| Penalty end turn never moves earlier | `Math.max` in Phase 3.6; not directly tested |
| Units held plus public float equal bond units after a refinance | Built by construction from merged holder units in `executeCorporationBondRefinance`; not asserted at runtime |

## Failure and recovery

- **Wrongly defaulted corporation.** A corporation defaulted for a cash dip it could have covered, or during a pause. Seen as a default notice, CCC rating and sectors sold by auto-resolution. Repaired by the heal tooling: restore the sectors and cash and clear the default and penalty flags. Prevented since the solvency gate and pause skip were added.
- **Stuck settlement lock.** A crash during a cure can leave `bondSettlementInProgressAt` set, so later cure attempts get 409. The lock is released in a `finally` block by `withCorporationSettlementLock` (`src/lib/corporations/settlementLock.ts`) and has no expiry, so a process killed mid-cure leaves it set until an operator clears the field.
- **Partial cash cure.** The cash route runs in a transaction where the database supports it, and otherwise applies each credit separately and reverses earlier credits on a failure (compensation). A compensation failure is reported to error monitoring and needs a heal.
- **Turn crash mid-phase.** The bond turn stores its result with a completed status, and a resume reuses it instead of rerunning, so settlement is not paid twice.
- **Default that no cure can fix.** When refinance and restructure are infeasible the default stands. The CEO dissolves, or an admin force-liquidates through the same dissolution executor.
- **Mismatched holder data.** The cure routes refuse to move money if a holder document is missing ("Bond holder data is inconsistent"), so the corporation is not debited for credits that cannot land. Repaired by a heal of the bond holders.
- **Rerun.** Phase 7 is idempotent for a corporation that is already cured: it only selects bonds that are unmatured and defaulted.

## Connections

**Driven by:**

- [Corporations](./corporations.md): corporate cash, sector value and income decide whether coupons and maturities push a corporation negative (`processCorporationTurn` output read by `processBondTurn`).
- [Currency Exchange](./currency-exchange.md): bonds settle in their own currency, converted to the anchor currency for equity and claim comparisons (`loadFxRatesByCurrency`, `corpCapitalToAnchor`).
- Central bank prime rate: sets coupon rates and live bond prices (`buildPrimeRateMap` in `src/lib/bonds/corporateBondDefault.ts`).
- Admin pause of corporation actions: `gameState.corporationActionsPaused`, read at the top of `processBondTurn`.
- Market system mode: `gameConfig.marketSystemMode`, read by `filterInsolventCorps` and the executors.

**Affects:**

- [Corporations](./corporations.md): default forces CCC and blocks cheap credit for 96 turns, can sell sectors (restructure) or end the corporation (dissolve) through `disposeLeavingSectors` and `executeCorporationBondDefaultDissolution`.
- [Stock Market](./stock-market.md): `recomputeSharePrices` re-prices shares from post-default cash; dissolution pays shareholders last.
- [Sovereign Bonds](./sovereign-bonds.md): holders of the defaulted paper (players, funds, other corporations) take the loss; sovereign bonds themselves cannot default through this path.
- Corporate IMF restructuring: a bond default and outstanding bond principal make a corporation a rescue candidate (see the player page).
- Index funds: funds holding defaulted paper are paid on cash cure and written off on dissolution (`payFundShareholderRows`, `writeOffFundHoldingsInDissolvedCorporation`).
- Central bank reserve: the public-float slice of a dissolution is credited to the reserve.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/turn/bondTurn.test.ts` | Default marking, cascade (two and three levels), pause behaviour, penalty expiry, auto-resolution ordering, auto-redeem |
| `src/lib/turn/bondTurnHelpers.test.ts` | Solvency gate, bond portfolio as asset, fail-safe fallbacks |
| `src/lib/bonds/corporateBondDefault.test.ts` | Dissolution preview, refinance eligibility and pricing, shareholder allocation |
| `src/lib/bonds/restructure.test.ts`, `executeCorporationBondRestructure.test.ts` | Restructure planner, last-sector guard, executor |
| `src/lib/bonds/executeCorporationBondRefinance.test.ts` | Refinance, leverage refusal, cap |
| `src/lib/bonds/executeCorporationBondDefaultDissolution.test.ts` | Dissolution ledger legs and fund payout |
| `src/lib/bonds/sectorExitBasis.test.ts` | Preview and executor basis agreement |
| `src/lib/constants/__tests__/bondIssuanceWindow.test.ts`, `src/lib/constants/bonds.test.ts` | Issuance window and constants |
| `src/app/api/corporations/[id]/bond-default/route.test.ts` and the `cash`, `dissolve`, `refinance` route tests | Route authorization and responses |
| `src/app/api/bonds/[bondId]/buyback/route.test.ts` | CEO buyback |

Gaps: no test file for the `restructure` route, none for the `buy` route's CEO self-buy block, and the `sell` route's test does not cover its defaulted-bond refusal. The 20% and 85% salvage constants are exercised through the planner and preview tests but not pinned by a dedicated constants test.

## Known issues and history

- **Player wiki contradiction (defaulted bonds).** The player page says defaulted bonds "can still be traded on the open market at distressed prices". In code a holder cannot sell a defaulted bond (`sell/route.ts` returns "Cannot sell a defaulted bond"); only buying from the public float at 0.10 and the CEO buyback at full face are possible.
- **Stale message.** The dissolve route's success message says holders and shareholders were paid "from liquid capital and sector NPV". The real basis is cash plus 20% of sector value (book under plants).
- **Refinance cap message.** The route text says dissolution is "the only remaining option" once the cap is reached, but restructure is also available.
- **Earlier doc example corrected.** The previous worked example mixed an 90,000 equity with a 450,000 sector value. With real formulas the solvency gate would not have defaulted that corporation, so the trace above uses consistent figures.
- **Score cap wording corrected.** The cap of 12 is below the B threshold of 15; the CCC tier starts at 0.
- **Maturity liquidity horizon is provisional.** `CORPORATE_CREDIT_MATURITY_HORIZON_TURNS` (24 turns) is noted in code as provisional until balance qualification.
- Dated changes recorded in code comments and tests: ticket 1130 (refinance repriced on fundamentals, solvency gate added, last-sector guard), ticket 1198 (shared exit-equity basis, bond portfolio counted as an asset, pause skips detection and auto-resolution). Exact dates are not recorded in this page's earlier versions.

Last checked: 2026-10-29, version 1.18.0
