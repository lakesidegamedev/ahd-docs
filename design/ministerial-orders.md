# Ministerial Orders

Design doc for the ministerial order lifecycle: issuance, active-window tracking,
expiry, and per-turn effect application. Ministerial orders are the discretionary
lever cabinet-position holders spend ministerial actions on, distinct from tier
settings and regional targets (also cabinet levers, but persistent rather than
timed).

Player guide: [Cabinet](https://www.ahousedividedgame.com/wiki/cabinet) (see also [Cabinet Guide](https://www.ahousedividedgame.com/wiki/cabinet-guide) for the orders each post can issue).

**Lifecycle location:** `src/lib/cabinet/ministerialOrderLifecycle.ts`
**Issuance route:** `POST /api/country/[code]/executive/cabinet/[positionId]/order`
**Turn application:** `src/lib/turn/ministerialOrderProcessing.ts`

## Data model

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

Collection: `getMinisterialOrdersCollection(db)`
(`src/lib/db/collections/cabinetSettings.ts`).

`DEFAULT_ORDER_DURATION = 24` turns (one game half-year), `src/lib/constants/cabinetMechanicsTypes.ts`.

## Expiry resolution

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
`expiresTurn`, then to `issuedTurn + DEFAULT_ORDER_DURATION` as a last resort.

## Expiry sweep

```typescript
export async function expireMinisterialOrders(
  db: Db,
  currentTurn: number
): Promise<{ expired: number }>
```

Runs a two-pass sweep every turn (bug #0761 fix, legacy rows with missing or
string-typed `expiresTurn` were lingering `active: true` forever under a single
typed-query pass):

1. **Fast path:** `updateMany({ active: true, expiresTurn: { $lte: currentTurn } })`
, catches every well-typed row in one query.
2. **Stale sweep:** fetches all remaining `active: true` docs, recomputes expiry via
   `resolveMinisterialOrderExpiresTurn` for each, and force-deactivates any that
   should have expired but didn't match the fast-path filter (wrong type, missing
   field).

Also called defensively at order-issuance time (see below), so a stale still-active
row from a prior turn cannot block a fresh order of the same type from being issued.

## Issuance

`POST /api/country/[code]/executive/cabinet/[positionId]/order`, auth: cabinet
holder for that position, or admin.

1. Resolve `mechanics` and `availableOrders` for the country/position; 404 if the
   position or order config is unknown.
2. Regional-scope orders require a `targetRegionId`, rejected up front with 400
   (`"Select a target region"`) rather than silently dropping the effect at turn
   time, since the turn engine only applies regional effects that carry a
   `regionId`.
3. Auth check: `member.characterId` must match the caller's character, or the caller
   is admin.
