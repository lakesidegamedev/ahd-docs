# Policy System

How policy positions work at two levels, a character's personal stance and the enacted status quo per legislation type, and how enacted policy moves state and national metrics and demographics every turn.

## Summary

Player guide: [Policy Effects](https://www.ahousedividedgame.com/wiki/policy-effects) (enacted policy and metric effects). For two-axis party positions see [Party Ideology](https://www.ahousedividedgame.com/wiki/party-ideology). No wiki page is dedicated to the personal policy shift action.

The policy system tracks where characters and the game world stand on policy issues across two dimensions: **economic** (fiscal/regulatory spectrum) and **social** (cultural/rights spectrum). These positions are stored at two levels:

1. **Character policy positions** - each player character's personal stance on the economic and social axes (-5 to +5)
2. **State/national policy records** - the current legislative status quo per legislation type, stored in the `statePolicies` collection (-3 to +3 per axis)

The two levels are related but distinct. A character's personal positions affect how demographic groups vote in elections and how visible policy alignment is to voters. The `statePolicies` records reflect what the government has actually enacted through legislation and drive ongoing metric effects each turn.

Scope note: the legacy metric loop in `processStatePolicyEffects` skips countries that run the political metrics board (US, UK, RU, DD and the non-playable boards, see [Edge cases and limits](#edge-cases-and-limits)). The demographic effects engine runs for every country.

## Rules

### Player policy positions

#### Scale

Each character has a `policies` object with two numeric fields:

```ts
interface PolicyPositions {
  economic: number; // -5 to +5
  social: number; // -5 to +5
}
```

- **Negative** values are left/progressive; **positive** values are right/conservative.
- Set at character creation; changed only through the explicit policy shift action or by voting on bills.
- NPPs also carry `PolicyPositions` and use the same fields in election calculations.
- The shift action moves a whole step (1). Bill votes move fractions (0.25) on a 0.05 grid.

#### Changing positions: policy shift action

Players shift their policy position one step at a time via `POST /api/settings/policy` (`src/app/api/settings/policy/route.ts`).

| Parameter | Values |
| --- | --- |
| `axis` | `"economic"` or `"social"` |
| `direction` | `1` or `-1` |
| `useVoucher` | optional boolean, default false |

**Cost per shift:**

| Resource | Cost |
| --- | --- |
| Actions | 15 (`POLICY_SHIFT_ACTION_COST`) |
| Political Influence | -5% (floor 0; `floor(current x 0.95)`) |
| National Influence | -5% (same formula) |
| Infamy | +5 (`POLICY_SHIFT_INFAMY_COST`), clamped to 0 to 100 |

The new value is the old one plus or minus 1; a request that would pass -5 or +5 is rejected with a 400 error and the character is not charged (the bound is part of the atomic update filter).

The 15, 5 and 0.95 values are `POLICY_SHIFT_ACTION_COST`, `POLICY_SHIFT_INFAMY_COST` and `POLICY_SHIFT_INFLUENCE_MULTIPLIER` in `src/lib/positionUpdateVouchers/rules.ts`. A shift can instead be paid with one position update voucher (`useVoucher: true`), which costs 0 actions, 0 infamy and no influence loss (multiplier 1) and takes one from `positionUpdateVouchers`. Vouchers are granted one at a time (`POSITION_UPDATE_VOUCHER_GRANT_AMOUNT = 1`). A `policy_shift` achievement is awarded on the first successful shift.

#### Changing positions: bill votes

Voting on a bill shifts the voter's own policy positions (`src/lib/policyShift.ts`). The bill's position on each axis is the average of its provisions that take a stance there (omitted and 0 values are ignored). An aye vote moves the voter toward the bill by `VOTE_SHIFT_STEP` = 0.25 per axis, never past the bill's position; a nay vote moves them away by 0.25; an abstention, an axis with no stance, or a voter already on the bill's position does not move. Results are clamped to -5..+5 and snapped to the 0.05 grid.

A per-bill ledger (`policyShiftLedger.<characterId>` on the `bills` or `stateBills` document) stores the voter's `baseline` before this bill first moved them and what was `applied`. Every later change of vote is computed from the baseline and only the difference is added, so the net effect of one bill never exceeds one step, an abstention after an aye or nay reverts what that vote applied, and shifts from other bills in between are kept. A vote cast through a party whip never moved the voter's positions and does not count as a prior vote (`personalPreviousVote`). A vote recorded before the ledger existed is left alone when changed (`shouldApplyVoteShift`).

### State and national policy tracking

#### Collection: `statePolicies`

Each record in `statePolicies` represents the current legislative standing for one legislation type, either at the national level or for a specific state or region.

**Fields the policy API reads (`StatePolicyRecord`, `src/lib/db/types/legislation.ts`):**

| Field | Type | Description |
| --- | --- | --- |
| `scope` | `"national"` \| `"state"` | Whether this record is a country-level position or a state-level position |
| `stateId` | `string` (optional) | Present when `scope = "state"` (e.g. `"CA"`, `"TX"`) |
| `legislationTypeId` | `string` | References a `LegislationType._id` |
| `economic` | `number` (-3 to +3) | Economic axis position; 0 = center |
| `social` | `number` (-3 to +3) | Social axis position; 0 = center |
| `updatedAt` | `Date` | Last modification timestamp |

The turn engine reads the richer enacted-bill record (`StatePolicy`, `src/lib/db/types/statePolicy.ts`), which also stores `policyOptionId`, `policyOptionIndex`, `enactedTurn`, `effectDirection` (-1, 0, +1), `countryId` and `enactedBy` (`kind`: `bill`, `order` or `expiry`). Country-level rows use pseudo state ids: `federal` (US), `uk_national`, `jp_national`, `de_national`.

Legislation types marked `nationalOnly: true` only have national-scope records. Types with `allowedScope: "both"` or `"state"` have per-state records.

#### Seeding

Base policy records come from `src/lib/seeds/reference/basePolicies.ts` (re-exported by `scripts/seeds/basePolicies.ts`) and are written by `scripts/seed/seed-policies.ts`:

- **National defaults**: per-country, per-type baseline values (e.g. tax policy +1, healthcare -1) in `COUNTRY_POLICY_CONFIGS`; the US and UK sets are exported as `NATIONAL_DEFAULTS` and `UK_NATIONAL_DEFAULTS`.
- **State defaults**: derived from each state's `politicalLean`: score = `clampScore(politicalLean x 0.6)`, rounded and clamped to -3..+3, so bluer states get more negative values, redder states more positive. Law-enforcement, reproductive-rights and gun-control types use the social axis only; school-standards and housing types use both axes; everything else uses the economic axis.
- The seeder upserts by default; a reset option clears `statePolicies` first. It is preset-aware (`getBasePolicies(preset)`).

#### Position matching

The `statePolicies` position (economic, social) is an integer pair, not a named label. The API matches this pair against the legislation type's `policyOptions` array to return a human-readable `policyOptionName` (`findMatchedOption`, `src/lib/policy/nationalPolicyRecords.ts`):

- **Exact match**: finds the option where `o.economic === economic && o.social === social`.
- **Nearest neighbor**: if no exact match, selects the option with the minimum Manhattan distance (`|econDiff| + |socialDiff|`).
- Tax slider types show the live rate label instead, including a "phasing in" note when a target rate is pending.

### Policy to demographics (elections)

Character policy positions are compared to the leans of each demographic group when calculating vote appeal. The live appeal curve uses exponent 1.5 (`APPEAL_POSITION_EXPONENT`, `src/lib/utils/demographicAppeal.ts`), not the retired squared/gamma=2 curve. For the exact formula and pipeline, see [elections.md](./elections.md) - specifically the **Appeal** step in the Total Appeal System.

Candidates closer to a demographic group's lean on the economic and social axes receive higher appeal scores with that group, which translates to a larger share of that group's votes per turn during general elections.

### Policy to legislation (bills and archetype approval)

When a bill is enacted, each provision's legislation type carries `economic` and `social` scores that define the ideological direction of that policy shift. This information is used in two ways:

1. **State metrics**: `applyLegislationEffect()` applies the provision's delta to the relevant state or national metrics via `effectTarget`.
2. **Archetype approval**: Legislators who voted FOR the enacted bill receive approval changes from their demographic archetypes. The impact is calculated from the difference between the old and new policy index for that legislation type, multiplied by each archetype's domain affinity. For the full formula, see [bills-legislation.md](./bills-legislation.md) - the **Archetype Approval Impacts** section.

Active `statePolicies` records also drive **per-turn metric effects** through `policyOptions[].metricEffects`. Each turn a policy is in effect, the matched option's `metricEffects` array applies direct additive changes to specific state or national metrics (e.g. -0.04%/turn to uninsured rate while a given healthcare option is active).

### Metric effects engine

**Entry point:** `src/lib/policyEffects.ts` -> `processStatePolicyEffects()`

#### Processing order (per turn, per state)

1. **Exponential decay toward target.** Each metric moves a fixed fraction of the way to its policy-driven target. With no active policy on a metric, the target is the metric's baseline, so the same step pulls it back to baseline.
2. **Direct tick rates.** `metricEffects` add a flat change on top of the decayed value.
3. **Clamp** to the metric's range, and write only if the change is above 0.001.

There is no separate "natural decay" step for metrics. `processMetricDecay` (`src/lib/turn/metricDecay.ts`) is an explicit no-op kept for compatibility, and its `DECAY_RATE` of 0.0025 is not used by the metric engine. The 0.25% per turn rate applies only to demographic lean and turnout (below).

#### Exponential decay formula

```typescript
// shared/constants/formulas.ts
export const POLICY_TAU = 139; // turns

export function applyPolicyDecay(current: number, target: number, tau = POLICY_TAU): number {
  const decayFactor = 1 - Math.exp(-1 / tau); // about 0.7168% of the remaining gap per turn
  return current + (target - current) * decayFactor;
}
```

Metrics approach their target asymptotically; the half-life of the gap is `139 x ln 2`, about 96 turns (2 game years).

#### Target calculation

`calculateMetricTarget` (`src/lib/policyEffects.ts`) sums, for every active policy and every matching `effectTargetsWeighted` entry:

```
intensity   = optionIntensity(options, optionIndex)      // -1..+1, signed distance from the ladder centre
strength    = effectiveIntensity(intensity) * 3          // sign * |intensity|^0.8, then x3
contribution = (strength / 3) * weight * MAX_EFFECT_PER_LAW * decayScope * sign * rangeScale
             * adaptation * deliveryMultiplier
target      = clamp(baseline + sum(contribution), metric min, metric max)
```

- `optionIntensity` (`src/lib/legislature/optionIntensity.ts`): `sign(effectDirection) x |index - centre| / maxDistance`. The centre option gives exactly 0, so a neutral law is a no-op. If the option cannot be found the sign of `effectDirection` is used.
- `effectiveIntensity` raises the magnitude to `POLICY_INTENSITY_GAMMA = 0.8`, so extreme options read distinctly stronger than moderate ones.
- `sign` is +1 when higher is better for the metric, -1 otherwise.
- `rangeScale` (`metricRangeScale`): 1 for metrics whose range is 100 or less; for larger ranges it is `|baseline| / 100`, using the current value as the baseline.
- `adaptation` is the half-life factor below, `deliveryMultiplier` is the delivered share (1 unless department or regional finance flags are on).
- A legacy single `effectTarget` is used (weight 1.0) when no weighted targets exist.
- Baseline: the metric's entry in `stateBaselines` (default 50 if missing). Large-range metrics (maximum above 100) use the current value instead. In worlds with the era system on, a windowed metric whose seed is on the wrong side of its era band's worst bound rests at the band's `best` value instead.

#### Federal multiplier (country-aware)

National laws apply at reduced strength per state or region:

```typescript
// shared/constants/formulas.ts
export function getFederalMultiplier(countryId: string): number {
  // UK 1/12 (regions), JP 1/8 (regions), DE 1/16 (Lander)
  return FEDERAL_MULTIPLIER_BY_COUNTRY[countryId] ?? 1 / 50; // default 1/50 (US states)
}
```

**Source:** `FEDERAL_MULTIPLIER`, `UK_FEDERAL_MULTIPLIER`, `JP_FEDERAL_MULTIPLIER`, `DE_FEDERAL_MULTIPLIER` in `shared/constants/formulas.ts`. This multiplier governs the per-turn tick path (`metricEffects`). The exponential-decay path is normalized separately: any national law (scope below 1) uses `NATIONAL_LAW_DECAY_MULTIPLIER = 0.21` per region (`nationalDecayScope`), so a strong national law moves its main metric about the same amount whether the country has 12 or 50 regions. State and regional laws (scope 1) keep full strength. `MAX_EFFECT_PER_LAW = 12` caps the decay-path points one law can move a metric before the scope multiplier. Metrics with a range above 100 are scaled by their reference value divided by 100 (`metricRangeScale`).

**Rationale:** the sum of per-region effects equals the intended national total, which prevents a single federal bill from dominating state metrics.

#### Time-based effect decay (adaptation)

Some effect targets have `adjustmentHalfLife`, which models economic adaptation:

```typescript
// Example: defense cuts hurt GDP initially, but the economy adapts
const decayFactor = applyHalfLifeDecay(1, turnsElapsed, adjustmentHalfLife);
// After N half-lives: effect = initial x (0.5)^N; turnsElapsed = currentTurn - policy.enactedTurn
```

| Half-life (turns) | Effect after 48 turns (1 game year) |
| --- | --- |
| 24 | 25% of original |
| 48 | 50% of original |
| 96 | 71% of original |

#### Direct tick rates

Policy options apply additive per-turn changes (`computeTickRates`):

```
rate(metric) = sum over active policies of  ratePerTurn x scopeMultiplier x deliveryMultiplier
newValue     = clamp(decayedValue + rate)
```

Metrics owned by the budget mirror (`MIRROR_CONTROLLED_METRIC_IDS`) and by dedicated drift engines (`DRIFT_OWNED_METRICS`) are never written here, and with the era system on a law cannot tick a metric that does not exist yet in that era (`isMetricActive`).

**Effect scale:** extreme policies are about +-0.06 per turn, center = 0. Designed for about a 10-year full reversal.

### Demographic effects engine

**Entry point:** `src/lib/demographicEffects.ts` -> `processAllStateDemographics()`

Policies shift demographic groups through up to four channels, each with its own maximum rate at full policy strength:

| Channel | Constant | Value | Unit | Notes |
| --- | --- | --- | --- | --- |
| Population | `SHIFT_RATE_PER_TURN` | 0.1 | percent of group per turn | Always on |
| Economic lean, social lean | `LEAN_SHIFT_RATE_PER_TURN` | 0.035 | lean points per turn | Needs the v2 flag; capped by `LEAN_MAX_DEVIATION_FROM_BASELINE` = 1.5 |
| Turnout | `TURNOUT_SHIFT_RATE_PER_TURN` | 0.25 | percentage points per turn | Needs the v2 flag; capped by `TURNOUT_MAX_DEVIATION_FROM_BASELINE` = 10 |
| Decay back to seeded baseline | `LEAN_TURNOUT_DECAY_RATE_PER_TURN` | 0.0025 | share of the gap per turn | Lean and turnout with no active shift |

Per effect: `shift = direction x (policy.economic / 3) x scopeMultiplier x rate x magnitude`, where `direction` is -1 to +1 from the legislation type's `demographicEffects`, and `magnitude` is clamped to 0.25 to 3 (`DEMOGRAPHIC_EFFECT_MAGNITUDE_MIN`, `DEMOGRAPHIC_EFFECT_MAGNITUDE_MAX`, default 1, ignored for population).

| Policy strength | Normalized | Max population shift per turn |
| --- | --- | --- |
| +3 (extreme right) | +1.0 | +0.1% |
| +1 (moderate) | +0.33 | +0.033% |
| 0 (center) | 0 | 0 |
| -1 (moderate left) | -0.33 | -0.033% |
| -3 (extreme left) | -1.0 | -0.1% |

Effects marked `permanent` on lean or turnout relocate the group's base value through the durable realignment overlay (`src/lib/demographics/durableRealignment.ts`) instead of the capped, decaying channel. When `mediaEditorialEnabled` is on, a newsroom slant pull is added on top.

#### Federal division

Federal demographic effects use the same country-aware multiplier: US 1/50 per state, UK 1/12, JP 1/8, DE 1/16; any other country falls back to the US set (`federalPolicies`).

#### Bulk processing

Both engines bulk-fetch all states, policies, legislation types and metrics in parallel and write with one `bulkWrite` (`macroMetrics` for policy effects, `stateDemographics` for demographics).

### API

#### `GET /api/country/[code]/policy`

Returns current policy records joined with legislation type metadata. No authentication required. The route is per country (`code` in the path), replacing the older global route.

**Query parameters:**

| Parameter | Required | Description |
| --- | --- | --- |
| `scope` | Yes | `"national"` or `"state"` |
| `stateId` | When state | State abbreviation (e.g. `"CA"`) |

**Response**: array of `PolicyRecordResponse` objects (`src/lib/policy/types.ts`), plus tariff and subsidy rows:

| Field | Type | Description |
| --- | --- | --- |
| `legislationTypeId` | `string` | Legislation type identifier |
| `name` | `string` | Human-readable legislation type name |
| `policyDomain` | `string` | Domain (e.g. `"healthcare"`, `"economy"`) |
| `economic` | `number` | Current economic axis position (-3 to +3) |
| `social` | `number` | Current social axis position (-3 to +3) |
| `nationalOnly` | `boolean` | Whether this type is federal-only |
| `policyOptionName` | `string` \| `null` | Name of the matched policy option (exact or nearest) |
| `hasEconomic` | `boolean` | True if this type has any option with a non-zero economic score |
| `hasSocial` | `boolean` | True if this type has any option with a non-zero social score |
| `metricEffects` | array | Per-turn metric effects from the matched option (`category`, `metricId`, `ratePerTurn`) |
| `weightedEffects` | array (optional) | Secondary targets from `effectTargetsWeighted` |
| `enactedByKind`, `activeOrder` | optional | Whether the record came from a bill, an executive order or an expiry |

Cache-Control is `no-store` on all responses. **Error**: `400` for an invalid country code, or a missing or invalid `scope`, or `scope=state` without `stateId`.

#### `POST /api/settings/policy`

Shifts the authenticated character's policy position. See [Changing positions: policy shift action](#changing-positions-policy-shift-action) above. Rate limited to 30 requests per 60 seconds per user.

### Display

- **National Policy page** (`/policy`): lists all national policies grouped by domain. Shows current policy option name and economic/social positions per type.
- **State page - State Laws & Policy tab**: state-level policy records for the selected state. Empty if the legislation and policy seeds have not been run.
- **Character profile**: shows the character's personal economic and social positions on the -5 to +5 scale.

## Data

| Collection | Fields | Read or written | Player-visible |
| --- | --- | --- | --- |
| `characters` | `policies.economic`, `policies.social`, `actions`, `infamy`, `politicalInfluence`, `nationalInfluence`, `positionUpdateVouchers` | read, written by the shift action and bill votes | yes (profile) |
| `bills`, `stateBills` | `policyShiftLedger.<characterId>` (`baseline`, `applied`) | read, written by votes | no |
| `statePolicies` | `scope`, `stateId`, `legislationTypeId`, `policyOptionId`, `policyOptionIndex`, `enactedTurn`, `economic`, `social`, `effectDirection`, `enactedBy` | read by the engines and API; written by enactment and seeding | yes (policy pages) |
| `legislationTypes` | `policyOptions`, `effectTargetsWeighted`, `effectTarget`, `demographicEffects`, `policyDomain`, `nationalOnly` | read | partly (names, domains) |
| `stateBaselines` | `baselines.<category>.<metric>` | read | no |
| `macroMetrics` (via merged region view) | economic and population metric values | read, written by policy effects | yes (metrics pages) |
| `stateDemographics` | `groups.<id>.population`, `economicLean`, `socialLean`, `turnout`, cached state lean, `mediaOpinionPull` | read, written by demographics | yes (demographics pages) |
| `demographicDefaults` | seeded per-group baselines | read (v2 only) | no |
| `states` | ids and `countryId` | read | yes |
| `gameState` | `currentTurn`, `eraSystemEnabled`, `legislationDemographicEffectsV2Enabled`, `departmentFinanceEnabled`, `regionalLegislationFinanceEnabled` | read | no |
| `gameConfig` | `mediaEditorialEnabled` | read | no |

Key type files:

- `src/lib/db/types/legislation.ts`: `LegislationType`, `LegislationPolicyOption`, `StatePolicyRecord`, `PolicyOptionMetricEffect`
- `src/lib/db/types/statePolicy.ts`: `StatePolicy` (the enacted-bill record), `StateMetricBaseline`, `VoteImpact`
- `src/lib/db/types/character.ts`: `PolicyPositions`

`StatePolicyRecord` (in `legislation.ts`) and `StatePolicy` (in `statePolicy.ts`) are different interfaces. `StatePolicyRecord` is what the policy API reads: the current axis positions per type. `StatePolicy` is the richer enacted-bill record the engines read.

Indexes used: `{ scope, stateId }` for state queries; `{ scope: "national" }` for national queries.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `legislationDemographicEffectsV2Enabled` | on in fresh worlds; absent (off) in older worlds | `gameState`; default in `src/lib/seeds/reference/featureFlagDefaults.ts` |
| `eraSystemEnabled` | on in fresh worlds | `gameState`; same defaults file. Turns on era baselines and the metric era gate |
| `departmentFinanceEnabled` | on in fresh worlds | `gameState`; scales national policy effects by delivered share |
| `regionalLegislationFinanceEnabled` | on in fresh worlds | `gameState`; scales state and regional policy effects by delivered share |
| `mediaEditorialEnabled` | on in fresh worlds | `gameConfig`; default in `FRESH_WORLD_GAME_CONFIG_FLAGS`, `src/lib/seeds/reference/featureFlagDefaults.ts` |
| Policy constants | see Constants table | `shared/constants/formulas.ts`, `src/lib/demographicEffects.ts`, `src/lib/positionUpdateVouchers/rules.ts`, `src/lib/policyShift.ts` |
| Base policy defaults per country | per `COUNTRY_POLICY_CONFIGS` entry | `src/lib/seeds/reference/basePolicies.ts` |
| World preset | per world | `gameState.preset`; selects the base policy set |
| Country scope ids and multipliers | US `federal` 1/50, UK `uk_national` 1/12, JP `jp_national` 1/8, DE `de_national` 1/16 | `src/lib/constants/nationalScope.ts`, `shared/constants/formulas.ts` |

There are no `gameConfig` fields for the shift costs; they are code constants.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| Character position range | -5 to +5 | `src/lib/db/types/character.ts` |
| `statePolicies` range | -3 to +3 | `src/lib/db/types/legislation.ts` |
| `POLICY_SHIFT_ACTION_COST` | 15 | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFAMY_COST` | 5 | `src/lib/positionUpdateVouchers/rules.ts` |
| `POLICY_SHIFT_INFLUENCE_MULTIPLIER` | 0.95 | `src/lib/positionUpdateVouchers/rules.ts` |
| `POSITION_UPDATE_VOUCHER_GRANT_AMOUNT` | 1 | `src/lib/positionUpdateVouchers/rules.ts` |
| `VOTE_SHIFT_STEP` | 0.25 | `src/lib/policyShift.ts` |
| `POLICY_TAU` | 139 turns | `shared/constants/formulas.ts` |
| `POLICY_INTENSITY_GAMMA` | 0.8 | `shared/constants/formulas.ts` |
| `MAX_EFFECT_PER_LAW` | 12 | `shared/constants/formulas.ts` |
| `NATIONAL_LAW_DECAY_MULTIPLIER` | 0.21 | `shared/constants/formulas.ts` |
| Federal multipliers | US 1/50, UK 1/12, JP 1/8, DE 1/16 | `shared/constants/formulas.ts` |
| `SHIFT_RATE_PER_TURN` | 0.1 (percent) | `src/lib/demographicEffects.ts` |
| `LEAN_SHIFT_RATE_PER_TURN`, `LEAN_MAX_DEVIATION_FROM_BASELINE` | 0.035, 1.5 | `src/lib/demographicEffects.ts` |
| `TURNOUT_SHIFT_RATE_PER_TURN`, `TURNOUT_MAX_DEVIATION_FROM_BASELINE` | 0.25, 10 | `src/lib/demographicEffects.ts` |
| `LEAN_TURNOUT_DECAY_RATE_PER_TURN` | 0.0025 | `src/lib/demographicEffects.ts` |
| Minimum write threshold (metrics, demographics) | 0.001, 0.0001 | `src/lib/policyEffects.ts`, `src/lib/demographicEffects.ts` |
| `APPEAL_POSITION_EXPONENT` | 1.5 | `src/lib/utils/demographicAppeal.ts` |

## Timing

```
stateEffectsPhase (hourly turn)
  crisisTurn -> ministerialOrders            (serialized writers of the same metric paths)
  UK and JP regional budgets settle
        -> policyEffects (processStatePolicyEffects)      }  run together in one
  demographicEffects (processAllStateDemographics)        }  parallel group
        -> era checkpoints (after demographics)           }
  ...
  metricEngine -> demographicFlows -> statehood -> census
