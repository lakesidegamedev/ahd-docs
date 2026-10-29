# Resources & Extraction Contracts

Extractable resources model sovereign ownership of natural wealth. States hold an extraction capacity ceiling (a daily basis, not a fixed per-turn amount); corporations can hold exclusive contracts granting them a share of that capacity. Uncontracted capacity flows freely to all extraction sectors in the state.

Player guides: [Resources](https://www.ahousedividedgame.com/wiki/resources-overview) and [Extraction Contracts](https://www.ahousedividedgame.com/wiki/extraction-contracts).

## Extractable Resources

Six resources can be extracted, defined by `EXTRACTABLE_RESOURCES` in `src/lib/constants/commodities.ts`:

| Resource    | Unit  | Typical role                                                                                        |
| ----------- | ----- | --------------------------------------------------------------------------------------------------- |
| Oil         | bbl   | Energy sector primary input                                                                         |
| Coal        | tons  | Energy / industrial input                                                                           |
| Iron        | tons  | Industrial / construction input                                                                     |
| Natural Gas | MMBtu | Energy sector input                                                                                 |
| Timber      | m³    | Construction / paper input                                                                          |
| Rare Earth  | tons  | Tech sector strategic input; merged commodity (copper + rare earth minerals, demand-weighted blend) |

These are a subset of the 27 commodity types tracked in the commodity pricing engine (`docs/design/commodities.md`, `COMMODITY_TYPES` in `src/lib/constants/commodities.ts`). Standard commodities (steel, electronics, etc.) have no extraction capacity model. Copper is not a separate extractable resource; it was folded into `rare_earth`.

## Capacity Model

Each state holds a `stateResourceCapacity` document specifying, per resource, the maximum extraction output ceiling in commodity units on a **daily** basis (the same basis as `sector.revenue` and `capitalStock`; a turn is a fraction of a day on the money timescale, so reading this as units/turn overstates the ration). Values are seeded from real-world production benchmarks and are updated via the admin panel.

```
stateResourceCapacity: {
  stateId: "TX",
  countryId: "US",
  resources: { oil: 300_000, natural_gas: 1_500_000, coal: 10_000, ... }
}
```

Every seeded state receives a capacity document. States without authored
deposits receive an empty `resources` map, which gives them zero extraction
capacity. Only a truly missing document uses the compatibility fallback of
uncapped output.

**Capacity is not strictly fixed over time.** R&D breakthroughs for extraction corps permanently `$inc` per-resource capacity on the sector's state (see `docs/design/corporations.md` → "R&D Budget & Innovation"). The increase is weighted by the sector's active strategy supply map, so `oil_gas` breakthroughs grow oil + natural gas, `iron_mining` grows iron only, etc. This is by design: R&D "unlocks new deposits." States with no capacity document are still skipped: the innovation phase does not auto-insert docs.

## Extraction Contracts

A contract grants a named corporation an exclusive share (0% to 100%) of a state's capacity for a specific resource:

```
extractionContract: {
  stateId, countryId, corporationId, resource,
  share: 0.5,           // fraction of state capacity reserved
  grantedTurn, grantedBy, grantedByLevel: "state" | "national",
  revokedTurn?: number  // absent = active; set = revoked
}
```

- **Player offers:** use offer and acceptance, royalties, and a 75% total-share headroom cap.
- **Admin grants:** the direct admin POST path can over-allocate beyond 100%; the open-access pool then collapses to zero.
- **Revocation:** soft-delete via `revokedTurn`. Revoked contracts are excluded from all queries (`revokedTurn: { $exists: false }`).

## Turn Processing Integration

Each turn in `commodityPriceTurn.ts`:

1. Fetch `stateResourceCapacity` docs for all states with extraction sectors.
2. Fetch active contracts (non-revoked).
3. For each extraction sector, compute revenue-based output per resource.
4. Call `computeExtractionCapacityMultipliers()` → `Map<sectorId, Map<resource, 0.0 to 1.0>>`.
5. Apply multipliers inside `computeRawSupplyDemand()`: only extraction sectors, only extractable resources.
6. Resulting supply feeds the global commodity price update.

**Multiplier rules (per state, per resource):**

- Contract holders are capped to `totalCapacity × share`. If output < cap → multiplier = 1 (not capped).
- Open-access pool = `totalCapacity × (1 − Σ contractedShares)`. If total open-access demand ≤ pool → multiplier = 1; otherwise proportional squeeze.
- Over-allocated states: open-access pool = 0, all uncontracted sectors produce nothing for that resource.
- A truly missing capacity doc uses multiplier 1 for compatibility. A normally seeded empty resource map has zero capacity.

## Contract Lifecycle

```
Issuer offers → counterparty accepts → extractionContracts insert (grantedTurn = currentTurn)
  └─ effective on next turn's commodity price run
  (offers + active share capped at 75% of capacity; src/lib/extraction/commands/)

Admin direct grant → extractionContracts insert (may over-allocate)

Revoked → soft-delete (revokedTurn = currentTurn)
  └─ excluded from multiplier computation on next turn
```

## API Routes

| Method | Route                                    | Auth   | Purpose                                |
| ------ | ---------------------------------------- | ------ | -------------------------------------- |
| GET    | `/api/contracts/extraction`              | Public | List active contracts (filterable)     |
| POST   | `/api/contracts/extraction`              | Admin  | Grant a contract                       |
| DELETE | `/api/contracts/extraction/[id]`         | Admin  | Revoke a contract (soft delete)        |
| GET    | `/api/states/[id]/resources`             | Public | State capacity + contracts + output    |
| GET    | `/api/map/resources`                     | Public | Country-wide choropleth data           |
| GET    | `/api/admin/resource-capacity`           | Admin  | List all capacity docs                 |
| PATCH  | `/api/admin/resource-capacity/[stateId]` | Admin  | Set/update a state's resource capacity |

**GET /api/contracts/extraction** query params: `stateId`, `corporationId`, `resource`, `countryId`.

**Admin direct-grant path:** `POST /api/contracts/extraction` can create a
contract directly and is the only path that may over-allocate. Player-created
contracts use the offer and acceptance commands instead.

Body:

```json
{
  "stateId": "TX",
  "corporationId": "<24-char ObjectId>",
  "resource": "oil",
  "share": 0.5,
  "grantedBy": "<legislature ID>",
  "grantedByLevel": "state" | "national",
  "force": false
}
```

If the new contract would over-allocate and `force` is false, the server returns **409** with `{ overAllocated: true, needsConfirmation: true }` without inserting. The client must re-submit with `force: true` to proceed.

## UI Surfaces

| Surface                         | Location                                    | Read                              | Admin actions  |
| ------------------------------- | ------------------------------------------- | --------------------------------- | -------------- |
| State Resources tab             | `/country/[code]/region/[id]?tab=resources` | Capacity + contracts + output     | Grant / Revoke |
| Corporation Contracts section   | `/corporation/[id]`                         | Own contracts                     | -              |
| National Congress Contracts tab | `/country/[code]/congress?tab=contracts`    | Country contracts                 | Grant / Revoke |
| Country map Resources mode      | `/country/[code]/map`                       | Choropleth by capacity/allocation | -              |

## Key Files

- `src/lib/db/types/extractionContract.ts`: Contract document type
- `src/lib/db/types/stateResourceCapacity.ts`: Capacity document type
- `src/lib/db/collections/extractionContracts.ts`: Collection getter
- `src/lib/db/collections/stateResourceCapacity.ts`: Collection getter
- `src/lib/constants/commodities.ts`: `EXTRACTABLE_RESOURCES`, `ExtractableResource`
- `src/lib/turn/extraction/extractionCapacity.ts`: Multiplier computation (7 unit tests)
- `src/lib/turn/commodityPriceTurn.ts`: Integration point (extraction capacity block starts ~line 546)
- `src/app/api/contracts/extraction/route.ts`: GET + POST
- `src/app/api/contracts/extraction/[id]/route.ts`: DELETE
- `src/components/congress/GrantContractModal.tsx`: Grant form (over-allocation confirmation flow)
- `src/components/state/StatePageTabsResources.tsx`: State resources UI with admin grant/revoke
- `scripts/seeds/stateResourceCapacity.ts`: CLI wrapper for the capacity seed; data lives in `src/lib/seeds/reference/stateResourceCapacity.ts` (unlisted states default to zero capacity for every resource)

## Rules and constants

| Constant | Value | Source |
| --- | --- | --- |
| `GOVT_CONTRACT_MAX_TOTAL_SHARE` | 0.75 (total of offered plus active contract share per state and resource) | `src/lib/constants/prospecting.ts` |
| `CONTRACT_SHARE_MIN` | 0.01 | `src/lib/constants/prospecting.ts` |
| `CONTRACT_SHARE_MAX` | 0.75 | `src/lib/constants/prospecting.ts` |
| `CONTRACT_ROYALTY_RATE_MIN` / `MAX` | 0 / 0.02 (fraction of contracted capacity market value per turn) | `src/lib/constants/prospecting.ts` |
| `CONTRACT_TERM_TURNS_MIN` / `MAX` | 24 / 480 turns | `src/lib/constants/prospecting.ts` |
| `CONTRACT_OFFER_EXPIRY_TURNS` | 24 turns | `src/lib/constants/prospecting.ts` |
| `CONTRACT_DEFAULT_MISSED_PAYMENTS` | 3 missed royalty payments trigger default | `src/lib/constants/prospecting.ts` |
| `PROSPECT_DURATION_TURNS` | 6 | `src/lib/constants/prospecting.ts` |
| `PROSPECT_YIELD_MIN` / `MAX` | 0.03 / 0.08 of current capacity | `src/lib/constants/prospecting.ts` |
| `PROSPECT_MAX_GAIN_FRACTION` | 0.2 of current capacity per survey | `src/lib/constants/prospecting.ts` |
| `PROSPECT_MAX_ACTIVE_PER_INITIATOR` | 6 | `src/lib/constants/prospecting.ts` |
| Extractable resources | 6 | `EXTRACTABLE_RESOURCES`, `src/lib/constants/commodities.ts` |
| Commodity types tracked | 27 | `COMMODITY_TYPES`, `src/lib/constants/commoditiesCore.ts` |

Prospecting surveys (`src/lib/extraction/commands/launchCorpProspect.ts`, `launchGovernmentProspect.ts`) are how capacity grows beyond the seed and R&D; the 75% total-share ceiling exists so open-access extractors are never fully crowded out. Worked example: a state with 300,000 bbl of oil capacity and one contract at share 0.5 holds 150,000 bbl for the contract holder and leaves an open pool of 150,000 bbl. If open-access demand is 200,000 bbl the open sectors are squeezed to a multiplier of 0.75.

## Timing

Extraction caps are applied in the `commodityPrices` phase (`processCommodityPriceTurn`, `src/lib/turn/commodityPriceTurn.ts`, registered in `src/simulation/phases/turnPhaseRegistry.ts`). Contracts are read at the start of that phase, so a contract granted or revoked during turn N is effective in turn N+1. The multipliers feed `computeRawSupplyDemand`, which produces the supply side of that turn's commodity price update. Offer expiry, royalty payment and default are handled by the extraction commands (`src/lib/extraction/commands/`), outside the price pass.

## Edge cases and limits

- **No capacity document.** The compatibility fallback is multiplier 1 (uncapped). A seeded state with an empty `resources` map has capacity 0 and cannot extract.
- **Over-allocation.** Only the admin direct-grant path can exceed 100%; the open pool then reads 0 and uncontracted sectors produce nothing for that resource. Player offers cannot exceed the 75% ceiling.
- **Output below cap.** A contract holder producing less than `totalCapacity x share` has multiplier 1.
- **Revoked contracts.** Soft deleted, excluded from all queries; share returns to the open pool next turn.
- **Non-extraction sectors and non-extractable commodities** are never touched by the multipliers.
- **R&D growth.** Capacity increases only for states that already have a capacity document.
- **Unit basis.** Capacity is documented on a daily basis like `sector.revenue`; the seed file header describes the same figure as a per-turn ceiling. The code path was not traced to settle which; treat the daily reading as the engine's convention.

## Connections

**Driven by**
- [Corporations](./corporations.md): extraction sector output and R&D breakthroughs raise state capacity (`$inc` on `stateResourceCapacity`).
- [Bills & Legislation](./bills-legislation.md) and congress contract tabs: government contract offers (`src/lib/extraction/commands/issueContractOffer.ts`).

**Affects**
- [Commodities](./commodities.md): capped supply feeds the global price update (`src/lib/turn/commodityPriceTurn.ts`).
- [Corporations](./corporations.md): royalties are paid to the issuer and count as `revenue.resourceRoyalties` (`acceptContractOffer.ts`).
- [Subsidies](./subsidies.md) and [Tariffs](./tariffs.md): sibling resource-sector levers.

## Related Systems

- [Commodities](./commodities.md): Pricing engine that consumes extraction output
- [Corporations](./corporations.md): Sectors that produce commodity supply; extraction sectors are the direct consumers of contracts

Last checked: 2026-10-29, version 1.18.0
