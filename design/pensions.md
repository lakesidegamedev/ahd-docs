# Occupational Pensions

Second-pillar pension funds attached to unions. The state pension (first pillar) is a separate pay-as-you-go budget line (`{cc}.health.socialInsurance.primary`) funded out of tax; this system does not touch it. An occupational pension is bargained into a collective agreement alongside wages: the employer pays a contribution rate into a fund the union holds, covered workers accrue a claim against that fund, and the fund pays benefits to retirees out of its own cash. It ships as part of the A8 union-bargaining work and depends on `labourSystemMode >= "full"` (see `design/labour.md`) for the bargaining path that sets the rate; the turn-processing pass itself runs whenever an active `CollectiveAgreement` carries a `pensionContributionRate`.

Player guide: [Pensions](https://www.ahousedividedgame.com/wiki/pensions)

Every anchor (₳) that enters a scheme was debited from a real employer's `liquidCapital` and ledgered on both legs. A scheme cannot mint assets. This is deliberately unlike the NPP investable-cash accrual, which is an uninstrumented modelled mint outside the ledger perimeter, a pension scheme that minted its own assets would be a second one of those in a system whose whole point is that the assets are real and can fall short.

## Bargaining the rate

`pensionContributionRate` is a term in `BargainingTerms`, set by either party's offer during a bargaining campaign, alongside `wageLevel`, `agreementDurationTurns`, and `noStrikeTurns`. Valid range is `PENSION_CONTRIBUTION_RATE_MIN` (0) to `PENSION_CONTRIBUTION_RATE_MAX` (0.15), up to 15% of the covered wage bill. An omitted or zero rate means no pension was bargained.

Mediation splits the pension question the same way it splits the wage question: leverage-weighted between the two sides' latest offers.

```
unionWeight = 0.35 + (campaign.mandate.leverage / 100) * 0.3
pensionContributionRate = round(employerRate + (unionRate - employerRate) * unionWeight, 4dp)
```

The settled term is written onto the resulting `CollectiveAgreement.pensionContributionRate` (optional field, absent reads as zero) only when the mediated rate is greater than 0.

## The turn pass (`pensionTurn` phase)

Runs once per turn, registered as the `pensionTurn` phase in `turnPhaseRegistry.ts`, immediately after `corporationTurn`. Order matters: the wage bill the pension pass reads is written by that turn's corp processing, and phase 2 (benefits, investing) needs the mark-to-market and contribution numbers from phase 1 before it runs.

### The wage bill

`sector.laborCost` is written by the corporation turn as a DAILY figure (per-turn cost times `TURNS_PER_DAY`, same convention as `revenue`). The pension pass is a per-TURN pass, so it divides that figure back down (`coveredWageBillPerTurn`) before charging anything against it. `sector.laborCost` is documented elsewhere as display/analytics telemetry, not normally read back into the economy; the pension pass is an exception and treats an absent or non-finite figure as contributing nothing, the labour system can be off entirely, and inventing a wage bill would charge an employer for workers the economy is not modelling. The same wage-bill figure drives both the contribution and the accrual, so the two are always measured against the same population.

### Step 1: contribution

For each active agreement with `pensionContributionRate > 0`:

```
contribution = coveredWageBill * pensionContributionRate
```

Debited from the employer's liquid capital via `atomicallyDebitCorpLiquidCapital`. If the employer cannot pay, the contribution is simply not made, the claim is **not** forgiven; it still accrues (step 3). This is ledgered as a `pension_contribution` financial-tx-log entry on both legs (employer debit, scheme credit).

### Step 2: top-up

If the scheme is short of `PENSION_DEFICIT_RATIO` (0.9) funded, the employer is asked for an additional top-up, computed against the position **before** this turn's accrual (so a top-up never bills an employer for a shortfall the same turn's accrual just created):

```
fundingRatio = totalAssets / liabilities   (1 if no liabilities, 0 if no assets)
target = liabilities * PENSION_DEFICIT_RATIO
shortfall = target - assets
topUp = shortfall * PENSION_TOPUP_FRACTION   (0.05, i.e. 5% of the shortfall per turn)
```