```

Both engines run inside the hourly turn, in the state effects phase (`src/simulation/phases/stateEffectsPhase.ts`). `policyEffects` waits for the crisis and ministerial-order writers (which also write metric paths) and for the regional budget processors that supply delivery multipliers, then runs. `processAllStateDemographics` is started in the same parallel group, so the two run concurrently; demographics read `statePolicies` themselves, and era checkpoints run strictly after demographics. Within `processStatePolicyEffects` the order is: exponential decay toward target, then direct tick rates. Enactment itself happens when a bill resolves, outside this pass; a new `statePolicies` record takes effect from the next turn. See [Turn Processing](./turn-processing.md).

## Worked trace

**A. Policy shift.** A character has 40 Political Influence, 12 National Influence, 3 infamy, 30 actions, economic 2. They shift economic by +1 without a voucher.

1. Cost: actions 30 - 15 = 15. Infamy 3 + 5 = 8 (within 0 to 100).
2. Political Influence `floor(40 x 0.95) = floor(38) = 38`. National Influence `floor(12 x 0.95) = floor(11.4) = 11`.
3. Economic 2 + 1 = 3 (bound filter passed, 3 < 5).
4. Result stored on the character; `policy_shift` achievement awarded if first.

**B. Metric decay path.** A Japan national law (scope 1/8 on the tick path, 0.21 on the decay path), a metric that is higher-is-better with baseline and current value 50, a weighted target of weight 0.5, and the ladder's second-strongest option on a 7-option ladder (centre index 3, option index 5).

1. Intensity: `|5 - 3| / 3 = 0.6667`.
2. Effective intensity: `0.6667^0.8 = 0.7230`. Strength `0.7230 x 3 = 2.169`.
3. Contribution: `(2.169 / 3) x 0.5 x 12 x 0.21 = 0.9110`.
4. Target: 50 + 0.9110 = 50.9110.
5. Decay factor: `1 - exp(-1/139) = 0.007168`. New value `50 + 0.9110 x 0.007168 = 50.00653`.
6. Tick: suppose the matched option has `ratePerTurn = 0.03`. Scaled by 1/8 it is 0.00375. Value `50.00653 + 0.00375 = 50.01028`.
7. Both are clamped to the metric range and written to `macroMetrics` because the change exceeds 0.001.

After 96 turns of the same target the gap is about 50% closed (0.5 of 0.911 is 0.455).

**C. Demographic population channel.** A US federal law with `policy.economic = +2` and a demographic effect with `direction = +1` on group G.

1. Strength: `2 / 3 = 0.6667`. Scope 1/50 = 0.02.
2. Population shift: `1 x 0.6667 x 0.02 x 0.1 = 0.001333` percent per turn.
3. With the v2 flag on and `magnitude = 1`, the lean shift is `1 x 0.6667 x 0.02 x 0.035 = 0.000467` lean points per turn, and cannot take the group more than 1.5 from its seeded baseline.

## Edge cases and limits

- **Bounds.** A shift past -5 or +5 is rejected with 400; the filter is atomic, so the character is not charged.
- **Floors.** Political and National Influence use `floor(current x 0.95)`, so 0 stays 0 and the cost is zero on an empty balance. Infamy is clamped to 0 to 100.
- **Rate limit.** The shift endpoint allows 30 requests per 60 seconds per user.
- **Votes.** A vote never moves a voter past the bill's own position, and a bill with no stance on an axis (or a stance of 0) leaves that axis alone.
- **No policy active.** The metric target is its baseline, so the same decay pulls it back at about 0.72% of the gap per turn. A repealed or expired law does not leave a permanent mark.
- **Adaptation.** `adjustmentHalfLife` shrinks a policy's contribution over time since enactment, so one-off shocks fade.
- **Unmatched option.** The API reports the nearest option by Manhattan distance when no option matches the pair exactly.
- **Missing seeds.** A state with no `statePolicies` records shows an empty laws tab.
- **Board countries skip the metric loop.** `processStatePolicyEffects` skips every state whose country is a political-board country (`isPoliticalApprovalCountry`): US, UK, RU, DD and the non-playable boards. Their political metrics are animated by the political metrics dynamics phase and the metric engine, which read enacted levels, so running this loop would fight them. Countries without a board (for example JP, DE, SCO, WAL) still run it. Demographic effects run for every country.
- **Skipped metrics.** Budget-mirror metrics, drift-owned metrics, and `unemploymentRate` when the labour-employment block exists are never written by the policy loop.
- **Large-range metrics.** Metrics with a maximum above 100 use the current value as baseline and scale by value / 100 (a maximum law moves them by about 1% of their value times the weight and scope).
- **Lean and turnout bands.** Legislation cannot push a group further than the band from baseline, but a value already outside the band is not snapped back in.
- **Why the scope split.** Without the federal multiplier one federal bill would move every state by its full amount, and without the normalized decay scope a federal law would be weak in countries with many regions.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Personal positions stay within -5 to +5 | Atomic bound filter in the shift route; clamp in `computeVoteShift`; `policyShift.test.ts`, `route.test.ts` |
| One bill moves a voter by at most one step net | Ledger baseline in `applyBillVotePolicyShift`; `policyShift.test.ts` |
| A shift is never charged when rejected | Single `findOneAndUpdate` with payment and bound filters; `src/app/api/settings/policy/route.test.ts` |
| Metric values stay in their range | Clamp in the engine; `policyEffects.bounds.test.ts` |
| Center option and neutral laws change nothing | `optionIntensity` returns 0; `policyEffects.intensity.test.ts` |
| Policy never writes budget-mirror or drift-owned metrics | Skip sets in the engine; `policyEffects.budgetSync.test.ts`, `policyEffects.driftOwned.test.ts` |
| A law cannot tick a metric that does not exist in the era | `isMetricActive` gate; `policyEffects.eraGate.test.ts` |
| Lean and turnout stay within the deviation band | `applyBandedShift`; `demographicEffects.v2.test.ts` |
| Sum of per-region national effect is region-count independent | By construction (`NATIONAL_LAW_DECAY_MULTIPLIER`); not directly asserted by a test |

## Failure and recovery

- **Empty laws tab or missing policy rows.** Seeds were not run for a world or a country, or a reseed cleared `statePolicies`. Reseeding base policies (upsert) restores them; enacted-law rows come back only through new enactments or a data repair.
- **Metric not moving.** Usual causes: the country is a board country (this loop does not run), the legislation type has no weight on the metric, the metric is budget-owned or drift-owned, or the metric does not exist in the era. These are by design, not faults.
- **Wrong matched option name.** An off-ladder `economic`/`social` pair shows the nearest option. Repair is to correct the `statePolicies` record.
- **Turn failure in the phase.** The phase writes with bulk operations and tolerates a missing metrics document by skipping that state. A failed turn phase is reported in the turn diagnostics and the next turn recomputes from current values, so the system is self-correcting; a stuck value is repaired by correcting the metric or baseline document.
- **Lost-update races.** Crisis and ministerial-order writers share metric paths with the policy loop, which is why they run first and policy last; if that order were broken, increments could be overwritten.
- **Demographic drift gone wrong.** Lean and turnout are bounded by baselines in `demographicDefaults`; an admin edit outside the band is left alone and decays back only by the 0.25% rule or a repair.
- **Voucher or action shortfall.** The route returns a 400 with the reason and changes nothing.

## Connections

**Driven by**
- [Bills & Legislation](./bills-legislation.md): enacted bills write `statePolicies` records and bill votes shift personal positions (`src/lib/policyShift.ts`).
- [Player Progression](./player-progression.md): the shift action spends actions and influence.
- [Stats & Actions](./stats-actions.md): action and infamy costs.

**Affects**
- [National Metrics](./national-metrics.md): per-turn policy effects write metric values for non-board countries (`src/lib/policyEffects.ts`).
- [Election Mechanics](./elections.md): personal positions set demographic appeal (`src/lib/utils/demographicAppeal.ts`).
- [Demographics](./demographics.md): enacted policy shifts group populations, leans and turnout (`src/lib/demographicEffects.ts`).
- [Player Policies](./player-policies.md): the player-facing view of personal positions.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/policyShift.test.ts` | Bill position targets, vote shift, preview, ledger rules |
| `src/app/api/settings/policy/route.test.ts` | Shift route: costs, bounds, vouchers |
| `src/lib/positionUpdateVouchers/rules.test.ts` | Payment resolution |
| `src/lib/policyEffects.bounds.test.ts` | Range handling for large metrics |
| `src/lib/policyEffects.intensity.test.ts` | Graded option intensity |
| `src/lib/policyEffects.eraBaseline.test.ts`, `policyEffects.eraGate.test.ts` | Era-aware baseline and gate |
| `src/lib/policyEffects.delivery.test.ts` | Delivered-share scaling |
| `src/lib/policyEffects.budgetSync.test.ts`, `policyEffects.driftOwned.test.ts` | Ownership chokepoints |
| `src/lib/demographicEffects.test.ts`, `demographicEffects.v2.test.ts`, `demographicEffects.buckets.test.ts` | Population, lean, turnout and bucket channels |
| `shared/constants/formulas.test.ts`, `shared/constants/formulas.intensity.test.ts` | Federal multiplier constants, decay helpers, intensity curve |
| `src/lib/policy/nationalPolicyRecords.test.ts` | Option matching and policy API payload |

