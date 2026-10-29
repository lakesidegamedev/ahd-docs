# Subsidies

## Summary

Subsidies are government financial support programs enacted via legislation that provide profit margin bonuses to qualifying corporations. They are the domestic counterpart to [tariffs](./tariffs.md). Each active subsidy that a sector qualifies for adds 7.5 percentage points to its profit margin and costs the granting government an annualized budget line of 10.5% of the qualifying revenue. They are created and ended only by industry bills.

Player guide: [Subsidies](https://www.ahousedividedgame.com/wiki/subsidies)

**Entry point:** `src/lib/subsidies/subsidyEffects.ts`

## Rules

- **Scope:** National or state-level industrial policy.
- **Beneficiaries:** Qualifying corporations (domestic or foreign, based on the `domesticOnly` flag).
- **Effect:** +7.5pp profit margin per qualifying subsidy (`SUBSIDY_MARGIN_BONUS` in `src/lib/subsidies/subsidyEffects.ts`).
- **Cost:** an annualized line in the owning government's budget, see Budget cost below.
- **Enactment:** via `subsidy` bill provisions in the legislation system. A bill with a `subsidy` or `end_subsidy` provision must be an industry bill ("Subsidy provisions can only be included in industry bills", `SUBSIDY_BILL_CATEGORIES`, `src/lib/congress/billProposal.ts`). In worlds on reviewed legislation v2 a mixed draft of subsidies with laws or taxes is category `custom` and is also accepted.
- **Stacking:** federal and state subsidies stack freely.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `SUBSIDY_MARGIN_BONUS` | 7.5 percentage points per qualifying active subsidy | `src/lib/subsidies/subsidyEffects.ts` |
| `SUBSIDY_DEADWEIGHT_FACTOR` | 1.4 (fiscal inefficiency premium, file-local) | `src/lib/subsidies/subsidyBudgetCosts.ts` |
| `SUBSIDY_COST_MULTIPLIER` | `(7.5 / 100) x 1.4 = 0.105` of annual qualifying revenue | `src/lib/subsidies/subsidyBudgetCosts.ts` |
| `TURNS_PER_YEAR` | 48 (annualizes one turn of revenue) | `src/lib/constants/turnTime.ts` |
| `MARGIN_SOFT_CAP_KNEE` | 80 | `src/lib/constants/corporations.ts` |
| `MARGIN_HARD_CEILING` | 100 | `src/lib/constants/corporations.ts` |
| `SECTOR_SUBSIDIES_SPENDING_KEY` | `"sectorSubsidies"` (budget category key) | `src/lib/budget/spending.ts` |
| Sentiment pulse on a sector subsidy starting or ending | +0.08 to +0.15 (default 0.10) on start, the same size negative on end, decay 0.85 per 15-minute interval | `src/lib/corporations/sentimentEvents.ts` (`fireSubsidyCreatedPulse`, `fireSubsidyEndedPulse`) |
| Sentiment cap | plus or minus 0.25 | `src/lib/corporations/sentimentEngine.ts` (`SENTIMENT_CAP`) |

### Subsidy structure

```typescript
interface Subsidy {
  _id: ObjectId;
  countryId: CountryId; // Country (national) or state's country
  scope: "national" | "state"; // Scope level
  stateId?: string; // For state subsidies
  scopeType: string; // "economy_wide" | "sector"
  targetSectorType?: string; // For sector scope
  targetStrategyId?: string; // Optional: require specific operating strategy
  domesticOnly: boolean; // Only corps HQ'd in territory qualify
  active: boolean; // Active status (false = ended)
  sourceBillId: ObjectId; // Enacting legislation
  createdAt: Date;
  updatedAt: Date;
}
```


### Qualification Rules

A corporation sector qualifies for a subsidy if it passes ALL filters:

```typescript
// corpQualifiesForSubsidy():21-60

// 1. Territory filter
if (subsidy.scope === "state") {
  if (sectorStateId !== subsidy.stateId) return false; // State: sector must be IN state
} else {
  if (sectorCountryId !== subsidy.countryId) return false; // National: sector must be IN country
}

// 2. Sector type filter
if (subsidy.scopeType === "sector" && subsidy.targetSectorType !== sectorType) return false;

// 3. Strategy filter (optional)
if (subsidy.targetStrategyId != null) {
  const effectiveStrategy = sectorStrategyId ?? "standard";
  if (effectiveStrategy !== subsidy.targetStrategyId) return false;
}

// 4. Domestic-only filter
if (subsidy.domesticOnly) {
  if (subsidy.scope === "state") {
    if (corpHqState !== subsidy.stateId) return false; // HQ must be in state
  } else {
    if (corpCountryId !== subsidy.countryId) return false; // HQ must be in country
  }
}

return true;
```

The sector type match uses `sectorPolicyTargetMatches()` in `src/lib/constants/corporations.ts`: a target of `manufacturing` also matches `manufacturing_vehicles`, and `media` also matches `media_entertainment`. Any other target must equal the sector type exactly.

#### Scope Types

| Scope          | Description                         | Qualifying Sectors            |
| -------------- | ----------------------------------- | ----------------------------- |
| `economy_wide` | Blanket subsidy to all sectors      | All sectors in territory      |
| `sector`       | Targeted subsidy to specific sector | e.g., only healthcare sectors |

#### Domestic-Only Flag

When `domesticOnly: true`:

- **National subsidy:** Only corporations with `corpCountryId === subsidy.countryId` qualify
- **State subsidy:** Only corporations with `corpHqState === subsidy.stateId` qualify

When `domesticOnly: false` (default):

- Foreign corporations operating in the territory also qualify


### Margin Modifier

Each qualifying active subsidy provides **+7.5pp** profit margin:

```typescript
// getSubsidyMarginModifier():66-93
const SUBSIDY_MARGIN_BONUS = 7.5;

let total = 0;
for (const s of subsidies) {
  if (!s.active) continue;
  if (
    corpQualifiesForSubsidy(
      s,
      corpHqState,
      sectorType,
      sectorStateId,
      sectorStrategyId,
      sectorCountryId,
      corpCountryId
    )
  ) {
    total += SUBSIDY_MARGIN_BONUS;
  }
}
return total;
```

#### Stacking Examples

| Subsidies                         | Total Bonus                      |
| --------------------------------- | --------------------------------- |
| 1 federal (economy_wide)          | +7.5pp                            |
| 1 state (sector: healthcare)      | +7.5pp                            |
| 1 federal + 1 state (same sector) | +15pp                             |
| 2 federal (economy_wide + sector) | +15pp                             |
| 2 federal (same scope)            | +7.5pp (second overwrites first)  |

**Note:** Multiple subsidies of the same scope/type do NOT stack - the second overwrites the first via upsert. Different scopes (economy_wide + sector) or different levels (federal + state) DO stack.


### Enactment

Subsidies are enacted via legislation:

```typescript
// applySubsidyProvision():99-129
const filter = {
  countryId,
  scope,
  stateId: stateId ?? null,
  scopeType: provision.scopeType,
  targetSectorType: provision.targetSectorType ?? null,
  targetStrategyId: provision.targetStrategyId ?? null,
};

await db.collection<Subsidy>("subsidies").updateOne(
  filter,
  {
    $set: { domesticOnly: provision.domesticOnly, active: true, sourceBillId, updatedAt: now },
    $setOnInsert: { createdAt: now },
  },
  { upsert: true }
);
```

### Ending Subsidies

Subsidies can be terminated via `end_subsidy` provisions:

```typescript
// applyEndSubsidyProvision():135-159
await db.collection<Subsidy>("subsidies").updateMany(
  {
    countryId,
    scope,
    stateId: stateId ?? null,
    scopeType: provision.scopeType,
    targetSectorType: provision.targetSectorType ?? null,
    targetStrategyId: provision.targetStrategyId ?? null,
    active: true,
  },
  { $set: { active: false, updatedAt: new Date() } }
);
```

**Audit trail:** Subsidies are marked `active: false` rather than deleted, preserving historical records.

### Composite Key

Subsidies use a six-field upsert key to prevent duplicates:

```typescript
{
  (countryId, scope, stateId, scopeType, targetSectorType, targetStrategyId);
}
```

Re-enacting the same provision updates the existing subsidy rather than creating a duplicate.


### Budget cost

Subsidies are not free to the state. Each active subsidy carries an annualized cost in the owning government's budget (`src/lib/subsidies/subsidyBudgetCosts.ts`). The cost is the margin points delivered (7.5pp as a fraction of revenue) times a deadweight factor, `SUBSIDY_DEADWEIGHT_FACTOR = 1.4`, so `SUBSIDY_COST_MULTIPLIER = 0.075 × 1.4 = 0.105` of annual qualifying revenue. Cost is measured on the same revenue the margin bonus is earned on: realized revenue where plants production applies, not nameplate capacity. Sector revenue is normalized to the anchor currency, summed, and converted to the subsidizing country's currency for the budget.

### Integration with corporation turn processing

Subsidy margin modifiers are applied during sector processing:

```typescript
// src/lib/turn/corporation/sectorTurn/marginStack.ts
const subsidyMod = getSubsidyMarginModifier(
  lookups.activeSubsidies,
  corp.headquartersState,
  sector.sectorType,
  sector.stateId,
  sector.strategyId,
  sectorCountryId,
  corpCountry
);

const totalMarginMod = /* ... + subsidyMod + ... */;
const effectiveMargin = softCapEffectiveMargin(
  sector.profitMargin + totalMarginMod + nationalizedMarginPenalty
);
```

The margin is not hard-capped at 100. `softCapEffectiveMargin()` in `src/lib/constants/corporations.ts` leaves values up to `MARGIN_SOFT_CAP_KNEE = 80` unchanged and compresses anything above with `80 + 20 * tanh((m - 80) / 20)`, so the result approaches `MARGIN_HARD_CEILING = 100` but never reaches it. Negative margins pass through. This stops stacked modifiers from pinning a sector at a free 100%.

## Data

Reads and writes (collection, fields):

| Collection | Fields | Access | Player-visible |
| --- | --- | --- | --- |
| `subsidies` | `countryId`, `scope`, `stateId`, `scopeType`, `targetSectorType`, `targetStrategyId`, `domesticOnly`, `active`, `sourceBillId`, `createdAt`, `updatedAt` | Written by `applySubsidyProvision` and `applyEndSubsidyProvision`; read each turn by `getActiveSubsidies` (`active: true`) | Through the bill view and the sector margin breakdown; the document itself is not exposed |
| `corporations` | `headquartersState`, `countryId`, `liquidCurrencyCode` | Read | Yes (corporation pages) |
| `corporateSectors` | `corporationId`, `stateId`, `countryId`, `sectorType`, `revenue`, `realizedRevenue`, `strategyId` | Read | Yes (sector detail) |
| `federalBudget` | `spending.byCategory.sectorSubsidies`, `spending.total`, `surplus`, `updatedAt` | Written each turn by `processSubsidyBudget` (`src/lib/turn/subsidyBudgetTurn.ts`) | Yes, as the sector-subsidies spending line |
| `stateBudgets` | `spending.byCategory.sectorSubsidies`, `spending.total`, `surplus`, `balance`, `updatedAt` | Written each turn by `processSubsidyBudget` | Yes, as the state budget line |
| `gameConfig` (`_id: "default"`) | `marketSystemMode` | Read to choose the revenue basis | No |
| `sentimentPulses` | `scope: "sector"`, `sectorType`, `countryId`, `initialImpact`, `decayRate`, `eventType` (`subsidy_created`, `subsidy_ended`), `createdAt` | Written for sector-scoped enactment and end | No (moves share prices) |

The `subsidies` collection is region-scoped by `stateId`, so a country merge re-points state rows (`src/lib/country/mergeCountry.ts`, `src/lib/referendum/transfer/regionScopedCollections.ts`).

## Configuration

- **No subsidy-specific game config field or feature flag.** The margin bonus and deadweight factor are code constants (see Constants). Changing them needs a code change.
- **`gameConfig.marketSystemMode`** chooses the cost basis: below the `plants` tier the cost uses `revenue`; at `plants` it uses `realizedRevenue` (`marketAtLeast(mode, "plants")` in `src/lib/subsidies/subsidyBudgetCosts.ts`, mode resolved by `src/lib/market/featureFlag.ts`). An absent or unknown value resolves to `off`.
- **Reviewed legislation v2 worlds** still accept subsidy provisions as-is (`src/lib/legislature/commands/validateStateBillProvisions.ts`).
- **Per-subsidy settings** come from the enacting provision: `scopeType`, `targetSectorType`, `targetStrategyId`, `domesticOnly`.
- No era or country presets change subsidy values.

## Timing

- **Enactment** happens when a bill containing a `subsidy` or `end_subsidy` provision is enacted (`src/lib/legislationEffects.ts`), outside the corporation phase. A sector-scoped subsidy also fires a sector sentiment pulse (`fireSubsidyCreatedPulse` or `fireSubsidyEndedPulse` in `src/lib/corporations/sentimentEvents.ts`).
- **Benefit** is evaluated every turn in the corporation phase, inside each sector's margin stack (`marginStack.ts`). It reads the active subsidy list preloaded once per turn (`src/lib/corporations/turnReferenceData.ts`), so a subsidy enacted mid-turn applies from the next corporation turn.
- **Cost** is written in the `subsidyBudget` phase (`runPhase("subsidyBudget", ...)` in `src/simulation/phases/stateEffectsPhase.ts`), every turn, so the budget line stays current between fiscal-year resets. Regional budgets for Germany, China and Japan also read the state cost map.

## Worked trace

A healthcare sector operates in state S of country C. Its base profit margin is 12. Two active subsidies exist: a national economy-wide one (`scopeType: economy_wide`, `domesticOnly: false`) and a state one for S (`scopeType: sector`, `targetSectorType: healthcare`, `domesticOnly: false`). The sector's nameplate `revenue` is 10,000,000 per turn. The world is below the `plants` tier, the country's currency is the anchor (rate 1), and there are no tariffs or other modifiers.

1. Qualification, national: scope is national and `sectorCountryId === C`, scope type is economy-wide, no strategy filter, not domestic-only. It qualifies.
2. Qualification, state: scope is state and `sectorStateId === S`, `sectorPolicyTargetMatches("healthcare", "healthcare")` is true, no strategy filter. It qualifies.
3. Margin modifier: `7.5 + 7.5 = 15` (`getSubsidyMarginModifier`).
4. Effective margin: `softCapEffectiveMargin(12 + 15) = 27`, below the 80 knee so unchanged.
5. High-margin variant: a base of 75 gives raw 90, and `80 + 20 x tanh((90 - 80) / 20) = 80 + 20 x 0.4621 = 89.24`. The last points are worth less near the ceiling.
6. Cost, national subsidy: it covers every qualifying sector in C. For this sector, `10,000,000 x 48 x 0.105 = 50,400,000` a year in anchor units, added to the country's `sectorSubsidies` line in `federalBudget`, then converted to C's currency before the write.
7. Cost, state subsidy: only sectors in S qualify. Here the same sector gives `50,400,000` into the `stateBudgets` document for S.
8. Realized-revenue variant: under `plants` with `realizedRevenue` 4,000,000, each cost is `4,000,000 x 48 x 0.105 = 20,160,000`. The margin bonus is unchanged.
9. Budget write: `surplus = revenue.total - spending.total` is recomputed and the document is written only if the line, total or surplus changed.

## Edge cases and limits

- **Same key overwrites.** Re-enacting the same scope, sector and strategy updates the existing record (and reactivates it if it had ended) rather than adding another +7.5pp.
- **Different keys stack.** Federal plus state, or economy-wide plus a sector-targeted subsidy, each add 7.5pp. There is no ceiling on the number of stacking subsidies other than the margin soft cap.
- **Ending a subsidy** with `end_subsidy` matches on the same key and sets `active: false`; the record is kept for audit. Ending something that does not exist is a no-op.
- **Strategy default.** A sector with no operating strategy counts as `standard` for the strategy filter.
- **State-owned corporations** have an empty headquarters state. They still qualify for non-domestic-only subsidies, and the cost side deliberately counts them too, so benefit and cost stay symmetric. A state-scoped `domesticOnly` subsidy cannot match them.
- **Zero qualifying revenue** produces no budget cost for that subsidy.
- **Cost follows benefit.** Under the plants market tier the margin bonus is earned on realized revenue, so cost is measured on realized revenue, not nameplate capacity. Below plants, plain `revenue` is used.
- **Currency.** Sector revenue is converted to the anchor currency, summed, then converted to the subsidizing country's currency, because budget fields are stored in country currency.
- **Margin cap.** Stacked subsidies cannot push a margin past the soft cap, so the last points are worth less near 100%.
- **Domestic-only is not part of the key.** Re-enacting with a different `domesticOnly` updates the existing record in place.
- **Pulse on no-op end.** An `end_subsidy` for a sector target fires the sector sentiment pulse even if no active record matched.

## Invariants

- **Cost and benefit use the same qualifying set.** Both call `corpQualifiesForSubsidy` with the same arguments, including the empty headquarters state of state-owned corporations. Covered by `src/lib/subsidies/subsidyBudgetCosts.test.ts` and `subsidyEffects.test.ts`.
- **Cost equals margin points times deadweight.** `SUBSIDY_COST_MULTIPLIER` is derived from `SUBSIDY_MARGIN_BONUS`, so they cannot drift apart; `src/lib/turn/subsidyBudgetTurn.test.ts` checks the 0.105 value.
- **Inactive subsidies deliver nothing.** `getSubsidyMarginModifier` skips `active: false`; tested.
- **Records are never deleted.** Ending sets `active: false`; tested in `subsidyEffects.test.ts`.
- **A margin never reaches 100.** Enforced by `softCapEffectiveMargin` in the margin stack. Not specifically asserted against subsidies.
- **Budget currency matches the granting country.** Covered by the "re-denominates" test in `subsidyBudgetTurn.test.ts`. Not enforced at runtime beyond the single conversion in the loader.
- **No uniqueness index on the composite key.** The six-field key is enforced only by the upsert filter, not by a database index.

## Failure and recovery

- **Missing budget line.** If the `subsidyBudget` phase fails, the budget keeps its last written subsidy cost until the next successful turn. The line is recomputed from scratch each turn, so the next run corrects it with no manual step.
- **Stale cost after an end.** When no active subsidies remain, the next run writes 0 and clears the stale line (tested).
- **Wrong currency on the cost line.** If FX rates are missing (forex off or unseeded), the cost passes through unconverted. Repair by seeding rates; the next turn rewrites the figure.
- **Duplicate or wrong subsidy documents.** Because the key is enforced by upsert only, a data repair or import could leave duplicates, which would double the bonus. A heal that deactivates the duplicate restores the intended stack.
- **Bill enacted with no country context.** The provision is skipped and an error is reported to monitoring; the subsidy is not created. Re-enact the provision through a new bill.

## Connections

**Driven by:**

- [Legislation System](./bills-legislation.md): `subsidy` and `end_subsidy` provisions create and deactivate records (`applySubsidyProvision`, `applyEndSubsidyProvision` via `src/lib/legislationEffects.ts`).
- [Corporations](./corporations.md): sector type, strategy, headquarters state and country decide qualification (`corpQualifiesForSubsidy`).

**Affects:**

- [Corporations](./corporations.md): adds to the sector margin stack in `src/lib/turn/corporation/sectorTurn/marginStack.ts`.
- [National Budget](./national-budget.md): the annualized cost appears as a sector-subsidies spending line (`src/lib/turn/subsidyBudgetTurn.ts`).
- [Tariffs](./tariffs.md): counterpart policy; both sit in the same margin stack and add together, so a tariff penalty on a foreign corp can be offset by a subsidy it qualifies for.

Related pages:

- [Tariffs](./tariffs.md) - Trade barriers (counterpart to subsidies)
- [Corporations](./corporations.md) - Profit margin modifiers, sector processing
- [Legislation System](./bills-legislation.md) - Bill enactment process

Key files:

| File                                             | Purpose                                      |
| ------------------------------------------------ | -------------------------------------------- |
| `src/lib/subsidies/subsidyEffects.ts`            | Subsidy qualification and margin calculation |
| `src/lib/turn/corporation/sectorTurn/marginStack.ts` | Subsidy application during turn processing (margin stack) |
| `src/lib/turn/subsidyBudgetTurn.ts` | Writes the annualized subsidy cost into federal and state budgets each turn |
| `src/lib/constants/corporations.ts` | `sectorPolicyTargetMatches`, `softCapEffectiveMargin` |
| `src/lib/subsidies/subsidyBudgetCosts.ts`        | Annualized government budget cost of active subsidies |
| `src/lib/legislationEffects.ts`                  | Subsidy provision enactment (calls `applySubsidyProvision`/`applyEndSubsidyProvision`) |

## Tests

- `src/lib/subsidies/subsidyEffects.test.ts`: the 7.5 constant, qualification (territory, sector type, folded sector targets, strategy default, domestic-only national and state), stacking, inactive skip, upsert and deactivate writes, `getActiveSubsidies`.
- `src/lib/subsidies/subsidyBudgetCosts.test.ts`: revenue basis below and under the plants tier, calibration at full realization, fallback when `realizedRevenue` is absent.
- `src/lib/turn/subsidyBudgetTurn.test.ts`: cost multiplier, federal and state writes, zero-revenue skip, stale line cleared, non-US budget ids, currency re-denomination.
- `src/lib/legislationEffects.test.ts`: enactment of subsidy and end-subsidy provisions, including state-scoped.
- Gaps: no test of the industry-bill-only rule for subsidy provisions in isolation, no test that two documents with the same key cannot coexist, and no end-to-end test of the margin stack with the soft cap and a subsidy together.

## Known issues and history

- The composite key has no database unique index (see Invariants).
- The cost uses the sector's own currency conversion per corporation, then one conversion to the granting country's currency; countries without a currency mapping pass through unconverted.
- Budget cost is measured on realized revenue under the plants market tier. Before that change, nameplate revenue was billed, overcharging the treasury by the realization gap (code comment, marked P3.5). The calibration is pinned so a fully realized world bills the same as before.
- No dated changelog entries are recorded on this page.

Last checked: 2026-10-29, version 1.18.0
