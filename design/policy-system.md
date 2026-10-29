# Policy System

How policy positions work at two levels, a character's personal stance and the enacted status quo per legislation type, and how enacted policy moves state and national metrics and demographics every turn.

Player guide: [Policy Effects](https://www.ahousedividedgame.com/wiki/policy-effects) (enacted policy and metric effects). For two-axis party positions see [Party Ideology](https://www.ahousedividedgame.com/wiki/party-ideology). No wiki page is dedicated to the personal policy shift action.

## Overview

The policy system tracks where characters and the game world stand on policy issues across two dimensions: **economic** (fiscal/regulatory spectrum) and **social** (cultural/rights spectrum). These positions are stored at two levels:

1. **Character policy positions** - each player character's personal stance on the economic and social axes (-5 to +5)
2. **State/national policy records** - the current legislative status quo per legislation type, stored in the `statePolicies` collection (-3 to +3 per axis)

The two levels are related but distinct. A character's personal positions affect how demographic groups vote in elections and how visible policy alignment is to voters. The `statePolicies` records reflect what the government has actually enacted through legislation and drive ongoing metric effects each turn.

---

## Player Policy Positions

### Scale

Each character has a `policies` object with two integer fields:

```ts
interface PolicyPositions {
  economic: number; // -5 to +5
  social: number; // -5 to +5
}
```

- **Negative** values are left/progressive; **positive** values are right/conservative.
- Set at character creation; changed only through the explicit policy shift action or by voting on bills.
- NPPs also carry `PolicyPositions` and use the same fields in election calculations.

### Changing Positions - Policy Shift Action

Players shift their policy position one step at a time via `POST /api/settings/policy`.

| Parameter   | Values                     |
| ----------- | -------------------------- |
| `axis`      | `"economic"` or `"social"` |
| `direction` | `1` or `-1`                |

**Cost per shift:**

| Resource            | Cost                                        |
| ------------------- | ------------------------------------------- |
| Actions             | 15 (`POLICY_SHIFT_ACTION_COST`)             |
| Political Influence | −5% (floor 0; `Math.floor(current × 0.95)`) |
| National Influence  | −5% (same formula)                          |
| Infamy              | +5 (`POLICY_SHIFT_INFAMY_COST`)             |

The new value is clamped to −5..+5; requests that would go out of bounds are rejected with a 400 error.

The 15, 5 and 0.95 values are `POLICY_SHIFT_ACTION_COST`, `POLICY_SHIFT_INFAMY_COST` and `POLICY_SHIFT_INFLUENCE_MULTIPLIER` in `src/lib/positionUpdateVouchers/rules.ts`. A shift can instead be paid with one position update voucher, which costs 0 actions, 0 infamy and no influence loss (multiplier 1). Vouchers are granted one at a time (`POSITION_UPDATE_VOUCHER_GRANT_AMOUNT = 1`). A `policy_shift` achievement is awarded on the first successful shift.

### Changing Positions - Bill Votes

Voting on a bill shifts the voter's own policy positions (`src/lib/policyShift.ts`). The bill's position on each axis is the average of its provisions that take a stance there (omitted and 0 values are ignored). An aye vote moves the voter toward the bill by `VOTE_SHIFT_STEP` = 0.25 per axis, never past the bill's position; a nay vote moves them away by 0.25; an abstention, an axis with no stance, or a voter already on the bill's position does not move. Results are clamped to -5..+5 and snapped to the 0.05 grid.

---

## State and National Policy Tracking

### Collection: `statePolicies`

Each record in `statePolicies` represents the current legislative standing for one legislation type, either at the national level or for a specific state.

**Key fields on `StatePolicyRecord`:**

| Field               | Type                      | Description                                                         |
| ------------------- | ------------------------- | ------------------------------------------------------------------- |
| `scope`             | `"national"` \| `"state"` | Whether this record is a federal position or a state-level position |
| `stateId`           | `string` (optional)       | Present when `scope = "state"` (e.g. `"CA"`, `"TX"`)                |
| `legislationTypeId` | `string`                  | References a `LegislationType._id`                                  |
| `economic`          | `number` (−3 to +3)       | Economic axis position; 0 = center                                  |
| `social`            | `number` (−3 to +3)       | Social axis position; 0 = center                                    |
| `updatedAt`         | `Date`                    | Last modification timestamp                                         |

Legislation types marked `nationalOnly: true` only have national-scope records. Types with `allowedScope: "both"` or `"state"` have per-state records.

### Seeding

Base policy records are seeded from `scripts/seeds/basePolicies.ts`:

- **National defaults**: Per-type baseline values (e.g. tax policy +1, healthcare −1) defined in `US_NATIONAL_DEFAULTS` and `UK_NATIONAL_DEFAULTS`.
- **State defaults**: Derived from each state's `politicalLean` property; bluer states get more negative values, redder states more positive. Clamped to −3..+3.

Run `npm run seed:policies` to upsert, or `npm run seed:policies:reset` to clear and reseed.

### Position Matching

The `statePolicies` position (economic, social) is an integer pair, not a named label. The API matches this pair against the legislation type's `policyOptions` array to return a human-readable `policyOptionName`:

- **Exact match**: finds the option where `o.economic === economic && o.social === social`.
- **Nearest neighbor**: if no exact match, selects the option with the minimum Manhattan distance (`|econDiff| + |socialDiff|`).

---

## Policy to Demographics (Elections)

Character policy positions are compared to the leans of each demographic group when calculating vote appeal. The live appeal curve uses exponent 1.5 (`APPEAL_POSITION_EXPONENT`), not the retired squared/gamma=2 curve. For the exact formula and pipeline, see [elections.md](./elections.md) - specifically the **Appeal** step in the Total Appeal System.

Summary: candidates closer to a demographic group's lean on the economic and social axes receive higher appeal scores with that group, which translates to a larger share of that group's votes per turn during general elections.

---

## Policy to Legislation (Bills and Archetype Approval)

When a bill is enacted, each provision's legislation type carries `economic` and `social` scores that define the ideological direction of that policy shift. This information is used in two ways:

1. **State metrics**: `applyLegislationEffect()` applies the provision's delta to the relevant state or national metrics via `effectTarget`.
2. **Archetype approval**: Legislators who voted FOR the enacted bill receive approval changes from their demographic archetypes. The impact is calculated from the difference between the old and new policy index for that legislation type, multiplied by each archetype's domain affinity. For the full formula, see [bills-legislation.md](./bills-legislation.md) - the **Archetype Approval Impacts** section.

Active `statePolicies` records also drive **per-turn metric effects** through `policyOptions[].metricEffects`. Each turn a policy is in effect, the matched option's `metricEffects` array applies direct additive changes to specific state or national metrics (e.g. −0.04%/turn to uninsured rate while a given healthcare option is active).

---

## Turn Processing - Policy Effects Engine

**Entry point:** `src/lib/policyEffects.ts` → `processStatePolicyEffects()`

### Processing Order (per turn)

1. **Exponential decay toward target** - Metrics move toward policy-driven targets
2. **Direct tick rates** - `metricEffects` apply additive changes
3. **Natural decay** - All metrics decay 0.25%/turn toward baseline when no policy is active

### Exponential Decay Formula

```typescript
// src/lib/policyEffects.ts:325-326
const newValue = applyPolicyDecay(currentValue, target);

// @shared/constants/formulas.ts
export const POLICY_TAU = 139; // turns

export function applyPolicyDecay(current: number, target: number, tau = POLICY_TAU): number {
  const decayFactor = 1 - Math.exp(-1 / tau); // about 0.7% of the remaining gap per turn
  return current + (target - current) * decayFactor;
}
```

Metrics approach their target asymptotically - large gaps close faster than small ones.

### Target Calculation

```typescript
// src/lib/policyEffects.ts:145-221 calculateMetricTarget()

let totalContribution = 0;

for (const policy of policies) {
  const legType = legTypeMap.get(policy.legislationTypeId);

  // Weighted effect targets (preferred)
  if (legType.effectTargetsWeighted) {
    for (const target of legType.effectTargetsWeighted) {
      let contribution = calculatePolicyContribution(
        policy.effectDirection * 3, // -3 to +3 range
        target.weight,
        policy.scopeMultiplier,
        isHigherBetter
      );

      // Time-based decay (adaptation modeling)
      if (target.adjustmentHalfLife) {
        const turnsElapsed = currentTurn - policy.enactedTurn;
        const decayFactor = applyHalfLifeDecay(1, turnsElapsed, target.adjustmentHalfLife);
        contribution *= decayFactor;
      }

      totalContribution += contribution;
    }
  }
}

return baseline + totalContribution;
```

### Federal Multiplier (Country-Aware)

Federal policies apply at reduced strength per state/region:

```typescript
// @shared/constants/formulas.ts
export function getFederalMultiplier(countryId: string): number {
  // UK 1/12 (regions), JP 1/8 (regions), DE 1/16 (Länder)
  return FEDERAL_MULTIPLIER_BY_COUNTRY[countryId] ?? 1 / 50; // default 1/50 (US states)
}
```

**Source:** `FEDERAL_MULTIPLIER`, `UK_FEDERAL_MULTIPLIER`, `JP_FEDERAL_MULTIPLIER`, `DE_FEDERAL_MULTIPLIER` in `shared/constants/formulas.ts`. This multiplier governs the per-turn tick path (`metricEffects`). The exponential-decay path is normalized separately: any national law (scope below 1) uses `NATIONAL_LAW_DECAY_MULTIPLIER = 0.21` per region (`nationalDecayScope`), so a strong national law moves its main metric about the same amount whether the country has 12 or 50 regions. State and regional laws (scope 1) keep full strength. `MAX_EFFECT_PER_LAW = 12` caps the decay-path points one law can move a metric before the scope multiplier. Metrics with a range above 100 are scaled by their reference value divided by 100 (`metricRangeScale`).

**Rationale:** The sum of per-region effects equals the intended national total. Prevents a single federal bill from dominating state metrics.

### Time-Based Effect Decay

Some policies have `adjustmentHalfLife` - models economic adaptation:

```typescript
// Example: Defense cuts hurt GDP initially, but economy adapts
const decayFactor = applyHalfLifeDecay(1, turnsElapsed, adjustmentHalfLife);
// After N half-lives: effect = initial × (0.5)^N
```

| Half-Life (turns) | Effect after 48 turns (1 game-year) |
| ----------------- | ----------------------------------- |
| 24                | 25% of original                     |
| 48                | 50% of original                     |
| 96                | 71% of original                     |

### Direct Tick Rates

Policy options apply additive per-turn changes:

```typescript
// src/lib/policyEffects.ts:341-363
const tickRates = computeTickRates(policies, legTypeMap);

for (const [category, metricRates] of Object.entries(tickRates)) {
  for (const [metricId, rate] of Object.entries(metricRates)) {
    if (rate === 0) continue;
    const newVal = Math.max(minVal, Math.min(maxVal, base + rate));
    // Example: rate = -0.04%/turn for uninsured rate
  }
}
```

**Effect scale:** Extreme policies ≈ ±0.06/turn, center = 0. Designed for ~10-year full reversal.

### Natural Metric Decay

When no policy is active, metrics decay toward baseline:

```typescript
// src/lib/policyEffects.ts:22-24
// Natural metric decay: 0.25%/turn toward baseline
// Prevents permanent deviation after legislation expires
```

---

## Turn Processing - Demographic Effects

**Entry point:** `src/lib/demographicEffects.ts` → `processAllStateDemographics()`

### Demographic Shift Mechanics

Policies gradually shift demographic group populations:

```typescript
// src/lib/demographicEffects.ts:46
export const SHIFT_RATE_PER_TURN = 0.1; // 0.1% max shift per turn

// src/lib/demographicEffects.ts:54-86 calculateDemographicShifts()
const strength = policy.economic / 3; // Normalize -3..+3 to -1..+1
const shiftAmount = effect.direction * strength * policy.scopeMultiplier * SHIFT_RATE_PER_TURN;
shifts[effect.groupId] = (shifts[effect.groupId] ?? 0) + shiftAmount;
```

| Policy Strength    | Normalized | Max Shift/Turn |
| ------------------ | ---------- | -------------- |
| +3 (extreme right) | +1.0       | +0.1%          |
| +1 (moderate)      | +0.33      | +0.033%        |
| 0 (center)         | 0          | 0              |
| -1 (moderate left) | -0.33      | -0.033%        |
| -3 (extreme left)  | -1.0       | -0.1%          |

### Federal Division

Federal demographic effects also use the country-aware multiplier:

```typescript
// US: 1/50 per state, UK: 1/12 per region, JP: 1/8 per region, DE: 1/16 per Land; any other country defaults to 1/50
const federalPolicies = statePolicies.get("federal").map((p) => ({
  ...p,
  scopeMultiplier: getFederalMultiplier("US"), // 0.02
}));
```

### Bulk Processing Optimization

Both policy and demographic effects use bulk-fetch and bulk-write:

```typescript
// src/lib/policyEffects.ts:393-400
const [states, allStatePolicies, allLegTypes, allStateMetrics, allStateBaselines] =
  await Promise.all([...]);  // Parallel fetch

// Collect updates, single bulkWrite
if (bulkOps.length > 0) {
  await db.collection("stateMetrics").bulkWrite(bulkOps);
}
```

---

## API

### `GET /api/policy`

Returns current policy records joined with legislation type metadata. No authentication required.

**Query parameters:**

| Parameter | Required   | Description                                                                         |
| --------- | ---------- | ----------------------------------------------------------------------------------- |
| `scope`   | Yes        | `"national"` or `"state"`                                                           |
| `stateId` | When state | State abbreviation (e.g. `"CA"`)                                                    |
| `country` | No         | `"us"` or `"uk"` - filters legislation types by country scope when `scope=national` |

**Response**: Array of `PolicyRecordResponse` objects:

| Field               | Type               | Description                                                                             |
| ------------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `legislationTypeId` | `string`           | Legislation type identifier                                                             |
| `name`              | `string`           | Human-readable legislation type name                                                    |
| `policyDomain`      | `string`           | Domain (e.g. `"healthcare"`, `"economy"`)                                               |
| `economic`          | `number`           | Current economic axis position (−3 to +3)                                               |
| `social`            | `number`           | Current social axis position (−3 to +3)                                                 |
| `nationalOnly`      | `boolean`          | Whether this type is federal-only                                                       |
| `policyOptionName`  | `string` \| `null` | Name of the matched policy option (exact or nearest)                                    |
| `hasEconomic`       | `boolean`          | True if this type has any option with a non-zero economic score                         |
| `hasSocial`         | `boolean`          | True if this type has any option with a non-zero social score                           |
| `metricEffects`     | array              | Per-turn metric effects from the matched option (`category`, `metricId`, `ratePerTurn`) |

Cache-Control is set to `no-store` on all responses.

**Error**: Returns `400` when `scope` is missing, invalid, or `scope=state` is used without `stateId`.

### `POST /api/settings/policy`

Shifts the authenticated character's policy position. See [Player Policy Positions - Policy Shift Action](#changing-positions--policy-shift-action) above.

---

## Database

**Collection**: `statePolicies`

**Indexes used**: `{ scope, stateId }` for state queries; `{ scope: "national" }` for national queries.

**Related collections**:

- `legislationTypes` - provides `policyOptions`, `policyDomain`, `nationalOnly`, `countryScope`, and `effectTargetsWeighted` used by the policy API and turn system
- `characters` - stores per-character `policies: { economic, social }` (−5 to +5)

**Key type files**:

- `src/lib/db/types/legislation.ts` - `LegislationType`, `LegislationPolicyOption`, `StatePolicyRecord`, `PolicyOptionMetricEffect`
- `src/lib/db/types/statePolicy.ts` - `StatePolicy` (the enacted-bill record), `PolicyReaction`, `VoteImpact`
- `src/lib/db/types/character.ts` - `PolicyPositions`

> Note: `StatePolicyRecord` (in `legislation.ts`) and `StatePolicy` (in `statePolicy.ts`) are different interfaces. `StatePolicyRecord` is what the policy API reads - the current axis positions per type. `StatePolicy` is a richer enacted-bill record that also stores `enactedAt`, `enactedByBillId`, and `effectDirection`.

---

## Timing

Both engines run inside the hourly turn, in the state effects phase (`src/simulation/phases/stateEffectsPhase.ts`): `policyEffects` is one sub-phase there, and `processAllStateDemographics` is dispatched in the same phase's later parallel group, so demographics read the same turn's policy records. Within `processStatePolicyEffects` (`src/lib/policyEffects.ts`) the order is: exponential decay toward target, then direct tick rates, then natural decay of metrics with no active policy. Enactment itself happens when a bill resolves, outside this pass; a new `statePolicies` record takes effect from the next turn. See [Turn Processing](./turn-processing.md).

## Constants

| Constant | Value | Source |
| --- | --- | --- |
| Character position range | -5 to +5 | `src/lib/db/types/character.ts` |
| `statePolicies` range | -3 to +3 | `src/lib/db/types/legislation.ts` |
| `POLICY_SHIFT_ACTION_COST` | 15 | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFAMY_COST` | 5 | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFLUENCE_MULTIPLIER` | 0.95 | `src/lib/positionUpdateVouchers/rules.ts` |
| `VOTE_SHIFT_STEP` | 0.25 | `src/lib/policyShift.ts` |
| `POLICY_TAU` | 139 turns | `shared/constants/formulas.ts` |
| `MAX_EFFECT_PER_LAW` | 12 | `shared/constants/formulas.ts` |
| `NATIONAL_LAW_DECAY_MULTIPLIER` | 0.21 | `shared/constants/formulas.ts` |
| `SHIFT_RATE_PER_TURN` | 0.1 (percent) | `src/lib/demographicEffects.ts` |
| Natural metric decay | 0.25% per turn | `src/lib/policyEffects.ts` |
| `APPEAL_POSITION_EXPONENT` | 1.5 | `src/lib/utils/demographicAppeal.ts` |

## Edge cases and limits

- **Bounds.** A shift past -5 or +5 is rejected with 400; the filter is atomic, so the character is not charged.
- **Floors.** Political and National Influence use `floor(current x 0.95)`, so 0 stays 0 and the cost is zero on an empty balance.
- **Rate limit.** The shift endpoint allows 30 requests per 60 seconds per user.
- **Votes.** A vote never moves a voter past the bill's own position, and a bill with no stance on an axis (or a stance of 0) leaves that axis alone.
- **No policy active.** Metrics decay 0.25% per turn toward baseline, so a repealed or expired law does not leave a permanent mark.
- **Adaptation.** `adjustmentHalfLife` shrinks a policy's contribution over time since enactment, so one-off shocks fade.
- **Unmatched option.** The API reports the nearest option by Manhattan distance when no option matches the pair exactly.
- **Missing seeds.** A state with no `statePolicies` records shows an empty laws tab.
- **Why the scope split.** Without the federal multiplier one federal bill would move every state by its full amount, and without the normalized decay scope a federal law would be weak in countries with many regions.

## Connections

**Driven by**
- [Bills & Legislation](./bills-legislation.md): enacted bills write `statePolicies` records and bill votes shift personal positions (`src/lib/policyShift.ts`).
- [Player Progression](./player-progression.md): the shift action spends actions and influence.
- [Stats & Actions](./stats-actions.md): action and infamy costs.

**Affects**
- [National Metrics](./national-metrics.md): per-turn policy effects write `stateMetrics` and national metrics (`src/lib/policyEffects.ts`).
- [Election Mechanics](./elections.md): personal positions set demographic appeal (`src/lib/utils/demographicAppeal.ts`).
- [Demographics](./demographics.md): enacted policy shifts group populations (`src/lib/demographicEffects.ts`).
- [Player Policies](./player-policies.md): the player-facing view of personal positions.

## Display

- **National Policy page** (`/policy`): Lists all national policies grouped by domain. Shows current policy option name and economic/social positions per type.
- **State page - State Laws & Policy tab**: State-level policy records for the selected state. Empty if `seed:legislation` and `seed:policies` have not been run.
- **Character profile**: Shows the character's personal economic and social positions on the −5 to +5 scale.

Last checked: 2026-10-29, version 1.18.0
