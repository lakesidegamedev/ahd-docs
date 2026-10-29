# Ministerial Orders

## Summary

Design doc for the ministerial order lifecycle: issuance, active-window tracking,
expiry, and per-turn effect application. Ministerial orders are the discretionary
lever cabinet-position holders spend ministerial actions on, distinct from tier
settings and regional targets (also cabinet levers, but persistent rather than
timed).

Player guide: [Cabinet](https://www.ahousedividedgame.com/wiki/cabinet) (see also [Cabinet Guide](https://www.ahousedividedgame.com/wiki/cabinet-guide) for the orders each post can issue).

| Piece | Location |
| --- | --- |
| Lifecycle (expiry, active test) | `src/lib/cabinet/ministerialOrderLifecycle.ts` |
| Issuance route | `POST /api/country/[code]/executive/cabinet/[positionId]/order` (`src/app/api/country/[code]/executive/cabinet/[positionId]/order/route.ts`) |
| Turn application | `src/lib/turn/ministerialOrderProcessing.ts` |
| Action pool (spend, refund, accrual, UK shared pool) | `src/lib/cabinet/ministerialActionPool.ts` |
| Order catalogue by country and post | `src/lib/constants/cabinetOrders.ts` (per-country files under `src/lib/countries/<cc>/cabinet/`) |

An order is a timed metric nudge. The holder spends one ministerial action, the
order runs for a fixed number of turns, and each turn its effect is added to the
country's metrics until it expires. The same turn function also applies tier
settings, regional targets, advocacy, estates, energy, infrastructure and
treasury effects; this page covers the order half.

## Rules

| Constant | Value | Source |
| --- | --- | --- |
| `DEFAULT_ORDER_DURATION` | 24 turns | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `MINISTERIAL_ACTION_CAP` | 4 actions banked per position | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `MINISTERIAL_ACTION_ACCRUAL_TURNS` | +1 action every 6 turns (4 per game day) | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `MINISTERIAL_ACTION_REGEN_INTERVAL` | 24, deprecated, superseded by the accrual constant | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `CABINET_EFFECT_STRENGTH` | 1.25 multiplier on the merged order effect | `src/lib/turn/ministerialOrderProcessing.ts` |
| `MAX_PER_METRIC_MODIFIER_PER_TURN` | 0.08 per metric per turn, either sign | `src/lib/turn/ministerialOrderProcessing.ts` |
| `EFFICACY_PIVOT` / `EFFICACY_SLOPE` | 5.5 / 0.04 | `src/lib/stats/statsConstants.ts` |
| `NEUTRAL_STAT` | 5.5 (equal to the pivot) | `src/lib/stats/statsConstants.ts` |
| `OFFICE_POOL_TOP_UP_AP_COST` | 10 main AP buys 1 action, once per pool per turn, never above the cap | `src/lib/actions/officePoolTopUpRules.ts` |

Order cost is 1 ministerial action. Order duration is per order (`duration` on the
`MinisterialOrderConfig`); the US catalogue uses `DEFAULT_ORDER_DURATION` for every
order. Emergency actions cost 1 action too (`EmergencyMechanicConfig.cost`) and use
the emergency's own `duration`.

Statecraft multiplier:
`statMultiplier(stat) = 1 + (clamp(stat, 1, 10) - 5.5) * 0.04` (`src/lib/stats/statMultiplier.ts`),
so stat 1 gives 0.82x, stat 5.5 gives 1.0x, stat 10 gives 1.18x.

Per-turn effect on one metric, summed over all active orders in a country:

```
applied = clamp(sum(modifier * statMultiplier(issuer.statecraft)) * 1.25, -0.08, +0.08)
          * modifierSpanScale(metric)
```

`modifierSpanScale` is `max(1, |THRESHOLDS.worst - THRESHOLDS.best| / 100)` for the
metric leaf (`src/lib/turn/ministerialOrderProcessing.ts`, thresholds in
`src/lib/utils/metricScoring.ts`), so a 0-100 authored modifier registers on a
metric with a larger real-unit range. A metric with no `THRESHOLDS` entry keeps
scale 1. The cap is applied before the span scale, so the effective cap on a wide
metric is `0.08 * scale` (for `crimeRate`, `0.08 * 95 = 7.6`).

The sum in that formula is over every channel in the country, not only orders:
tier settings, regional targets, advocacy, estates, energy and infrastructure
effects are merged into the same per-metric total before the strength multiplier
and the cap, so the 0.08 ceiling is shared across all cabinet levers.

Why 24 turns: one game half-year (`TURNS_PER_YEAR` is 48 in
`src/lib/constants/calendar.ts`), long enough that an order is a real commitment,
short enough that a minister must keep spending actions to hold a policy.

### Expiry resolution

Expiry is derived, not just read off `expiresTurn`, so legacy or wrong-typed rows
self-heal:

```typescript
export function computeMinisterialOrderExpiresTurn(
  issuedTurn: number,
  duration: number = DEFAULT_ORDER_DURATION
): number {
  return issuedTurn + duration;
}

export function resolveMinisterialOrderExpiresTurn(order: OrderExpiryFields): number {
  if (order.duration != null && Number.isFinite(order.duration) && order.issuedTurn != null) {
    return computeMinisterialOrderExpiresTurn(order.issuedTurn, order.duration);
  }
  const coerced = Number(order.expiresTurn);
  if (Number.isFinite(coerced)) return coerced;
  return computeMinisterialOrderExpiresTurn(order.issuedTurn, DEFAULT_ORDER_DURATION);
}

export function isMinisterialOrderActive(
  order: Pick<MinisterialOrder, "active" | "expiresTurn" | "issuedTurn" | "duration">,
  currentTurn: number
): boolean {
  if (!order.active) return false;
  return resolveMinisterialOrderExpiresTurn(order) > currentTurn;
}
```

Resolution order: prefer `issuedTurn + duration` (authoritative when both are
present and numeric) over the persisted `expiresTurn`, then fall back to a coerced
`expiresTurn`, then to `issuedTurn + DEFAULT_ORDER_DURATION` as a last resort. The
expiry turn is the first turn on which the order is inactive.

### Expiry sweep

```typescript
export async function expireMinisterialOrders(
  db: Db,
  currentTurn: number
): Promise<{ expired: number }>
```

Runs a two-pass sweep every turn (bug #0761 fix, legacy rows with missing or
string-typed `expiresTurn` were lingering `active: true` forever under a single
typed-query pass):

1. **Fast path:** `updateMany({ active: true, expiresTurn: { $lte: currentTurn } })`,
   catches every well-typed row in one query.
2. **Stale sweep:** fetches all remaining `active: true` docs, recomputes expiry via
   `resolveMinisterialOrderExpiresTurn` for each, and force-deactivates any that
   should have expired but didn't match the fast-path filter (wrong type, missing
   field).

