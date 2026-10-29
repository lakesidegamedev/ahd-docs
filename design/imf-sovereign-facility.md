# IMF Sovereign Facility

The IMF sovereign facility is the "bailout" resolution path for a sovereign debt crisis. When a country enters a crisis (failed bond auctions, unsustainable debt/GDP) and the executive chooses **bailout** instead of restructure or repudiate, the country's rollover need and deficit are consolidated into a single amortizing loan from the IMF Corp. The facility is repaid over time out of the country's own revenue, capped at a fraction of per-turn income, exactly like the corporate IMF bailout caps payments at a fraction of income, but the sovereign version uses federal revenue instead of corporate operating income, and the borrower is a country's `federalBudget` row rather than a `Corporation` document.

This is a separate system from the [corporate IMF bailout](imf-corporate-bailout.md). Both borrow the same IMF Corp entity and the same annuity-with-income-cap math (`imfFacilityMath.ts`), but they apply to different debtors and are triggered by different subsystems (sovereign default vs. corporate bond default).

## Trigger: sovereign default crisis

A country enters a sovereign crisis (`sovereignCrisisState: "crisisPending"`) through `crisisDetection.ts`, driven by debt/GDP penalties on bond demand and a failed-auction counter:

- `DGDP_PENALTY_FLOOR = 0.6`, `DGDP_PENALTY_RATE = 0.3`, demand starts penalized above 60% debt/GDP.
- `DGDP_CLIFF_FLOOR = 2.0`, `DGDP_CLIFF_RATE = 0.4`, a steeper demand cliff above 200% debt/GDP.
- `DEMAND_UNDERSUBSCRIBED_THRESHOLD = 0.7`, an auction is "failed" when demand falls below 70% of the offering.
- `FAILED_AUCTION_COUNT_FOR_CRISIS = 3`, three consecutive failed annual auctions trigger `crisisPending`.

Once in `crisisPending`, the executive has `EXECUTIVE_DECISION_TURNS = 12` turns to choose repudiate, restructure, **bailout**, or **monetize**. Monetize is blocked at 8% inflation or above. If no executive decision lands in time, `crisisAutoAction.ts` automatically selects Repudiate; the legislative flow uses `LEGISLATIVE_VOTE_TURNS_PER_CHAMBER = 24` per chamber.

## Applying the bailout: `applyBailoutResolution`

`src/lib/sovereignDefault/resolution/bailout.ts` runs when the bailout choice is ratified (in Phase 5 as documented, executive submission auto-ratifies without the bicameral gate). It:

1. Requires `sovereignCrisisState` to be `crisisPending` or `crisisResolving`; otherwise returns `not-in-crisisPending`.
2. Requires a seeded IMF Corp (`imfInstitution: true` on the `corporations` collection); otherwise returns `no-imf-corp`.
3. Computes facility terms via `computeSovereignBailoutTerms` (see below).
4. Writes facility state onto the country's `federalBudget` document and sets `sovereignCrisisState: "recovering"`.
5. Opens a 12-turn IMF Board override window.
6. Emits bailout-granted news, applies executive political impact, and emits a civil-unrest event chain for the "bailout" path.

## Facility terms: `computeSovereignBailoutTerms`

`src/lib/sovereignDefault/imfSovereignFacility.ts`. Pure math, no DB access.

```typescript
const rollover = Math.max(0, inputs.rolloverFaceValue);
const deficit = Math.max(0, inputs.annualDeficit);
const principal = rollover + deficit;
```

- **Principal** = next-12-turn bond rollover face value (`calculateSovereignRolloverAmount`, bonds maturing in the next 12 turns) plus the projected annual deficit (`Math.max(0, -budget.surplus)`). Both inputs are floored at 0; a country in surplus with a failed-auction crisis can still get a bailout sized to its rollover need alone.
- **Annual rate**: `IMF_SOVEREIGN_DEFAULT_RATE = 0.06` (6% annual), fixed, not risk-adjusted.
- **Amortization horizon**: `IMF_SOVEREIGN_AMORTIZATION_TURNS = 240` turns.
- **Income capture fraction**: clamped between `IMF_SOVEREIGN_INCOME_CAPTURE_MIN = 0.1` and `IMF_SOVEREIGN_INCOME_CAPTURE_CAP = 0.3`, defaulting to `IMF_SOVEREIGN_INCOME_CAPTURE_DEFAULT = 0.2` (20% of per-turn revenue).

These four values (principal, rate, amortization turns, capture fraction) are written onto the `federalBudget` row as:

