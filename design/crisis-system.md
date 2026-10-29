# Crisis System

Crises are dynamic events that modify state metrics, government approval, and corporate profit margins across affected regions. They can be one-time shocks (flat effects) or ongoing situations (tick effects).

## Summary

Player guides: [Crisis Interaction](https://www.ahousedividedgame.com/wiki/crisis-interaction) (templates, decision trees, collective contributions, auto-spawning) and [Global Response Crises](https://www.ahousedividedgame.com/wiki/global-response-crises) (chained multi-country crises). The bloc-alignment flashpoints in the second half of this page are described for players in [Bloc Spheres](https://www.ahousedividedgame.com/wiki/bloc-spheres). For the multi-country campaign engine see [global-response-crises-as-shipped.md](./global-response-crises-as-shipped.md).

- **Purpose**: Create dynamic economic/political events that challenge players and alter the game world
- **Scope**: Global, country-wide, or region-specific
- **Duration**: Fixed (N turns) or indefinite (manual resolution)
- **Effects**: State metrics, government approval, corporate profit margins, national inflation, real GDP, character stats
- **Turn Processing**: Runs inside the `stateEffectsAndNationalAggregation` adapter (`src/simulation/phases/stateEffectsPhase.ts`), via `runtime.runPhase("crisisTurn", ...)`
- **Two subsystems**: the national crisis engine (`crises` collection, `src/lib/turn/crisisTurn.ts`) and the bloc-alignment flashpoints (`alignmentCrises` collection, `src/lib/alignment/crisisTurn.ts`). They share a name and nothing else.

## Rules

Every constant this page relies on, with its source.

| Constant | Value | Source |
| --- | --- | --- |
| Tick decay | `1 - elapsed / duration`, clamped to 0..1; indefinite crises stay at 1 | `tickDecayFactor` in `src/lib/turn/crisisTurn.ts` |
| Flat effect timing | Only when `turn === crisis.startTurn` | `src/lib/turn/crisisTurn.ts` |
| `gdpLoss` fraction clamp | 0 to 0.95 per effect; several losses multiply | `applyGdpLossEffects` in `src/lib/turn/crisisTurn.ts` |
| Profit margin clamp | 0 to 100 | `applyProfitMarginEffects` in `src/lib/turn/crisisTurn.ts` |
| Character stat clamp | 1 to 10 | `applyStatEffects` in `src/lib/turn/crisisTurn.ts` |
| Collective contribution shortening | `floor(duration x min(1, current / target) x 0.5)` turns; 0 when the target is missing or not positive | `collectiveDurationReduction` in `src/lib/crises/rules/collectiveReduction.ts` |
| `COLLECTIVE_MAX_DURATION_CUT` | 0.5 | `src/lib/crises/rules/collectiveReduction.ts` |
| Decisive-option shortening | sum of `durationReductionTurns` over the distinct options chosen (each option id counted once) | `calculateDecisionDurationReduction` in `src/lib/crises/interactionEngine.ts` |
| Minimum effective duration | 1 turn | `src/lib/turn/crisisTurn.ts` |
| `MIN_CRISIS_DURATION_TURNS` | 24 (every finite template or auto-disaster duration is raised to this; `null` stays indefinite) | `src/lib/crises/crisisDuration.ts` |
| `CRISIS_FLAT_UNIT_SCALE` / `CRISIS_TICK_UNIT_SCALE` | 100 / 30 (authored fractional swing times this gives the stored native delta) | `src/lib/crises/effectScale.ts` |
| `MAX_AUTO_CRISES_PER_TURN` | 1 | `src/lib/crises/autoCrisisConstants.ts` |
| `DEFAULT_DISASTER_COOLDOWN_TURNS` | 144 | `src/lib/crises/autoCrisisConstants.ts` |
| `AUTO_DISASTER_CADENCE_TURNS` | 144 turns between automatic disasters per country, staggered by a hash of the country id | `src/lib/crises/autoDisasterConstants.ts` |
| `AUTO_DISASTER_DEFAULT_DURATION_TURNS` | 24 | `src/lib/crises/autoDisasterConstants.ts` |
| `AUTO_DISASTER_MARGIN_PENALTY` | -10 percentage points, decaying linearly to 0 at expiry | `src/lib/crises/autoDisasterConstants.ts`, `src/lib/crises/disasterMarginPenalty.ts` |
| Weather disaster treasury loss | `round(smoothed GDP x 0.0002 x climateLossMultiplier(pressure, resilience))` | `src/lib/crises/autoDisasterSpawn.ts` |
| `BOARD_DELTA_CAP` / `BOARD_TICK_DELTA_CAP` | 12 / `12 / MIN_CRISIS_DURATION_TURNS` = 0.5 per turn, the cap on political metric board bends | `src/lib/politicalLegislation/legacyEffectBridge.ts` |
| `sectorGrowth` shock bounds | -10 to 15 (`SECTOR_SIGNAL_MIN` / `SECTOR_SIGNAL_MAX`) | `src/lib/crises/rules/metricPath.ts`, `src/lib/turn/gdpGrowth.ts` |
| `MAX_OPEN_CRISES` (alignment) | 3 | `src/lib/alignment/crisisTurn.ts` |
| `CRISIS_WINDOW_TURNS` (alignment) | 12 | `src/lib/alignment/crisis.ts` |
| `TUG_OF_WAR_MIN_SHARE` (alignment) | 25 share points for the runner-up pole | `src/lib/alignment/crisis.ts` |
| `DEFECTION_CRISIS_AT` | `SUSTAIN_TURNS / 2` = 12 turns (`SUSTAIN_TURNS` = 24) | `src/lib/alignment/crisisTurn.ts`, `src/lib/alignment/membershipEligibility.ts` |
| `ALIGNMENT_GATES` | `locked` 85, `nonAligned` 20 | `src/lib/constants/alignmentEras.ts` |
| `PER_NATION_TURN_CAP` / `CRISIS_TURN_CAP` | 5 / 7.5 alignment points per nation per turn | `src/lib/constants/alignmentEras.ts` |

### Crisis Structure

#### Core Fields (`crises` collection)

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

#### Crisis Effect Structure

Each effect defines what changes and how often it applies:

| Field            | Type                                                                                       | Description                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `effectType`     | `"flat"` \| `"tick"` \| `"decay"`                                                           | **flat**: applied once on start turn only; **tick**: applied every turn while active, ramping down toward expiry; **decay**: skipped by `crisisTurn.ts`; used only for `profitMargin` effects, which the corporation turn applies as a linearly fading penalty (see Decay effects below) |
| `targetType`     | `"metric"` \| `"approval"` \| `"profitMargin"` \| `"inflation"` \| `"gdpLoss"` \| `"stat"` | What the effect modifies                                                                  |
| `statKey`        | string \| undefined                                                                          | For `stat` effects: which character stat to target (charisma, debate, energy, etc.)       |
| `metricCategory` | string \| null                                                                                | Category name (e.g., `"economic"`), for metric effects                                   |
| `metricField`    | string \| null                                                                                | Field name (e.g., `"unemploymentRate"`), for metric effects                              |
| `sectorType`     | string \| null                                                                                | Corporation sector type filter, for profit margin effects; null = all sectors            |
| `strategyId`     | string \| null                                                                                | Operating strategy filter, for profit margin effects; null = all strategies              |
| `value`          | number                                                                                        | Effect magnitude. Negative = penalty; positive = bonus. Profit margin = percentage points. For `gdpLoss`, the fraction of regional GDP destroyed (e.g. 0.03 = 3%) |
| `physicality`    | `"physical"` \| `"financial"` \| undefined                                                  | For `profitMargin` effects under the plants market tier: `physical` reads `value` as a production haircut instead of a margin hit. Absent = `financial` (legacy margin-only) |
| `label`          | string                                                                                        | Display name for the effect (e.g., "Unemployment spike")                                  |

Built-in templates (`src/lib/crises/templates.ts`) author `metric`, `approval` and `inflation` effects as fractional swings and convert them with `toNativeEffectValue`: a flat swing of -0.03 is stored as -3, a tick swing of -0.02 is stored as -0.6 per turn. `profitMargin` (already in points) and `gdpLoss` (already a fraction) are not scaled. The `gdpLoss` template helper always authors `effectType: "flat"`.

### Scope Resolution

Crises resolve their geographic scope to a list of target state IDs:

| Scope       | Resolution                                                 |
| ----------- | ---------------------------------------------------------- |
| `"global"`  | All states in all countries                                |
| `"country"` | All states in the specified `countryIds`                   |
| `"region"`  | Only the specified `regionIds` (state IDs like "CA", "TX") |

### Effect Types

#### Flat Effects

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

#### Tick Effects

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

#### Tick Decay

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

**Shortening a crisis.** If the crisis carries an `interactionDefinition` and the interaction exists, `effectiveDuration = max(1, durationTurns - reduction)`, where `reduction` is the collective-contribution reduction (up to half the duration when the shared target is fully funded) plus any `durationReductionTurns` from decisive options taken. Expiry is checked against `effectiveDuration`. Multi-responder (global) crises earn no decisive-option reduction, because each leader answers only for their own country and the shared `resolutionPath` is never written.

### Target Types

#### Metric Effects

Modify state metrics. The write target depends on the metric path:

- **Economic and population paths** (the macro categories, `isMacroMetricPath` in `src/lib/macroMetrics/paths.ts`): `macroMetrics.${metricCategory}.${metricField}.value`, one clamped aggregation-pipeline update across every target state.
- **Political paths** (everything else): the region's political metric board, through `boardDeltaForLegacyEffect` and `applyBoardDelta` (`src/lib/politicalLegislation/`). This is a value shift that the dynamics phase later drifts back, not a permanent change to the equilibrium. Recurring (tick) effects use `BOARD_TICK_DELTA_CAP` (0.5) as the per-turn cap; a one-off shock uses `BOARD_DELTA_CAP` (12).
- **Redirect**: a `metric` effect on `economic.gdpGrowth` is rerouted to the `economic.sectorGrowth` node (`resolveCrisisMetricPath`, `src/lib/crises/rules/metricPath.ts`), with bounds -10 to 15, so a shock can push growth below zero. See [Economic Systems](./economic-systems.md).
- **Applies to**: All states in the resolved scope
- **Example categories**: `economic`, `social`, `infrastructure`
- **Example fields**: `unemploymentRate`, `gdpGrowth`, `crimeRate`

#### Approval Effects

Modify government approval rating at the **country level**:

- **Collection**: `governmentApprovals`
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

#### Profit Margin Effects

Modify corporate sector profit margins in the `corporateSectors` collection:

- **Collection**: `corporateSectors`
- **Field**: `profitMargin` (clamped to [0, 100])
- **Filtering**: Can target specific `sectorType` (via `operatingSectorFilter`) and/or `strategyId`
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

#### Decay effects (margin penalty)

`decay` `profitMargin` effects never write to the stored margin. `crisisTurn.ts` filters them out; instead the corporation turn reads active crises through `buildDisasterEffectsByState` and subtracts a transient penalty `value x (turnsRemaining / durationTurns)` for each (`computeDisasterPenaltySplit`, `src/lib/crises/disasterMarginPenalty.ts`), summed across overlapping disasters. Automatic regional disasters rewrite their template margin effects as `decay` effects (`buildRegionalDisasterEffects`, `src/lib/crises/autoDisasterSpawn.ts`), or add the generic -10 point shock when the template has none. Under the plants market tier a `physical` effect becomes a production factor `max(0, min(1, 1 + P / 100))` where P is the summed physical penalty (`disasterProductionFactor`).

#### Inflation Effects

Modify country-level inflation via `applyInflationEffects()`: the summed delta is added to `federalBudget.economicFactors.inflationRate` of each affected country (deduplicated like approval). The per-turn inflation recalculation then blends the shock through inertia, so it decays over following turns. See [Economic Systems](./economic-systems.md).

#### GDP Loss Effects

One-time, real output destruction (physical-destruction disasters): `value` is the fraction of the affected region's GDP destroyed (e.g. `0.03` = 3%), applied as a `$mul` on `state.gdp` so the economy regrows from the reduced base afterward, the loss persists across turns, unlike a `metric` effect on `economic.gdpGrowth` which only drags the growth rate. The shipped helper authors `gdpLoss` as a `flat` effect, which is what limits it to `startTurn`: `crisisTurn.ts` selects effects by `effectType` (`flat` only on the start turn, `tick` every turn) before routing by `targetType`.

#### Stat Effects

Target a specific character stat (`statKey`: `charisma`, `debate`, `energy`, etc.) via `applyStatEffects()`. Active characters (`retiredAt: null`) in scope lose the absolute value of the effect from the stat, clamped to 1 through 10. Country scope matches `currentOffice.countryId`; region scope matches `currentOffice.stateId`.

### Crisis Catalog and Bloc-Alignment Crisis Chains

There is a second, distinct crisis subsystem for the bloc-alignment game (`src/lib/alignment/crisisCatalog.ts`, `src/lib/alignment/crisisTurn.ts`, `src/lib/alignment/crisis.ts`), Cold War flashpoints that raise a target nation's alignment-movement ceiling while open, rather than mutating `macroMetrics`/`governmentApprovals`/`corporateSectors` directly. It stores its documents in a separate `alignmentCrises` collection (`getAlignmentCrisesCollection`), not `crises`.

#### Catalog

`AUTHORED_CRISES` (`crisisCatalog.ts`) is a fixed list of historical anchors, each gated to an inclusive era window (`minYear`-`maxYear`) and a preferred `targetEntityId`: Hungarian Rising (HU, 1956-58), Suez Intervention (EG, 1956-58), Berlin Flashpoint (DD, 1958-63), Missile Standoff (CU, 1962-64), Prague Spring (CS, 1968-70). `authoredCrisesForYear(year)` filters the catalog to crises whose window contains the current year.

`EMERGENT_CRISES` defines two world-condition-driven kinds instead of calendar-driven ones: `emergent.defection` (a bloc member visibly trying to leave) and `emergent.tugOfWar` (a country two blocs are both heavily invested in).

#### Per-Turn Chain Resolution

Each turn, `closeDueCrises()` and `openDueCrises()` (`src/lib/alignment/crisisTurn.ts`) run the crisis lifecycle:

1. **Close due crises**, any crisis with `status: "open"` and `closesTurn <= currentTurn` resolves (`status: "resolved"`, `resolvedTurn` stamped).
2. **Open new flashpoints**, up to `MAX_OPEN_CRISES = 3` concurrently (slots = 3 minus those still open), in strict precedence order:
   - **Authored anchors** fire once each per world (any earlier crisis document of the same `kind`, open or resolved, blocks a repeat), gated by era window. If the anchor's preferred target is not movable (lead at or above `ALIGNMENT_GATES.locked` = 85, or absent from the world) or already claimed this turn, it **retargets** to the most contested movable nation instead of fizzling (`retargetedFrom` records the original target). Egypt and Cuba are deliberately kept in the catalog though neither is an implemented country, an authored crisis targeting them retargets to a real flashpoint.
   - **Defection crises** open for any bloc member that has wanted out for at least `SUSTAIN_TURNS / 2` turns (`DEFECTION_CRISIS_AT`).
   - **Tug-of-war crises** open for any nation two poles are both contesting (`tugOfWarCandidate()`): the runner-up holds at least 25 share points and trails the leader by no more than `ALIGNMENT_GATES.nonAligned` (20).
3. Each opened crisis gets a `closesTurn` of `currentTurn + CRISIS_WINDOW_TURNS`. Only one open crisis per nation.

The contest ranking used for retargeting is `contestRank = second * 2 - (top - second)` over pole shares (`src/lib/alignment/crisis.ts`).

A crisis itself pays out nothing directly, while open, it raises its target's movement ceiling (`openCrisisTargets()` feeds `CRISIS_TURN_CAP` elsewhere in the alignment turn phase), so ordinary sphere-projection plays against that nation can move further than anywhere else. A crisis nobody acts on changes nothing.

See [bloc-alignment-and-spheres.md](./bloc-alignment-and-spheres.md) for the surrounding bloc-stress/sphere-projection system this feeds into.

### Turn Processing

Handled by `processCrisisTurn()` in `src/lib/turn/crisisTurn.ts`:

| Phase                           | Action                                                                     |
| ------------------------------- | -------------------------------------------------------------------------- |
| **Load active crises**          | Fetch all crises with `status: "active"`                                   |
| **Resolve scope**               | Convert scope + countryIds/regionIds to target state IDs                   |
| **Apply flat effects**          | Only if `turn === crisis.startTurn`                                        |
| **Apply tick effects**          | Every turn while active                                                    |
| **Apply metric effects**        | Clamped pipeline update to `macroMetrics`; political board bends           |
| **Apply approval effects**      | `$inc` to `governmentApprovals` by country                                 |
| **Apply profit margin effects** | Update `corporateSectors` with clamping                                    |
| **Apply inflation, gdpLoss, stat effects** | `$inc` on `federalBudget`, `$mul` on `states.gdp`, stat `bulkWrite` on `characters` |
| **Wire events**                 | Emit `crisis_start` on activation, `crisis_end` on resolution              |
| **Auto-resolve**                | Mark expired crises as `resolved` when `turn >= startTurn + effectiveDuration` |

### Wire Event Integration

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

Players with active characters whose `homeState` is in the affected states also receive an inbox notification (`crisis` on start, `crisis_resolved` on end) through `notifyAffectedPlayers`. The end notification is its own type so it stays out of the action-required filter.

### Lifecycle

1. **Creation**: Admin creates crisis via admin panel or API
2. **Activation**: Crisis effects apply immediately on next turn processing
3. **Duration**: Tick effects apply each turn; flat effects only on start turn
4. **Resolution**:
   - **Auto**: When `turn >= startTurn + effectiveDuration` (if `durationTurns` is set)
   - **Manual**: Admin marks as resolved via admin panel
5. **Cleanup**: Resolved crises remain in database for historical reference

### Admin Management

Crises are created and managed via admin routes (not yet documented in public API):

- **Create**: Admin panel → World → Crises → Create
- **Resolve**: Mark active crisis as resolved
- **Edit**: Modify effects, duration, scope

### Example Crises

#### Financial Crisis (Country-wide, tick effects)

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

#### Regional Drought (Region-specific, flat + tick)

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

### Key Files

| File                              | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `src/lib/db/types/crisis.ts`      | TypeScript interfaces for Crisis and CrisisEffect    |
| `src/lib/turn/crisisTurn.ts`      | Turn processing: effect application, auto-resolution |
| `src/lib/turn/crisisTurn.test.ts` | Unit tests for crisis turn processing                |
| `src/lib/wireEvent.ts`            | Wire event logging for crisis start/end              |
| `src/lib/crises/disasterMarginPenalty.ts` | Decaying margin and production penalty from `decay` effects |
| `src/lib/crises/autoCrisisSpawn.ts`, `autoDisasterSpawn.ts` | Automatic crisis and disaster spawners |
| `src/lib/alignment/crisisCatalog.ts` | Authored + emergent bloc-alignment crisis catalog  |
| `src/lib/alignment/crisisTurn.ts` | Bloc-alignment crisis open/close lifecycle           |
| `src/lib/alignment/crisis.ts`     | Alignment crisis helpers (`mostContested`, `tugOfWarCandidate`) |

## Data

### `crises` collection

Written by admin creation, the template creator and the auto-spawners; updated by `crisisTurn` on resolution. Player-visible on the World Crises page, the wire feed and inbox notifications.

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
| `createdBy`          | ObjectId \| null | Admin who created; null for automatic crises |
| `createdAt`          | Date           | Creation timestamp                     |
| `resolvedAt`         | Date \| null   | Resolution timestamp                   |

Optional fields set by other paths: `autoGenerated`, `autoSource` (`disaster`, `condition`, `random`), `templateKey`, `autoDisasterFiscalCost`, `interactionDefinition` (`decisionTree`, `autoResolveOnExpiry`), `chain`, `globalResponse`, `livingConflictEventId`, `lastUndergroundExtensionTurn`, `heroImage`.

### Other collections touched

| Collection | Fields | Access | Player-visible |
| --- | --- | --- | --- |
| `macroMetrics` | `economic.*.value`, `population.*.value`, `lastUpdated` | written (metric effects) | yes, as national and state metrics |
| political metric boards (`PoliticalMetricsDoc`) | board `value` through `applyBoardDelta` | written | yes |
| `governmentApprovals` | `approvalRating` | written (`$inc`, no clamp) | yes |
| `corporateSectors` | `profitMargin`, `stateId`, `strategyId`, sector filter | read, written | yes |
| `federalBudget` | `economicFactors.inflationRate`, `economicFactors.lastUpdated`; `treasuryBalance`, `disasterFiscalReceipts` (weather loss) | written | yes |
| `states` | `gdp` (`$mul`) | written | yes |
| `characters` | `stats`, `homeState`, `currentOffice`, `retiredAt` | read, written (stat effects) | yes |
| `crisisInteractions` | decision state, `collectiveCurrent`, `collectiveTarget`, `resolutionPath` | read; closed on crisis resolution | yes, as decision cards |
| `crisisAutoCooldowns` | `lastSpawnTurn`, `armed` | read, written by spawners | no |
| `gameState` | flags listed under Configuration | read | no |
| `alignmentCrises` | `kind`, `targetEntityId`, `title`, `headline`, `openedTurn`, `closesTurn`, `status`, `resolvedTurn`, `retargetedFrom`, `createdAt` | read, written | yes, on the alignment desk |
| `notifications` | `crisis`, `crisis_resolved` types, `metadata.crisisId` | written | yes |

## Configuration

All flags live on the single game state document (`gameState`, `_id: "current"`, type in `src/lib/db/types/gameState.ts`) and are admin toggles. A flag that is absent counts as off unless stated.

| Setting | Default | Effect | Read in |
| --- | --- | --- | --- |
| `crisisInteractionEnabled` | off | Creates `crisisInteractions` on the start turn and auto-resolves expired interactions. Off: crises still apply effects, with no decision cards | `src/lib/crises/featureFlag.ts`, `src/lib/turn/crisisTurn.ts` |
| `autoDisastersEnabled` | off | Master switch for both automatic spawners (regional disasters and condition/random crises) | `src/lib/turn/autoDisasterTurn.ts`, `src/lib/turn/autoCrisisTurn.ts` |
| `autoCrisisPaused` | off | Stays enabled but spawns nothing this turn (the climate feedback still advances for disasters) | same |
| `crisisSpawnChanceMultiplier` | 1 (anything not a positive number counts as 1) | Multiplies each random-tier template `spawnChance`; condition-tier crises are unaffected. Used by simulations | `src/lib/crises/autoCrisisSpawn.ts` |
| `crisisAidBillsEnabled` | off | Aid bills for crises | `src/lib/crises/featureFlag.ts`, `src/lib/crises/aidFinalize.ts` |
| `livingConflictsEnabled` | off | Living-conflict events materialize as crises and retire the legacy Vietnam crises | `src/lib/turn/crisisTurn.ts` |
| `conflictsEnabled` | off | Syncs the Vietnam front combat document | `src/lib/turn/crisisTurn.ts` |
| `corporationActionsPaused` | false | Skips both spawner phases, so cadence is not wasted on an inert economy | `src/simulation/phases/turnPhaseRegistry.ts` |
| Template `fromYear` / `untilYear` | none | Era window against the live `currentYear`; fails open when the year is missing | `src/lib/crises/crisisEraWindow.ts` |
| Template `disasterCooldownTurns` | 144 | Per template and scope cooldown | `src/lib/crises/autoCrisisConstants.ts` |
| Template `autoTrigger`, `spawnChance`, `cooldownTurns` | per template | Condition and random spawn tiers | `src/lib/crises/templates.ts` |
| Effect `physicality` | absent (= financial) | Plants tier only; absent keeps legacy margin-only behaviour | `src/lib/db/types/crisis.ts` |

There are no per-country or per-era presets for the national engine itself; era shows up only through template windows and the alignment catalog's year windows.

## Timing

- **Phase:** `crisisTurn`, inside the state-effects adapter (`src/simulation/phases/stateEffectsPhase.ts`). It runs first of the pure `$inc` writers: `crisisTurn`, then `ministerialOrders`, then `policyEffects`, an order chosen because the first two commute and policy effects read the result.
- **Before the early return** (so they run even with no active crisis): crisis aid-bill resolution and penalty reversal, living-conflict materialization, and the Vietnam chain opening and escalation.
- **Spawning:** the `autoDisasterTurn` and `autoCrisisTurn` phases (registry group `resourceAndFinanceStart`, `src/simulation/phases/turnPhaseRegistry.ts`, skipped while corporation actions are paused) create automatic crises. `MAX_AUTO_CRISES_PER_TURN = 1` and the master auto-disaster flag gate them. A crisis spawned this way is announced by `crisisTurn` on the turn where `turn === startTurn`.
- **Admin-created crises** have `startTurn` equal to the already-processed current turn, so the start branch never runs for them. They are announced once at creation (`announceCrisisStart`) and their tick effects begin on the next turn.
- **Within a crisis, order:** resolve scope, compute effective duration, scale tick effects, apply metric, approval, profit margin, inflation, `gdpLoss`, then stat effects, then announce (start turn only), then expiry check. A crisis whose expiry turn is `startTurn + effectiveDuration` still applies its final tick (at factor 0) on that turn before resolving.
- **After the loop:** expired crises are batch-resolved (global-response aggregate resolved first, open interactions closed, wire and inbox notices sent), then `processCrisisChain` advances chained families, then expired interactions auto-resolve (only when `crisisInteractionEnabled`).
- **Bloc-alignment crises** close at the top of the alignment phase (`closeDueCrises`), the surviving open targets set that turn's movement caps (`openCrisisTargets`), and new flashpoints open at the end of the phase on the turn's settled shares (`openDueCrises`). A newly opened crisis therefore raises its target's cap starting the next turn.
- **Downstream:** the corporation turn reads `decay` margin effects, and the next `inflationRecalc` blends any inflation shock.

```
resourceAndFinanceStart: autoDisasterTurn -> autoCrisisTurn      (create crises, startTurn = this turn)
   ...
alignment:               closeDueCrises -> caps use open targets -> drift -> openDueCrises
   ...
fiscalYearBoundary
stateEffectsAndNationalAggregation:
   crisisTurn  (aid bills, living conflicts, Vietnam chain, then effects, announce, expiry, chain)
   -> ministerialOrders -> policyEffects (reads crisis-shocked values)
   -> metricEngine (sectorGrowth carries the GDP rate shock) -> nationalMetrics
   -> inflationRecalc (blends the inflation shock)
corporation turn: decay margin penalty read from active crises
```

## Worked trace

Case 1, tick decay and shortening. A country-scope crisis spawns from a built-in template that authors an approval tick swing of -0.02 and a duration of 24 turns (already at the 24-turn floor).

1. Stored value: `toNativeEffectValue("tick", -0.02) = -0.02 x 30 = -0.6` approval points per turn at full strength.
2. At elapsed 6 turns with no responses: `tickDecayFactor = 1 - 6/24 = 0.75`, so the applied delta is `-0.6 x 0.75 = -0.45`, summed with any other approval effects and added to `governmentApprovals.approvalRating` for each affected country once.
3. Whole life with no responses: ticks run at elapsed 0 to 24 (the last at factor 0). Factors sum to `25 - (24 x 25 / 2) / 24 = 12.5`, so total approval lost is `0.6 x 12.5 = 7.5` points.
4. If players raise half of a collective target: `reduction = floor(24 x 0.5 x 0.5) = 6`, `effectiveDuration = max(1, 24 - 6) = 18`. Ticks run at elapsed 0 to 18; factors sum to `19 - (18 x 19 / 2) / 18 = 9.5`, so the total is `0.6 x 9.5 = 5.7` points. The crisis resolves on the turn `startTurn + 18`.

Case 2, the Financial Crisis below (`durationTurns` 96) carries a tick effect of -0.25 approval per turn and -0.2 GDP growth per turn.

| Turns since start | Decay factor | Approval per turn | GDP growth per turn |
| --- | --- | --- | --- |
| 0 | 1.00 | -0.250 | -0.200 |
| 24 | 0.75 | -0.1875 | -0.150 |
| 48 | 0.50 | -0.125 | -0.100 |
| 72 | 0.25 | -0.0625 | -0.050 |
| 96 | 0.00 | 0 | 0 |

Total approval lost over the crisis: 0.25 x (96 - (0 + 1 + ... + 95) / 96) = 0.25 x (96 - 47.5) = **12.1 points**, versus 24 points if the effect did not decay. If players fully fund a collective target, `reduction = floor(96 x 1 x 0.5) = 48`, the effective duration becomes 48, the decay runs twice as fast, and the total approval loss falls to 0.25 x (48 - 23.5) = **6.1 points**. An admin-created crisis skips its start-turn tick, so its first tick is at elapsed 1 and its totals are one full-strength tick smaller (11.9 and 5.9).

Case 3, compounding GDP loss. A region with `gdp` 200,000,000 is hit on its start turn by two `gdpLoss` effects of 0.02 and 0.03. `factor = (1 - 0.02) x (1 - 0.03) = 0.9506`, applied as `$mul` on `states.gdp`: 200,000,000 becomes 190,120,000. Nothing happens on later turns, and the sector growth model regrows from the smaller base.

Case 4, decay margin penalty. An automatic disaster has `durationTurns` 24 and the generic `value` -10. At 6 turns after `startTurn`, `turnsRemaining = 18`, so the sector margin penalty is `-10 x 18 / 24 = -7.5` points, computed fresh each turn and not stored. At expiry it is 0.

## Edge cases and limits

- **Stacked crises add up.** Multiple active crises each apply their own effects; approval deltas for one crisis are summed, profit margins and metrics accumulate per effect. There is no cap on the number of simultaneous admin or auto crises (only the alignment catalog caps open flashpoints at 3).
- **Metric clamping.** Macro metric effects are applied as one clamped pipeline update, so a crisis can never push a metric outside its definition bounds (default 0 to 100 when the definition has none, except the `sectorGrowth` redirect at -10 to 15). Political boards are clamped 0 to 100 by `applyBoardDelta`, and bends are capped per write. Profit margin is clamped to 0..100.
- **Approval is not clamped by the crisis.** Approval effects use a plain `$inc` on `approvalRating` per affected country, with no clamp in `crisisTurn.ts`.
- **Approval counts once per country.** A region-scoped crisis derives the affected countries from its regions, so a country with many affected states takes the approval delta once, not once per state. The same holds for inflation effects.
- **`gdpLoss` follows `effectType`.** The template helper authors it as `flat`, so it applies only at `startTurn`; it is capped at 95% per effect and persists because it multiplies `state.gdp`. A hand-authored `gdpLoss` tick effect would be scaled by decay and re-applied every turn, which no shipped template does.
- **`decay` effects are skipped by `crisisTurn`.** They are not inert: the corporation turn applies them (see Decay effects). A `decay` effect on any target other than `profitMargin` does nothing.
- **Zero or empty scope.** If the resolved state list is empty or no effect applies, nothing is written and the crisis still progresses to expiry.
- **Indefinite crises** never auto-expire, never decay, and are ended only by an admin. They are exempt from the 24-turn minimum.
- **Stat effects** drop character stats by the absolute value and clamp to 1..10; characters without a stats object are skipped.
- **Interaction off.** With `crisisInteractionEnabled` off, no decision cards exist, so no shortening happens even if the crisis carries an `interactionDefinition`.
- **Alignment crises** retarget instead of fizzling: if the preferred target is locked (`ALIGNMENT_GATES.locked`) or already claimed this turn, the crisis moves to the most contested movable nation, and if none exists it is skipped this turn (and may retry later). A crisis nobody acts on changes nothing, since it only raises a target's movement ceiling from `PER_NATION_TURN_CAP` 5 to `CRISIS_TURN_CAP` 7.5.
- **Authored anchors fire once per world** and only inside their era window.
- **Deliberate exclusion.** Alignment flashpoints never touch metrics, approval or margins; the national engine never touches alignment shares.

## Invariants

- Tick decay factor stays within 0 to 1 and indefinite crises hold 1: pure function, covered by the taper test in `src/lib/turn/crisisTurn.test.ts`.
- A flat effect and a `gdpLoss` apply on the start turn only: `src/lib/turn/crisisTurn.test.ts`.
- Macro metrics never leave their bounds through a crisis: `src/lib/turn/crisisTurn.test.ts` (S8 clamp test).
- Stored `profitMargin` is never mutated by a `decay` effect: `src/lib/turn/crisisTurn.decay.test.ts`.
- A start announcement is emitted exactly once per crisis: `src/lib/turn/crisisTurn.test.ts` (start-turn and admin-create tests).
- A nation has at most one open alignment crisis and at most 3 are open at once; authored anchors run once per world; locked nations never get one: `src/lib/alignment/crisisTurn.test.ts`.
- Automatic spawns are deterministic for a given turn and key (`deterministicRoll`, FNV-1a), so replaying a turn cannot double-spawn: `src/lib/crises/autoCrisis.test.ts`.
- A fixed duration is never below 24 turns: `src/lib/crises/crisisDuration.test.ts`.
- Approval staying in range after crisis effects is **not enforced** here; downstream approval processing is responsible.

## Failure and recovery

- **Crisis never ends.** A crisis with `durationTurns` null and no admin resolution keeps applying full-strength tick effects forever. Repair: resolve it from the admin panel.
- **Duplicate or stuck spawns.** Cooldown rows (`crisisAutoCooldowns`) stop a template recurring; a bad or missing row can suppress or repeat a spawn. Repair: correct the row, or let the re-arm logic clear it.
- **Metric stuck at a bound after a crisis.** Political boards drift back through the dynamics phase; macro metrics recover through their own engine nodes. A metric that stays pinned usually points to an indefinite crisis still active.
- **Turn replay.** `crisisTurn` effects are `$inc` writes, so replaying a completed turn would double-apply them; turn resume logic skips phases already applied. A partial failure after the effect writes but before resolution is repaired by rerunning the turn from the recorded phase state.
- **Missed start announcement.** An admin crisis is announced once at creation; if that call failed, the crisis is live without a wire item or inbox notice. Repair: re-run the announcement for that crisis.
- **Weather loss charge.** `chargeDisasterFiscalLoss` is idempotent per crisis (`disasterFiscalReceipts`), so a retry reconciles a missed treasury debit.
- **Alignment crisis shortage.** If no movable nation exists, authored anchors skip and retry on later turns while the era window is open.

## Connections

**Driven by:**

- Admin panel and the template creator (`src/lib/crises/createCrisisFromTemplate.ts`): create crises with effects, scope and duration.
- Auto-spawners (`src/lib/crises/autoCrisisSpawn.ts`, `autoDisasterSpawn.ts`): condition and random tiers create crises from templates.
- Player responses ([Crisis Interaction guide](https://www.ahousedividedgame.com/wiki/crisis-interaction)): collective contributions and decisive options shorten a crisis through `effectiveDuration` in `processCrisisTurn`.
- [Bloc Alignment and Spheres](./bloc-alignment-and-spheres.md): bloc stress and sphere projection decide which defection and tug-of-war flashpoints open.

**Affects:**

- [Policy System](./policy-system.md) and [National Metrics](./national-metrics.md): metric effects change `macroMetrics` and political metric boards (`applyMetricEffects`).
- [Economic Systems](./economic-systems.md): a GDP growth shock lands on the `economic.sectorGrowth` node and an inflation effect on `federalBudget.economicFactors.inflationRate`, both read by the next `metricEngine` and `inflationRecalc` phases.
- [Government Approval](./government-approval.md): approval effects change `approvalRating` per country (`applyApprovalEffects`).
- [Corporations](./corporations.md): profit margin effects change `corporateSectors.profitMargin` (`applyProfitMarginEffects`); `decay` effects feed the corporation turn margin stack (`src/lib/turn/corporation/sectorTurn/marginStack.ts`); under the plants tier a `physical` effect is a production haircut.
- [National Budget](./national-budget.md): inflation effects change `federalBudget.economicFactors.inflationRate` (`applyInflationEffects`); weather disasters debit `treasuryBalance`.
- [Bloc Alignment and Spheres](./bloc-alignment-and-spheres.md): an open alignment crisis raises its target's per-turn movement cap (`openCrisisTargets` feeding `CRISIS_TURN_CAP`).

Related documentation:

- [Policy System](./policy-system.md), State metrics that crises can modify
- [Corporations](./corporations.md), Profit margin effects on corporate sectors
- [National Metrics](./national-metrics.md), Government approval affected by crises

## Tests

| File | Covers |
| --- | --- |
| `src/lib/turn/crisisTurn.test.ts` | tick and flat timing, tick taper, auto-resolve, indefinite crises, wire events, scope, approval parent country, clamp, `gdpLoss` once, `sectorGrowth` redirect |
| `src/lib/turn/crisisTurn.decay.test.ts` | `decay` margin effects never write the stored margin |
| `src/lib/turn/crisisTurn.yearBoundary.test.ts` | year-gated conflict and chain openings use the turn's calendar year, and do not double-open on replay |
| `src/lib/crises/interactionEngine.test.ts` | collective and decisive duration reduction, interaction lifecycle |
| `src/lib/crises/crisisDuration.test.ts` | 24-turn minimum duration |
| `src/lib/crises/disasterMarginPenalty.test.ts` | decaying margin and production penalty |
| `src/lib/crises/autoCrisis.test.ts`, `autoCrisisRearm.test.ts`, `autoCrisisEraGate.test.ts`, `autoDisasterSpawn.test.ts` | spawn caps, cooldowns, re-arm, era windows, disaster cadence |
| `src/lib/crises/severity.test.ts`, `templates.test.ts` | effect scaling and template integrity |
| `src/lib/alignment/crisis.test.ts`, `src/lib/alignment/crisisTurn.test.ts` | contest ranking, open and close lifecycle, retargeting, cap |

Gaps: no test drives `stat` or `inflation` effects through `processCrisisTurn`; the political board branch of metric effects is covered only through `src/lib/crises/applyEffects.political.test.ts`; no test pins the order of alignment crisis opening relative to movement caps.

## Known issues and history

- **Alignment crisis cap timing.** Newly opened flashpoints raise their target's cap only from the next turn, because opening happens after drift (see Timing). Earlier text of this page said crises open before the caps are computed; the code closes first and opens last.
- **`decay` margin penalty ignores shortening.** `buildDisasterEffectsByState` uses the stored `durationTurns`, not the effective duration, so player responses that shorten a crisis shorten its tick effects but not the rate at which its `decay` margin penalty fades. The penalty ends when the crisis leaves the active list, so a shortened crisis drops the remaining penalty at once rather than fading it out.
- **`gdpLoss` timing depends on `effectType`.** Documented as "regardless of effectType" in earlier text; the code selects by `effectType` first. Only the shipped `flat` authoring keeps it one-shot.
- **Dead branch.** `applyProfitMarginEffects` still checks `effectType === "decay"` although the caller already filters decay effects out; covered by a test that calls it directly.
- **Doc corrections (this page).** Collection names were wrong in earlier text: metrics are written to `macroMetrics` and political boards (not `stateMetrics`), and approval to `governmentApprovals` (not `governmentApproval`). `decay` is live for margin penalties, not "reserved".
- **Player wiki.** The Crisis Interaction and Bloc Spheres pages agree with the code on every number checked (144-turn cadence, -10 point margin penalty, 0.02 percent weather loss, 50 percent maximum cut, 5 and 7.5 movement caps).
- **Open design note.** Approval has no clamp in `crisisTurn.ts`; stacked heavy crises depend on downstream processing to bound it.

Last checked: 2026-10-29, version 1.18.0