Also called defensively at order-issuance time (see below), so a stale still-active
row from a prior turn cannot block a fresh order of the same type from being issued.

### Issuance

`POST /api/country/[code]/executive/cabinet/[positionId]/order`, auth: `requireAuth`,
then the caller must be the cabinet holder for that position, or admin.

1. Validate the country code (400 on unknown), then resolve `mechanics` and
   `availableOrders` for the country/position; 404 if the position has neither
   orders nor an emergency mechanic.
2. Resolve the order config: the synthesized emergency order, or the entry of
   `availableOrders` with the requested `orderId`; 400 `"Invalid order ID"` if neither.
3. Regional-scope orders require a `targetRegionId` (the legacy `regionId` field is
   also accepted), rejected up front with 400 (`"Select a target region"`) rather
   than silently dropping the effect at turn time, since the turn engine only
   applies regional effects that carry a `regionId`.
4. Auth check: `member.characterId` must match the caller's character, or the caller
   is admin; otherwise 403.
5. Read the remaining pool through `resolveMinisterialRemaining`. It backfills legacy
   `cabinetMembers` docs missing `ministerialActions` /
   `lastMinisterialActionResetDay` (pre-fix nominations and admin force-confirms
   could insert members without these fields, which silently fails the atomic
   `$gte: 1` spend below, since Mongo does not match `$gte` against a missing field).
   UK player holders read the shared pool. If remaining is under 1, 400.
6. `expireMinisterialOrders(db, currentTurn)` runs first, then the route checks for
   an already-active order of the same `orderId` on that position, 409 if found.