| Field                                            | Meaning                                    |
| ------------------------------------------------ | ------------------------------------------ |
| `imfSovereignBailoutActive`                      | Facility is live                           |
| `imfSovereignFacilityPrincipalOutstanding`       | Remaining principal (₳)                    |
| `imfSovereignFacilityAnnualRate`                 | Annual rate, percent                       |
| `imfSovereignFacilityAmortizationTurnsRemaining` | Turns left on the amortization clock       |
| `imfSovereignFacilityIncomeCaptureFraction`      | Fraction of per-turn revenue captured      |
| `imfSovereignFacilityImfCorporationId`           | IMF Corp receiving payments                |
| `imfSovereignFacilityCumulativePaidAnchor`       | Lifetime anchor (₳) paid into the facility |

## Per-turn payment: `processSovereignImfFacilityPayments`

`src/lib/sovereignDefault/imfSovereignFacilityTurn.ts`, run every turn against every `federalBudget` with `imfSovereignBailoutActive: true`. Same annuity-with-income-cap kernel as the corporate facility (`computeImfFacilityPaymentTurn` in `src/lib/imf/imfFacilityMath.ts`):

1. Per-turn revenue is approximated as `budget.revenue.total / TURNS_PER_YEAR`.
2. The scheduled payment is a level annuity on the outstanding principal at the per-turn rate (`annualRatePercent / 100 / TURNS_PER_YEAR`) over the remaining amortization turns.
3. Actual payment = `min(scheduledPayment, perTurnRevenue * incomeCaptureFraction)`.
4. If the cap binds and doesn't cover full interest, the interest shortfall is **capitalized onto principal** and the amortization clock does not advance that turn (the country gets more time, but the loan grows).
5. When principal clears (`newPrincipal <= 1e-6`), `imfSovereignBailoutActive` is set back to `false`.

