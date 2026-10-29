# Tariffs

Tariffs are trade barriers enacted via legislation that impose costs on corporations operating outside their home country. They affect profit margins, market capture, and commodity pricing.

**Entry point:** `src/lib/tariffs/tariffEffects.ts`

## Overview

- **Scope:** National or state-level trade policy
- **Target:** Foreign corporations operating in the tariff-imposing country
- **Effects:** Margin penalty, market capture modifier, commodity blend weight shift
- **Enactment:** Via `tariff` bill provisions in legislation system

## Tariff Structure

```typescript
interface Tariff {
  _id: ObjectId;
  countryId: CountryId; // Country imposing the tariff
  scopeType: string; // "economy_wide" | "sector" | "origin_country" | "corporation"
  targetSectorType?: string; // For sector scope
  targetOriginCountryId?: string; // For origin_country scope
  targetCorporationId?: ObjectId; // For corporation scope
  rate: number; // 0-100 (percentage points)
  sourceBillId: ObjectId; // Enacting legislation
  createdAt: Date;
  updatedAt: Date;
}
```

## Scope Types

| Scope            | Description                                | Target                             |
| ---------------- | ------------------------------------------ | ---------------------------------- |
| `economy_wide`   | Blanket tariff on all foreign corporations | All foreign corps in country       |
| `sector`         | Targeted tariff on specific sector type    | e.g., all foreign steel producers  |
| `origin_country` | Country-specific tariff                    | Corps from specific origin country |
| `corporation`    | Entity-specific tariff                     | Single named corporation           |

### Composite Key

Tariffs use a five-field upsert key to prevent duplicates:

```typescript
{
  (countryId, scopeType, targetSectorType, targetOriginCountryId, targetCorporationId);
}
```

Re-enacting the same provision updates the existing tariff rather than creating a duplicate.

## FTA Override Layer

Free trade agreements zero out all tariff layers between the partnered countries. When two countries are bound by an active FTA (`organizationLegislation` doc, `type: "free_trade_agreement"`, `status: "active"`), every `C(n,2)` pair among the FTA's `parties` is treated as tariff-free between those two countries, this overrides `economy_wide`, `sector`, `origin_country`, and `corporation` scopes alike.

```typescript
// src/lib/tariffs/ftaOverrides.ts
export function isFtaActive(pairs: FtaPairSet, a: string, b: string): boolean {
  if (a === b) return true; // domestic, treated as fully integrated
  return pairs.has(ftaPairKey(a as CountryId, b as CountryId));
}
```

`getEffectiveTariffRate()` takes an optional `activeFtaPairs` set and short-circuits to 0 before summing any tariff layer when the sector country and the corp HQ country are FTA partners. The same FTA coverage also proportionally neutralizes the domestic malus, the commodity blend weights, and the country-level inflation-pressure input (`computeCountryTariffPressure`), so an FTA that zeroes the corporate-margin channel is consistent everywhere else tariffs feed in, a tariff neutralized by FTA does not still drive consumer-price inflation or blend weighting.

## Territorial Invariant

**Critical:** Only tariffs where `tariff.countryId === sectorCountryId` are consulted. A tariff imposed by the US on Chinese corps only applies to sectors operating **in the US**, not to Chinese sectors operating in third countries.

```typescript
// getEffectiveTariffRate()
if (t.countryId !== sectorCountryId) continue;
```

## Margin Modifiers

### Foreign Corporations

Foreign corporations pay **half** the effective tariff rate as a margin penalty, not the full rate:

```typescript
// getForeignTariffMarginModifier()
const rate = getEffectiveTariffRate(tariffs, sectorCountryId, sectorType, corpHqCountryId, corpId, activeFtaPairs);
if (rate === 0) return 0;
// Halved: a 40% tariff gives -20pp margin penalty, not -40pp.
// Full 1:1 ratio made tariffs too punitive for foreign corps operating
// in the tariff country, effectively killing their margins.
return -rate / 2;
```

**Example:** 25% tariff → -12.5pp margin modifier

### Domestic Corporations

Domestic corporations pay a smaller **supply-chain friction malus** from economy-wide and sector tariffs only:

```typescript
// getDomesticTariffMalus()
let total = 0;
for (const t of tariffs) {
  if (t.countryId !== sectorCountryId) continue;
  if (t.scopeType === "economy_wide") total += t.rate;
  else if (t.scopeType === "sector" && t.targetSectorType === sectorType) total += t.rate;
}
const T = Math.min(100, total);
return -(T / 100) * 10; // -0 to -10pp
```

**Rationale:** Broad tariffs create domestic supply-chain friction, but targeted origin-country and corporation-specific tariffs are too narrow to affect domestic costs.

| Tariff Rate | Domestic Malus |
| ----------- | -------------- |
| 0%          | 0pp            |
| 25%         | -2.5pp         |
| 50%         | -5pp           |
| 100%        | -10pp          |

## Effective Tariff Rate Calculation

The effective rate is the sum of all applicable tariffs:

```typescript
// getEffectiveTariffRate()
if (sectorCountryId === corpHqCountryId) return 0; // Domestic corps pay no tariff

for (const t of tariffs) {
  if (t.countryId !== sectorCountryId) continue;
  if (t.rate === 0) continue;

  if (t.scopeType === "economy_wide") {
    total += t.rate;
  } else if (t.scopeType === "sector" && t.targetSectorType === sectorType) {
    total += t.rate;
  } else if (t.scopeType === "origin_country" && t.targetOriginCountryId === corpHqCountryId) {
    total += t.rate;
  } else if (t.scopeType === "corporation" && t.targetCorporationId === corpId) {
    total += t.rate;
  }
}
return Math.min(100, total);
```

