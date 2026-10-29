# Resources & Extraction Contracts

## Summary

Extractable resources model sovereign ownership of natural wealth. States hold an extraction capacity ceiling (a daily basis, not a fixed per-turn amount); corporations can hold exclusive contracts that reserve a share of that capacity. Uncontracted capacity flows to all extraction sectors in the state, and a contract holder that wants more than its reserved share competes for that open pool too.

Player guides: [Resources](https://www.ahousedividedgame.com/wiki/resources-overview) and [Extraction Contracts](https://www.ahousedividedgame.com/wiki/extraction-contracts).

## Rules

### Extractable resources

Six resources can be extracted, defined by `EXTRACTABLE_RESOURCES` in `src/lib/constants/commoditiesCore.ts`:

| Resource    | Unit  | Typical role                                                                                        |
| ----------- | ----- | --------------------------------------------------------------------------------------------------- |
| Oil         | bbl   | Energy sector primary input                                                                         |
| Coal        | tons  | Energy / industrial input                                                                           |
| Iron        | tons  | Industrial / construction input                                                                     |
| Natural Gas | MMBtu | Energy sector input                                                                                 |
| Timber      | m3    | Construction / paper input                                                                          |
| Rare Earth  | tons  | Tech sector strategic input; merged commodity (copper + rare earth minerals, demand-weighted blend) |

These are a subset of the 27 commodity types tracked in the commodity pricing engine ([Commodities](./commodities.md), `COMMODITY_TYPES` in `src/lib/constants/commoditiesCore.ts`). Standard commodities (steel, electronics, etc.) have no extraction capacity model. Copper is not a separate extractable resource; it was folded into `rare_earth`.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `GOVT_CONTRACT_MAX_TOTAL_SHARE` | 0.75 (total of offered plus active contract share per state and resource) | `src/lib/constants/prospecting.ts` |
| `CONTRACT_SHARE_MIN` / `CONTRACT_SHARE_MAX` | 0.01 / 0.75 | `src/lib/constants/prospecting.ts` |
| `CONTRACT_ROYALTY_RATE_MIN` / `MAX` | 0 / 0.02 (fraction of contracted capacity market value per turn) | `src/lib/constants/prospecting.ts` |
| `CONTRACT_TERM_TURNS_MIN` / `MAX` | 24 / 480 turns | `src/lib/constants/prospecting.ts` |
| `CONTRACT_OFFER_EXPIRY_TURNS` | 24 turns | `src/lib/constants/prospecting.ts` |
| `CONTRACT_DEFAULT_MISSED_PAYMENTS` | 3 missed royalty payments trigger default | `src/lib/constants/prospecting.ts` |
| `PROSPECT_DURATION_TURNS` | 6 (scaled by era through `prospectEraScaling`) | `src/lib/constants/prospecting.ts` |
| `PROSPECT_YIELD_MIN` / `MAX` | 0.03 / 0.08 of current capacity | `src/lib/constants/prospecting.ts` |
| `PROSPECT_MAX_GAIN_FRACTION` | 0.2 of current capacity per survey | `src/lib/constants/prospecting.ts` |
| `PROSPECT_MAX_ACTIVE_PER_INITIATOR` | 6 | `src/lib/constants/prospecting.ts` |
| `DEPOSIT_RESERVE_TURNS` | 1,920 (40 game years x 48 turns) | `src/lib/extraction/depletion.ts` |
| `EXTRACTION_CAPACITY_HAIRCUT_TURNS` | 240 (fade-in window for the revenue haircut) | `src/lib/extraction/capacityHaircut.ts` |
| `EXTRACTION_CAPACITY_HAIRCUT_FLOOR` | 0.5 (worst case realized factor) | `src/lib/extraction/capacityHaircut.ts` |
| `RAMP_REANCHOR_DELTA` | 0.25 (a one-turn utilization drop that restarts the ramp) | `src/lib/extraction/capacityHaircut.ts` |
| `EXTRACTION_UTILIZATION_MAX_RISE_PER_TURN` | 0.05 (module-private; falls apply at once) | `src/lib/extraction/capacityHaircut.ts` |
| `CAPACITY_BINDING_THRESHOLD` | 0.9 (display and alerts) | `src/lib/extraction/capacityHaircut.ts` |
| Scarcity relief | full relief at world supply/demand 0.5 or below, none at 1.0 or above, linear between | `haircutScarcityRelief`, `src/lib/extraction/capacityHaircut.ts` |
| Extractable resources | 6 | `EXTRACTABLE_RESOURCES` |
| Commodity types tracked | 27 | `COMMODITY_TYPES` |

### Capacity model

Each state holds a `stateResourceCapacity` document specifying, per resource, the maximum extraction output ceiling in commodity units on a **daily** basis (the same basis as `sector.revenue` and `capitalStock`; a turn is a fraction of a day on the money timescale, so reading this as units/turn overstates the ration). Values are seeded from real-world production benchmarks and are updated via the admin panel.

```
stateResourceCapacity: {
  stateId: "TX",
  countryId: "US",
  resources: { oil: 300_000, natural_gas: 1_500_000, coal: 10_000, ... }
}
```

Every seeded state receives a capacity document. States without authored deposits receive an empty `resources` map, which gives them zero extraction capacity. Only a truly missing document uses the compatibility fallback of uncapped output.

**Capacity is not strictly fixed over time.** R&D breakthroughs for extraction corps permanently `$inc` per-resource capacity on the sector's state (see [Corporations](./corporations.md), "R&D Budget & Innovation"). The increase is weighted by the sector's active strategy supply map, so `oil_gas` breakthroughs grow oil + natural gas, `iron_mining` grows iron only, etc. This is by design: R&D "unlocks new deposits." States with no capacity document are still skipped: the innovation phase does not auto-insert docs. Prospecting surveys (`src/lib/extraction/commands/launchCorpProspect.ts`, `launchGovernmentProspect.ts`) also raise capacity beyond the seed.

### Deposit depletion (plants tier only)

On worlds running the plants market tier, deposits are finite. Reserves are derived, not stored:

```
reserves(r)  = resources[r] x DEPOSIT_RESERVE_TURNS
remaining(r) = max(0, reserves(r) - extractedUnits[r])
ceiling(r)   = min(resources[r], remaining(r))
```

The ceiling only binds at the end of a field's life, so a deposit tapers off over its last turns. A prospecting survey that lifts `resources[r]` lifts derived reserves by the same multiple. Below the plants tier the raw documents are used and nothing is booked (`depletedCapacityDoc` is never called).

### Extraction contracts

A contract grants a named corporation an exclusive share (0% to 100%) of a state's capacity for a specific resource:

```
extractionContract: {
  stateId, countryId, corporationId, resource,
  share: 0.5,           // fraction of state capacity reserved
  grantedTurn, grantedBy, grantedByLevel: "state" | "national",
  revokedTurn?: number  // absent = active; set = revoked
}
```

- **Player offers:** use offer and acceptance, a signing fee, per-turn royalties, and a 75% total-share headroom cap (offered plus active, any issuer, no override). Which government level may issue is set by the Resource Extraction Authority Act (`src/lib/extraction/contractAuthority.ts`; national only by default, or both, or state only). The corporation must operate in the state.
- **Admin grants:** the direct admin POST path can over-allocate beyond 100%; the open-access pool then collapses to zero.
- **Revocation:** soft-delete via `revokedTurn`. Revoked contracts are excluded from all queries (`activeExtractionContractFilter`).
- **Combined concessions.** Multiple active contracts for the same company, state and resource add together (`indexContractShares`, `src/lib/extraction/rules/contractShares.ts`), and all of the company's sectors share that one allocation.

### Capacity multipliers

`computeExtractionCapacityMultipliers` (`src/lib/turn/extraction/extractionCapacity.ts`) returns `Map<sectorId, Partial<Record<resource, 0..1>>>`. Per state and resource, with `C` the capacity and `S` the sum of contracted shares:

```
openPool      = max(0, C x (1 - S))
for each contracted company:
  desired     = sum of its sectors' desired output (revenue-based output, capped by plantOutputCap where present)
  allocated   = min(desired, C x share)
  residual    = desired - allocated (spread over its sectors pro rata)
OA demand     = sum of open-access outputs + contracted residuals
poolFill      = 0 if openPool <= 0 or OA demand <= 0, else min(1, openPool / OA demand)
multiplier    = min(1, (reserved units + residual x poolFill) / output)
```

A lease is a **reserved floor, not a ceiling**: what a holder wants beyond its reserved share competes for the open pool on the same terms as everyone else (ticket 1619). Other branches:

- No capacity document: multiplier 1 (compatibility).
- `C <= 0` for the resource: multiplier 0.
- A sector with zero desired output gets 1, except 0 when the pool is empty and its company holds no reservation.
- Plants only: `fullOutputMultipliers` re-expresses multipliers against full output so the plants hard-min digs exactly the grant.

### Revenue haircut

The multipliers also bite realized revenue (`src/lib/extraction/capacityHaircut.ts`). Revenue-weighted utilization is `sum(supplyRate_r x multiplier_r) / sum(supplyRate_r)`. The haircut fades in linearly over `EXTRACTION_CAPACITY_HAIRCUT_TURNS` from the first turn a sector is processed, is floored at `EXTRACTION_CAPACITY_HAIRCUT_FLOOR`, is relieved per resource by world scarcity, and utilization may rise by at most 0.05 per turn. Relief is capped by the raw physical capacity ratio so a sector cannot book revenue for ore the deposits cannot yield (`scarcityReliefCappedUtilization`).

### Royalties and lifecycle

```
royaltyDue (anchor) = royaltyRatePerTurn x share x stateCapacity[resource] x price
```

(`royaltyDueAnchor`, `src/lib/turn/extraction/contractSettlement.ts`). The corporation pays; the issuer treasury is credited and the amount counts as `revenue.resourceRoyalties`. A failed payment increments `missedPayments`; the third sets `status: "defaulted"` and `revokedTurn`. A successful payment resets `missedPayments` to 0. Term expiry (`expiresTurn <= turn`) takes precedence and charges nothing. `lastRoyaltyTurn` makes a retried phase idempotent.

```
Issuer offers (status "offered", offerExpiresTurn) -> counterparty accepts (signing fee, status "active", activatedTurn, expiresTurn)
  - decline, or offerExpiresTurn reached: status "declined" / "expired", revokedTurn set
Admin direct grant -> extractionContracts insert (may over-allocate)
Active -> royalties each turn -> expired (term) | defaulted (3 missed) | revoked
```

Contract changes are effective in the next `commodityPrices` pass.

### API routes

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

### UI surfaces

| Surface                         | Location                                    | Read                              | Admin actions  |
| ------------------------------- | ------------------------------------------- | --------------------------------- | -------------- |
| State Resources tab             | `/country/[code]/region/[id]?tab=resources` | Capacity + contracts + output     | Grant / Revoke |
| Corporation Contracts section   | `/corporation/[id]`                         | Own contracts                     | -              |
| National Congress Contracts tab | `/country/[code]/congress?tab=contracts`    | Country contracts                 | Grant / Revoke |
| Country map Resources mode      | `/country/[code]/map`                       | Choropleth by capacity/allocation | -              |

### Key files

- `src/lib/db/types/extractionContract.ts`: Contract document type
- `src/lib/db/types/stateResourceCapacity.ts`: Capacity document type
- `src/lib/db/collections/extractionContracts.ts`: Collection getter
- `src/lib/db/collections/stateResourceCapacity.ts`: Collection getter
- `src/lib/constants/commoditiesCore.ts`: `EXTRACTABLE_RESOURCES`, `ExtractableResource`
- `src/lib/turn/extraction/extractionCapacity.ts`: Multiplier computation 
- `src/lib/turn/commodityPriceTurn.ts`: Integration point (the "Pre-compute extraction capacity multipliers" block)
- `src/app/api/contracts/extraction/route.ts`: GET + POST
- `src/app/api/contracts/extraction/[id]/route.ts`: DELETE
- `src/components/congress/GrantContractModal.tsx`: Grant form (over-allocation confirmation flow)
- `src/components/state/StatePageTabsResources.tsx`: State resources UI with admin grant/revoke
- `src/lib/extraction/`: depletion, haircut, contract authority, shares and the offer, accept, decline, revoke and prospect commands
- `src/lib/turn/extraction/contractSettlement.ts`: royalty, term expiry, offer expiry and default
- `scripts/seeds/stateResourceCapacity.ts`: CLI wrapper for the capacity seed; data lives in `src/lib/seeds/reference/stateResourceCapacity.ts` (unlisted states default to zero capacity for every resource)


## Data

| Collection | Fields | Written by | Player-visible |
| --- | --- | --- | --- |
| `stateResourceCapacity` | `stateId`, `countryId`, `resources` (per-resource ceiling), `extractedUnits` (cumulative, plants tier), `updatedAt` (`src/lib/db/types/stateResourceCapacity.ts`) | seed, admin PATCH, R&D `$inc`, prospecting, `bookExtractionDepletion` (`src/lib/turn/commodity/extractionDepletion.ts`) | Capacity, output and contracted share on the state Resources tab and map mode |
| `extractionContracts` | `stateId`, `countryId`, `corporationId`, `resource`, `share`, `grantedTurn`, `grantedBy`, `grantedByLevel`, `revokedTurn?`, `tenderId?`, `status?` (`offered`, `active`, `declined`, `expired`, `defaulted`), `signingFeeAnchor?`, `signingFeeAttemptKey?`, `signingFeeSettled?`, `royaltyRatePerTurn?`, `termTurns?`, `activatedTurn?`, `expiresTurn?`, `offerExpiresTurn?`, `missedPayments?`, `lastRoyaltyTurn?`, `updatedAt` | offer, accept, decline and revoke commands, `contractSettlement`, admin POST and DELETE | Terms and status for the corporation and officials; the list is public; `missedPayments` is visible only to the corporation's owner and admins |
| `gameConfig` | `prospectingEnabled`, `contractIssuanceEnabled`, `treasuryCashLedgerEnabled` | admin config | No |

The in-memory multiplier map is not stored; it is rebuilt every `commodityPrices` pass. Contract documents join to corporations by `corporationId`.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `contractIssuanceEnabled` | `true` on fresh worlds and resets; absent means off | `src/lib/seeds/reference/featureFlagDefaults.ts`; read by `src/lib/extraction/featureFlag.ts`. Gates offer, accept and decline routes and the `contractSettlement` phase |
| `prospectingEnabled` | `true` on fresh worlds; absent means off | same. Gates survey launch and the `prospectingResolution` phase |
| `treasuryCashLedgerEnabled` | `true` on fresh worlds | same. Switches signing fee and royalty to funded treasury cash |
| Plants market tier (`marketSystemMode`) | per world | gameConfig; turns on depletion, plant output caps and fuller revenue coupling in `commodityPriceTurn.ts` |
| `extractionOutputScaleEnabled` | per world | gameConfig; scales desired extraction units in `extractionDesiredUnits` |
| Contract and prospecting constants | see Rules | `src/lib/constants/prospecting.ts` |
| Seed capacity per state | unlisted states get an empty map (zero capacity) | `src/lib/seeds/reference/stateResourceCapacity.ts` |

## Timing

Extraction caps are applied in the `commodityPrices` phase (`processCommodityPriceTurn`, `src/lib/turn/commodityPriceTurn.ts`, listed in `src/simulation/phases/turnPhaseNames.ts`). Phase order around it: `prospectingResolution`, `macroCountryTurn`, then `bondTurn` and `commodityPrices` (run in parallel), then `contractSettlement`. Contracts are read at the start of the price phase, so a contract granted or revoked during turn N is effective in turn N+1. Offer expiry, term expiry, royalty payment and default run afterwards in `contractSettlement`. The multipliers feed `computeRawSupplyDemand`, which produces the supply side of that turn's commodity price update; on plants worlds the depletion counter is incremented in the same pass.

Within the price phase: load capacity docs and active contracts for states with extraction sectors, build revenue-based inputs, ration (on depleted views when plants), book depletion, then compute supply and demand.

## Worked trace

State capacity for oil is 300,000 bbl daily. Corporation A holds one contract at share 0.5 and wants 200,000. Corporations B and C hold none and want 100,000 each. Plants tier off, so no depletion view.

| Step | Calculation | Result |
| --- | --- | --- |
| Open pool | 300,000 x (1 - 0.5) | 150,000 |
| A reserved | min(200,000, 300,000 x 0.5) | 150,000 |
| A residual | 200,000 - 150,000 | 50,000 |
| Open-access demand | 50,000 + 100,000 + 100,000 | 250,000 |
| Pool fill | min(1, 150,000 / 250,000) | 0.6 |
| A multiplier | (150,000 + 50,000 x 0.6) / 200,000 | 0.9 |
| B and C multiplier | (100,000 x 0.6) / 100,000 | 0.6 each |
| Total extracted | 180,000 + 60,000 + 60,000 | 300,000 (equals capacity) |

Royalty for A's contract at rate 0.01 and an anchor price of 80 per bbl: `0.01 x 0.5 x 300,000 x 80` = 120,000 anchor per turn, converted to the corporation's and issuer's currencies. Three misses in a row default the contract.

Depletion: capacity 300,000 gives reserves 300,000 x 1,920 = 576,000,000. After 575,900,000 extracted, remaining is 100,000, so the ceiling is min(300,000, 100,000) = 100,000.

## Edge cases and limits

- **No capacity document.** The compatibility fallback is multiplier 1 (uncapped). A seeded state with an empty `resources` map has capacity 0 and cannot extract.
- **Over-allocation.** Only the admin direct-grant path can exceed 100%; the open pool then reads 0 and uncontracted sectors produce nothing for that resource. Player offers cannot exceed the 75% ceiling. A direct grant that over-allocates returns 409 `{ overAllocated, needsConfirmation }` until resubmitted with `force: true`.
- **Output below reservation.** A holder producing less than `C x share` gets multiplier 1 and leaves the rest of its reservation idle.
- **Revoked contracts.** Soft deleted, excluded from all queries; share returns to the open pool next turn.
- **Non-extraction sectors and non-extractable commodities** are never touched by the multipliers.
- **R&D growth.** Capacity increases only for states that already have a capacity document.
- **Depletion** exists on the plants tier only.
- **Unit basis.** Capacity is documented on a daily basis like `sector.revenue`; the seed file header and the depletion module describe the same figure as a per-turn ceiling. The code path was not traced to settle which; treat the daily reading as the engine's convention.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Offered plus active player-issued share per state and resource never exceeds 0.75 | `issueContractOffer` headroom check plus a post-insert re-check for races; `computeContractedShare.test.ts`, `headroom/route.test.ts` |
| Multipliers stay in 0 to 1 | `min(1, ...)` in code; `extractionCapacity.test.ts` |
| Total granted output does not exceed capacity when not over-allocated | `extractionCapacity.test.ts` cases; no runtime check |
| A retried royalty phase never double charges | `lastRoyaltyTurn` guard; `contractSettlement.test.ts`, `contractSettlement.ledger.integration.test.ts` |
| Admin over-allocation requires explicit confirmation | `extraction.integration.test.ts` |

## Failure and recovery

Typical failures: a state with no capacity document (extraction runs uncapped and inflates supply), a stuck royalty settlement (the corporation is debited but the issuer credit fails; the code refunds the debit and rolls back the stamp so the next run charges again), and an over-allocated state starving open-access miners. Repairs are a reseed of the capacity table for missing documents, a heal that rewrites a wrong `share` or `status` on a contract, or an admin revoke (soft delete) of the offending contract. Depletion counters can be reset by a heal of `extractedUnits` if a bad run over-booked.

## Connections

**Driven by**
- [Corporations](./corporations.md): extraction sector output and R&D breakthroughs raise state capacity (`$inc` on `stateResourceCapacity`).
- [Bills & Legislation](./bills-legislation.md) and congress contract tabs: government contract offers (`src/lib/extraction/commands/issueContractOffer.ts`).

**Affects**
- [Commodities](./commodities.md): capped supply feeds the global price update (`src/lib/turn/commodityPriceTurn.ts`).
- [Corporations](./corporations.md): royalties are paid to the issuer and count as `revenue.resourceRoyalties` (`contractSettlement.ts`); the capacity haircut reduces realized extraction revenue.
- [Subsidies](./subsidies.md) and [Tariffs](./tariffs.md): sibling resource-sector levers.

Related: [Commodities](./commodities.md) (pricing engine that consumes extraction output) and [Corporations](./corporations.md) (sectors that produce commodity supply).

## Tests

- `src/lib/turn/extraction/extractionCapacity.test.ts` (19 cases): multipliers, reserved floor, combined concessions.
- `src/lib/turn/extraction/contractSettlement.test.ts`, `contractSettlement.ledger.integration.test.ts`: royalties, default, expiry.
- `src/lib/extraction/depletion.test.ts`, `capacityHaircut.test.ts`, `computeContractedShare.test.ts`, `contractAuthority.test.ts`, `eraExtractionClamp.test.ts`, `noBuyerPhaseOut.test.ts`, `revenueAnchor.test.ts`.
- `src/lib/extraction/commands/contractLifecycle.integration.test.ts`, `acceptContractOffer.ledger.integration.test.ts`, `launchCorpProspect.test.ts`, `launchGovernmentProspect.test.ts`.
- `src/app/api/contracts/extraction/extraction.integration.test.ts`, `listStatusFilter.test.ts`, `tenderBypass.test.ts`, `headroom/route.test.ts`; `src/app/api/states/[id]/resources/route.test.ts`.
- Gap: no test pins the seed capacity values.

## Known issues and history

- The earlier version of this page said contract holders are strictly capped at `capacity x share` and cannot touch the open pool. Code differs: since ticket 1619 a lease is a reserved floor and the holder's excess demand competes for the open pool. The Extraction Contracts player page still says a contracted company "does not also draw on the open-access pool", which the code contradicts.
- The earlier page said the multiplier function had 7 unit tests; it now has 19.
- Unit basis (daily versus per-turn) is unresolved between the engine convention and the seed file header.
- The tender flow (`tenderId`) is described on the player page; the offer commands here are the lower-level path.

Last checked: 2026-10-29, version 1.18.0
