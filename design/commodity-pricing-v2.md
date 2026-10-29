# Commodity pricing v2 - design note

> **Historical migration plan:** The three-layer model has shipped. Use
> [Commodities](./commodities.md) and `src/lib/tariffs/tariffEffects.ts` for
> current behavior. Values below are retained as design history where noted.

## Goals

1. **Three supply/demand pools** drive implied prices: **global**, **state (regional)**, and **national** (aggregate of all real states in the same `countryId`).
2. **Blend weights** (same for price and margin logic where applicable):
   - At **T = 0** (no tariff stack): **50% global / 25% state / 25% national**.
   - At **T = 100** (full stack), shipped weights are **25% global / 25% state / 50% national**.
   - **Linear interpolation** in `T/100` between those endpoints (weights always sum to 1).
3. **T** = **full stacked** effective tariff signal used today for commodity blend pressure (same family of rules as `getTariffBlendWeights` / stacked layers - not economy-wide only).
4. **National layer** uses **summed** state S/D across the country; apply a **small** stabilizer floor on national supply/demand (much smaller than global’s `BASE_COMMODITY_SUPPLY_DEMAND`).
5. **Every real state** gets persisted **state-layer** price inputs (and implied state raw price); no “only states with sector activity.”
6. **Charts and corp margins** stay **consistent**: same three layers and the same weight formula relative to **T**.
7. **Rollout** (historical): shipped everywhere at once, with no long-lived feature flag.

## Storage model (no divergence)

**Problem:** Stacked **T** is per sector (and per corp for some scopes); a single blended scalar per state cannot match every corp.

**Solution:** Persist **three implied price components** (and sufficient S/D for charts), **not** one final blended price as the source of truth.

- **Global component** - one per commodity per turn (aligned with today’s global implied price).
- **National component** - per **countryId** per commodity (from national aggregated S/D).
- **State component** - per **stateId** per commodity (from state S/D).

**At read time** (corp turn, sector APIs, any consumer that needs “the price this actor faces”):

```
finalPrice = wG(T) × P_global + wR(T) × P_state + wN(T) × P_national(country)
```

Use the **actor’s own stacked `T`** (sector + presence keys + corp where relevant).

**Public / anonymous reads** (e.g. commodity page with no sector): define and document a **default `T`** (e.g. `0`, or policy-linked national stack) - must be explicit in UI or API.

### Legacy field

Existing **`statePrices[stateId]`** on `commodityPrices` (and history) may remain as a **denormalized cache** for one turn during migration (e.g. blend at `T = 0` for backward compatibility), then remove or stop writing once all readers use components + blend.

## Weight formulas

Let `α = clamp(T, 0, 100) / 100`.

- `wG = 0.5 − 0.25α`
- `wR = 0.25` (fixed)
- `wN = 0.25 + 0.25α`

Check: `α = 0` → `0.5, 0.25, 0.25`; `α = 1` → `0.25, 0.25, 0.5`. Source: `getTariffBlendWeights` in `src/lib/tariffs/tariffEffects.ts`.

## Turn processing

- **Compute** `P_global`, `P_national(countryId)`, `P_state(stateId)` from respective S/D using the same `computeMarketPrice` / ratio machinery as today (with national’s **tiny** floor only on the national ratio path).
- **Drift / pegs / nudges:** Apply in the same **precedence order** as today, ideally **per layer** or only on the blended output - **decide in implementation** and document invariants (admin pegs must remain predictable).

## Where data lives today

- **`commodityPrices`** - one document per commodity: `globalPrice`, `globalSupply`, `globalDemand`, `statePrices`, `stateSupply`, `stateDemand`, etc. (`src/lib/turn/commodityPriceTurn.ts`)
- **`commodityPriceHistory`** - per commodity per turn snapshots for charts
- Types: `src/lib/db/types/commodityPrice.ts`, `commodityPriceHistory.ts`

v2 adds fields (exact names TBD) for **national** S/D and/or implied national price by `countryId`, and **explicit** global/state component prices if not already inferable from existing fields.

## Implementation checklist (high level)

1. Extend types + `processCommodityPriceTurn` to compute and write **national aggregates** and **three-layer implied prices** (+ national stabilizer constant in `commodities.ts`).
2. Historical: this shipped as **`getTariffBlendWeights`** in `src/lib/tariffs/tariffEffects.ts`, returning `globalWeight`, `nationalWeight` and `localWeight`; wire **stacked `T`** from existing tariff resolution.
3. Replace any **single** blended price used for corp economics with **blend at read time** from components + **`T`**.
4. Update **`computeBlendedMarginModifiers`** (or successor) to **three** balance maps / three modifier paths, blended with the **same** `(wG, wR, wN)` for that sector’s **`T`**.
5. Grep consumers of `statePrices` / `globalPrice` for “final price”; migrate to component + blend.
6. Update **commodity APIs**, **detail page**, **guides**, and **`commodities.md`** when behavior is live.
7. **`npm run verify`**; add/adjust tests in `commodityPriceTurn.test.ts`, sector/margin tests, and any API integration tests.

## Related code (starting points)

- `src/lib/turn/commodityPriceTurn.ts` - persistence
- `src/lib/constants/commodities.ts` - `computeMarketPrice`, `computeRawSupplyDemand`, margin modifiers
- `src/lib/tariffs/tariffEffects.ts` - stacked tariff / blend rate inputs
- `src/lib/turn/corporation/sectorCalculations.ts` - corp-facing commodity pressure
- `src/app/api/corporations/[id]/sectors/[sectorId]/route.ts` - strategy / preview (must match turn)

## Open implementation details

Historical: these were open during design and are resolved in the shipped code.

- Exact **field names** and whether **history** stores full national maps or deltas.
- **Peg/nudge** semantics when only one layer is pegged.
- **Default `T`** for public commodity views.

---

_See also: [commodities](./commodities.md) - current shipped behavior._
