# Statehood Admission

## Summary

Era-windowed admission of US territories into full statehood: Alaska and Hawaii under the `1953-default` preset. Source: `src/lib/elections/statehoodAdmission.ts` (curve and readers) and `src/lib/turn/statehood.ts` (the turn phase).

Statehood is defined by presence in the active apportionment map (`HOUSE_SEATS` per preset, see `initializeOfficials`: "the apportionment map is what defines statehood"). That map is a frozen per-preset constant. A territory absent from it, like Alaska/Hawaii under `1953-default`, is seeded but seatless and cannot become a state through `runCensus` alone, census reapportions seats among existing states, it never admits a new one. This module supplies the missing transition.

Player guide: no dedicated wiki page covers statehood admission. Related player pages: [Relocation](https://www.ahousedividedgame.com/wiki/relocation) (which regions you can call home) and [Game Starting State](https://www.ahousedividedgame.com/wiki/game-starting-state).

What changes for players: before admission, Alaska and Hawaii residents can organize parties and elect a territorial governor but have no House, Senate or state legislature seats. After admission the state gets 1 House seat, 2 Senate seats, a State Senate seat, vacant offices and its normal election schedule.

Design law: **gravity, not rails**. Admission is not scripted to fire in a specific year. Each territory carries a window and a cumulative admission curve whose median lands on the historical year, so an untouched world usually admits Alaska and Hawaii around 1959, sometimes earlier (1956), sometimes later (up to 1970). It is a pull, not a timetable.

## Rules

### Territory table

`TERRITORY_ADMISSIONS` (`src/lib/elections/statehoodAdmission.ts`):

| `stateId` | Name | `historicalYear` | `windowStartYear` | `windowEndYear` |
| --- | --- | --- | --- | --- |
| `AK` | Alaska | 1959 | 1950 | 1970 |
| `HI` | Hawaii | 1959 | 1950 | 1970 |

`historicalYear` is the **median** of the admission curve, not a scripted fire date. The window opens in 1950 (Alaska Statehood Committee era) and closes in 1970; a world that still holds a territory as of `windowEndYear` admits it outright. Every preset other than `1953-default` already carries both states in its apportionment map (`getHouseSeats`, `src/lib/constants/states.ts`), so this table is only consulted for territories missing from the active map.

### Admission curve

Constants, all in `src/lib/elections/statehoodAdmission.ts`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `ADMISSION_CDF_AT_HISTORICAL_YEAR` | 0.5 | Probability of admission by the end of the historical year. Exactly 0.5 is what makes that year the median. |
| `INITIAL_HOUSE_SEATS_ON_ADMISSION` | 1 | Constitutional floor of House seats a newly admitted state receives (recalculated at the next census). |
| `POST_WINDOW_RAMP_EXPONENT` | 0.7 | Curvature of the ramp after the historical year (not exported). |

The exponent is below 1, so probability climbs fast then flattens: a world that misses the historical moment resolves soon after rather than drifting to the window's end. It is 0.7 rather than 0.5 (square root) because a square-root ramp put too much probability mass in the single year right after the anchor, making that year, not the historical year, the modal admission year. `statehoodAdmission.test.ts` pins the historical year as the modal year to prevent regression.

`admissionCdf(t, year)`, piecewise, with `zeroYear = windowStartYear - 1`:

- `0` before `windowStartYear`.
- `1` at or after `windowEndYear`.
- Up to and including `historicalYear`: `0.5 * p^2` where `p = (year - zeroYear) / (historicalYear - zeroYear)`. Pressure builds; a straight line would make 1950 as likely as 1958, understating a decade-long statehood movement.
- After `historicalYear`: `0.5 + 0.5 * q^0.7` where `q = (year - historicalYear) / (windowEndYear - historicalYear)`.

`admissionHazard(t, year) = (F(y) - F(y-1)) / (1 - F(y-1))`, the per-year conditional probability implied by the CDF. It returns 0 once the prior year's cumulative chance has reached 1, or if the CDF did not rise. Rolling it once a year reproduces the CDF exactly.

Worked values for Alaska or Hawaii (window 1950 to 1970, median 1959):

| Year | Cumulative chance admitted by year end | Chance admitted during that year, if not yet admitted |
| --- | --- | --- |
| 1950 | 0.5% | 0.5% |
| 1955 | 18.0% | 6.3% |
| 1958 | 40.5% | 12.5% |
| 1959 | 50.0% | 16.0% |
| 1960 | 59.3% | 18.7% |
| 1962 | 70.1% | 14.3% |
| 1965 | 82.7% | 18.5% |
| 1969 | 96.8% | 50.8% |
| 1970 | 100% | 100% (forced) |

Each territory rolls independently, so Alaska and Hawaii can be admitted in different years.

### Roll and decision

`admissionRoll(stateId, year, iteration)` is a deterministic `[0,1)` draw: `hashToUint32("statehood:{iteration}:{stateId}:{year}") / 2^32`, where `hashToUint32` is the first four bytes of a SHA-256 (`src/lib/events/substrate/rng.ts`). It is keyed on the world's iteration (worlds diverge) and the year, not the turn (idempotent, replaying a turn cannot re-roll the same year). Turn-processing paths must never use `Math.random()`.

`decideAdmissions(candidates, year, iteration)`, for each candidate territory, computes the year's hazard, skips it if the hazard is 0, and admits it if the roll is below the hazard. Returns `AdmissionDecision[]` (`stateId`, `name`, `year`, `hazard`). Callers must pre-filter `candidates` to exclude territories already states under the active apportionment map or already admitted in an earlier year, this function only evaluates the roll, not world state.

### Reading admission state

`admittedStateIdsAsOf(states, asOfYear)` is the single reader of the `admittedYear` field on state documents: returns state ids with `admittedYear <= asOfYear`. Every statehood gate goes through it: apportionment (`loadApportionment`), seat creation, bootstrap officials, and the perpetual-election spawner. These previously tested `getHouseSeats(preset)[id] != null` directly, which can never become true mid-game; a gate that bypasses this reader silently keeps an admitted state a territory in its own corner of the game.

`isUsPoliticalState(stateId, preset, admittedIds)`, true when a US region hosts full state politics this era: either House seats under the active apportionment map, or `admittedIds` (mid-game admission). DC fails (not an electoral state per `isUsElectoralState`); AK/HI fail under `1953-default` until admitted.

`isUsResidentPoliticalRegion(stateId, preset, admittedIds)`, true when a region can be a player's political home: `isUsPoliticalState` OR listed in `TERRITORY_ADMISSIONS`. Alaska and Hawaii start as territories under `1953-default`, residents can organize parties and elect a territorial governor, but gain no House/Senate/state-legislative seats until `isUsPoliticalState` passes. Callers include character creation and the two relocation routes.

### Admission content

`buildAdmissionContent(decisions)` builds the news-post body: singular ("X is admitted to the Union in {year}, taking its seats in the House and Senate. House apportionment will be recalculated at the next census.") or a joined list for simultaneous admissions ("A and B are admitted ..."). Empty string if `decisions` is empty.

## Data

| Collection | Field or document | Read or written | Notes |
| --- | --- | --- | --- |
| `gameState` (`_id: "current"`) | `lastStatehoodYear` | read, written | Last in-game year evaluated. Cleared by `resetGameWorld`. |
| `gameState` | `currentYear`, `preset`, `iteration` (`type`, `number`) | read | Year is only a fallback; the phase passes the turn's year. Iteration builds the roll key `"{type}-{number}"`, or `"default"` when absent. |
| `states` | `admittedYear` | read, written | Set on admission. The one marker every gate reads. Cleared by `resetStateRuntimeFields`. |
| `states` | `houseDistricts` | written | Set to 1 on admission, later changed by the census. |
| `seats` | house, 2 senate classes, governor, stateSenate rows | written (upsert) | Built by `buildUsStateSeats`; ids are deterministic, so a re-run does not duplicate. |
| `electedOfficials` | vacant `senate` (per `SENATE_CLASSES`, default classes 1 and 2) and `house` (district 1) | written (insert) | Only if the state has no senate or house officials yet. |
| `politicalParties` | US roster | read | To map seed abbreviations to this world's parties. |
| `statePartyOrg` | major-party chapter rows | written (upsert) | Then overlaid with 1953 organisation, registration and `hasPresence`. |
| `stateRegistrationPool` | `US_{stateId}` | written (upsert) | `independent`, `unregistered` from the 1953 seed, `lastUpdatedTurn: 0`. |
| news posts | "Admitted to the Union" | written | Category `election`, via `createSystemNewsPost`. |

Player-visible: the news post, the new seats and offices, the state's election races, and the House seat count and electoral votes after apportionment. `lastStatehoodYear`, `admittedYear` and the roll are internal.

## Configuration

There are no `gameConfig` fields or flags for statehood. Behaviour is set by constants and the world preset.

| Setting | Default | Where set |
| --- | --- | --- |
| World preset (`gameState.preset`) | set at world reset | `resetGameWorld`; decides whether AK/HI are in the apportionment map |
| `getHouseSeats(preset)` | `1953-default` map without AK/HI; `1991-default` and every other preset include them | `src/lib/constants/states.ts` |
| Window, median year, territory list | see table above | `TERRITORY_ADMISSIONS` |
| `ADMISSION_CDF_AT_HISTORICAL_YEAR`, `POST_WINDOW_RAMP_EXPONENT`, `INITIAL_HOUSE_SEATS_ON_ADMISSION` | 0.5, 0.7, 1 | `src/lib/elections/statehoodAdmission.ts` |
| Senate classes for new state | `[1, 2]` unless listed | `SENATE_CLASSES` in `src/lib/constants` |
| Registration and organisation seed | 1953 US lanes | `get1953USRegistrationSeed`, `src/lib/seeds/registration/registrationLanes1953.ts` |
| Iteration stamp (`gameState.iteration`) | absent means key `"default"` | `resetGameWorld` |

## Timing

```
stateEffectsPhase (hourly turn)
  ... metricEngine -> demographicFlows -> statehood -> census -> ...
statehood:
  shouldEvaluateStatehood (year > lastStatehoodYear)
    -> pendingTerritories -> decideAdmissions
    -> states.admittedYear + houseDistricts
    -> seedAdmittedStatePolitics -> lastStatehoodYear -> news post
later turns:
  ensurePerpetualElections spawns the state's races (via admittedYear)
  next census: loadApportionment counts the new state
```

`runStatehoodAdmission` (`src/lib/turn/statehood.ts`) runs from the `statehood` phase of `src/simulation/phases/stateEffectsPhase.ts`, after `demographicFlows` and before `census`. It is gated by `shouldEvaluateStatehood`: it evaluates once per in-game year, on the first turn where the year exceeds `gameState.lastStatehoodYear`, then stamps `lastStatehoodYear`. Order matters: a territory admitted in a census year already holds a seat when `runCensus` reapportions the 435 House seats.

On admission the phase writes `admittedYear` and `houseDistricts = INITIAL_HOUSE_SEATS_ON_ADMISSION` (1) to the state, then `seedAdmittedStatePolitics` creates seat rows, the vacant Senate (classes from `SENATE_CLASSES`, default 1 and 2) and House officials, major party organisation rows remapped to the world's current party roster, and the 1953 registration pool. It deliberately does not create elections: `ensurePerpetualElections` (`src/lib/turn/perpetualElections/engine.ts`) spawns them on the normal calendar once the state is on its roster via `admittedYear`. A news post titled "<names> Admitted to the Union" is created last.

## Worked trace

Setup: a `1953-default` world with no iteration stamp (roll key `default`), so both territories are pending. Alaska is evaluated in 1959, after the earlier years each rolled and missed.

1. Gate. 1959 is greater than `lastStatehoodYear` (1958), so the phase runs. `pendingTerritories` returns AK and HI (neither is in the 1953 map, neither has `admittedYear`).
2. Cumulative chance at the end of 1958. `p = (1958 - 1949) / (1959 - 1949) = 9/10`. `F = 0.5 * 0.9^2 = 0.405`.
3. Cumulative chance at the end of 1959. `year <= historicalYear`, `p = 10/10 = 1`. `F = 0.5`.
4. Hazard. `(0.5 - 0.405) / (1 - 0.405) = 0.095 / 0.595 = 0.1597`.
5. Roll. `admissionRoll("AK", 1959, "default")` hashes `statehood:default:AK:1959` and gives 0.1418.
6. Decision. 0.1418 is below 0.1597, so Alaska is admitted with `AdmissionDecision { stateId: "AK", name: "Alaska", year: 1959, hazard: 0.1597 }`. Hawaii rolls 0.1498 against the same hazard and is also admitted that year in this world.
7. Writes. `states.AK.admittedYear = 1959`, `houseDistricts = 1`. Five seat rows are upserted for AK: house (1 seat), senate classes 1 and 2, governor, stateSenate. Two vacant senate officials and one vacant house official are inserted. Org rows and the `US_AK` registration pool are written. `lastStatehoodYear = 1959`.
8. News. Title "Alaska and Hawaii Admitted to the Union", body "Alaska and Hawaii are admitted to the Union in 1959, taking their seats in the House and Senate. House apportionment will be recalculated at the next census."
9. Aftermath. On the next 1960 census turn (same phase order, statehood first), `loadApportionment` includes AK and HI through `admittedStateIdsAsOf`, so the 435 seats are redistributed over 50 states.

In the same world the earlier years all missed. For Alaska: 1950 roll 0.857 against 0.005, 1955 roll 0.148 against 0.063, 1958 roll 0.166 against 0.125.

## Edge cases and limits

- `pendingTerritories` excludes any territory already present in the preset's apportionment map (`getHouseSeats`), so the phase is a no-op for every preset other than `1953-default`, and stamps the year anyway so the query is not repeated.
- At or after `windowEndYear` (1970) the cumulative chance is 1 and hazard is 1, so a world that still holds a territory then admits it that year.
- Before `windowStartYear` (1950) the chance is 0, and the hazard is 0, so no roll is made.
- `admissionHazard` returns 0 once the prior year's cumulative chance has reached 1.
- Replaying a turn cannot re-roll: the roll hash is keyed on iteration, state and year, never the turn or `Math.random()`.
- A missing 1953 registration seed for a state throws, and an unresolvable seed party only logs a warning and skips that party's shares, so one renamed party cannot strand an admission.
- Major-party org rows are remapped by abbreviation, then by canonical seed name, onto the party the world actually has, so a renamed or renumbered party does not receive another party's starting organisation.
- Officials are only created when the state has no senate or house officials, so an admin-seeded delegation is never duplicated.
- Seat counts after admission are 1 House seat until the next census reapportions.
- A future-dated `admittedYear` does not count yet: `admittedStateIdsAsOf` filters by year.
- Presidential elections after admission use the larger apportionment through `loadApportionment`, which is why electoral votes change at the next census rather than immediately.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Median of the curve is the historical year (CDF is 0.5 at `historicalYear`) | `statehoodAdmission.test.ts` ("puts the median exactly on the historical year") |
| CDF never decreases, is 0 before the window and 1 at its end | `statehoodAdmission.test.ts` |
| Rolling the hazard year by year reproduces the CDF | `statehoodAdmission.test.ts` ("reproduces the CDF when applied year by year") |
| The historical year is the single most likely admission year | `statehoodAdmission.test.ts` (modal year test) |
| A year is rolled at most once per territory | Deterministic roll plus `lastStatehoodYear` guard; `statehood.test.ts` |
| A territory is never admitted twice | `alreadyAdmitted` filter; `statehood.test.ts` ("never re-admits") |
| Re-seeding an admitted state never duplicates seats or officials | Deterministic seat ids and the existing-officials check; `statehood.test.ts` |
| Admission creates no elections of its own | `statehood.test.ts` ("creates no elections") |
| Every gate agrees that an admitted state is a state | Single reader `admittedStateIdsAsOf`; per-gate tests listed below. No runtime assertion that a new gate uses it, so this is not enforced for future code. |

## Failure and recovery

- **Partial admission.** `states.admittedYear` is written before `seedAdmittedStatePolitics` runs. If seeding throws (for example the 1953 registration seed is missing), the state is already marked admitted, so the next year's pending list no longer contains it and the seeding is not retried by the phase. The visible symptom is a state that holds seats in apportionment but has no org rows, registration pool or officials. Recovery is a data repair that re-runs the seeding for that state; the seeding is idempotent (upserts and an existing-officials check), so a re-run is safe.
- **Renamed or renumbered parties.** The roster is player-mutable. An unresolved seed abbreviation logs a warning and skips that party's shares, leaving the state without that party's starting registration. Repair is to correct the party or org rows by hand, or rerun the seeding after fixing the roster.
- **Admission never fires.** The phase skips any year not greater than `lastStatehoodYear`, so a stale or too-high value silences it. `resetGameWorld` clears the field on a reset; if it is wrong in a live world, unsetting it lets the next turn evaluate.
- **Admitted state missing elections.** Races come from `ensurePerpetualElections`, which runs every turn, so a missing race fixes itself on the next turn once `admittedYear` is set.
- **World reset.** `resetStateRuntimeFields` clears `admittedYear` and `resetGameWorld` clears `lastStatehoodYear`, returning AK and HI to territory status.

## Connections

Driven by:

- Calendar year from the turn clock (`currentYear` in `stateEffectsPhase.ts`) and the world iteration (`gameState.iteration`) for the roll.
- Seed preset (`getHouseSeats(preset)` in `src/lib/constants/states.ts`) decides which territories are pending.

Affects:

- [Elections](./elections.md): `ensurePerpetualElections` adds House, Senate and state races for an admitted state.
- Apportionment: `loadApportionment` in `src/lib/elections/apportionment.ts` reads `admittedYear` through `admittedStateIdsAsOf`, so the next census counts the new state.
- [Relocation](./relocation.md): `isUsResidentPoliticalRegion` lets players live in AK and HI before admission; `isUsPoliticalState` gates full state politics after.
- [State-Level Power](./state-level-power.md): state offices and state party organisations appear once admitted.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/elections/statehoodAdmission.test.ts` | CDF, hazard, roll determinism, `decideAdmissions` including median and modal year, news content, `admittedStateIdsAsOf`, `isUsPoliticalState`, `isUsResidentPoliticalRegion` |
| `src/lib/turn/statehood.test.ts` | `shouldEvaluateStatehood`, `pendingTerritories`, `runStatehoodAdmission`, `seedAdmittedStatePolitics`, drifted party roster |
| `src/lib/elections/apportionmentStatehood.test.ts` | Admission in `buildApportionment` and `loadApportionment`, future-dated admission |
| `src/lib/turn/perpetualElections.eraStatehood.test.ts` | Territorial governor only in 1953, races for a mid-game admitted state, no races before the year |
| `src/lib/admin/seed/seedSeatsStatehood.test.ts` | `buildUsStateSeats`, territorial seats, live delegation size |
| `src/lib/admin/bootstrap/initializeOfficials.test.ts` | Bootstrap officials honour admission |
| `src/lib/seeds/reference/statePartyOrg.test.ts` | Major-party org rows |

Gaps: no end-to-end test that runs the phase through a census in the same turn, and no test for the partial-failure path where seeding throws after `admittedYear` is written.

## Known issues and history

- Partial admission is not self-healing (see Failure and recovery).
- Tuning note: the post-anchor exponent was moved from the obvious 0.5 to 0.7 because the square root made the year after 1959 the modal admission year. The test pins the historical year as modal.
- Only Alaska and Hawaii are modelled; the table can take more territories, but each also needs a 1953-style registration seed.
- The player wiki has no page for this mechanic, so there is nothing to contradict.

Last checked: 2026-10-29, version 1.18.0
