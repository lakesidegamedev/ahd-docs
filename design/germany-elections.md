# Germany, Elections

Player guide: [Germany](https://www.ahousedividedgame.com/wiki/de-overview) (the country overview; no player page covers Landeslisten on their own yet).

## Rules

### Electoral System

Germany uses **AMS** (Additional Member System / MMP) for the Bundestag: 299
direct Wahlkreis mandates plus compensatory list seats produce a 630-seat
modern chamber. The `1953-default` preset uses 487 seats. Federal
Sainte-Laguë allocation applies the 5% or three-direct-mandate threshold;
each Land's list allocation is its quota minus direct seats, floored at zero.
Constituency and top-up computation lives in
`src/lib/countries/de/elections/germanyAMS.ts`; this document covers the
**Landesliste** management layer. Source:
`src/lib/countries/de/elections/germanyLandesliste.ts` (older import paths under
`src/lib/elections/` and `src/lib/turn/election/` forward to these files).

| Constant | Value | Source |
| --- | --- | --- |
| Direct Wahlkreis mandates | 299 across 16 Laender | `src/lib/countries/de/data/deRegions.ts` |
| Bundestag size, modern preset | 630 | `src/lib/countries/de/institutionsFacts.ts` |
| Bundestag size, `1953-default` | 487 | `getLiveLowerChamberSeats` (`src/lib/legislature/lowerChamberSeats.ts`), `src/lib/countries/de/data/deRegions1953.ts` |
| Vote threshold (`VOTE_THRESHOLD`) | 5% of Zweitstimmen | `src/lib/countries/de/elections/germanyAMS.ts` |
| Direct-mandate exception | 3 or more direct mandates bypasses the 5% | `src/lib/turn/election/sainteLagueAllocation.ts` |
| Land-level threshold | none (`minVoteShare: 0`) | `src/lib/countries/de/elections/germanyAMS.ts` |

### Landesliste

A Landesliste is an ordered list of a party's candidates within one
Bundesland. List seats are stored as one aggregate elected-official record per
party and Land, with `seatsHeld` recording the total. The list supplies the
named representative for that aggregate record rather than creating one
official document per seat. Lists are stored in the `landeslisten` collection,
keyed by `(countryId: "DE", partyId, landId, cycle)`.

### Auto-Generation

`autoGenerateLandesliste(db, { partyId, landId, cycle, preserveExisting? })`:

- Ranks the party's members resident in that Land (`homeState === landId`) by `nationalInfluence` descending; members without NPI count as 0, and ties sort by `ObjectId` string, a stable tiebreak across runs.
- Upserts by `(countryId: "DE", partyId, landId, cycle)`.
- If the existing list is `lockedAt`, this is a no-op regardless of `preserveExisting`, a locked list cannot be regenerated.
- If `preserveExisting: true` and an unlocked list already exists, returns it unchanged instead of overwriting chair edits.

`generateLandeslistenForCycle(db, cycle)` runs this for every distinct `(party, Land)` pair with at least one resident DE member, concurrently (`Promise.all`), always with `preserveExisting: true`. Called at Bundestag spawn so chairs have an edit window before the list is consumed by the AMS resolver.

### Chair Edits

`reorderLandesliste(db, { partyId, landId, cycle, candidates, authoredBy? })` lets a party chair or vice chair (the only roles the API accepts: `PUT /api/country/[code]/parties/[id]/landesliste/[landId]`) reorder or replace the list before it locks:

- Throws if no list exists for the `(partyId, landId, cycle)` key.
- Throws if the existing list is already `lockedAt`.
- Throws if `candidates` contains a duplicate id.
- Throws if any candidate is not a `DE` party member resident in that Land (validated against `characters` with `party`, `homeState` matching).
- On success, replaces `candidates` and stamps `updatedAt` (and `authoredBy` if provided).

### Locking

`lockLandesliste(db, { partyId, landId, cycle })` sets `lockedAt` and blocks
further chair edits. The helper exists, but the current spawn and AMS paths do
not call it. Spawn generates lists, chair reordering can update them, and the
resolver reads the current `candidates` order or falls back to NPI-ranked
residents.

### Reading

`getLandesliste(db, { partyId, landId, cycle })`, direct lookup by the `(countryId: "DE", partyId, landId, cycle)` key; returns `null` if not found.

### Lifecycle Summary

| Stage               | Function                                                                              | State                                          |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Cycle start (spawn) | `generateLandeslistenForCycle` → `autoGenerateLandesliste` (`preserveExisting: true`) | Unlocked, NPI-ranked                           |
| Edit window         | `reorderLandesliste` (party chair action)                                             | Unlocked, chair-ordered                        |
| Optional lock       | `lockLandesliste`                                                                     | Available helper, not called by the live cycle |
| Seat resolution     | `allocateBundestag` reads `candidates` or an NPI-ranked fallback                      | Consumed                                       |

## Timing

- **Spawn**: `generateLandeslistenForCycle` runs when a Bundestag election is spawned, from `src/lib/turn/election/electionSpawning.ts` for the normal cycle and from `ensureDEElections` in `src/lib/countries/de/elections/perpetual.ts` for any missing cycle. Lists exist from the start of the campaign, so chairs have the whole election window to edit.
- **Resolution**: `maybeReconcileBundestag` runs once per cycle only after every Bundestag and snap Bundestag election for that cycle has resolved (16 Land elections), and only if `lastBundestagReconciledCycle` is behind. It calls `allocateBundestag`, then persists the aggregate list officials.
- Order inside `allocateBundestag`: direct mandates, Zweitstimmen (derived from Erststimmen by ticket-split crossover), federal Sainte-Lague with the 5% or 3-direct rule, per-Land quota, list seats equal quota minus direct seats, persist.

### Worked example

Illustrative numbers: a party wins 40 direct mandates in Bavaria and its federal Sainte-Lague share gives Bavaria a quota of 55 seats. Its Bavarian list gets `max(0, 55 - 40) = 15` seats, held as one aggregate official whose named representative is the first candidate on the Bavarian Landesliste. If the quota were 38, the list gets `max(0, 38 - 40) = 0` seats and the 2 extra direct seats stay (overhang is not compensated or trimmed).

## Edge cases and limits

- A locked list cannot be regenerated or edited; a missing list makes `reorderLandesliste` throw, though the API auto-generates a base list on first edit.
- A party below 5% of Zweitstimmen gets no list seats unless it wins 3 or more direct mandates.
- Overhang clamps to 0 list seats, with no per-Wahlkreis dropping.
- A party with no resident members in a Land gets no Landesliste there; the resolver falls back to party members, then to the party's national representative, for the named seat holder.
- The 1953 preset shrinks the chamber to 487 seats; before the fix tracked in issue 3896 a hardcoded 630 over-seated it.
- A 5% threshold test uses total Zweitstimmen cast, not registered voters.

### Related

- Constituency + compensatory seat math: `src/lib/countries/de/elections/germanyAMS.ts` (not covered here).
- Country config: `COUNTRY_CONFIGS.DE` in `src/lib/constants/countries.ts` defines the Bundestag's election type key (`bundestag`), which also drives its inclusion in `WESTMINSTER_STYLE_TYPES` and `NATIONAL_AGGREGATION_TYPES` for the live-results national board, see [Live Election Results](./live-election-results.md).

## Connections

**Driven by:**
- [Elections](./elections.md): Bundestag spawn and resolution drive list generation and allocation (`electionSpawning.ts`, `germanyAMS.ts`).
- Party membership and `nationalInfluence`: decide the default list order (`autoGenerateLandesliste`).

**Affects:**
- Bundestag composition: list seats persist as aggregate officials (`persistBundestagResult`), and `reconcileBundestagHolderOffices` updates holder offices.
- [Live Election Results](./live-election-results.md): the national board aggregates the Bundestag.

Last checked: 2026-10-29, version 1.18.0