**Stacking:** Multiple tariffs stack additively. A 20% economy-wide + 15% sector tariff = 35% effective rate.

## Commodity Blend Weights

Commodity margin calculation blends three price sources: global, national, and local (state-level). Tariffs shift weight from **global to national**, not to local; the local weight is fixed:

```typescript
// getTariffBlendWeights()
let blendRate = 0;
for (const t of tariffs) {
  if (t.countryId !== sectorCountryId) continue;
  if (t.rate === 0) continue;

  if (t.scopeType === "economy_wide") blendRate += t.rate;
  else if (t.scopeType === "sector" && t.targetSectorType === sectorType) blendRate += t.rate;
  else if (t.scopeType === "origin_country") {
    const key = `${sectorCountryId}:${t.targetOriginCountryId}:${sectorType}`;
    if (allSectorKeys.has(key)) blendRate += t.rate;
  } else if (t.scopeType === "corporation") {
    const key = `${sectorCountryId}:corp:${t.targetCorporationId}:${sectorType}`;
    if (allSectorKeys.has(key)) blendRate += t.rate;
  }
}

const T = Math.min(100, blendRate);
const tariffEffect = T / 100;
const localWeight = 0.25; // fixed
const nationalWeight = 0.25 + tariffEffect * 0.25; // 0.25 → 0.50
const globalWeight = 0.5 - tariffEffect * 0.25; // 0.50 → 0.25
```

| Tariff Rate | Global Weight | National Weight | Local Weight |
| ----------- | -------------- | ---------------- | ------------- |
| 0%          | 0.50           | 0.25              | 0.25          |
| 25%         | 0.4375         | 0.3125            | 0.25          |
| 50%         | 0.375          | 0.375             | 0.25          |
| 100%        | 0.25           | 0.50              | 0.25          |

**Rationale:** Tariffs make national commodity markets more relevant to margin calculation, reflecting that import costs push buyers toward domestically-priced goods; the local/state component is held fixed and does not move with tariff pressure.

FTA coverage scales the broad scopes (`economy_wide`, `sector`) down by `(1 - partner-exposure share)` and zeroes out narrow scopes (`origin_country`, `corporation`) targeting an FTA partner, the same treatment used by the corporate-margin and inflation-pressure channels.

## Market Capture (Split Attacks)

Tariffs affect market capture during sector split attacks:

```typescript
// getSplitCaptureMultiplier()
const T = Math.max(0, Math.min(100, effectiveTariffRate));
if (isDomesticSplittingForeign) {
  return 1.0 + (T / 100) * 0.5; // 1.0 → 1.5× (domestic bonus)
}
return 1.0 - (T / 100) * 0.5; // 1.0 → 0.5× (foreign penalty)
```

| Tariff Rate | Domestic Attacker | Foreign Attacker |
| ----------- | ----------------- | ---------------- |
| 0%          | 1.0×              | 1.0×             |
| 25%         | 1.125×            | 0.875×           |
| 50%         | 1.25×             | 0.75×            |
| 100%        | 1.5×              | 0.5×             |

**Effect:** Domestic corps gain market share as foreign competitors are priced out.

## Enactment

Tariffs are enacted via legislation:

```typescript
// applyTariffProvision() (upsert; the surrounding function runs 392-492)
const filter = {
  countryId,
  scopeType: provision.scopeType,
  targetSectorType: provision.targetSectorType ?? null,
  targetOriginCountryId: provision.targetOriginCountryId ?? null,
  targetCorporationId: provision.targetCorporationId
    ? new ObjectId(String(provision.targetCorporationId))
    : null,
};

await db.collection<Tariff>("tariffs").updateOne(
  filter,
  {
    $set: { rate: provision.rate, sourceBillId, updatedAt: now },
    $setOnInsert: { createdAt: now },
  },
  { upsert: true }
);
```

## Collections

### `tariffs`

| Field                   | Type      | Description                                               |
| ----------------------- | --------- | --------------------------------------------------------- |
| `_id`                   | ObjectId  | Document ID                                               |
| `countryId`             | CountryId | Country imposing tariff                                   |
| `scopeType`             | string    | `economy_wide`, `sector`, `origin_country`, `corporation` |
| `targetSectorType`      | string?   | For sector scope                                          |
| `targetOriginCountryId` | string?   | For origin_country scope                                  |
| `targetCorporationId`   | ObjectId? | For corporation scope                                     |
| `rate`                  | number    | Tariff rate (0-100)                                       |
| `sourceBillId`          | ObjectId  | Enacting legislation                                      |
| `createdAt`             | Date      | Creation timestamp                                        |
| `updatedAt`             | Date      | Last update                                               |

## Key Files

| File                                    | Purpose                                   |
| --------------------------------------- | ----------------------------------------- |
| `src/lib/tariffs/tariffEffects.ts`      | All tariff effect calculations            |
| `src/lib/tariffs/ftaOverrides.ts`       | Free trade agreement pair loading + lookup |
| `src/lib/budget/fiscalYear.ts`          | Tariff rate application in budget context |
| `src/lib/legislationEffects.ts`         | Routes enacted tariff provisions to `applyTariffProvision` |
| `src/lib/tariffs/reconcileTariffs.ts`   | Reapplies enacted tariff provisions in bulk |

## Related Documentation

- [Commodities](./commodities.md), Commodity pricing, blend weights, margin modifiers
- [Subsidies](./subsidies.md), Domestic industry support (counterpart to tariffs)
- [Legislation System](./bills-legislation.md), Bill enactment process
