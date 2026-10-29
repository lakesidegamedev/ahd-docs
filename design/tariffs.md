# Tariffs

Tariffs are trade barriers enacted via legislation that impose costs on corporations operating outside their home country. They affect profit margins, market capture, and commodity pricing.

Player guide: [Tariffs](https://www.ahousedividedgame.com/wiki/tariffs)

**Entry point:** `src/lib/tariffs/tariffEffects.ts`

## Overview

- **Scope:** National or state-level trade policy
- **Target:** Foreign corporations operating in the tariff-imposing country
- **Effects:** Margin penalty, market capture modifier, commodity blend weight shift
- **Enactment:** Via `tariff` bill provisions in legislation system
- **Also feeds:** the country inflation-pressure input and the federal budget's headline tariff rate (see Connections)

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

The foreign modifier is then multiplied by `(1 - techEffects.tariffShield)` in the margin stack (`src/lib/turn/corporation/sectorTurn/marginStack.ts`), so a corporation with the tariff-shield tech effect pays proportionally less. The domestic malus is not shielded.

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

With FTA coverage, each contributing layer is first scaled by `(1 - partner-exposure share)` (the FTA-partner share of foreign trade in the country for economy-wide, or in the sector type for sector scope), so the snippet above shows the unscaled case. The blend weights below use the same scaling for their broad layers.

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

**Stacking:** Multiple tariffs stack additively. A 20% economy-wide + 15% sector tariff = 35% effective rate. Sector matching uses `sectorPolicyTargetMatches()` (`src/lib/constants/corporations.ts`), so a `manufacturing` target also covers `manufacturing_vehicles` and `media` also covers `media_entertainment`. The same sector alias applies in the domestic malus and blend weights, which the simplified snippets above write as plain equality.

**Worked example:** a US sector owned by a Chinese corporation faces a 20% economy-wide tariff and a 15% tariff aimed at Chinese-origin corporations. Effective rate = 35%, margin modifier = -17.5pp. A US-owned competitor in the same sector pays no tariff but takes a domestic malus from the economy-wide layer only: -(20 / 100) x 10 = -2pp. If a split attack by the domestic corp targets the Chinese sector, its capture multiplier is 1.0 + 0.35 x 0.5 = 1.175x.

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

Setting a rate of 0 through a new bill has the same effect as repealing the tariff, because zero-rate rows are skipped in every calculation. There is no separate repeal provision. The most recent bill for the same key wins.

**Economy-wide budget sync:** when an `economy_wide` tariff is enacted and the national budget's `taxRates.tariffs` differs, `applyTariffProvision` sets it to the new rate and recalculates federal revenue (`calculateFederalRevenue` in `src/lib/budget/revenue.ts`). Other scopes reach the budget only through corporate margins on later turns.

**Sentiment:** only `sector` tariffs fire sentiment pulses, `+0.07` domestic and `-0.07` foreign (`fireTariffProvisionSentiment`), and only when the rate changed. Withdrawing an FTA fires `-0.07` foreign pulses for each signed sector tariff (`fireFtaRescissionSentiment`).

## Rules and Constants

| Constant | Value | Source |
| --- | --- | --- |
| Effective rate cap | 100 (sum of applicable tariffs) | `getEffectiveTariffRate` in `src/lib/tariffs/tariffEffects.ts` |
| Foreign margin penalty | `-rate / 2` percentage points | `getForeignTariffMarginModifier` in `src/lib/tariffs/tariffEffects.ts` |
| Domestic malus | `-(T / 100) x 10`, T capped at 100, so 0 to -10pp | `getDomesticTariffMalus` in `src/lib/tariffs/tariffEffects.ts` |
| Blend weights at rate T | global `0.5 - 0.25 x T/100`, national `0.25 + 0.25 x T/100`, local fixed `0.25` | `getTariffBlendWeights` in `src/lib/tariffs/tariffEffects.ts` |
| Split capture multiplier | domestic `1 + 0.5 x T/100`, foreign `1 - 0.5 x T/100`, T clamped to 0..100 | `getSplitCaptureMultiplier` in `src/lib/tariffs/tariffEffects.ts` |
| Sector tariff sentiment pulse | +0.07 domestic, -0.07 foreign | `fireTariffProvisionSentiment` in `src/lib/tariffs/tariffEffects.ts` |
| Tariff shield | foreign modifier x `(1 - tariffShield)` | `src/lib/constants/techTree/effects.ts` |

## Timing

- **Enactment** runs when a signed bill's provisions are applied (`src/lib/legislationEffects.ts` calls `applyTariffProvision`). Signed tariff bills are also replayed idempotently by `src/lib/tariffs/reconcileTariffs.ts`, which does not re-fire sentiment.
- **Margin penalty, domestic malus and blend weights** are evaluated every turn per sector in the corporation phase margin stack (`src/lib/turn/corporation/sectorTurn/marginStack.ts`), using tariffs and FTA pairs preloaded once per turn (`src/lib/turn/corporation/buildLookups.ts`, `src/lib/corporations/turnReferenceData.ts`).
- **Inflation pressure** is computed in the budget inflation step (`src/lib/budget/inflation.ts`, `computeCountryTariffPressure`).
- **Split capture** is not a turn step. It is evaluated when a player runs a sector split attack through the region economy routes.
- A tariff or FTA change takes effect from the next corporation turn; nothing is retroactive.

## Edge cases and limits

- **Domestic corps never pay the foreign penalty.** If the sector's country equals the corporation's HQ country the effective rate is 0.
- **Cap.** Effective rate, domestic malus input and blend input are each capped at 100, so stacking beyond 100% has no extra effect.
- **Territorial invariant.** A country's tariffs apply only to sectors located in that country.
- **FTA.** A partner pair gets rate 0 for the foreign penalty. Domestic malus, blend weights and inflation pressure scale by the partner share instead of flipping on or off for broad scopes.
- **Narrow scopes and the malus.** `origin_country` and `corporation` tariffs never create a domestic malus.
- **Blend presence keys.** Narrow-scope tariffs only shift blend weights where the targeted entity actually has a cross-border sector of that type.
- **Zero rate** rows are ignored everywhere.
- **Subsidies.** A foreign corporation's tariff penalty and any subsidy it qualifies for are separate terms in the same margin stack and simply add. Neither cancels the other; see [Subsidies](./subsidies.md).

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
| `src/lib/budget/revenue.ts`             | Federal revenue recalculation after an economy-wide tariff changes the headline rate |
| `src/lib/budget/inflation.ts`           | Calls `computeCountryTariffPressure` for the inflation channel |
| `src/lib/turn/corporation/sectorTurn/marginStack.ts` | Applies foreign penalty, domestic malus and blend weights each turn |
| `src/lib/legislationEffects.ts`         | Routes enacted tariff provisions to `applyTariffProvision` |
| `src/lib/tariffs/reconcileTariffs.ts`   | Reapplies enacted tariff provisions in bulk |

## Connections

**Driven by:**

- [Legislation System](./bills-legislation.md): `tariff` provisions create or change tariffs (`src/lib/legislationEffects.ts` to `applyTariffProvision`).
- Free trade agreements (organization legislation): active FTAs load as partner pairs (`src/lib/tariffs/ftaOverrides.ts`) and zero or scale tariff layers.
- [Corporations](./corporations.md): HQ country, sector type and corporation id decide which tariffs apply.

**Affects:**

- [Corporations](./corporations.md): margin penalty, domestic malus and market capture in the sector margin stack and split attacks.
- [Commodities](./commodities.md): blend weights shift commodity margin pricing from global toward national.
- [National Budget](./national-budget.md): an economy-wide tariff sets the budget's headline tariff rate and revenue projection (`src/lib/tariffs/tariffEffects.ts`, `src/lib/budget/revenue.ts`).
- Inflation: tariff pressure is an input to country inflation (`src/lib/budget/inflation.ts`).
- [Subsidies](./subsidies.md): counterpart policy in the same margin stack.

## Related Documentation

- [Commodities](./commodities.md), Commodity pricing, blend weights, margin modifiers
- [Subsidies](./subsidies.md), Domestic industry support (counterpart to tariffs)
- [Legislation System](./bills-legislation.md), Bill enactment process

Last checked: 2026-10-29, version 1.18.0
