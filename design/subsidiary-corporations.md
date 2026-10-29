# Subsidiary Corporations

A player-owned corporation can control other player-owned corporations as a **holding group**: one corp (the parent) formalizes >50% voting control of another (the subsidiary), gaining management rights over its CEO seat, funding it directly, and setting a dividend floor. The relationship is always **derived**, never stored as a parent pointer, a corp is a subsidiary of whoever currently controls its votes, full stop. This companion doc covers that system; see [corporations.md](./corporations.md) for the base corporation model it extends.

Player guide: [Subsidiary Corporations](https://www.ahousedividedgame.com/wiki/subsidiary-corporations)

Feature flag: `subsidiaryCorporationsEnabled` on the `gameState` singleton (`_id: "current"`), default ON for fresh worlds via `featureFlagDefaults`. Fail-closed on any world that never stamped the flag, `isSubsidiaryCorporationsEnabled()` returns `false` unless the field is explicitly `true`. Every subsidiary API route, and every effect below, is gated behind this flag.

## Rules and Constants

| Constant | Value | Source |
| --- | --- | --- |
| `SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT` | 50 (voting power must exceed this) | `src/lib/corporations/corporateOwnershipConstants.ts` |
| `SUBSIDIARY_FORMALIZATION_THRESHOLD_PERCENT` | 50 (kept in sync with the above) | `src/lib/corporations/subsidiaries/constants.ts` |
| `SUBSIDIARY_MIN_AGE_TURNS` | 24 turns between formalize and release | `src/lib/corporations/subsidiaries/constants.ts` |
| `SUBSIDIARY_CAPITAL_INJECTION_MAX_PCT_OF_PARENT_LIQUID` | 0.25 | `src/lib/corporations/subsidiaries/constants.ts` |
| `SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS` | 24 turns per subsidiary | `src/lib/corporations/subsidiaries/constants.ts` |
| `SPIN_OFF_COOLDOWN_TURNS` | 168 turns per parent | `src/lib/corporations/subsidiaries/constants.ts` |
| `SPIN_OFF_BASE_COST_ANCHOR` | 500,000 ₳ | `src/lib/corporations/subsidiaries/constants.ts` |
| `SPIN_OFF_PER_SECTOR_COST_ANCHOR` | 100,000 ₳ per sector moved | `src/lib/corporations/subsidiaries/constants.ts` |
| `MAX_DIVIDEND_RATE` | 25 (upper bound of a dividend floor, percent) | `src/lib/constants/corporationsClient.ts` |
| `GROUP_SYNERGY_CONVERGENCE` | 0.05 of the gap per turn | `src/lib/corporations/groups/synergies.ts` |
| `GROUP_SYNERGY_MAX_SHARE` | 0.6 of the group leader's strength | `src/lib/corporations/groups/synergies.ts` |
| `SPINOFF_SYNERGY_MAX_SHARE` | 0.85 | `src/lib/corporations/groups/synergies.ts` |
| `SPINOFF_BRAND_INHERITANCE_TURNS` | 96 turns after spin-off | `src/lib/corporations/groups/synergies.ts` |
| `TRANSFER_PRICING_AUDIT_THRESHOLD_ANCHOR` | 5,000,000 ₳ accrued exposure | `src/lib/corporations/groups/transferPricing.ts` |
| `TRANSFER_PRICING_PENALTY_RATE` | 0.4 | `src/lib/corporations/groups/transferPricing.ts` |

One turn is about one real hour; 48 turns are one game year. So 24 turns is about one real day and 168 turns is about seven real days.

Worked example: parent P owns 62% of voting power in corp S and its CEO formalizes. P has 2,000,000 liquid capital, so one injection is capped at 500,000. After the injection S cannot receive another for 24 turns. P sets a dividend floor of 10%; S's CEO has set 6%, so S pays 10%. If S's CEO had set 15%, S would pay 15%. P later sells down to 48% and on the next corporation turn the formalization marker and floor are cleared.

## Core Model: Derived Control, Not a Stored Edge

There is no `parentCorporationId` field anywhere. Two facts combine to define "is this corp a managed subsidiary right now, and if so, of whom":

1. **Voting control**, some corporation currently controls **>50%** of the target's voting power (`SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT = 50` in `corporateOwnershipConstants.ts`, re-exported from `corporateOwnership.ts`, kept in sync with `SUBSIDIARY_FORMALIZATION_THRESHOLD_PERCENT = 50` in the subsidiaries module). Voting power, not raw share count, super-share multipliers are respected via `acquirerOwnershipPercent()` / `getControllingCorporateParent()`.
2. **Formalization**, `Corporation.subsidiaryFormalizedAtTurn` is set. This is an **opt-in marker**, not a parent pointer; it just records "yes, someone formalized this."

`isFormalizedSubsidiary()` requires both: a controlling parent AND the marker. If voting control lapses (parent sells down, dilution, etc.) the marker becomes stale and is cleared automatically by the turn processor's zombie cleanup (see below), there is no manual "unformalize because the numbers moved" step for players.

Unsold shares still sitting in the parent's own open sell orders or listings count toward its control for every derived-control check (`loadReservedCorporatePositions` / `resolveControllingCorporateParent`), so listing a controlling block for sale does not silently drop parent powers before the trade fills.

## Eligibility

- **Parent eligibility** (`isEligibleAsSubsidiaryParent`): the corp must not be national/state-owned (`countryOwnerId` unset) and must not itself already be a formalized subsidiary, **no chaining**. A subsidiary cannot itself be a parent.
- **Subsidiary eligibility** (`isEligibleAsSubsidiary`): the target must not be national/state-owned.
- **No self-ownership**: a corp cannot formalize itself.
- **No ownership cycles**: `wouldCreateOwnershipCycle()` walks the derived control graph (built fresh from every corp's `getControllingCorporateParent()` on every check) to reject any formalization that would let A control B control A. This is enforced twice, once when a corp attempts to _formalize_ a subsidiary, and once earlier at the point of _purchase_ (`corpPurchaseWouldCycle()` in `cycleGuard.ts`) so a corporate buyer cannot even acquire majority control of a corp that already controls it. The purchase-time check was added after the formalize-time-only check left a window where the loop existed in the share graph before anyone tried to formalize it.
- **One-person rule**: a subsidiary's CEO must be a different human than the parent's owner, the parent's sitting CEO, or the CEO of any sibling subsidiary of the same parent (`humanBlockedFromSubsidiaryCeo()`). This keys on the human behind the seat, not `corp.userId`, a caretaker-run parent resolves to `caretakerCeo.underlyingUserId` (`resolveParentCeoUserId()`). NPP-run siblings with no caretaker are skipped entirely (no human operates them, nothing to block).

## Formalizing a Subsidiary

`POST /api/corporations/[id]/subsidiary/formalize`, target is `[id]`, `parentCorporationId` in the body.

- **Caller must be CEO of the parent** (not vacant, `userId` matches).
- Parent voting control of the target must exceed **50%**, computed with reserved-holdings adjustment.
- Target must not already be formalized.
- Cycle and eligibility checks above all apply.
- **Same-human guard on formalize too**: if the target's current CEO is a human and that human is the parent's owner, formalization is refused until a different CEO (player or NPP) is seated on the target.
- On success, `subsidiaryFormalizedAtTurn` is set to the current turn on the target only. `formalizeSubsidiary()` uses an atomic `updateOne` guarded by `subsidiaryFormalizedAtTurn: { $exists: false }` so a race can't double-formalize.

## Releasing a Subsidiary

`POST /api/corporations/[id]/subsidiary/release`, `dismissCaretaker` optional in body.

- Caller must currently be authorized to act as parent (`canActOnCorporationAsParent`).
- **Minimum age**: `SUBSIDIARY_MIN_AGE_TURNS = 24` turns (≈1 real day) must pass between formalize and release, an anti-flip-flop guard.
- Clears `subsidiaryFormalizedAtTurn`, `parentDividendFloorPct`, `parentDividendFloorSetByCorpId`.
- Optionally dismisses an NPP caretaker CEO the parent installed, restoring the underlying human.

## Zombie Subsidiary Cleanup (turn processor)

`cleanupZombieSubsidiaries()` runs every turn inside `processCorporationTurn` (gated by the feature flag), after financial-distress tracking and after group relief and synergies (see Timing):

- For every corp with `subsidiaryFormalizedAtTurn` set: if nobody controls >50% anymore, the formalization marker and dividend-floor fields are unset, the managed relationship dissolves on its own, no player action needed.
- For every corp with a stale `parentDividendFloorSetByCorpId` (the setter no longer controls >50%, but the formalization itself is still valid under a _different_ controller): only the floor is cleared, formalization stays.
- Runs as a bulk write; logs the count and records an audit entry (`corp.subsidiary_cleanup`).

## Timing

All of this runs in the corporation phase of the turn (`processCorporationTurn` in `src/lib/turn/corporation/index.ts`), only when `subsidiaryCorporationsEnabled` is on. Player actions (formalize, release, injection, floor, appoint, spin-off) run immediately when the API is called, outside the turn.

Order inside the corporation phase, earliest first:

1. Per-corp sector processing, including dividends. The parent dividend floor is applied here (`src/lib/turn/corporation/sectorCalculations.ts`).
2. Supply agreement settlement, then the transfer-pricing audit for cross-border intra-group premiums (`groups/applyTransferPricingAudit.ts`).
3. Tax is charged and IMF bailout payments remitted.
4. Phase 3e, group loss relief (`groups/applyGroupRelief.ts`), a rebate after tax.
5. Phase 3f, group synergies (`groups/applySynergies.ts`).
6. Later, after financial-distress tracking, zombie subsidiary cleanup (`subsidiaries/turnCleanup.ts`).

Because cleanup runs last, a group edge that lapsed this turn is only cleared at the end of the same phase. Group edges need both control and the formalization marker, so a lapsed parent already stops counting for relief and synergies in the same turn's resolution.

## Authorization: `canActOnCorporationAsParent`

Every subsidiary management action (release, capital injection, dividend floor, CEO appointment) shares one authorization check:

```
true iff:
  feature flag is ON, AND
  sub.subsidiaryFormalizedAtTurn is set, AND
  sub is not national/state-owned, AND
  the caller is the sitting (non-vacant) CEO/owner of whoever currently
  controls >50% of sub's voting power (recomputed live, reserved holdings included)
```

Parent authority is recomputed on every call from live share data, it is never cached on `userId`.

## Capital Injection

`POST /api/corporations/[id]/subsidiary/capital-injection`, `{ amount }` in the **parent's** local currency.

- **Cap**: a single injection cannot exceed **25%** of parent liquid capital (`SUBSIDIARY_CAPITAL_INJECTION_MAX_PCT_OF_PARENT_LIQUID = 0.25`).
- **Cooldown**: `SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS = 24` turns per subsidiary.
- **Forex-aware**: parent local → ₳ (anchor) → subsidiary local, using each corp's own FX rate (`getCorpFxRate`).
- **Atomic**: `atomicallyDebitCorpLiquidCapital()` on the parent first (race-safe balance gate); if the credit to the subsidiary fails for any reason, the debit is refunded.
- Two `emitTx` ledger entries (`corp_capital_injection`, one negative on the parent, one positive on the subsidiary) plus an audit record (`corp.capitalInjection`).
- Sets `sub.lastCapitalInjectionTurn` to the current turn.

## Parent Dividend Floor

`POST /api/corporations/[id]/subsidiary/dividend-floor`, `{ floorPct }` (0 to `MAX_DIVIDEND_RATE`).

- Stored as `Corporation.parentDividendFloorPct` + `parentDividendFloorSetByCorpId` on the subsidiary.
- `activeParentDividendFloorPct()` derives the effective floor: returns 0 unless the feature is enabled, both fields are set, a controlling parent currently exists, and that parent's id matches the one who set the floor. Otherwise the floor is silently ignored (and later swept by zombie cleanup).
- Folded into the corp's effective dividend rate via a `max(...)` with the CEO-set rate at both the per-turn dividend site and the corporation-detail read path, so a parent can force a minimum payout that the subsidiary's own CEO cannot undercut, but never override a CEO who is already paying more.

## CEO Appointment on Subsidiaries

`POST /api/corporations/[id]/subsidiary/appoint-ceo`, `{ ceoType: "character" | "npp", characterId?, forcedNppId? }`.

- Caller must pass `canActOnCorporationAsParent`.
- **NPP path**: reuses the existing caretaker-CEO mechanism (`appointCaretakerCeo`), leaves the subsidiary's `userId` intact and sets `caretakerCeo`, so a human who still nominally "owns" the seat is tracked underneath.
- **Character path**: enforces the one-person rule against the parent owner, the parent's resolved CEO, and every sibling subsidiary's CEO, then reseats: closes the old CEO's tenure record, sets `ceoId` / `ceoType: "character"` / `userId`, clears `ceoVacant` and any pending caretaker/appointment fields, opens a new tenure record.

## Blocked While a Formalized Subsidiary: Share Issuance

`subsidiaryIssuanceBlockReason()` in `issuanceGuard.ts` blocks **all** equity issuance (public issuance, self-issuance, going public) on any corp with `subsidiaryFormalizedAtTurn` set, whenever the feature flag is on. Rationale in-code: any issuance dilutes the parent's stake and could drop it below the >50% control threshold, letting the subsidiary's CEO escape parent oversight. The parent must fund it via capital injection instead, or release it first if dilution is genuinely wanted. No-op when the feature is off or the corp isn't formalized, non-subsidiary issuance is unaffected.

## Spin-Off

`POST /api/corporations/[id]/subsidiary/spin-off`, `{ sectorType, name, tickerSymbol?, appointedCeoType, appointedCeoCharacterId?, forcedNppId? }`.

Moves one of the parent's sector types into a **new, wholly parent-owned private corporation**, immediately formalized as a subsidiary of the parent.

- **Eligibility**: caller is the non-vacant parent CEO; parent must be an eligible subsidiary parent (not national, not itself a subsidiary, no chaining); parent must operate at least one sector of the requested type.
- **Cooldown**: `SPIN_OFF_COOLDOWN_TURNS = 168` turns (≈7 real days) per parent.
- **Cost**: `SPIN_OFF_BASE_COST_ANCHOR = 500,000 ₳` base + `SPIN_OFF_PER_SECTOR_COST_ANCHOR = 100,000 ₳` per sector moved, i.e. `spinOffCostAnchor(n) = 500,000 + 100,000 × n`, converted to the parent's local currency and debited atomically. The fee is not destroyed, it credits the parent's country treasury (`creditTreasuryProceeds`), ledgered on both sides (`corp_capital_seed` debit, `gov_tax_revenue` credit).
- **New corp**: private (`isPrivate: true`, no public float at creation), 100% owned by the parent (single shareholder entry: `{ corporationId: parent._id, shares: subsidiaryShares }`), share count from `getEraFounderShares(CEO_INITIAL_SHARES, ...)`, deliberately deflated below the flat `CEO_INITIAL_SHARES` base so a spin-off in an early era doesn't open at a modern-sized market cap. `subsidiaryFormalizedAtTurn` is set immediately at creation; `isSpinOff: true`, `spunOffFromCorpId`, `spunOffAtTurn` are stamped.
- **CEO**: either a human character (subject to the one-person rule, same as `appointSubsidiaryCeo`) or an NPP caretaker (`pickOrCreateNppCeoForNewCorp`). An NPP-run new corp gets the system placeholder user id, never the parent's.
- **Sector transfer is a REASSIGN, not a merge**: the moved `corporateSectors` documents keep their own `_id` and only `corporationId` is repointed. `revenue` and `currentGrowthCost` are re-denominated corp-currency → ₳ → new-corp-currency (identity when parent and spin-off share a currency, the normal case for a same-country spin-off). Plant-related fields (`capitalStock`, `buildQueue`, construction-in-progress, `mothballed`, `plantsStartTurn`) ride along untouched and are explicitly **not** put through the currency round-trip, those are already ₳-denominated by contract, and re-converting them on a cross-currency move would misstate capex by the FX rate.
- **Atomic with rollback**: on any failure mid-transaction, transferred sectors are moved back to the parent, the new corp document is deleted, and the debited fee is refunded.
- **Anchors `parent.lastSpinOffTurn`** for the cooldown.
- **Interacts with merger-review divestiture**: if the parent has a `pendingDivestiture` order (a C3 merger remedy), the spin-off does **not** discharge it by itself, the new corp is still wholly parent-owned, so the group's controlled market share is unchanged. `settleDivestitureIfSatisfied()` is called best-effort right after the spin-off so the order's status reflects reality immediately; actual discharge requires the parent to later sell the spin-off down below the control threshold.

## Ownership Cycle Guard on Purchase

`corpPurchaseWouldCycle()` (`cycleGuard.ts`) is checked when a **corporation** (not a player character) buys shares in another corporation, at the point of purchase rather than only at formalization time. It reads the full corp cap-table graph (`_id`, `shareholders`, `totalShares`, `superShareMultiplier`) and reuses the same `wouldCreateOwnershipCycle()` walk. Refusal message: `OWNERSHIP_CYCLE_ERROR`.

## Holding Groups: Tax Relief, Balance Sheet, Synergies

A **group** is the set of corporations connected by formalized subsidiary edges, resolved fresh every turn by `resolveFormalizedGroups()` in `groups/groupMembership.ts`. A group edge requires BOTH de-facto control (>50% voting) AND formalization, de-facto control alone is not a group for any of the effects below. Cycles that slip past the guards are handled defensively: the root-resolution walk is bounded by edge count and canonicalizes on the smallest id in any detected cycle so the group doesn't fragment into singletons and silently lose relief.

### Group Loss Relief (tax)

`computeGroupRelief()` in `groups/lossRelief.ts`. Each corp is still taxed alone during normal turn processing; relief is applied as a **rebate afterward**, not a recomputation of the tax figure, arithmetically identical to filing consolidated, but additive rather than invasive to the turn's hot path.

- **Same-country only.** A loss in one country cannot shelter profit in another. Cross-border intra-group transfer-pricing audits are live in `src/lib/corporations/groups/transferPricing.ts`: exposure above ₳5 million can trigger a 40% surcharge. Same-country intra-group pricing is ignored intentionally.
- Pools by `(group root, country)` via `poolByGroupAndCountry()`.
- Requires at least 2 group members, at least one profit and one loss, and some tax actually paid; otherwise no relief.
- `lossesSurrendered = min(totalLoss, totalProfit)`.
- `effectiveRate` is **derived** from `totalTaxPaid / totalProfit` for the pool (never looked up from a rate table), so it automatically reflects whatever mix of state/federal/legal-structure rates actually applied, a pass-through member that paid $0 tax correctly contributes nothing.
- `totalRelief = min(totalTaxPaid, lossesSurrendered × effectiveRate)`, capped at tax actually collected; relief is a refund, never a payment from the treasury to a group that paid nothing.
- Allocated pro-rata among the members who actually paid tax, by share of tax paid; the last payer absorbs the rounding remainder so allocations sum exactly.

### Group Balance Sheet (read-only consolidation)

`loadGroupBalanceSheet()` in `groups/groupBalanceSheet.ts`. Consolidates nothing in the engine, every member keeps its own cash, shares, and shareholders. This is purely a display aggregation for a parent corp's page:

- Returns `null` if the corp isn't in a formalized group of 2+.
- Per member: liquid capital (anchor ₳), sector revenue (anchor ₳), sector count. Root listed first, then by revenue descending.
- Totals: liquid capital, revenue, sector count, deduplicated industries, deduplicated countries.
- Sector revenue is read in the **host country's** currency (not the owning corp's), consistent with how sector revenue is generally stored.

### Group Synergies (marketing & logistics)

`computeGroupSynergies()` in `groups/synergies.ts`. An explicitly asymmetric model: members are pulled **up** toward the group's best `marketingStrength` / `logisticsStrength`, never dragged down, averaging was rejected because it would make acquiring a weak subsidiary strictly punish a strong parent.

- **Convergence rate**: `GROUP_SYNERGY_CONVERGENCE = 0.05` (5% of the remaining gap closed per turn).
- **Ordinary ceiling**: `GROUP_SYNERGY_MAX_SHARE = 0.6`, a member may be lifted to at most 60% of the group leader's strength.
- **Spin-off ceiling**: `SPINOFF_SYNERGY_MAX_SHARE = 0.85` for a corp that was spun off from a _current_ member of the same group, within `SPINOFF_BRAND_INHERITANCE_TURNS = 96` turns of the spin-off. If the corp it was spun from has since left the group, or the window has expired, the ordinary 0.6 ceiling applies instead, this is what the previously-dead `isSpinOff` / `spunOffFromCorpId` fields (written since spin-off shipped, read by nothing until this landed) are for.
- Target for each member = `max(current strength, leader strength × applicable cap)`, never below where the member already is.
- Delta per turn = `(target - current) × 0.05`, applied to both marketing and logistics independently.
- Sub-0.01 deltas are skipped entirely (not worth a write, wouldn't show in the UI).
- Returns only members that actually move; a settled group writes nothing.

## Edge cases and limits

- **Exactly 50% is not control.** The test is strictly greater than 50% of voting power (`src/lib/corporations/corporateOwnership.ts` returns no parent when the top holder is at or below the threshold).
- **Control lapses.** The marker and floor are cleared at the next corporation turn. Nothing is refunded or reverted; capital already injected stays in the subsidiary.
- **Different controller.** If a different corporation takes over >50%, formalization stays but the old controller's dividend floor is cleared.
- **Zero or vacant seats.** A vacant parent CEO cannot formalize, release, inject, set a floor, appoint or spin off.
- **State and national corps are excluded** as parents and subsidiaries, because their ownership is the treasury, not shareholders.
- **No chaining.** A formalized subsidiary cannot be a parent, so groups are one level deep.
- **Dividend floor** can only raise the payout. It is bounded by `MAX_DIVIDEND_RATE` (25) and never lowers a CEO rate that is already higher.
- **Capital injection cap** uses the parent's liquid capital at the time of the call; a zero-liquid parent cannot inject.
- **Loss relief** never exceeds tax actually collected, needs at least two members and one profit plus one loss, and is same-country only. Cross-border shifts are policed by the transfer-pricing audit instead.
- **Synergies** only lift, never lower, and skip deltas under 0.01. Averaging was rejected so a weak subsidiary cannot penalize a strong parent.
- **Share issuance is blocked** on formalized subsidiaries so dilution cannot drop the parent below control.
- **Spin-off fee** is paid to the parent's country treasury, not destroyed, and the whole operation rolls back on any failure.

## Connections

**Driven by:**

- [Corporations](./corporations.md): share ownership and voting power (`getControllingCorporateParent()` in `src/lib/corporations/corporateOwnership.ts`) decide who is a parent.
- [Corporate mergers and acquisitions](./corporate-mergers-and-acquisitions.md): buying a controlling stake creates the control that formalization marks; purchase-time cycle checks run in `subsidiaries/cycleGuard.ts`.

**Affects:**

- [Corporations](./corporations.md): the dividend floor changes payout in `src/lib/turn/corporation/sectorCalculations.ts`, and issuance is blocked via `subsidiaries/issuanceGuard.ts`.
- [Corporate mergers and acquisitions](./corporate-mergers-and-acquisitions.md): the merger-review divestiture check measures the controlled group (`src/lib/corporations/mergerReview/divestiture.ts`).
- Tax: group loss relief rebates tax already collected (`groups/applyGroupRelief.ts`), which lowers treasury tax revenue.
- Marketing and logistics strength: synergies in `groups/applySynergies.ts`.

## Admin Toggle

`POST /api/admin/corporations/subsidiaries/toggle` flips `gameState.subsidiaryCorporationsEnabled`. UI: `src/components/admin/economy/SubsidiaryCorporationsToggle.tsx`.

## UI

- **`SubsidiaryManagementCard.tsx`**, parent-side management panel (capital injection, dividend floor, CEO appointment, release) shown when `canManageAsParent` is true.
- **`SubsidiariesOverviewCard.tsx`**, lists the corp's subsidiaries (from the `subsidiaries` payload built in `corporationDetail.ts`, filtered to >50% voting control) and group balance-sheet summary.
- **`FormalizeSubsidiaryModal.tsx`**, formalize flow, shown when `canFormalizeAsSubsidiary` is true.
- **`SpinOffModal.tsx`**, spin-off flow (`canSpinOff` requires the flag on, viewer is the non-vacant CEO, and the corp is eligible as a parent).
- **`AppointSubsidiaryCeoModal.tsx`**, CEO reseat flow (character or NPP).

## Collections & Fields

No new collection. All state lives on the existing `corporations` documents:

| Field                                                                           | Meaning                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `subsidiaryFormalizedAtTurn?: number`                                           | Presence = formalized; the turn it happened. Cleared automatically if control lapses.             |
| `isSpinOff?: boolean`, `spunOffFromCorpId?: ObjectId`, `spunOffAtTurn?: number` | Spin-off provenance; feeds the synergy brand-inheritance ceiling.                                 |
| `lastSpinOffTurn?: number`                                                      | Cooldown anchor on the **parent** for spin-offs it initiates.                                     |
| `lastCapitalInjectionTurn?: number`                                             | Per-subsidiary cooldown anchor for capital injections received.                                   |
| `parentDividendFloorPct?: number`, `parentDividendFloorSetByCorpId?: ObjectId`  | Dividend floor set by the controlling parent; only honored while that parent still controls >50%. |
| `pendingDivestiture?: PendingDivestiture`                                       | Merger-review remedy; measured against the controlled group, not discharged by a spin-off alone.  |

## Key Files

- `src/lib/corporations/subsidiaries/featureFlag.ts`, `isSubsidiaryCorporationsEnabled()`
- `src/lib/corporations/subsidiaries/constants.ts`, thresholds, cooldowns, spin-off cost formula
- `src/lib/corporations/subsidiaries/helpers.ts`, `isFormalizedSubsidiary`, `activeParentDividendFloorPct`, eligibility, `wouldCreateOwnershipCycle`, `humanBlockedFromSubsidiaryCeo`
- `src/lib/corporations/subsidiaries/authorization.ts`, `canActOnCorporationAsParent`
- `src/lib/corporations/subsidiaries/cycleGuard.ts`, `corpPurchaseWouldCycle` (purchase-time cycle check)
- `src/lib/corporations/subsidiaries/issuanceGuard.ts`, blocks equity issuance on formalized subsidiaries
- `src/lib/corporations/subsidiaries/parentContext.ts`, `resolveParentCeoUserId`, `collectSiblingSubsidiaryCeoUserIds`
- `src/lib/corporations/subsidiaries/turnCleanup.ts`, `cleanupZombieSubsidiaries()`, run every turn
- `src/lib/corporations/subsidiaries/commandTypes.ts`, shared command result/`fail()` helper
- `src/lib/corporations/subsidiaries/commands/formalizeSubsidiary.ts`, `releaseSubsidiary.ts`, `capitalInjection.ts`, `spinOff.ts`, `appointSubsidiaryCeo.ts`, `setParentDividendFloor.ts`
- `src/lib/corporations/groups/groupMembership.ts`, `resolveFormalizedGroups()`
- `src/lib/corporations/groups/lossRelief.ts`, `computeGroupRelief()`, `poolByGroupAndCountry()`
- `src/lib/corporations/groups/groupBalanceSheet.ts`, `loadGroupBalanceSheet()`
- `src/lib/corporations/groups/synergies.ts`, `computeGroupSynergies()`, `memberShareCap()`
- `src/lib/corporations/corporateOwnershipConstants.ts`, `SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT`
- `src/lib/corporations/corporateOwnership.ts`, `getControllingCorporateParent`, `acquirerOwnershipPercent`
- `src/lib/corporations/mergerReview/divestiture.ts`, `controlledGroupIds()`, divestiture satisfaction check against the controlled group
- `src/lib/corporations/queries/corporationDetail.ts`, subsidiaries payload, viewer permission flags (`canManageAsParent`, `canFormalizeAsSubsidiary`, `canSpinOff`)
- `src/lib/db/types/corporation.ts`, subsidiary-related fields on `Corporation`
- `src/app/api/corporations/[id]/subsidiary/formalize/route.ts`, `release/route.ts`, `capital-injection/route.ts`, `dividend-floor/route.ts`, `appoint-ceo/route.ts`, `spin-off/route.ts`
- `src/app/api/admin/corporations/subsidiaries/toggle/route.ts`, admin feature-flag toggle
- `src/components/corporation/SubsidiaryManagementCard.tsx`, `SubsidiariesOverviewCard.tsx`, `FormalizeSubsidiaryModal.tsx`, `SpinOffModal.tsx`, `AppointSubsidiaryCeoModal.tsx`
- `src/components/admin/economy/SubsidiaryCorporationsToggle.tsx`

Last checked: 2026-10-29, version 1.18.0
