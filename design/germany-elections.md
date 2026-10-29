# Germany, Elections

## Summary

Germany elects its Bundestag by AMS (Additional Member System, a form of mixed-member proportional representation): single-member Wahlkreis seats plus compensatory list seats. This page covers the **Landesliste** layer, the per-party, per-Land candidate lists that supply the named holder of each list seat, and the allocation path that decides how many list seats each Land gets. Constituency and top-up math lives in `src/lib/countries/de/elections/germanyAMS.ts`; list management lives in `src/lib/countries/de/elections/germanyLandesliste.ts` (older import paths under `src/lib/elections/` and `src/lib/turn/election/` forward to these files).

Player guide: [Germany](https://www.ahousedividedgame.com/wiki/de-overview) (the country overview; no player page covers Landeslisten on their own yet).

## Rules

### Electoral system

Germany uses AMS for the Bundestag. Direct Wahlkreis mandates plus compensatory list seats make up the chamber. A federal Sainte-Laguë allocation applies the 5% or three-direct-mandate threshold; each party's federal seats are then split across Länder, and each Land's list allocation is its quota minus direct seats, floored at zero.

| Constant | Value | Source |
| --- | --- | --- |
| Direct Wahlkreis mandates, modern preset | 299 across 16 Länder | `src/lib/countries/de/data/deRegions.ts` (`houseDistricts`, `DE_WAHLKREISE_PER_LAND`) |
| Bundestag size, modern preset | 630 | `src/lib/countries/de/institutionsFacts.ts` |
| Bundestag size, `1953-default` | 487 | `src/lib/countries/de/eras/1953.ts`, read by `getLiveLowerChamberSeats` (`src/lib/legislature/lowerChamberSeats.ts`) |
| Vote threshold (`BUNDESTAG_VOTE_THRESHOLD`, aliased `VOTE_THRESHOLD` in `germanyAMS.ts`) | 0.05 of Zweitstimmen | `src/lib/turn/election/sainteLagueAllocation.ts` |
| Direct-mandate exception (`DIRECT_MANDATE_EXCEPTION`) | 3 or more direct mandates bypasses the 5% | `src/lib/turn/election/sainteLagueAllocation.ts` |
| Land-level threshold | none (`minVoteShare: 0`) | `allocateListSeatsPerLand` in `germanyAMS.ts` |
| Sainte-Laguë divisors | 1, 3, 5, 7, ... (`2n + 1`); a strict "greater than" comparison, so the first party in input order wins an exact tie | `allocateViaSainteLague` in `sainteLagueAllocation.ts` |

### Allocation steps

`allocateBundestag(db, cycle)` computes a plan and writes nothing:

1. **Direct mandates.** Aggregate the existing `bundestag` direct-seat officials into seat counts per party and per (party, Land).
2. **Zweitstimmen.** Sum Erststimmen per party per Land from every `bundestag` and `snap_bundestag` election tally of the cycle, then derive Zweitstimmen by ticket-split crossover (`deriveZweitstimmen`, `src/lib/turn/election/ticketSplitCrossover.ts`). Crossover moves a fixed share of one party's first votes to another party and conserves the total.
3. **Federal Sainte-Laguë** over national Zweitstimmen for the era's chamber size. A party is eligible if its votes are at least 5% of total votes or it has 3 or more direct mandates.
4. **Per-Land quota.** Each party's federal seats are split across Länder by that party's per-Land Zweitstimmen, again with Sainte-Laguë and no threshold. List seats for a Land are `max(0, quota - directSeats)`.
5. **Holders.** Build the ordered candidate list per (party, Land) and assign one aggregate list official per bloc.

Crossover rates are era-scoped tables in `ticketSplitCrossover.ts`, chosen by `gameState.preset`; unknown presets get the modern table.

| Table | Rules (share of first votes that move) |
| --- | --- |
| `CROSSOVER_RATES_1953` | cdu to dp 0.02, cdu to gbbhe 0.015, cdu to fdp 0.02, spd to gbbhe 0.01 |
| `CROSSOVER_RATES_1991` | cdu to fdp 0.06, csu to fdp 0.05, spd to grn 0.05, spd to pds 0.03 |
| `CROSSOVER_RATES_MODERN` | cdu to fdp 0.07, cdu to grn 0.02, csu to fdp 0.05, spd to grn 0.07, spd to lnk 0.03, grn to spd 0.03 |

A rule whose party does not exist in the active world is dropped (`buildDEPartySlugToSeqId`). If one party's outgoing rates sum above 1, they are scaled down so it never lends out more than it received. Output votes are rounded per party.

### Landesliste

A Landesliste is an ordered list of a party's candidates within one Bundesland. List seats are stored as one aggregate elected-official record per party and Land, with `seatsHeld` recording the total. The list supplies the named representative for that aggregate record rather than creating one official document per seat. Lists are stored in the `landeslisten` collection, keyed by `(countryId: "DE", partyId, landId, cycle)`. In the API the `partyId` is the party's `sequentialId` as a string.

### Auto-generation

`autoGenerateLandesliste(db, { partyId, landId, cycle, preserveExisting? })`:

- Ranks the party's members resident in that Land (`homeState === landId`) by `nationalInfluence` descending; members without NPI count as 0, and ties sort by `ObjectId` string, a stable tiebreak across runs.
- Upserts by `(countryId: "DE", partyId, landId, cycle)`.
- If the existing list is `lockedAt`, this is a no-op regardless of `preserveExisting`: a locked list cannot be regenerated.
- If `preserveExisting: true` and an unlocked list already exists, returns it unchanged instead of overwriting chair edits.

`generateLandeslistenForCycle(db, cycle)` runs this for every distinct `(party, Land)` pair with at least one DE character that has both `party` and `homeState`, concurrently (`Promise.all`), always with `preserveExisting: true`. Called at Bundestag spawn so chairs have an edit window before the list is consumed by the AMS resolver.

### Chair edits

`reorderLandesliste(db, { partyId, landId, cycle, candidates, authoredBy? })` lets a party chair or vice chair reorder or replace the list before it locks. The API accepts only those two roles: `PUT /api/country/[code]/parties/[id]/landesliste/[landId]` (`src/app/api/country/[code]/parties/[id]/landesliste/[landId]/route.ts`). The body is `{ cycle, candidates }` with at most 500 candidate ids; `GET` on the same path returns the list for a `cycle` query parameter. Both are DE-only (400 for any other country).

- Throws if no list exists for the `(partyId, landId, cycle)` key. The API avoids this by calling `autoGenerateLandesliste` with `preserveExisting: true` first.
- Throws if the existing list is already `lockedAt`.
- Throws if `candidates` contains a duplicate id.
- Throws if any candidate is not a `DE` party member resident in that Land (validated against `characters` with `party`, `homeState` matching).
- On success, replaces `candidates` and stamps `updatedAt` (and `authoredBy` if provided).

### Locking

`lockLandesliste(db, { partyId, landId, cycle })` sets `lockedAt` and blocks further chair edits. The helper exists, but the current spawn and AMS paths do not call it, although its comment and the `Landesliste` type comment say lists lock at cycle start. Spawn generates lists, chair reordering can update them, and the resolver reads the current `candidates` order or falls back to NPI-ranked residents.

### Reading

`getLandesliste(db, { partyId, landId, cycle })` is a direct lookup by the `(countryId: "DE", partyId, landId, cycle)` key; it returns `null` if not found.

### Holder selection

`buildCandidateMap` (only for blocs with list seats above 0) uses the Landesliste `candidates` when the list is non-empty, otherwise the NPI-ranked resident members. Candidates with no resolvable name are skipped. `assignListSeats` then picks the first candidate who is **not** the bloc's direct-tier representative; if none, the first candidate; if none, the party's national representative. A bloc with no representative at all still gets an official with `characterId: null`.

### Lifecycle summary

| Stage | Function | State |
| --- | --- | --- |
| Cycle start (spawn) | `generateLandeslistenForCycle` then `autoGenerateLandesliste` (`preserveExisting: true`) | Unlocked, NPI-ranked |
| Edit window | `reorderLandesliste` (party chair action) | Unlocked, chair-ordered |
| Optional lock | `lockLandesliste` | Available helper, not called by the live cycle |
| Seat resolution | `allocateBundestag` reads `candidates` or an NPI-ranked fallback | Consumed |

## Data

| Collection | Read | Written | Player-visible |
| --- | --- | --- | --- |
| `landeslisten` | list lookup, generation, resolver | `candidates`, `authoredBy`, `updatedAt`, `lockedAt`, `createdAt`, `cycle`, `countryId`, `partyId`, `landId` | Yes, a list is readable through the `GET` route by any signed-in player with a character |
| `characters` | `party`, `homeState`, `nationalInfluence`, `name`, `_id` | no (office fields are updated later by `reconcileBundestagHolderOffices`) | Names and offices, yes |
| `elections` | `bundestag` and `snap_bundestag` rows for the cycle: `state`, `status`, `cycle` | no | Yes |
| `electionVoteTallies` | `totalVotes`, `candidateParties` | `resolutionPath: "ams"`, `resolvedSeatHolders`, `resolvedTotalSeats` on finalized tallies | Results pages, yes |
| `electedOfficials` | direct-tier `bundestag` rows (`seatsHeld`, `state`, `party`, `characterId`) | list-tier rows: `seatSource: "list"`, `seatsHeld`, `characterId`, `characterName`, `nppId`, `isNPP`, `electedAt` (all prior list rows deleted first) | Yes, the members list |
| `gameState` (`_id: "current"`) | `preset`, `lastBundestagReconciledCycle` | `lastBundestagReconciledCycle`, `updatedAt` | No |

The `Landesliste` type is `src/lib/db/types/landesliste.ts`. The collection is classified as runtime, not reference, data in `src/lib/admin/seed/seedManifest.ts` (the German seed does not write it), and is cleared by an economy reset (`src/lib/admin/economyReset/collections.ts`).

## Configuration

| Setting | Default and where set | Effect |
| --- | --- | --- |
| `gameState.preset` | set by the world seed; absent means modern | Chooses chamber size (`getLiveLowerChamberSeats`), the era's region data (`deRegions.ts`, `deRegions1953.ts`, and the other era files), and the crossover table |
| Lower chamber seats | 630 modern (`institutionsFacts.ts`), 487 in 1953 (`eras/1953.ts`) | Total federal seats fed to Sainte-Laguë |
| `electionSystems.lowerChamber` | `"ams"` (`institutionsFacts.ts`) | Routes Bundestag resolution into `reconcileGermanElection` |
| Crossover rate tables | constants in `ticketSplitCrossover.ts` | Zweitstimmen derivation, see Rules |
| `BUNDESTAG_VOTE_THRESHOLD`, `DIRECT_MANDATE_EXCEPTION` | 0.05 and 3, `sainteLagueAllocation.ts` | Federal eligibility |
| `COUNTRY_CONFIGS.DE` in `src/lib/constants/countries.ts` | election type key `bundestag` | Includes the Bundestag in `WESTMINSTER_STYLE_TYPES` and `NATIONAL_AGGREGATION_TYPES` for the live-results national board, see [Live Election Results](./live-election-results.md) |

There is no feature flag or per-world switch for Landeslisten themselves.

## Timing

- **Spawn**: `generateLandeslistenForCycle` runs when a Bundestag election is spawned, from `src/lib/turn/election/electionSpawning.ts` for the normal cycle and from `ensureDEElections` in `src/lib/countries/de/elections/perpetual.ts` for any missing cycle. Lists exist from the start of the campaign, so chairs have the whole election window to edit.
- **Resolution**: `maybeReconcileBundestag` is called from `reconcileGermanElection` in `src/lib/turn/election/generalResolution.ts` after each German constituency election resolves. It does nothing until every `bundestag` and `snap_bundestag` election for that cycle is `resolved` or `cancelled` (16 Land elections in the modern preset), and only if `lastBundestagReconciledCycle` is behind. It then calls `allocateBundestag`, persists the aggregate list officials, reconciles holder offices, stamps the tallies and the cycle marker, and opens the Bundestagspraesident election.

```
spawn  ->  generateLandeslistenForCycle        (lists exist, chairs may edit)
  ...campaign, Land elections resolve one by one...
last Land resolves -> maybeReconcileBundestag
    1 direct mandates  2 Zweitstimmen  3 federal Sainte-Lague (5% / 3 direct)
    4 per-Land quota   5 list holders from Landesliste
  -> persistBundestagResult -> reconcileBundestagHolderOffices
  -> tally stamp + lastBundestagReconciledCycle -> Bundestagspraesident election
```

## Worked trace

Toy world, modern preset, a 20-seat chamber instead of 630 (the arithmetic is the same at any size). Parties use rate-table slugs; `csu` and `lnk` do not exist in this world, so the rules naming them are dropped. Active rules: cdu to fdp 0.07, cdu to grn 0.02, spd to grn 0.07, grn to spd 0.03.

**Step 1, Erststimmen (candidate votes):**

| Land | cdu | spd | fdp | grn | sm | Total |
| --- | --- | --- | --- | --- | --- | --- |
| BY | 500,000 | 200,000 | 40,000 | 60,000 | 30,000 | 830,000 |
| BW | 301,000 | 150,000 | 30,000 | 20,000 | 20,000 | 521,000 |

**Step 2, Zweitstimmen by crossover.** BY: cdu `500,000 x (1 - 0.09)` = 455,000; spd `200,000 x 0.93 + 60,000 x 0.03` = 186,000 + 1,800 = 187,800; fdp `40,000 + 500,000 x 0.07` = 75,000; grn `60,000 x 0.97 + 500,000 x 0.02 + 200,000 x 0.07` = 58,200 + 10,000 + 14,000 = 82,200; sm 30,000. BW: cdu 273,910; spd 140,100; fdp 51,070; grn 35,920; sm 20,000. Each Land sums to its Erststimmen total.

**Step 3, federal.** National: cdu 728,910; spd 327,900; fdp 126,070; grn 118,120; sm 50,000. Total 1,351,000, so 5% is 67,550. sm has 50,000 and no direct mandates, so it is excluded. Sainte-Laguë over 20 seats, best quotients in order: cdu 728,910; spd 327,900; cdu 242,970; cdu 145,782; fdp 126,070; grn 118,120; spd 109,300; cdu 104,130; cdu 80,990; cdu 66,264.5; spd 65,580; cdu 56,070; cdu 48,594; spd 46,842.9; cdu 42,877; fdp 42,023.3; grn 39,373.3; cdu 38,364.7; spd 36,433.3; cdu 34,710. Result: cdu 11, spd 5, fdp 2, grn 2.

**Step 4, per-Land quota for cdu (11 seats).** Quotients BY 455,000 / 151,666.7 / 91,000 / 65,000 / 50,555.6 / 41,363.6 / 35,000 and BW 273,910 / 91,303.3 / 54,782 / 39,130. The 11 highest give BY 7, BW 4. For spd (5 seats) the same method gives BY 3, BW 2.

**Step 5, list seats.** Suppose cdu holds 8 direct seats in BY and 1 in BW. BY: `max(0, 7 - 8)` = 0 list seats, and the 1 extra direct seat stays (overhang, not trimmed). BW: `4 - 1` = 3 list seats, stored as one official with `seatsHeld: 3`, `seatSource: "list"`, whose named holder is the first candidate on the cdu BW Landesliste who is not BW's direct-tier representative. The chamber ends at 21 seats here, not 20, because of the overhang.

## Edge cases and limits

- A locked list cannot be regenerated or edited; a missing list makes `reorderLandesliste` throw, though the API auto-generates a base list on first edit.
- A party below 5% of Zweitstimmen gets no list seats unless it wins 3 or more direct mandates. Its direct seats still stand.
- Overhang clamps to 0 list seats, with no per-Wahlkreis dropping, so the chamber can exceed its configured size.
- A party with no resident members in a Land gets no Landesliste there; the resolver falls back to the party's national representative for the named seat holder.
- An empty or fully unnameable candidate list falls back to NPI-ranked residents, then to the party representative.
- The 1953 preset shrinks the chamber to 487 seats and uses 11 Länder; before the fix tracked in issue 3896 a hardcoded 630 over-seated it.
- The 5% threshold test uses total derived Zweitstimmen, not registered voters.
- Zero Zweitstimmen anywhere (no tallies) returns empty allocations and no list officials.
- Candidates outside the Land or party cannot be put on a list through the edit path, but the resolver does not re-check a stored list against current membership.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Crossover conserves ballots (Zweitstimmen total equals Erststimmen total, within rounding) | `validateZweitstimmenSum`; tested in `src/lib/turn/election/ticketSplitCrossover.test.ts`. Not asserted at runtime during allocation |
| Federal allocation sums to the chamber size when any party is eligible | `validateAllocation` exists as a helper; not called at runtime |
| One list bloc per (party, Land) per reconcile | `persistBundestagResult` deletes all prior list officials and swallows a duplicate-key error from a concurrent run; the unique index it relies on is described in a code comment but its creation is not in this repo (see Known issues) |
| A cycle reconciles once | `lastBundestagReconciledCycle` guard in `maybeReconcileBundestag`; tested in `src/lib/turn/election/germanyAMS.test.ts` |
| A list contains no duplicates and only resident party members | `reorderLandesliste` checks, tested in `src/lib/elections/germanyLandesliste.test.ts` |
| Locked lists are never changed | Checks in `autoGenerateLandesliste` and `reorderLandesliste`; nothing locks a list in the live cycle |

## Failure and recovery

- **Reconcile throws part-way.** `reconcileGermanElection` sets the election back to `completed` and rethrows, so the finalized race stays eligible for retry on a later turn. `lastBundestagReconciledCycle` is only written after the list and holder writes succeed.
- **Duplicated list blocs** (a chamber larger than expected after overlapping runs, seen once in production). `persistBundestagResult` is idempotent per run and tolerates duplicate-key errors; a damaged world is repaired by re-running reconciliation after clearing the list officials (a heal).
- **Wrong chamber size** in an era world: re-run reconciliation after correcting the preset-driven size; the 1953 over-seating was fixed in code (issue 3896).
- **Missing lists** at a Bundestag start (a world seeded mid-cycle): `ensureDEElections` creates lists for each newly spawned cycle, and the readiness check `checkDELandeslisten` in `src/lib/constants/countryReadinessExpectations.ts` reports an empty collection.
- **Stale lists after a reset or reseed**: the collection is cleared by an economy reset and regenerated at the next spawn.

## Connections

**Driven by:**
- [Elections](./elections.md): Bundestag spawn and resolution drive list generation and allocation (`electionSpawning.ts`, `generalResolution.ts`, `germanyAMS.ts`).
- Party membership and `nationalInfluence`: decide the default list order (`autoGenerateLandesliste`).
- Party chair and vice chair: reorder lists through the `PUT` route.

**Affects:**
- Bundestag composition: list seats persist as aggregate officials (`persistBundestagResult`), and `reconcileBundestagHolderOffices` (`src/lib/countries/de/elections/bundestagHolderOffices.ts`) updates holder offices.
- Bundestagspraesident election: opened after a successful reconcile (`triggerBundestagspraesidentElectionAfterReconcile`).
- [Live Election Results](./live-election-results.md): the national board aggregates the Bundestag.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/elections/germanyLandesliste.test.ts` | Generation per (party, Land), NPI ordering, locked and preserved lists, reorder validation, `lockLandesliste`, `getLandesliste` |
| `src/lib/turn/election/germanyAMS.test.ts` | Direct-mandate aggregation, per-Land list seats and overhang clamp, `assignListSeats`, `maybeReconcileBundestag` (once per cycle, era-sized chamber, pending guard), duplicate-key tolerance, player outcomes |
| `src/lib/turn/election/sainteLagueAllocation.test.ts` | Federal Sainte-Laguë, 5% and 3-direct rule |
| `src/lib/turn/election/ticketSplitCrossover.test.ts` | Crossover rates and ballot conservation |
| `src/lib/countries/de/elections/bundestagHolderOffices.test.ts` | Holder office reconciliation |

Gaps: no test for the `PUT` route's chair and vice chair authorisation, none for the empty-candidate-list fallback inside `buildCandidateMap`, and none that a stored list is re-validated against current membership at resolution.

## Known issues and history

- `lockLandesliste` is never called, so lists never lock; the type and function comments say they lock at cycle start. Chairs can edit until the cycle's reconcile reads the list.
- The comment on `persistBundestagResult` names a heal script and a partial unique index for the duplicate-list incident (tickets and issue numbers in the code comment); neither the script nor the index creation is in this repository.
- By-election promotion of a vacated list seat is deferred (`src/lib/turn/byElections.ts`).
- Fixed: the chamber size was hardcoded to 630 and over-seated the 1953 preset (issue 3896); it now comes from `getLiveLowerChamberSeats`.
- Fixed: the crossover table was keyed on retired archetypes and never applied (issue 810); it is now party-to-party and era-scoped.
- Contradiction with the player wiki: the Germany overview says the modern chamber is fixed at 630 "with no overhang mandates". The code does not trim overhang: direct seats above a Land's quota stay and list seats clamp to 0, so the chamber can exceed 630. The code wins; this page records the behaviour.

Last checked: 2026-10-29, version 1.18.0
