# Crisis System

Crises are dynamic events that modify state metrics, government approval, and corporate profit margins across affected regions. They can be one-time shocks (flat effects) or ongoing situations (tick effects).

Player guides: [Crisis Interaction](https://www.ahousedividedgame.com/wiki/crisis-interaction) (templates, decision trees, collective contributions, auto-spawning) and [Global Response Crises](https://www.ahousedividedgame.com/wiki/global-response-crises) (chained multi-country crises). The bloc-alignment flashpoints in the second half of this page are described for players in [Bloc Spheres](https://www.ahousedividedgame.com/wiki/bloc-spheres). For the multi-country campaign engine see [global-response-crises-as-shipped.md](./global-response-crises-as-shipped.md).

## Overview

- **Purpose**: Create dynamic economic/political events that challenge players and alter the game world
- **Scope**: Global, country-wide, or region-specific
- **Duration**: Fixed (N turns) or indefinite (manual resolution)
- **Effects**: State metrics, government approval, corporate profit margins
- **Turn Processing**: Runs inside the `stateEffectsAndNationalAggregation` adapter (`src/simulation/phases/stateEffectsPhase.ts`), via `runtime.runPhase("crisisTurn", ...)`

## Rules

Every constant this page relies on, with its source.

| Constant | Value | Source |
| --- | --- | --- |
| Tick decay | `1 - elapsed / duration`, clamped to 0..1; indefinite crises stay at 1 | `tickDecayFactor` in `src/lib/turn/crisisTurn.ts` |
| Flat effect timing | Only when `turn === crisis.startTurn` | `src/lib/turn/crisisTurn.ts` |
| `gdpLoss` fraction clamp | 0 to 0.95 per effect; several losses multiply | `applyGdpLossEffects` in `src/lib/turn/crisisTurn.ts` |
| Profit margin clamp | 0 to 100 | `applyProfitMarginEffects` in `src/lib/turn/crisisTurn.ts` |
| Character stat clamp | 1 to 10 | `applyStatEffects` in `src/lib/turn/crisisTurn.ts` |
| Collective contribution shortening | `floor(duration x min(1, current / target) x 0.5)` turns | `calculateCollectiveReduction` in `src/lib/crises/interactionEngine.ts` |
| Minimum effective duration | 1 turn | `src/lib/turn/crisisTurn.ts` |
| `MAX_AUTO_CRISES_PER_TURN` | 1 | `src/lib/crises/autoCrisisConstants.ts` |
| `DEFAULT_DISASTER_COOLDOWN_TURNS` | 144 | `src/lib/crises/autoCrisisConstants.ts` |
| `MAX_OPEN_CRISES` (alignment) | 3 | `src/lib/alignment/crisisTurn.ts` |
| `CRISIS_WINDOW_TURNS` (alignment) | 12 | `src/lib/alignment/crisis.ts` |
| `DEFECTION_CRISIS_AT` | `SUSTAIN_TURNS / 2` = 12 turns (`SUSTAIN_TURNS` = 24) | `src/lib/alignment/crisisTurn.ts`, `src/lib/alignment/membershipEligibility.ts` |
| `PER_NATION_TURN_CAP` / `CRISIS_TURN_CAP` | 5 / 7.5 alignment points per nation per turn | `src/lib/constants/alignmentEras.ts` |

## Crisis Structure

### Core Fields (`crises` collection)

| Field                | Type                                    | Description                                                   |
| -------------------- | --------------------------------------- | ------------------------------------------------------------- |
| `name`               | string                                  | Display name (e.g., "Northeast Blackout", "Financial Crisis") |
| `description`        | string                                  | Full description of the crisis                                |
| `scope`              | `"global"` \| `"country"` \| `"region"` | Geographic scope                                              |
| `countryIds`         | CountryId[]                             | Affected countries (when scope = "country" or "region")       |
| `regionIds`          | string[]                                | Affected states/regions (when scope = "region")               |
| `status`             | `"active"` \| `"resolved"`              | Current status                                                |
| `startTurn`          | number                                  | Game turn when crisis activated                               |
| `endTurn`            | number \| null                          | Game turn when resolved (null while active)                   |
| `durationTurns`      | number \| null                          | Duration in turns; null = indefinite                          |
| `effects`            | CrisisEffect[]                          | Array of effect definitions                                   |
| `wireMessageOnStart` | string                                  | Wire event message when crisis starts                         |
| `wireMessageOnEnd`   | string \| null                          | Wire event message when crisis ends                           |

### Crisis Effect Structure

Each effect defines what changes and how often it applies:

| Field            | Type                                                                                       | Description                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `effectType`     | `"flat"` \| `"tick"` \| `"decay"`                                                           | **flat**: applied once on start turn only; **tick**: applied every turn while active, ramping down toward expiry; **decay**: currently skipped by `crisisTurn.ts` (reserved) |
| `targetType`     | `"metric"` \| `"approval"` \| `"profitMargin"` \| `"inflation"` \| `"gdpLoss"` \| `"stat"` | What the effect modifies                                                                  |
| `statKey`        | string \| undefined                                                                          | For `stat` effects: which character stat to target (charisma, debate, energy, etc.)       |
| `metricCategory` | string \| null                                                                                | Category name (e.g., `"economic"`), for metric effects                                   |
| `metricField`    | string \| null                                                                                | Field name (e.g., `"unemploymentRate"`), for metric effects                              |
| `sectorType`     | string \| null                                                                                | Corporation sector type filter, for profit margin effects; null = all sectors            |
| `strategyId`     | string \| null                                                                                | Operating strategy filter, for profit margin effects; null = all strategies              |
| `value`          | number                                                                                        | Effect magnitude. Negative = penalty; positive = bonus. Profit margin = percentage points. For `gdpLoss`, the fraction of regional GDP destroyed (e.g. 0.03 = 3%) |
| `physicality`    | `"physical"` \| `"financial"` \| undefined                                                  | For `profitMargin` effects under the plants market tier: `physical` reads `value` as a production haircut instead of a margin hit. Absent = `financial` (legacy margin-only) |
| `label`          | string                                                                                        | Display name for the effect (e.g., "Unemployment spike")                                  |

## Scope Resolution

Crises resolve their geographic scope to a list of target state IDs:

| Scope       | Resolution                                                 |
| ----------- | ---------------------------------------------------------- |
| `"global"`  | All states in all countries                                |
| `"country"` | All states in the specified `countryIds`                   |
| `"region"`  | Only the specified `regionIds` (state IDs like "CA", "TX") |

## Effect Types

### Flat Effects

Applied **once** on the turn the crisis starts (`turn === crisis.startTurn`):

```typescript
// Example: Sudden unemployment spike
{
  effectType: "flat",
  targetType: "metric",
  metricCategory: "economic",
  metricField: "unemploymentRate",
  value: 2.5, // +2.5% unemployment
  label: "Job losses"
}
```

### Tick Effects

Applied **every turn** while the crisis is active:

```typescript
// Example: Ongoing economic recession
{
  effectType: "tick",
  targetType: "metric",
  metricCategory: "economic",
  metricField: "gdpGrowth",
  value: -0.1, // -0.1% GDP growth per turn
  label: "Economic contraction"
}
```

### Tick Decay

Tick effects don't hold full strength for the crisis's whole life, for crises with a finite `durationTurns`, `tickDecayFactor()` (`src/lib/turn/crisisTurn.ts`) linearly ramps the applied `value` from 1.0x at `startTurn` down to 0x at expiry (50% at the midpoint):

```typescript
export function tickDecayFactor(turn: number, startTurn: number, duration: number | null): number {
  if (duration === null || duration <= 0) return 1;
  const elapsed = turn - startTurn;
  return Math.max(0, Math.min(1, 1 - elapsed / duration));
}
```

Indefinite crises (`durationTurns` null or <= 0) never decay, they apply their tick effects at full strength every turn until manually resolved.

**Why decay exists:** a shock fades as the economy adapts, so a long crisis hurts most at the start and eases toward its end rather than ending in a cliff. The scale uses the **effective** duration, so a crisis shortened by player responses (below) also decays faster. Flat and `gdpLoss` effects are not scaled; they fire once at onset.

**Shortening a crisis.** If the crisis carries an `interactionDefinition` and the interaction exists, `effectiveDuration = max(1, durationTurns - reduction)`, where `reduction` is the collective-contribution reduction (up to half the duration when the shared target is fully funded) plus any `durationReductionTurns` from decisive options taken. Expiry is checked against `effectiveDuration`.

## Target Types

### Metric Effects

Modify state metrics in the `stateMetrics` collection:

- **Path**: `stateMetrics.${metricCategory}.${metricField}.value`
- **Applies to**: All states in the resolved scope
- **Example categories**: `economic`, `social`, `infrastructure`
- **Example fields**: `unemploymentRate`, `gdpGrowth`, `crimeRate`

### Approval Effects

Modify government approval rating at the **country level**:

- **Collection**: `governmentApproval`
- **Field**: `approvalRating`
- **Deduplication**: Region-scoped crises derive the affected country from the region's parent country

```typescript
// Example: National crisis reduces government approval
{
  effectType: "tick",
  targetType: "approval",
  value: -0.5, // -0.5% approval per turn
  label: "Public discontent"
}
```

### Profit Margin Effects

Modify corporate sector profit margins in the `corporateSectors` collection:

- **Collection**: `corporateSectors`
- **Field**: `profitMargin` (clamped to [0, 100])
- **Filtering**: Can target specific `sectorType` and/or `strategyId`
- **Example**: Energy crisis hits energy-intensive sectors

```typescript
// Example: Power grid failure hits all sectors
{
  effectType: "tick",
  targetType: "profitMargin",
  sectorType: null, // all sectors
  strategyId: null, // all strategies
  value: -5, // -5% profit margin per turn
  label: "Power outage costs"
}
```

### Inflation Effects

Modify country-level inflation via `applyInflationEffects()`.

### GDP Loss Effects

One-time, real output destruction (physical-destruction disasters), applied only at `startTurn` regardless of `effectType`: `value` is the fraction of the affected region's GDP destroyed (e.g. `0.03` = 3%), applied as a `$mul` on `state.gdp` so the economy regrows from the reduced base afterward, the loss persists across turns, unlike a `metric` effect on `economic.gdpGrowth` which only drags the growth rate.

### Stat Effects

Target a specific character stat (`statKey`: `charisma`, `debate`, `energy`, etc.) via `applyStatEffects()`.

## Crisis Catalog and Bloc-Alignment Crisis Chains

There is a second, distinct crisis subsystem for the bloc-alignment game (`src/lib/alignment/crisisCatalog.ts`, `src/lib/alignment/crisisTurn.ts`, `src/lib/alignment/crisis.ts`), Cold War flashpoints that raise a target nation's alignment-movement ceiling while open, rather than mutating `stateMetrics`/`governmentApproval`/`corporateSectors` directly. It stores its documents in a separate `alignmentCrises` collection (`getAlignmentCrisesCollection`), not `crises`.

### Catalog

`AUTHORED_CRISES` (`crisisCatalog.ts`) is a fixed list of historical anchors, each gated to an inclusive era window (`minYear`-`maxYear`) and a preferred `targetEntityId`: Hungarian Rising (HU, 1956-58), Suez Intervention (EG, 1956-58), Berlin Flashpoint (DD, 1958-63), Missile Standoff (CU, 1962-64), Prague Spring (CS, 1968-70). `authoredCrisesForYear(year)` filters the catalog to crises whose window contains the current year.

`EMERGENT_CRISES` defines two world-condition-driven kinds instead of calendar-driven ones: `emergent.defection` (a bloc member visibly trying to leave) and `emergent.tugOfWar` (a country two blocs are both heavily invested in).

### Per-Turn Chain Resolution

Each turn, `openDueCrises()` and `closeDueCrises()` (`src/lib/alignment/crisisTurn.ts`) run the crisis lifecycle:

1. **Close due crises**, any crisis with `status: "open"` and `closesTurn <= currentTurn` resolves.
2. **Open new flashpoints**, up to `MAX_OPEN_CRISES = 3` concurrently, in strict precedence order:
   - **Authored anchors** fire once each per world, gated by era window. If the anchor's preferred target is not movable (already at `ALIGNMENT_GATES.locked`) or already claimed this turn, it **retargets** to the most contested movable nation instead of fizzling (`retargetedFrom` records the original target). Egypt and Cuba are deliberately kept in the catalog though neither is an implemented country, an authored crisis targeting them retargets to a real flashpoint.
   - **Defection crises** open for any bloc member that has wanted out for at least `SUSTAIN_TURNS / 2` turns (`DEFECTION_CRISIS_AT`).
   - **Tug-of-war crises** open for any nation two poles are both contesting (`tugOfWarCandidate()`).
3. Each opened crisis gets a `closesTurn` of `currentTurn + CRISIS_WINDOW_TURNS`.

A crisis itself pays out nothing directly, while open, it raises its target's movement ceiling (`openCrisisTargets()` feeds `CRISIS_TURN_CAP` elsewhere in the alignment turn phase), so ordinary sphere-projection plays against that nation can move further than anywhere else. A crisis nobody acts on changes nothing.

See [bloc-alignment-and-spheres.md](./bloc-alignment-and-spheres.md) for the surrounding bloc-stress/sphere-projection system this feeds into.

## Timing

- **Phase:** `crisisTurn`, inside the state-effects adapter (`src/simulation/phases/stateEffectsPhase.ts`). It runs first of the pure `$inc` writers: `crisisTurn`, then `ministerialOrders`, then `policyEffects`, an order chosen because the first two commute and policy effects read the result.
- **Before the early return** (so they run even with no active crisis): crisis aid-bill resolution and penalty reversal, living-conflict materialization, and the Vietnam chain opening and escalation.
- **Spawning:** the `autoCrisisTurn` and `autoDisasterTurn` phases (turn phase registry, skipped while corporation actions are paused) create automatic crises. `MAX_AUTO_CRISES_PER_TURN = 1` and the master auto-disaster flag gate them. A crisis spawned this way is announced by `crisisTurn` on the turn where `turn === startTurn`.
- **Admin-created crises** have `startTurn` equal to the already-processed current turn, so the start branch never runs for them. They are announced once at creation (`announceCrisisStart`) and their tick effects begin on the next turn.
- **Within a crisis, order:** resolve scope, compute effective duration, scale tick effects, apply metric, approval, profit margin, inflation, `gdpLoss`, then stat effects, then announce (start turn only), then expiry check. A crisis whose expiry turn is `startTurn + effectiveDuration` still applies its final tick (at factor 0) on that turn before resolving.
- **Bloc-alignment crises** open and close in the alignment phase (`openDueCrises`, `closeDueCrises`), before movement caps are computed for that turn.

## Turn Processing

Handled by `processCrisisTurn()` in `src/lib/turn/crisisTurn.ts`:

| Phase                           | Action                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| **Load active crises**          | Fetch all crises with `status: "active"`                                   |
| **Resolve scope**               | Convert scope + countryIds/regionIds to target state IDs                   |
| **Apply flat effects**          | Only if `turn === crisis.startTurn`                                        |
| **Apply tick effects**          | Every turn while active                                                    |
| **Apply metric effects**        | Bulk `$inc` to `stateMetrics`                                              |
| **Apply approval effects**      | `$inc` to `governmentApproval` by country                                  |
| **Apply profit margin effects** | Update `corporateSectors` with clamping                                    |
| **Wire events**                 | Emit `crisis_start` on activation, `crisis_end` on resolution              |
| **Auto-resolve**                | Mark expired crises as `resolved` when `turn >= startTurn + durationTurns` |

## Edge cases and limits

- **Stacked crises add up.** Multiple active crises each apply their own effects; approval deltas for one crisis are summed, profit margins and metrics accumulate per effect. There is no cap on the number of simultaneous admin or auto crises (only the alignment catalog caps open flashpoints at 3).
- **Metric clamping.** Metric effects are applied as one clamped pipeline update, so a crisis can never push a metric outside its definition bounds. Profit margin is clamped to 0..100.
- **Approval is not clamped by the crisis.** Approval effects use a plain `$inc` on `approvalRating` per affected country, with no clamp in `crisisTurn.ts`.
- **Approval counts once per country.** A region-scoped crisis derives the affected countries from its regions, so a country with many affected states takes the approval delta once, not once per state.
- **`gdpLoss` ignores `effectType`.** It applies only at `startTurn`, is capped at 95% per effect, and persists because it multiplies `state.gdp`; unlike a growth-rate effect, the economy regrows from the smaller base.
- **`decay` effects are skipped.** `effectType: "decay"` is reserved and does nothing today.
- **Zero or empty scope.** If the resolved state list is empty or no effect applies, nothing is written and the crisis still progresses to expiry.
- **Indefinite crises** never auto-expire, never decay, and are ended only by an admin.
- **Stat effects** drop character stats by the absolute value and clamp to 1..10.
- **Alignment crises** retarget instead of fizzling: if the preferred target is locked (`ALIGNMENT_GATES.locked`) or already claimed this turn, the crisis moves to the most contested movable nation. A crisis nobody acts on changes nothing, since it only raises a target's movement ceiling from `PER_NATION_TURN_CAP` 5 to `CRISIS_TURN_CAP` 7.5.
- **Authored anchors fire once per world** and only inside their era window.

## Worked example

The Financial Crisis below (`durationTurns` 96) carries a tick effect of -0.25 approval per turn and -0.2 GDP growth per turn.

| Turns since start | Decay factor | Approval per turn | GDP growth per turn |
| --- | --- | --- | --- |
| 0 | 1.00 | -0.250 | -0.200 |
| 24 | 0.75 | -0.1875 | -0.150 |
| 48 | 0.50 | -0.125 | -0.100 |
| 72 | 0.25 | -0.0625 | -0.050 |
| 96 | 0.00 | 0 | 0 |

Total approval lost over the crisis: 0.25 x (96 - (0 + 1 + ... + 95) / 96) = 0.25 x (96 - 47.5) = **12.1 points**, versus 24 points if the effect did not decay. If players fully fund a collective target, `reduction = floor(96 x 1 x 0.5) = 48`, the effective duration becomes 48, the decay runs twice as fast, and the total approval loss falls to 0.25 x (48 - 23.5) = **6.1 points**.

## Wire Event Integration

Crises emit wire events for real-time notifications:

```typescript
// On activation (start turn only)
logWireEvent("crisis_start", crisis.wireMessageOnStart, {
  href: `/world/crises/${crisis._id.toString()}`,
});

// On resolution (auto or manual)
logWireEvent("crisis_end", crisis.wireMessageOnEnd, {
  href: `/world/crises/${crisis._id.toString()}`,
});
```

## Lifecycle

1. **Creation**: Admin creates crisis via admin panel or API
2. **Activation**: Crisis effects apply immediately on next turn processing
3. **Duration**: Tick effects apply each turn; flat effects only on start turn
4. **Resolution**:
   - **Auto**: When `turn >= startTurn + durationTurns` (if `durationTurns` is set)
   - **Manual**: Admin marks as resolved via admin panel
5. **Cleanup**: Resolved crises remain in database for historical reference

## Admin Management

Crises are created and managed via admin routes (not yet documented in public API):

- **Create**: Admin panel → World → Crises → Create
- **Resolve**: Mark active crisis as resolved
- **Edit**: Modify effects, duration, scope

## Database

### `crises` collection

| Field                | Type           | Description                            |
| -------------------- | -------------- | -------------------------------------- |
| `_id`                | ObjectId       | Document ID                            |
| `name`               | string         | Crisis name                            |
| `description`        | string         | Crisis description                     |
| `scope`              | string         | `"global"`, `"country"`, or `"region"` |
| `countryIds`         | string[]       | Affected country IDs                   |
| `regionIds`          | string[]       | Affected state/region IDs              |
| `status`             | string         | `"active"` or `"resolved"`             |
| `startTurn`          | number         | Activation turn                        |
| `endTurn`            | number \| null | Resolution turn                        |
| `durationTurns`      | number \| null | Duration in turns                      |
| `effects`            | array          | Crisis effect definitions              |
| `wireMessageOnStart` | string         | Start wire event message               |
| `wireMessageOnEnd`   | string \| null | End wire event message                 |
| `createdBy`          | ObjectId       | Admin who created                      |
| `createdAt`          | Date           | Creation timestamp                     |
| `resolvedAt`         | Date \| null   | Resolution timestamp                   |

## Example Crises

### Financial Crisis (Country-wide, tick effects)

```typescript
{
  name: "Financial Crisis",
  description: "A severe banking crisis spreads across the nation",
  scope: "country",
  countryIds: ["US"],
  status: "active",
  startTurn: 480,
  durationTurns: 96, // 2 years
  effects: [
    {
      effectType: "tick",
      targetType: "metric",
      metricCategory: "economic",
      metricField: "gdpGrowth",
      value: -0.2,
      label: "Economic contraction"
    },
    {
      effectType: "tick",
      targetType: "metric",
      metricCategory: "economic",
      metricField: "unemploymentRate",
      value: 0.05,
      label: "Job losses"
    },
    {
      effectType: "tick",
      targetType: "approval",
      value: -0.25,
      label: "Government blame"
    }
  ],
  wireMessageOnStart: "A financial crisis has gripped the nation",
  wireMessageOnEnd: "The financial crisis has ended"
}
```

### Regional Drought (Region-specific, flat + tick)

```typescript
{
  name: "California Drought",
  description: "Severe drought conditions impact agriculture",
  scope: "region",
  regionIds: ["CA", "NV", "AZ"],
  status: "active",
  startTurn: 500,
  durationTurns: 48, // 1 year
  effects: [
    {
      effectType: "flat",
      targetType: "metric",
      metricCategory: "infrastructure",
      metricField: "waterSupply",
      value: -20,
      label: "Water shortage"
    },
    {
      effectType: "tick",
      targetType: "profitMargin",
      sectorType: "agriculture",
      value: -3,
      label: "Crop failure costs"
    }
  ]
}
```

## Key Files

| File                              | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `src/lib/db/types/crisis.ts`      | TypeScript interfaces for Crisis and CrisisEffect    |
| `src/lib/turn/crisisTurn.ts`      | Turn processing: effect application, auto-resolution |
| `src/lib/turn/crisisTurn.test.ts` | Unit tests for crisis turn processing                |
| `src/lib/wireEvent.ts`            | Wire event logging for crisis start/end              |
| `src/lib/alignment/crisisCatalog.ts` | Authored + emergent bloc-alignment crisis catalog  |
| `src/lib/alignment/crisisTurn.ts` | Bloc-alignment crisis open/close lifecycle           |
| `src/lib/alignment/crisis.ts`     | Alignment crisis helpers (`mostContested`, `tugOfWarCandidate`) |

## Connections

**Driven by:**

- Admin panel and the template creator (`src/lib/crises/createCrisisFromTemplate.ts`): create crises with effects, scope and duration.
- Auto-spawners (`src/lib/crises/autoCrisisSpawn.ts`, `autoDisasterSpawn.ts`): condition and random tiers create crises from templates.
- Player responses ([Crisis Interaction guide](https://www.ahousedividedgame.com/wiki/crisis-interaction)): collective contributions and decisive options shorten a crisis through `effectiveDuration` in `processCrisisTurn`.
- [Bloc Alignment and Spheres](./bloc-alignment-and-spheres.md): bloc stress and sphere projection decide which defection and tug-of-war flashpoints open.

**Affects:**

- [Policy System](./policy-system.md) and [National Metrics](./national-metrics.md): metric effects change `stateMetrics` and political metric boards (`applyMetricEffects`).
- [Government Approval](./government-approval.md): approval effects change `approvalRating` per country (`applyApprovalEffects`).
- [Corporations](./corporations.md): profit margin effects change `corporateSectors.profitMargin` (`applyProfitMarginEffects`); under the plants tier a `physical` effect is a production haircut.
- [National Budget](./national-budget.md): inflation effects change `federalBudget.economicFactors.inflationRate` (`applyInflationEffects`).
- [Bloc Alignment and Spheres](./bloc-alignment-and-spheres.md): an open alignment crisis raises its target's per-turn movement cap (`openCrisisTargets` feeding `CRISIS_TURN_CAP`).

## Related Documentation

- [Policy System](./policy-system.md), State metrics that crises can modify
- [Corporations](./corporations.md), Profit margin effects on corporate sectors
- [National Metrics](./national-metrics.md), Government approval affected by crises

Last checked: 2026-10-29, version 1.18.0