`totalAssets` here is cash (`assetsAnchor`) plus this turn's paid contribution plus the marked-to-market value of any invested units (`investedValueAnchor`), never cash alone, or a scheme that had simply invested half its money would read as half funded. The top-up is deliberately partial (5%/turn): closing a deficit in one turn would bankrupt an employer for a slow-moving accounting number; a scheme recovering over roughly a couple of game-years is the intended shape. Also debited via `atomicallyDebitCorpLiquidCapital`; failure increments `shortfalls` and does not forgive the claim.

### Step 3: accrual

Always applied, whether or not the employer could pay steps 1-2:

```
accrual = coveredWageBill * PENSION_ACCRUAL_RATE   (0.08)
```

Added to `scheme.liabilitiesAnchor`. The accrual rate (8%) is set below the contribution ceiling (15%) on purpose: a scheme bargained at the maximum contribution rate builds a surplus rather than running to stand still, so the bargained rate is a real choice with a visible consequence either way. At a contribution rate of 0, a scheme still accrues liabilities it never funds, the correct picture of promising a pension and paying nothing in.

### Funding bands

```
pensionFundingRatio = assets / liabilities   (1 if liabilities <= 0, 0 if assets <= 0)
```

| Band | Condition |
| --- | --- |
| `surplus` | ratio > 1.1 |
| `funded` | 0.9 <= ratio <= 1.1 |
| `deficit` | 0.6 <= ratio < 0.9 (`PENSION_DEFICIT_RATIO`) |
| `critical` | ratio < 0.6 (`PENSION_CRITICAL_RATIO`) |

`describeFundingBand()` supplies one sentence per band for the union dashboard and employer console (e.g. deficit: "The scheme is short. The employer is being asked for a top-up every turn until it recovers.").

### The scheme document

One `PensionScheme` per union, created (`ensurePensionScheme`) the first time an agreement settles with a contribution rate above zero. A union that never bargained a pension has no scheme document at all, not a row of zeroes. Key fields: `assetsAnchor` (cash), `investedValueAnchor` (marked-to-market fund units, phase 2), `liabilitiesAnchor` (total accrued claims), `benefitsInPaymentAnchor` (the slice of liabilities that has come into payment), and cumulative counters `totalContributionsAnchor`, `totalTopUpsAnchor`, `totalBenefitsPaidAnchor`, `totalBenefitsUnpaidAnchor`, `totalInvestedAnchor`.

## Phase 2, part A: benefits in payment

Runs after the contribution/accrual sweep, via `runPensionBenefitsTurn`, for every scheme with `liabilitiesAnchor > 0` (independent of whether any agreement is still active, a scheme with liabilities and no live agreement is the ordinary end state of a workplace that closed).

Union membership has no individual pensioner: it's modelled in aggregate (a sector's unionization rate, a union's membership pressure), and a player character who retires is deleted outright by `retireCharacter`. So benefits are a flow against the modelled covered workforce as a whole, ledgered with `counterpartyType: "system"` / `counterpartyName: "Pensioners"`, exactly like other payments that leave the instrumented perimeter.

**Retirement (claims coming into payment):**

```
notYetInPayment = liabilities - benefitsInPayment
retirements = notYetInPayment * PENSION_RETIREMENT_RATE   (0.01, i.e. 1%/turn)
```

Runs before the drawdown is computed, so a scheme's first pensioners start drawing the turn they retire rather than a turn later.

**Benefits due:**

```
benefitsDue = (benefitsInPayment + retirements) * PENSION_BENEFIT_DRAWDOWN_RATE   (0.02, i.e. 2%/turn)
```

The stock drains gradually (2%/turn of whatever is in payment) rather than paying out in one shot, so underfunding is a slow, visible problem.

**The pro-rata cut:** benefits are paid from cash only (`scheme.assetsAnchor`), never overdrawn, never borrowed:

```
if cash >= due: paid = due, cutFraction = 0
else: paid = cash, unpaid = due - cash, cutFraction = unpaid / due
```