Budget-side revenue netting (i.e. deducting the payment from the country's own budget metrics) is explicitly out of scope for this phase per the code comment, "Phase 5 only models the IMF Corp credit side; budget-revenue netting lands in Phase 8 / 10 calibration." The processor only credits the IMF Corp and decrements the facility principal.

### FX conversion

The country's revenue is in its local currency; the IMF Corp's `liquidCapital` is in its own `liquidCurrencyCode` (typically USD). Each turn's payment is converted local currency → anchor (`corpCapitalToAnchor`) → IMF Corp currency (`anchorToCorpLiquidCapital`), and the anchor amount is also accumulated into `imfSovereignFacilityCumulativePaidAnchor` on the budget row in the same write.

## IMF Board override window

`POST /api/imf/board/override` (`src/app/api/imf/board/override/route.ts`). Any character who is a shareholder of the IMF Corp (`isImfBoardMember`) can act once, within the window opened by `applyBailoutResolution` (`IMF_BOARD_OVERRIDE_WINDOW_TURNS = 12` turns / `IMF_BOARD_OVERRIDE_WINDOW_HOURS = 12` as the wall-clock fallback):

- `modify-terms`: adjust `imfSovereignFacilityAnnualRate` by a clamped delta (`IMF_BOARD_RATE_DELTA_BOUND = 0.02`, i.e. ±2 percentage points) and `imfSovereignFacilityIncomeCaptureFraction` by a clamped delta (`IMF_BOARD_CAPTURE_DELTA_BOUND = 0.1`).
- `endorse` / `criticize`: posts a public board statement and applies a cross-country trust hit of `IMF_BOARD_PUBLIC_TRUST_DELTA = 0.02` (positive for endorse, negative for criticize) via `applyCrossCountryTrustHit`.
- `no-action`: records the window as actioned with no term or trust change.
- Guarded by an atomic `updateOne` filtered on `imfBoardOverrideAt: null` so two board members racing to act in the same window can't both apply (loser gets HTTP 409).
- Only one override action total is allowed per bailout grant, not one per action type.

## Read surfaces

- `GET /api/imf/overview` (`src/app/api/imf/overview/route.ts`): IMF Corp balance, board members (IMF Corp shareholders with a linked character), all countries with `imfSovereignBailoutActive: true` (principal, rate, amortization turns remaining, capture fraction, cumulative paid), lifetime total received across every country that has ever paid in, and pending board-override windows still open.
- `GET /api/country/[code]/sovereign-status` (`src/app/api/country/[code]/sovereign-status/route.ts`): per-country crisis state, recovery progress, and `imfSovereignBailoutActive` flag, consumed by `SovereignRecoveryProgressPanel.tsx` on the country page. That panel shows recovery-floor progress against `RECOVERY_FLOOR_TURNS = 48` and fiscal-discipline streak against `RECOVERY_DISCIPLINE_REQUIRED_STREAK = 5`, plus an "IMF bailout facility active" badge when the flag is set. It does not show facility principal, rate, or capture fraction, that detail lives only in the `/api/imf/overview` payload.

## Recovery after bailout

Entering the facility puts the country into `sovereignCrisisState: "recovering"`. The bailout path applies no direct flat GDP penalty in the resolution code (`src/lib/sovereignDefault/resolution/bailout.ts`); its cost is the ongoing income capture plus a temporary sector-margin penalty (`DEFAULT_MARGIN_PENALTY_BAILOUT = -0.045` in `src/lib/sovereignDefault/constants.ts`). The other two resolution paths do apply a direct GDP penalty: `REPUDIATE_GDP_PENALTY = 0.12` (12%, over `REPUDIATE_GDP_PENALTY_TURNS = 3` turns) and `RESTRUCTURE_GDP_PENALTY = 0.06` (6%, over `RESTRUCTURE_GDP_PENALTY_TURNS = 2` turns). Recovery requires `RECOVERY_FLOOR_TURNS = 48` turns minimum plus a `RECOVERY_DISCIPLINE_REQUIRED_STREAK = 5`-turn streak of fiscal discipline, rechecked every `RECOVERY_DISCIPLINE_RECHECK_TURNS = 5` turns.

## Contrast with the corporate IMF bailout

|              | Sovereign facility                                                         | Corporate bailout                                        |
| ------------ | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| Debtor       | Country `federalBudget` row                                                | `Corporation` document                                   |
| Trigger      | Failed-auction sovereign crisis, executive chooses bailout                 | Admin-initiated restructuring of a distressed corp       |
| Rate         | Fixed 6% annual (`IMF_SOVEREIGN_DEFAULT_RATE`)                             | Design-tunable per corp (`imfFacilityAnnualRate`)        |
| Amortization | 240 turns (`IMF_SOVEREIGN_AMORTIZATION_TURNS`)                             | Term set at bailout time                                 |
| Payment cap  | Income-capture fraction 10-30%, default 20%, of per-turn revenue           | 45% of per-turn corporate income                         |
| Equity       | None, no ownership dilution                                                | IMF receives new shares up to a target ownership percent |
| Oversight    | IMF Board 12-turn override window (rate/capture nudge or public statement) | Admin-only controls, no board mechanic                   |
| Math kernel  | Shared `computeImfFacilityPaymentTurn` (`src/lib/imf/imfFacilityMath.ts`)  | Same shared kernel                                       |

## Key Files

- `src/lib/sovereignDefault/imfSovereignFacility.ts`, `computeSovereignBailoutTerms` (principal, rate, amortization turns, capture fraction)
- `src/lib/sovereignDefault/imfSovereignFacilityTurn.ts`, `processSovereignImfFacilityPayments`, per-turn credit to IMF Corp
- `src/lib/sovereignDefault/resolution/bailout.ts`, `applyBailoutResolution`, entry point when the bailout resolution is ratified
- `src/lib/sovereignDefault/constants.ts`, all `IMF_SOVEREIGN_*` and `IMF_BOARD_*` constants, plus crisis-trigger and resolution-path constants
- `src/lib/sovereignDefault/crisisDetection.ts`, debt/GDP and failed-auction trigger into `crisisPending`
- `src/lib/imf/imfFacilityMath.ts`, `computeImfFacilityPaymentTurn`, `imfLevelPaymentPerTurn`, `imfPerTurnInterestRate` (shared with the corporate facility)
- `src/lib/imf/resolveImfCorporation.ts`, `getImfCorporation`, singleton lookup by `imfInstitution: true`
- `src/lib/bonds/sovereign.ts`, `calculateSovereignRolloverAmount`, `getNationalBudgetId`
- `src/app/api/imf/overview/route.ts`, `GET /api/imf/overview`
- `src/app/api/imf/board/override/route.ts`, `POST /api/imf/board/override`
- `src/app/api/country/[code]/sovereign-status/route.ts`, `GET /api/country/[code]/sovereign-status`
- `src/components/country/SovereignRecoveryProgressPanel.tsx`, recovery-progress UI panel
- `src/lib/db/types/budget.ts`, `FederalBudget` type, `imfSovereign*` and `imfBoardOverride*` fields