4. Backfill legacy `cabinetMembers` docs missing `ministerialActions` /
   `lastMinisterialActionResetDay`, pre-fix nominations and admin force-confirms
   could insert members without these fields, which silently fails the atomic
   `$gte: 1` spend below (Mongo doesn't match `$gte` against a missing field).
5. Action-pool check: `member.ministerialActions >= 1`, else 400.
6. `expireMinisterialOrders(db, currentTurn)` runs first, then the route checks for
   an already-active order of the same `orderId` on that position, 409 if found.
7. Atomically decrement `ministerialActions` via `updateOne({ ministerialActions:
   { $gte: 1 } })`; 409 on race-lost spend.
8. Insert the order document with `expiresTurn: computeMinisterialOrderExpiresTurn
   (currentTurn, orderConfig.duration)`. On insert failure, the spent action is
   refunded (`$inc: { ministerialActions: 1 }`) before the error is rethrown.

Emergency orders (`emergencyOrderId = "emergency_" + positionId`) are a special
config synthesized from `mechanics.emergency` rather than looked up in
`availableOrders`; their effects are always `scope: "regional"`.

## Per-turn effect application

`processMinisterialOrders(currentTurn)` (`src/lib/turn/ministerialOrderProcessing.ts`)
runs every turn, all countries:

1. Expire completed orders (`expireMinisterialOrders`).
2. Fetch all `active: true` orders.
3. **Statecraft scaling:** each order's effect magnitude is scaled by the issuing
   minister's `statecraft` stat via `statMultiplier()` (gentle ±20%), read once per
   issuing character. Unmigrated ministers (no stat block) and orders with no
   resolvable issuer default to 1.0×.
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

## Rules

| Constant | Value | Source |
| --- | --- | --- |
| `DEFAULT_ORDER_DURATION` | 24 turns | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `MINISTERIAL_ACTION_CAP` | 4 actions banked per position | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `MINISTERIAL_ACTION_ACCRUAL_TURNS` | +1 action every 6 turns (4 per game day) | `src/lib/constants/cabinetMechanicsTypes.ts` |
| `CABINET_EFFECT_STRENGTH` | 1.25 multiplier on the merged order effect | `src/lib/turn/ministerialOrderProcessing.ts` |
| `MAX_PER_METRIC_MODIFIER_PER_TURN` | 0.08 per metric per turn, either sign | `src/lib/turn/ministerialOrderProcessing.ts` |
| `EFFICACY_PIVOT` / `EFFICACY_SLOPE` | 5.5 / 0.04 | `src/lib/stats/statsConstants.ts` |

Order cost is 1 ministerial action. Statecraft multiplier:
`statMultiplier(stat) = 1 + (clamp(stat, 1, 10) - 5.5) * 0.04` (`src/lib/stats/statMultiplier.ts`),
so stat 1 gives 0.82x, stat 5.5 gives 1.0x, stat 10 gives 1.18x.

Per-turn effect on one metric, summed over all active orders in a country:

```
applied = clamp(sum(modifier * statMultiplier(issuer.statecraft)) * 1.25, -0.08, +0.08)
          * modifierSpanScale(metric)
```

`modifierSpanScale` is `max(1, |THRESHOLDS.worst - THRESHOLDS.best| / 100)` for the metric (`src/lib/turn/ministerialOrderProcessing.ts`), so a 0-100 authored modifier registers on a metric with a larger real-unit range.

Worked example: a minister with statecraft 8 (multiplier 1.10) issues an order with a +0.03 modifier on a 0-100 metric. Per turn the effect is 0.03 * 1.10 * 1.25 = 0.04125, under the 0.08 clamp, applied for 24 turns, about +0.99 in total if nothing else stacks on that metric. Three such orders on the same metric sum to 0.12375 before clamping, so the 0.08 ceiling cuts them to 0.08 per turn.

Why 24 turns: one game half-year (48 turns per year), long enough that an order is a real commitment, short enough that a minister must keep spending actions to hold a policy.

## Timing

`processMinisterialOrders` runs inside the `stateEffectsAndNationalAggregation` phase (`src/simulation/phases/stateEffectsPhase.ts`), as the `ministerialOrders` sub-phase. It runs after `crisisTurn`, `intelligenceTurn` and `navairOperations` and before `policyEffects`, `demographicEffects` and `metricDecay`, so the turn's order deltas are in the macro metrics before national aggregation (`nationalMetrics`), `inflationRecalc` and the metric history snapshot. The central bank's `policyInflationPressure` written here is read later in the same turn by the inflation recalculation (see [National Budget](./national-budget.md)).

Within `processMinisterialOrders` the order is: expire, load active orders, scale by statecraft, bucket by channel, route inflation pressure, merge and clamp, bulk `$inc`, then action accrual. Accrual happens only when `currentTurn % 6 == 0` (`isOfficePoolAccrualTurn`, `src/lib/actions/officePoolAccrual.ts`), and each row stamps `lastMinisterialActionAccrualTurn` so a phase re-run is a no-op.

## Edge cases and limits

- Action pool: capped at 4, gain +1 per 6 turns while below the cap. New appointments start full (`initialMinisterialActionFields` in `src/lib/cabinet/ministerialActionPool.ts`).
- UK player holders who hold two titles draw from one shared per-player pool, not one pool per title (`usesSharedMinisterialPool`, `ensureUkSharedPool`). NPP-held UK rows and all non-UK rows keep a per-row pool.
- Same order twice: an already-active order with the same `orderId` on that position returns 409. A different order is allowed, so several orders can run at once; the 0.08 clamp is what bounds them.
- Regional orders without a `targetRegionId` are rejected with 400 before any action is spent. A failed insert refunds the action.
- Zero actions: the issuance route returns 400. The spend is an atomic `$gte: 1` decrement, so two simultaneous requests cannot spend the same action.
- Unmigrated ministers (no stat block) and orders with no resolvable issuer (NPP-issued, `characterId` null) use a 1.0x multiplier.
- Inflation pressure effects (`inflationPressure`, `inflationRate` leaves) go to `centralBanks.policyInflationPressure`, never to `stateMetrics`, whatever scope the order declares. Emergency orders are always stored as regional.
- Government change: when a transition clears the cabinet (`src/lib/cabinetTransition.ts`), every active order in that country is set inactive. The order lifecycle module has no per-seat hook, so an order issued by a minister who is replaced inside the same government keeps running until it expires; the statecraft multiplier then follows the original issuer's stat.
- Only the position holder (or an admin) can issue orders for that position. The PM or President cannot spend another post's actions.
- Legacy rows with a missing or string-typed `expiresTurn` are still expired by the second-pass sweep.

## Connections

Driven by:

- [Cabinet](./cabinet.md): appointments set who holds an action pool and which orders a post offers (`availableOrders` in the country cabinet config).
- Character stats ([Player Progression](./player-progression.md)): the issuer's statecraft scales every order (`src/lib/stats/statMultiplier.ts`).
- [Turn Processing](./turn-processing.md): the `ministerialOrders` sub-phase and the accrual cadence.

Affects:

- [National Metrics](./national-metrics.md): order deltas are `$inc`ed onto `macroMetrics` and per-region metrics in the same turn they apply.
- [National Budget](./national-budget.md): inflation-pressure orders feed `centralBanks.policyInflationPressure`, read by `src/lib/budget/inflation.ts`.
- [Government Approval](./government-approval.md): political-pipeline countries get the national and regional deltas in `politicalCabinetContribution` for the approval dynamics step (`politicalMetricsDynamics`).

## Related systems

- `src/lib/constants/cabinetMechanicsTypes.ts`, `MinisterialOrderConfig`,
  `MINISTERIAL_ACTION_CAP` (4), `DEFAULT_ORDER_DURATION` (24).
- `src/lib/cabinet/ministerialActionPool.ts`, `initialMinisterialActionFields()`,
  the legacy-member backfill used at issuance.
- `docs/design/cabinet.md`, cabinet position structure, tier settings, regional
  targets (the other two cabinet levers, both persistent rather than order-timed).

Last checked: 2026-10-29, version 1.18.0