7. Atomically spend one action through `spendMinisterialAction`
   (`updateOne({ ministerialActions: { $gte: 1 } })` for ordinary rows); 409 on a
   lost race.
8. Insert the order document with `expiresTurn: computeMinisterialOrderExpiresTurn
   (currentTurn, orderConfig.duration)`. On insert failure, the spent action is
   refunded (`refundMinisterialAction`) before the error is rethrown.

Emergency orders (`emergencyOrderId = "emergency_" + positionId`) are a special
config synthesized from `mechanics.emergency` rather than looked up in
`availableOrders`; their effects are always `scope: "regional"`.

### Per-turn effect application

`processMinisterialOrders(currentTurn)` (`src/lib/turn/ministerialOrderProcessing.ts`)
runs every turn, all countries:

1. Expire completed orders (`expireMinisterialOrders`).
2. Fetch all `active: true` orders.
3. **Statecraft scaling:** each order's effect magnitude is scaled by the issuing
   minister's `statecraft` stat via `statMultiplier()` (gentle plus or minus 20%),
   read once per issuing character. Unmigrated ministers (no stat block) and orders
   with no resolvable issuer default to 1.0x.
4. Effects are bucketed per country under a `"orders"` source channel (kept separate
   from `"settings"`, `"military"`, `"estates"`, `"energy"`, `"infrastructure"`, the
   #1129 split-by-channel model, so a saturated order book doesn't zero out a
   newly-built estate's contribution).
5. Inflation-pressure metrics (`inflationPressure`, `inflationRate` leaves) are
   routed to `centralBanks.policyInflationPressure`, not into `stateMetrics`, a
   national monetary concept regardless of the effect's declared `scope`.
6. All other effects are merged across channels, scaled by
   `CABINET_EFFECT_STRENGTH` (**1.25**), then clamped to
   `MAX_PER_METRIC_MODIFIER_PER_TURN` (**0.08**) per metric per turn, the hard
   ceiling that stops a fully-staffed cabinet stacking 10+ active orders into
   runaway compounding (bug #0571 guarantee).
7. Macro-scale metrics (per-100k crime rate, per-pupil education spending, etc.) are
   additionally scaled by `modifierSpanScale(metricPath)`, which reads the metric's
   `THRESHOLDS` span so a 0-100-convention-authored modifier registers proportionally
   on a metric with a much larger real-unit range.
8. Applied via bulk `$inc` to `macroMetrics` for macro paths; political-pipeline
   countries additionally get their national + per-region deltas snapshotted into
   `politicalCabinetContribution` for the political-approval dynamics step.

Only macro paths are written by the `$inc` in step 8. `isMacroMetricPath`
(`src/lib/macroMetrics/paths.ts`) is true for the `economic` and `population`
categories, `independenceDesire`, and the governance paths `governance.independenceDesire`,
`governance.budgetBalance` and `governance.debtToGdp`. An order on any other metric (for example
`publicSafety.crimeRate` or `governance.publicTrust`) reaches the game only through
the political snapshot, which maps the raw (statecraft-scaled) deltas to political
metrics and does not apply the 1.25 strength, the 0.08 cap or the span scale in
this file.

## Data

Collection: `ministerialOrders`, accessed through `getMinisterialOrdersCollection(db)`
(`src/lib/db/collections/cabinetSettings.ts`).

```typescript
interface MinisterialOrder {
  _id: ObjectId;
  countryId: CountryId;
  positionId: string;
  characterId: ObjectId | null; // null when issued by an NPP minister
  isNPP?: boolean;
  nppId?: ObjectId;
  orderId: string;
  orderName: string;
  effects: Array<{
    metric: string;
    modifier: number;
    scope: "national" | "regional";
    regionId?: string;
  }>;
  issuedAt: Date;
  issuedTurn: number;
  duration?: number; // turn count issued for; used to recompute expiry on legacy rows
  expiresTurn: number;
  active: boolean;
  createdAt: Date;
}
```

Defined in `src/lib/db/types/ministerialOrder.ts`.

| Collection | Field | Read | Written | Notes |
| --- | --- | --- | --- | --- |
| `ministerialOrders` | whole document | turn step, issuance route, briefing route | issuance route (insert), expiry sweep and government change (`active`) | Orders and their remaining time are shown in the cabinet office page |
| `cabinetMembers` | `ministerialActions` | issuance route, accrual | spend, refund, accrual, top-up | The visible action count |
| `cabinetMembers` | `lastMinisterialActionResetDay` | pool backfill | backfill, UK mirror | Legacy field kept for pool seeding |
| `cabinetMembers` | `lastMinisterialActionAccrualTurn` | accrual filter | accrual | Idempotence stamp, not shown |
| `cabinetMembers` | `lastMinisterialActionTopUpTurn` | top-up rules | top-up | Once-per-turn guard |
| `characters` | `stats.statecraft` | turn step | none | Scales order effects |
| `characters` | `sharedMinisterialActions`, `sharedMinisterialActionResetDay`, `sharedMinisterialActionAccrualTurn`, `sharedMinisterialActionTopUpTurn` | UK pool reads | UK pool spend, refund, accrual, top-up | UK player holders only |
| `states` | `_id`, `countryId` | turn step | none | Maps a country to its regions |
| `macroMetrics` | `<metricPath>.value` | none | `$inc` by the turn step | Economic and population metrics shown to players |
| `centralBanks` | `policyInflationPressure` | inflation recalculation | set for every bank each turn (0 when none) | Not shown directly |
| `politicalCabinetContribution` | `contribution`, `regional`, `sources`, `turn` | political-metrics dynamics step | turn step, once per pipeline country per turn | Internal snapshot |

## Configuration

Order behaviour is set by code constants and per-country catalogues, not by
`gameConfig` fields. No `gameConfig` field changes the order cap, strength,
duration or the action economy.

| Setting | Default | Where it is set |
| --- | --- | --- |
| Order catalogue per post (id, name, `duration`, `effects`) | Per country; the US posts use `DEFAULT_ORDER_DURATION` | `src/lib/constants/cabinetOrders.ts` registry (`ORDERS_BY_COUNTRY`: DE, IE, UK, US, JP, CN, RU, DD, SCO, WAL) and per-country files under `src/lib/countries/<cc>/cabinet/` |
| Emergency mechanic per post (`cost: 1`, `duration`, `effects`) | Per post | `emergency` on `CabinetPositionMechanics` in the country mechanics files |
| Action cap and accrual interval | 4 and every 6 turns | `src/lib/constants/cabinetMechanicsTypes.ts` |
| Effect strength and per-metric cap | 1.25 and 0.08 | `src/lib/turn/ministerialOrderProcessing.ts` |
| Political-pipeline gate for the political snapshot | `isPoliticalApprovalCountry(countryId)` | `src/lib/politicalLegislation/politicalApprovalProvider.ts` |
| Phase round-trip budget for the `ministerialOrders` phase | 2000 | `src/simulation/engine/turnPhaseBudgets.ts` |

Scenario and era variants: the economy-reset wipe list includes `ministerialOrders`
(`src/lib/admin/economyReset/collections.ts`), so a reset clears all orders.
`ministerialOrders` is registered as a `runtime` collection in the seed manifest
(`src/lib/admin/seed/seedManifestRuntime.ts`), meaning seeds do not author it.

## Timing

`processMinisterialOrders` runs inside the `stateEffectsAndNationalAggregation` phase (`src/simulation/phases/stateEffectsPhase.ts`), as the `ministerialOrders` sub-phase. It runs after `crisisTurn`, `intelligenceTurn` and `navairOperations` and before `policyEffects`, `demographicEffects` and `metricDecay`, so the turn's order deltas are in the macro metrics before national aggregation (`nationalMetrics`), `inflationRecalc` and the metric history snapshot. The central bank's `policyInflationPressure` written here is read later in the same turn by the inflation recalculation (see [National Budget](./national-budget.md)).

The order of the serialized writers is deliberate: `crisisTurn` and `ministerialOrders` are pure `$inc` writers, and `policyEffects` is a read-modify-write that runs last so its read sees the crisis and order adjusted values (S4 audit note in `stateEffectsPhase.ts`).

```text
Issue (any time):  POST order -> spend 1 action -> insert into ministerialOrders

Turn, stateEffectsAndNationalAggregation (serialized writers):
  crisisTurn
    -> intelligenceTurn
    -> navairOperations
    -> ministerialOrders   expire, load, scale, merge, clamp
         |-- $inc macroMetrics (economic, population paths)
         |-- set centralBanks.policyInflationPressure (every bank)
         |-- snapshot politicalCabinetContribution (pipeline countries)
         `-- accrue actions when turn % 6 == 0
    -> policyEffects (read-modify-write, sees the order deltas)
  parallel: demographicEffects, metricDecay
Later in the same turn:
  nationalMetrics -> inflationRecalc (reads policyInflationPressure)
Next turn:
  politicalMetricsDynamics reads the snapshot (one turn lag)
```

Within `processMinisterialOrders` the order is: expire, load active orders, scale by statecraft, bucket by channel, route inflation pressure, merge and clamp, bulk `$inc`, then action accrual. Accrual happens only when `currentTurn % 6 == 0` (`isMinisterialAccrualTurn` wrapping `isOfficePoolAccrualTurn`, `src/lib/actions/officePoolAccrual.ts`), and each row stamps `lastMinisterialActionAccrualTurn` so a phase re-run is a no-op. Accrual is on the global turn clock, not a per-seat timer, so a seat that spends its last action regains one on the next multiple of 6, which is between 1 and 6 turns later.

An order issued during turn T (`currentTurn` T) first applies when turn T+1 is processed, and stops applying when the turn being processed reaches `issuedTurn + duration`.

## Worked trace

Input: a US Secretary of State with statecraft 8 issues Diplomatic Offensive
(`diplomatic_offensive`, `src/lib/countries/us/cabinet/orders.ts`: `economic.gdpGrowth`,
modifier +0.03, national, duration 24) while `currentTurn` is 1000. The post has 4 actions.

| Step | Calculation | Result |
| --- | --- | --- |
| Pool check | `ministerialActions` 4 >= 1 | passes |
| Spend | `$gte: 1` decrement | 3 left |
| Expiry stored | `computeMinisterialOrderExpiresTurn(1000, 24)` = 1000 + 24 | `expiresTurn` 1024 |
| Statecraft | `1 + (clamp(8, 1, 10) - 5.5) * 0.04` = 1 + 2.5 * 0.04 | 1.10 |
| Scaled modifier | 0.03 * 1.10 | 0.033 |
| Strength | 0.033 * 1.25 | 0.04125 |
| Cap | clamp(0.04125, -0.08, +0.08) | 0.04125 (under cap) |
| Span scale | `gdpGrowth` THRESHOLDS best 5, worst -3: `max(1, 8 / 100)` | 1 |
| Stored | `$inc` `economic.gdpGrowth.value` on every state of the country | +0.04125 per turn |

The order is active for turns 1001 to 1023 (expiry sweep deactivates it when turn
1024 is processed), which is 23 applications: 23 * 0.04125 = +0.94875 in total,
if nothing else stacks on that metric. Three such orders on the same metric sum to
0.033 * 3 * 1.25 = 0.12375 before clamping, so the 0.08 ceiling cuts them to 0.08
per turn.

Wide-span metric: a modifier of -0.02 on `publicSafety.crimeRate` (THRESHOLDS 1500 to
11000, span 9500, scale 95) at statecraft 5.5 gives -0.02 * 1.25 = -0.025, and
-0.025 * 95 = -2.375 per turn if it were written to a macro store
(`src/lib/turn/ministerialOrderProcessing.spanScale.test.ts`). `crimeRate` is a
political-family path, so in the live release this particular figure is the math
the test asserts, not a `$inc` onto `macroMetrics`.

## Edge cases and limits

- Action pool: capped at 4, gain +1 per 6 turns while below the cap. New appointments start full (`initialMinisterialActionFields` in `src/lib/cabinet/ministerialActionPool.ts`). A player can also buy +1 action for 10 main AP, once per pool per turn and never above the cap (`POST /api/country/[code]/office-pool/top-up`).
- UK player holders who hold two titles draw from one shared per-player pool, not one pool per title (`usesSharedMinisterialPool`, `ensureUkSharedPool`). NPP-held UK rows and all non-UK rows keep a per-row pool. A fresh row cannot lift a surviving balance: the shared pool is initialised from the minimum surviving row (`sharedPoolFromRows`).
- Same order twice: an already-active order with the same `orderId` on that position returns 409. A different order is allowed, so several orders can run at once; the 0.08 clamp is what bounds them.
- Regional orders without a `targetRegionId` are rejected with 400 before any action is spent. A failed insert refunds the action.
- Zero actions: the issuance route returns 400. The spend is an atomic `$gte: 1` decrement, so two simultaneous requests cannot spend the same action.
- Unmigrated ministers (no stat block) and orders with no resolvable issuer (NPP-issued, `characterId` null) use a 1.0x multiplier.
- Inflation pressure effects (`inflationPressure`, `inflationRate` leaves) go to `centralBanks.policyInflationPressure`, never to `stateMetrics`, whatever scope the order declares. Emergency orders are always stored as regional. Pressure is written for every bank each turn (0 when none), so an expired order clears its pressure. Banks shared across countries sum their member countries' pressure.
- Government change: when a transition clears the cabinet (`src/lib/cabinetTransition.ts`), every active order in that country is set inactive. The order lifecycle module has no per-seat hook, so an order issued by a minister who is replaced inside the same government keeps running until it expires; the statecraft multiplier then follows the original issuer's stat.
- Only the position holder (or an admin) can issue orders for that position. The PM or President cannot spend another post's actions.
- Legacy rows with a missing or string-typed `expiresTurn` are still expired by the second-pass sweep.
- A metric path outside the macro set is not `$inc`ed (see Rules, step 8 note). A regional effect without a `regionId` is dropped at turn time.
- A country with no states yields no `$inc` operations; a pipeline country with no effects still writes an empty snapshot so old residual decays.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| An action is never spent below zero | Atomic `$gte: 1` guard in `spendMinisterialAction`; covered by `src/lib/cabinet/ministerialActionPool.test.ts` |
| A failed order insert gives the action back | `refundMinisterialAction` in the route catch block; refund covered for the UK pool in `ministerialActionPool.test.ts`, not covered for the ordinary row path |
| No two active orders with the same `orderId` on one position | Route check only (409); not enforced by a unique index, so two simultaneous requests could in principle both pass the read |
| An order inactive once `turn >= issuedTurn + duration` | `expireMinisterialOrders` two-pass sweep; `src/lib/cabinet/ministerialOrderLifecycle.test.ts` and `src/lib/turn/ministerialOrderProcessing.test.ts` (bug #0761) |
| One metric moves at most 0.08 (times span scale) per turn from cabinet levers | `MAX_PER_METRIC_MODIFIER_PER_TURN`; `ministerialOrderProcessing.spanScale.test.ts` and `src/lib/turn/cabinetEffectPlateau.test.ts` |
| Accrual happens at most once per row per accrual turn | `lastMinisterialActionAccrualTurn` filter; accrual tests in `ministerialOrderProcessing.test.ts` and `ministerialActionPool.test.ts` |
| Action pool never exceeds the cap | `$lt` cap filter on accrual and the top-up block (`officePoolTopUpBlock`); `src/lib/actions/officePoolTopUp.test.ts` |
| Inflation-pressure effects never reach `stateMetrics` | Routing in the turn step; `ministerialOrderProcessing.test.ts` (PBoC stance case) |

## Failure and recovery

- Lost or stuck orders: a legacy or wrong-typed `expiresTurn` leaves an order active
  forever. The second-pass sweep catches this every turn; no manual step is needed.
- Order inserted but action not spent, or spent but no order: the route spends first
  and refunds on insert failure. A crash between spend and insert could still cost an
  action; the repair is a targeted data fix to the member's `ministerialActions`.
- Missing action fields on a cabinet row: the pool resolver backfills them on the next
  read, so a missing field does not lock a holder out.
- UK row mirror drift (one title shows a different balance): the next spend or accrual
  re-mirrors the shared pool to every row, and `reconcileUkSharedPool` recomputes it
  from the minimum row after an appointment change.
- A phase re-run in the same turn: expiry is idempotent, accrual is guarded by the
  per-row turn stamp, and effects are recomputed from the live order book, but the
  macro `$inc` is not guarded, so a re-run of the whole sub-phase adds a second tick.
  Repair is a data heal on the affected metrics.
- Wrong political snapshot after a cabinet change: the snapshot is rewritten every
  turn, so it self-corrects one turn after the order book changes.

## Connections

Driven by:

- [Cabinet](./cabinet.md): appointments set who holds an action pool and which orders a post offers (`availableOrders` in the country cabinet config).
- Character stats ([Player Progression](./player-progression.md)): the issuer's statecraft scales every order (`src/lib/stats/statMultiplier.ts`).
- [Turn Processing](./turn-processing.md): the `ministerialOrders` sub-phase and the accrual cadence.

Affects:

- [National Metrics](./national-metrics.md): order deltas are `$inc`ed onto `macroMetrics` and per-region metrics in the same turn they apply.
- [National Budget](./national-budget.md): inflation-pressure orders feed `centralBanks.policyInflationPressure`, read by `src/lib/budget/inflation.ts`.
- [Government Approval](./government-approval.md): political-pipeline countries get the national and regional deltas in `politicalCabinetContribution` for the approval dynamics step (`politicalMetricsDynamics`).

Related code:

- `src/lib/constants/cabinetMechanicsTypes.ts`, `MinisterialOrderConfig`,
  `MINISTERIAL_ACTION_CAP` (4), `DEFAULT_ORDER_DURATION` (24).
- `src/lib/cabinet/ministerialActionPool.ts`, `initialMinisterialActionFields()`,
  the legacy-member backfill used at issuance.
- [Cabinet](./cabinet.md), cabinet position structure, tier settings, regional
  targets (the other two cabinet levers, both persistent rather than order-timed).

## Tests

| Test file | Covers |
| --- | --- |
| `src/lib/cabinet/ministerialOrderLifecycle.test.ts` | Expiry computation, duration over stored `expiresTurn`, string coercion, active test |
| `src/lib/turn/ministerialOrderProcessing.test.ts` | Tier effect resolution, inflation routing, statecraft scaling, expiry (bug #0761), accrual on and off turns, political snapshot |
| `src/lib/turn/ministerialOrderProcessing.spanScale.test.ts` | Span scale and scaled cap math |
| `src/lib/turn/cabinetEffectPlateau.test.ts` | Applied step stays above the storage rounding grain (bug #0800) |
| `src/lib/cabinet/ministerialActionPool.test.ts` | UK shared pool spend, refund, accrual, reconcile, accrual cadence |
| `src/app/api/country/[code]/executive/cabinet/[positionId]/order/route.test.ts` | Emergency ids, null and legacy region payloads, missing target region |
| `src/lib/actions/officePoolTopUp.test.ts` | Action top-up rules |
| `src/lib/cabinetTransition.test.ts` | Cabinet clearing on government change |

Gaps: no test for the 409 duplicate-order path, the 403 non-holder path, the ordinary
row refund-on-insert-failure path, a multi-order stack hitting the 0.08 clamp end to
end, or the "replaced minister keeps the order running" behaviour.

## Known issues and history

- Orders issued by a minister who is later replaced inside the same government keep
  running (see Edge cases). No per-seat hook cancels them.
- The route reads `member` after an admin bypass without a null check, so an admin
  issuing an order for a vacant post is not handled as a clean 4xx.
- An emergency's `regionMetricThreshold` (for example crime rate above 5500) is checked
  in the office UI only; the issuance route does not re-check it. The emergency's
  optional `sideEffects` field is not read by the issuance route or the turn step.
- The `ministerialOrders` type allows NPP-issued orders (`isNPP`, `nppId`, null
  `characterId`), but no code path in this release writes them; only the 1.0x
  fallback multiplier handles them.
- Political-family order effects skip the 1.25 strength, the 0.08 cap and the span
  scale in this file; they are bounded later by the per-source residual cap
  (`CABINET_RESIDUAL_CAP_PER_SOURCE` = 8 in `src/lib/politicalMetrics/cabinetResidual.ts`).
- Player wiki example says a seat is back to full "after 12 turns"; accrual is on the
  global 6-turn clock, so the real time to regain depends on when the spend happened
  relative to the next multiple of 6.
- History recorded in code comments: bug #0571 introduced the per-turn cap (originally
  0.05); #0800 raised it to 0.08 and set the strength multiplier to 1.25; bug #0761
  added the two-pass expiry sweep; ticket #1129 split effects by channel; issue #2049
  added the shared UK action pool; the S4 audit (2026-07-16) serialized `crisisTurn`,
  `ministerialOrders` and `policyEffects`.

Last checked: 2026-10-29, version 1.18.0