When cash is short, every pensioner takes the same proportional cut, the model has no basis to pay some in full and others nothing. The unpaid amount is **not** forgiven and **not** carried as separate arrears; it simply stays on the books as liability (it isn't discharged), so the scheme continues to show as underfunded and the employer keeps being asked for a top-up. A guarded update (`assetsAnchor: { $gte: paidAnchor }`) ensures a scheme's cash can never go negative from a benefit payment even under a concurrent write. Paying a benefit discharges the matching liability 1:1 (`liabilitiesAnchor -= paidAnchor`), which is what lets the funding ratio actually improve as a scheme pays down its promise. Ledgered as `pension_benefit`.

## Phase 2, part B: scheme investing

After benefits, `runPensionSchemeInvestments` lets each scheme with cash put a portion into index funds, through the same primitives a player uses (`creditFundPosition`, fund `unitSupply`/`cashAnchor` increments, an `indexFundTransactions` row) under a new holder kind, `"pension_scheme"`. Whole units only, priced at the fund's quoted NAV.

**Fail closed:** if index funds are disabled (`isIndexFundsEnabled()`), this step does nothing and schemes simply hold cash. Every other pension mechanic (contributions, accrual, benefits, funding ratios read off cash alone) keeps working regardless, investment is optional, never a dependency.

**Fund choice** (`chooseSchemeFund`): only `active`, `kind: "broad"` funds are eligible. A scheme prefers its own country's broad index, falling back to the global broad index. Sector funds are explicitly not eligible, concentrating a country's pension assets in the sector its members work in is the exact failure mode occupational schemes are regulated against.

**Investable cash** (`pensionInvestableCashAnchor`), the tighter of two constraints:

1. Keep `PENSION_LIQUIDITY_BUFFER_TURNS` (8) turns of benefits-due in cash: `buffer = benefitsDue(inPayment) * 8`.
2. Never invest more than `1 - PENSION_CASH_FLOOR_FRACTION` (90%) of cash, so a young scheme with no pensioners yet doesn't go fully illiquid.

Below `PENSION_MIN_INVESTMENT_ANCHOR` (₳1,000), the pass invests nothing (no fund transaction for pocket change). Units bought are `floor(investable / quotedNav)`; cost is derived from whole units at NAV, not from the investable figure, so the ₳ leaving the scheme and the ₳ arriving at the fund always match exactly. A guarded debit (`assetsAnchor: { $gte: costAnchor }`) protects against the benefit pass having moved cash earlier in the same turn. Ledgered as `index_fund_subscribe`.

## Marking to market

`pensionSchemeAssetsAnchor(scheme) = max(0, assetsAnchor) + max(0, investedValueAnchor ?? 0)`. This is the **only** function every funding-ratio, band, and top-up computation is allowed to read through, reading `assetsAnchor` alone once a scheme holds fund units would report a scheme that just invested half its money as half funded.

`refreshSchemeInvestedValues` recomputes `investedValueAnchor` from the live `indexFundPositions` (units × fund's `quotedNav`) and writes it back, only for schemes whose value actually changed. It runs twice per pension turn: once before the contribution/accrual sweep (so a top-up is charged against today's mark, not a stale one) and once after the investment pass (so the union surface never shows already-invested cash as still liquid). A position pointing at a deleted fund values at zero.

## Timing

The `pensionTurn` phase runs once per turn, immediately after `corporationTurn` (`src/simulation/phases/turnPhaseRegistry.ts`), because it reads the `laborCost` that phase writes. Bargaining itself happens outside the turn pass, when a campaign settles (`src/lib/unions/bargaining.ts`); the settled rate then takes effect from the next pension pass.

### Order within the turn

1. `refreshSchemeInvestedValues` (mark to market before anything reads a funding ratio)
2. Per active agreement: contribution → top-up → accrual (this order specifically, so a top-up is never billed against a shortfall the same turn's own accrual created)
3. `runPensionBenefitsTurn` (retirements, then benefits due, then the pro-rata cut)
4. `runPensionSchemeInvestments`
5. `refreshSchemeInvestedValues` again

## Where it surfaces

- **Union dashboard** (`src/app/unions/[id]/page.tsx`, panel `UnionPensionSchemePanel.tsx`): renders nothing at all when the union has no scheme (no scheme, not an empty one). Shows cash, invested value, total assets, liabilities, benefits in payment, cumulative contributions/top-ups/invested/paid/unpaid, last benefit cut fraction, funding ratio, and band with `describeFundingBand()` copy. Data comes from `GET /api/unions/[id]`, which reads the scheme via `pensionSchemeAssetsAnchor`/`pensionFundingRatio`/`pensionFundingBand`.
- **Employer's financial statement** (`src/components/corporation/financials/financialsModel.ts`, line item `"pension"` / label "Pensions"): sums `pensionContributionCost + pensionTopUpCost` as an expense line, computed by `employerPensionCostForTurn` in `src/lib/corporations/queries/corporationDetail.ts`. This is a **projection**, recomputed from the same rules the turn uses (not a history read of the ledger), it answers "what is this agreement charging me right now," gated on `labourWagesEnabled`. An employer too short to pay in the actual turn pass is still shown what it owes, because the claim accrues either way. Also surfaces `pensionSchemesInDeficit`.
- **Turn-phase result** (`turnPhaseRegistry.ts`, `pensionResult`): logs `schemesCharged`, `contributionsAnchor`, `topUpsAnchor`, `accrualsAnchor`, `shortfalls`, `benefitsPaidAnchor`, `benefitsUnpaidAnchor`, `schemesCutting`, `investedAnchor`, `schemesInvesting` per turn.

## Constants reference

All constants live in `src/lib/pensions/rules.ts`. The funding-band cut-offs of 1.1 (surplus) and 0.9 (funded) are the same file; the 0.35 base and 0.3 leverage share in the mediation weight are in `src/lib/unions/bargaining.ts`.

| Constant | Value | Meaning |
| --- | --- | --- |
| `PENSION_CONTRIBUTION_RATE_MIN` (`src/lib/pensions/rules.ts`) | 0 | Floor on bargained contribution rate |
| `PENSION_CONTRIBUTION_RATE_MAX` (`src/lib/pensions/rules.ts`) | 0.15 | Ceiling on bargained contribution rate (15% of covered wage bill) |
| `PENSION_ACCRUAL_RATE` (`src/lib/pensions/rules.ts`) | 0.08 | Liability accrued per turn as a share of covered wage bill |
| `PENSION_DEFICIT_RATIO` (`src/lib/pensions/rules.ts`) | 0.9 | Funding ratio below which a top-up is owed |
| `PENSION_CRITICAL_RATIO` (`src/lib/pensions/rules.ts`) | 0.6 | Funding ratio below which the band is "critical" |
| `PENSION_TOPUP_FRACTION` (`src/lib/pensions/rules.ts`) | 0.05 | Share of the shortfall charged as top-up per turn |
| `PENSION_RETIREMENT_RATE` (`src/lib/pensions/rules.ts`) | 0.01 | Share of not-yet-in-payment liability that retires per turn |
| `PENSION_BENEFIT_DRAWDOWN_RATE` (`src/lib/pensions/rules.ts`) | 0.02 | Share of in-payment stock paid out per turn |
| `PENSION_LIQUIDITY_BUFFER_TURNS` (`src/lib/pensions/rules.ts`) | 8 | Turns of benefits-due kept in cash before investing |
| `PENSION_CASH_FLOOR_FRACTION` (`src/lib/pensions/rules.ts`) | 0.1 | Minimum share of cash never invested |
| `PENSION_MIN_INVESTMENT_ANCHOR` (`src/lib/pensions/rules.ts`) | ₳1,000 | Minimum cash before an investment pass bothers |

## Key Files

- `src/lib/pensions/rules.ts`, all constants, funding ratio/band, contribution/accrual/top-up/retirement/benefit-payment/investable-cash pure functions
- `src/lib/pensions/pensionTurn.ts`, `runPensionTurn`, the per-turn phase entry point; `ensurePensionScheme`; wage-bill helpers
- `src/lib/pensions/pensionBenefits.ts`, `runPensionBenefitsTurn`, the pro-rata benefit cut
- `src/lib/pensions/schemeInvesting.ts`, `runPensionSchemeInvestments`, `chooseSchemeFund`
- `src/lib/pensions/schemeAssets.ts`, `loadSchemeInvestedValues`, `refreshSchemeInvestedValues`, collection name constants
- `src/lib/pensions/employerPensionCosts.ts`, `employerPensionCostForTurn`, the financial-statement projection
- `src/lib/db/types/pensionScheme.ts`, `PensionScheme` document shape
- `src/lib/db/types/union.ts`, `CollectiveAgreement.pensionContributionRate`, `BargainingTerms` reference
- `src/lib/unions/bargaining.ts`, `pensionContributionRate` in offers, mediation weighting, validation
- `src/simulation/phases/turnPhaseRegistry.ts`, `pensionTurn` phase registration, runs immediately after `corporationTurn`
- `src/app/api/unions/[id]/route.ts`, union detail API, builds the `pensionScheme` view sent to the dashboard
- `src/components/unions/UnionPensionSchemePanel.tsx`, union dashboard panel
- `src/components/corporation/financials/financialsModel.ts`, the `"pension"` financial-statement line item
- `src/lib/corporations/queries/corporationDetail.ts`, computes `pensionContributionCost`/`pensionTopUpCost`/`pensionSchemesInDeficit` for the corp financials surface

## Edge cases and limits

- **No pension bargained.** An omitted or zero rate writes no term on the agreement and no scheme document is created. Nothing accrues.
- **Rate bounds.** Offers are validated to 0 to 0.15. A mediated rate of 0 is not written.
- **Employer cannot pay.** Contribution and top-up debits go through `atomicallyDebitCorpLiquidCapital`, which will not overdraw. A failed debit is counted in `shortfalls`; the accrual still lands, so the liability grows regardless.
- **Labour system off or no wage bill.** An absent or non-finite `sector.laborCost` counts as zero, so nothing is contributed or accrued. The page does not invent a wage bill.
- **Zero liabilities.** Funding ratio reads 1 when liabilities are 0 or less, and 0 when assets are 0 or less. No top-up is owed at ratio 1.
- **Cash never goes negative.** Benefit payment and fund purchases use guarded updates on `assetsAnchor`, so a concurrent write cannot overdraw a scheme.
- **Unpaid benefits are not forgiven.** The unpaid slice stays as liability, which keeps the scheme in deficit and keeps the top-up running.
- **No agreement left.** Benefits keep running for any scheme with liabilities above 0, even when no agreement is active.
- **Index funds off.** Investing is skipped and the scheme holds cash. Only broad `active` funds qualify; sector funds are excluded on purpose to avoid concentration.
- **Small cash.** Under 1,000 anchors investable, no purchase is made. Units are whole; cost is units times NAV.
- **Deleted fund.** A position in a deleted fund is marked at zero.
- **First pension on an existing agreement.** The scheme is created only when an agreement settles with a rate above zero.

## Connections

**Driven by**
- [Labour](./labour.md): the covered wage bill (`sector.laborCost`, read in `src/lib/pensions/pensionTurn.ts`) sets contribution and accrual; the bargaining path sets the rate (`src/lib/unions/bargaining.ts`).
- [Corporations](./corporations.md): the employer's `liquidCapital` pays contributions and top-ups.
- Index funds: fund NAV marks invested units to market (`src/lib/pensions/schemeAssets.ts`).

**Affects**
- Employer finances: contribution and top-up appear as a Pensions line in the corporation financial statement (`src/lib/corporations/queries/corporationDetail.ts`).
- Union dashboard: funding ratio and band are shown on the union page (`src/app/api/unions/[id]/route.ts`).
- Index funds: scheme purchases add to a fund's unit supply and cash.

Last checked: 2026-10-29, version 1.18.0