Gaps: no end-to-end test pins the 0.21 national multiplier through a full turn, no test covers the board-country skip, and the stats-phase ordering of policy and demographics is not asserted.

## Known issues and history

- The player guide (Policy Effects) says a metric with no policy drifts back to baseline at 0.25% per turn. The code has no such separate step for metrics: `processMetricDecay` is a no-op and the pull to baseline is the same exponential decay at about 0.72% per turn. The 0.25% rate is real only for demographic lean and turnout. Fix the player guide or the code.
- The same guide says the system is "live in every world" for the US, UK, Japan and Germany, but the metric loop skips US and UK (board countries).
- The `policyEffects` phase result reports `statesProcessed`, but `processStatePolicyEffects` returns nothing, so the count is always 0.
- `src/lib/policyEffects.ts` still carries a header comment that describes a 0.25% natural decay; the implementation does not.
- `processStateMetrics` is still exported from `src/lib/policyEffects.ts` but nothing in the turn calls it; the turn uses `processStatePolicyEffects`.
- Country-level policy sets are only mapped for the US (`federal`), UK, JP and DE. For any other non-board country the engines fall back to the US `federal` set (`nationalPoliciesByScope[...] ?? federalPolicies`), so those countries' own `*_national` records are not read by the metric or demographic loops. This looks unintended; verify before relying on national laws outside the four mapped countries.
- Dated change recorded in code: the appeal curve exponent was recalibrated to 1.5 on 2026-07-09 (`src/lib/utils/demographicAppeal.ts`); the national decay normalization and option intensity gamma come from the #0962 balance pass.

Last checked: 2026-10-29, version 1.18.0
