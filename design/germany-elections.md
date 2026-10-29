# Germany, Elections

## Electoral System

Germany uses **AMS** (Additional Member System / MMP) for the Bundestag: 299
direct Wahlkreis mandates plus compensatory list seats produce a 630-seat
modern chamber. The `1953-default` preset uses 487 seats. Federal
Sainte-Laguë allocation applies the 5% or three-direct-mandate threshold;
each Land's list allocation is its quota minus direct seats, floored at zero.
Constituency and top-up computation lives in
`src/lib/countries/de/elections/germanyAMS.ts`; this document covers the
**Landesliste** management layer. Source:
`src/lib/countries/de/elections/germanyLandesliste.ts`.

## Landesliste

A Landesliste is an ordered list of a party's candidates within one
Bundesland. List seats are stored as one aggregate elected-official record per
party and Land, with `seatsHeld` recording the total. The list supplies the
named representative for that aggregate record rather than creating one
official document per seat. Lists are stored in the `landeslisten` collection,
keyed by `(countryId: "DE", partyId, landId, cycle)`.

## Auto-Generation

`autoGenerateLandesliste(db, { partyId, landId, cycle, preserveExisting? })`:

- Ranks the party's members resident in that Land (`homeState === landId`) by `nationalInfluence` descending; members without NPI sort to the bottom in `ObjectId` order (a stable-ish tiebreak across runs).
- Upserts by `(countryId: "DE", partyId, landId, cycle)`.
- If the existing list is `lockedAt`, this is a no-op regardless of `preserveExisting`, a locked list cannot be regenerated.
- If `preserveExisting: true` and an unlocked list already exists, returns it unchanged instead of overwriting chair edits.

`generateLandeslistenForCycle(db, cycle)` runs this for every distinct `(party, Land)` pair with at least one resident DE member, concurrently (`Promise.all`), always with `preserveExisting: true`. Called at Bundestag spawn so chairs have an edit window before the list is consumed by the AMS resolver.

## Chair Edits

`reorderLandesliste(db, { partyId, landId, cycle, candidates, authoredBy? })` lets a party chair reorder or replace the list before it locks:

- Throws if no list exists for the `(partyId, landId, cycle)` key.
- Throws if the existing list is already `lockedAt`.
- Throws if `candidates` contains a duplicate id.
- Throws if any candidate is not a `DE` party member resident in that Land (validated against `characters` with `party`, `homeState` matching).
- On success, replaces `candidates` and stamps `updatedAt` (and `authoredBy` if provided).

## Locking

`lockLandesliste(db, { partyId, landId, cycle })` sets `lockedAt` and blocks
further chair edits. The helper exists, but the current spawn and AMS paths do
not call it. Spawn generates lists, chair reordering can update them, and the
resolver reads the current `candidates` order or falls back to NPI-ranked
residents.

## Reading

`getLandesliste(db, { partyId, landId, cycle })`, direct lookup by the `(countryId: "DE", partyId, landId, cycle)` key; returns `null` if not found.

## Lifecycle Summary

| Stage               | Function                                                                              | State                                          |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Cycle start (spawn) | `generateLandeslistenForCycle` → `autoGenerateLandesliste` (`preserveExisting: true`) | Unlocked, NPI-ranked                           |
| Edit window         | `reorderLandesliste` (party chair action)                                             | Unlocked, chair-ordered                        |
| Optional lock       | `lockLandesliste`                                                                     | Available helper, not called by the live cycle |
| Seat resolution     | `allocateBundestag` reads `candidates` or an NPI-ranked fallback                      | Consumed                                       |

## Related

- Constituency + compensatory seat math: `src/lib/countries/de/elections/germanyAMS.ts` (not covered here).
- Country config: `COUNTRY_CONFIGS.DE` in `src/lib/constants/countries.ts` defines the Bundestag's election type key (`bundestag`), which also drives its inclusion in `WESTMINSTER_STYLE_TYPES` and `NATIONAL_AGGREGATION_TYPES` for the live-results national board, see `live-election-results.md`.
