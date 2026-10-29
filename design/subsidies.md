# Subsidies

Subsidies are government financial support programs enacted via legislation that provide profit margin bonuses to qualifying corporations. They are the domestic counterpart to tariffs.

**Entry point:** `src/lib/subsidies/subsidyEffects.ts`

## Overview

- **Scope:** National or state-level industrial policy
- **Beneficiaries:** Qualifying corporations (domestic or foreign, based on `domesticOnly` flag)
- **Effect:** +7.5pp profit margin per qualifying subsidy
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

const totalMarginMod = /* ... */ +subsidyMod;
const effectiveMargin = Math.min(100, sector.profitMargin + totalMarginMod);
```

## Budget Cost

Subsidies are not free to the state. Each active subsidy carries an annualized cost in the owning government's budget (`src/lib/subsidies/subsidyBudgetCosts.ts`). The cost is the margin points delivered (7.5pp as a fraction of revenue) times a deadweight factor, `SUBSIDY_DEADWEIGHT_FACTOR = 1.4`, so `SUBSIDY_COST_MULTIPLIER = 0.075 × 1.4 = 0.105` of annual qualifying revenue. Cost is measured on the same revenue the margin bonus is earned on: realized revenue where plants production applies, not nameplate capacity. Sector revenue is normalized to the anchor currency, summed, and converted to the subsidizing country's currency for the budget.

## Key Files

| File                                             | Purpose                                      |
| ------------------------------------------------ | -------------------------------------------- |
| `src/lib/subsidies/subsidyEffects.ts`            | Subsidy qualification and margin calculation |
| `src/lib/turn/corporation/sectorTurn/marginStack.ts` | Subsidy application during turn processing (margin stack) |
| `src/lib/subsidies/subsidyBudgetCosts.ts`        | Annualized government budget cost of active subsidies |
| `src/lib/legislationEffects.ts`                  | Subsidy provision enactment (calls `applySubsidyProvision`/`applyEndSubsidyProvision`) |

## Related Documentation

- [Tariffs](./tariffs.md) - Trade barriers (counterpart to subsidies)
- [Corporations](./corporations.md) - Profit margin modifiers, sector processing
- [Legislation System](./bills-legislation.md) - Bill enactment process
