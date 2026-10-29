# Subsidies

Subsidies are government financial support programs enacted via legislation that provide profit margin bonuses to qualifying corporations. They are the domestic counterpart to [tariffs](./tariffs.md).

Player guide: [Subsidies](https://www.ahousedividedgame.com/wiki/subsidies)

**Entry point:** `src/lib/subsidies/subsidyEffects.ts`

## Overview

- **Scope:** National or state-level industrial policy
- **Beneficiaries:** Qualifying corporations (domestic or foreign, based on `domesticOnly` flag)
- **Effect:** +7.5pp profit margin per qualifying subsidy (`SUBSIDY_MARGIN_BONUS` in `src/lib/subsidies/subsidyEffects.ts`)
- **Cost:** an annualized line in the owning government's budget, see Budget Cost
- **Enactment:** Via `subsidy` bill provisions in legislation system
- **Stacking:** Federal and state subsidies stack freely

## Subsidy Structure

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

## Qualification Rules

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

### Scope Types

| Scope          | Description                         | Qualifying Sectors            |
| -------------- | ----------------------------------- | ----------------------------- |
| `economy_wide` | Blanket subsidy to all sectors      | All sectors in territory      |
| `sector`       | Targeted subsidy to specific sector | e.g., only healthcare sectors |

### Domestic-Only Flag

When `domesticOnly: true`:

- **National subsidy:** Only corporations with `corpCountryId === subsidy.countryId` qualify
- **State subsidy:** Only corporations with `corpHqState === subsidy.stateId` qualify

When `domesticOnly: false` (default):

- Foreign corporations operating in the territory also qualify

## Margin Modifier

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

### Stacking Examples

| Subsidies                         | Total Bonus                      |
| --------------------------------- | --------------------------------- |
| 1 federal (economy_wide)          | +7.5pp                            |
| 1 state (sector: healthcare)      | +7.5pp                            |
| 1 federal + 1 state (same sector) | +15pp                             |
| 2 federal (economy_wide + sector) | +15pp                             |
| 2 federal (same scope)            | +7.5pp (second overwrites first)  |

**Note:** Multiple subsidies of the same scope/type do NOT stack - the second overwrites the first via upsert. Different scopes (economy_wide + sector) or different levels (federal + state) DO stack.

## Enactment

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

## Ending Subsidies

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

## Composite Key

Subsidies use a six-field upsert key to prevent duplicates:

```typescript
{
  (countryId, scope, stateId, scopeType, targetSectorType, targetStrategyId);
}
```

Re-enacting the same provision updates the existing subsidy rather than creating a duplicate.

## Collections

### `subsidies`

| Field              | Type      | Description                           |
| ------------------ | --------- | ------------------------------------- |
| `_id`              | ObjectId  | Document ID                           |
| `countryId`        | CountryId | Country (national) or state's country |
| `scope`            | string    | `"national"` or `"state"`             |
| `stateId`          | string?   | For state subsidies                   |
| `scopeType`        | string    | `"economy_wide"` or `"sector"`        |
| `targetSectorType` | string?   | For sector scope                      |
| `targetStrategyId` | string?   | Required operating strategy           |
| `domesticOnly`     | boolean   | Only domestic corps qualify           |
| `active`           | boolean   | Active status                         |
| `sourceBillId`     | ObjectId  | Enacting legislation                  |
| `createdAt`        | Date      | Creation timestamp                    |
| `updatedAt`        | Date      | Last update                           |

## Integration with Corporation Turn Processing

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

## Budget Cost

Subsidies are not free to the state. Each active subsidy carries an annualized cost in the owning government's budget (`src/lib/subsidies/subsidyBudgetCosts.ts`). The cost is the margin points delivered (7.5pp as a fraction of revenue) times a deadweight factor, `SUBSIDY_DEADWEIGHT_FACTOR = 1.4`, so `SUBSIDY_COST_MULTIPLIER = 0.075 × 1.4 = 0.105` of annual qualifying revenue. Cost is measured on the same revenue the margin bonus is earned on: realized revenue where plants production applies, not nameplate capacity. Sector revenue is normalized to the anchor currency, summed, and converted to the subsidizing country's currency for the budget.

Worked example: a healthcare sector has a base profit margin of 12%. A national economy-wide subsidy (+7.5pp) and a state healthcare subsidy in the state it operates in (+7.5pp) both qualify, so the subsidy contribution is +15pp and, with no other modifiers, the effective margin is 27%. If the sector's revenue is 10,000,000 per turn and `TURNS_PER_YEAR` is 48, the national subsidy alone costs the federal budget 10,000,000 x 48 x 0.105 = 50,400,000 a year.

## Rules and Constants

| Constant | Value | Source |
| --- | --- | --- |
| `SUBSIDY_MARGIN_BONUS` | 7.5 percentage points per qualifying active subsidy | `src/lib/subsidies/subsidyEffects.ts` |
| `SUBSIDY_DEADWEIGHT_FACTOR` | 1.4 (fiscal inefficiency premium) | `src/lib/subsidies/subsidyBudgetCosts.ts` |
| `SUBSIDY_COST_MULTIPLIER` | `(7.5 / 100) x 1.4 = 0.105` of annual qualifying revenue | `src/lib/subsidies/subsidyBudgetCosts.ts` |
| `TURNS_PER_YEAR` | 48 (annualizes one turn of revenue) | `src/lib/constants/turnTime.ts` |
| `MARGIN_SOFT_CAP_KNEE` | 80 | `src/lib/constants/corporations.ts` |
| `MARGIN_HARD_CEILING` | 100 | `src/lib/constants/corporations.ts` |

## Timing

- **Enactment** happens when a bill containing a `subsidy` or `end_subsidy` provision is enacted (`src/lib/legislationEffects.ts`), outside the corporation phase. A sector-scoped subsidy also fires a sector sentiment pulse (`fireSubsidyCreatedPulse` or `fireSubsidyEndedPulse` in `src/lib/corporations/sentimentEvents.ts`).
- **Benefit** is evaluated every turn in the corporation phase, inside each sector's margin stack (`marginStack.ts`). It reads the active subsidy list preloaded once per turn (`src/lib/corporations/turnReferenceData.ts`), so a subsidy enacted mid-turn applies from the next corporation turn.
- **Cost** is written in the `subsidyBudget` phase (`runPhase("subsidyBudget", ...)` in `src/lib/simulation/phases/stateEffectsPhase.ts`), every turn, so the budget line stays current between fiscal-year resets. Regional budgets for Germany, China and Japan also read the state cost map.

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

## Key Files

| File                                             | Purpose                                      |
| ------------------------------------------------ | -------------------------------------------- |
| `src/lib/subsidies/subsidyEffects.ts`            | Subsidy qualification and margin calculation |
| `src/lib/turn/corporation/sectorTurn/marginStack.ts` | Subsidy application during turn processing (margin stack) |
| `src/lib/turn/subsidyBudgetTurn.ts` | Writes the annualized subsidy cost into federal and state budgets each turn |
| `src/lib/constants/corporations.ts` | `sectorPolicyTargetMatches`, `softCapEffectiveMargin` |
| `src/lib/subsidies/subsidyBudgetCosts.ts`        | Annualized government budget cost of active subsidies |
| `src/lib/legislationEffects.ts`                  | Subsidy provision enactment (calls `applySubsidyProvision`/`applyEndSubsidyProvision`) |

## Connections

**Driven by:**

- [Legislation System](./bills-legislation.md): `subsidy` and `end_subsidy` provisions create and deactivate records (`applySubsidyProvision`, `applyEndSubsidyProvision` via `src/lib/legislationEffects.ts`).
- [Corporations](./corporations.md): sector type, strategy, headquarters state and country decide qualification (`corpQualifiesForSubsidy`).

**Affects:**

- [Corporations](./corporations.md): adds to the sector margin stack in `src/lib/turn/corporation/sectorTurn/marginStack.ts`.
- [National Budget](./national-budget.md): the annualized cost appears as a sector-subsidies spending line (`src/lib/turn/subsidyBudgetTurn.ts`).
- [Tariffs](./tariffs.md): counterpart policy; both sit in the same margin stack and add together, so a tariff penalty on a foreign corp can be offset by a subsidy it qualifies for.

## Related Documentation

- [Tariffs](./tariffs.md) - Trade barriers (counterpart to subsidies)
- [Corporations](./corporations.md) - Profit margin modifiers, sector processing
- [Legislation System](./bills-legislation.md) - Bill enactment process

Last checked: 2026-10-29, version 1.18.0
