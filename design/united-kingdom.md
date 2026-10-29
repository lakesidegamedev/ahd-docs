# United Kingdom

## Summary

The UK uses the shared political and economic simulation with a parliamentary
monarchy, country-specific electorate data, Commons elections, devolved
regional offices, Prime Minister formation votes, and an era-aware Cabinet.

Player guide: [United Kingdom](https://www.ahousedividedgame.com/wiki/uk-overview).

Player guide: [United Kingdom](https://www.ahousedividedgame.com/wiki/uk-overview).

## Rules

### Regions and Commons seats

UK gameplay uses 12 regions for residency, elections, demographics, and
regional policy. The live modern Commons allocation comes from
`UK_COMMONS_SEATS` in `src/lib/constants/states.ts`:

| Code | Region                   | Commons seats |
| ---- | ------------------------ | ------------: |
| LON  | London                   |            75 |
| SEE  | South East England       |            90 |
| SWE  | South West England       |            58 |
| EAE  | East of England          |            60 |
| EMI  | East Midlands            |            47 |
| WMI  | West Midlands            |            57 |
| YHU  | Yorkshire and the Humber |            54 |
| NWE  | North West England       |            75 |
| NEE  | North East England       |            27 |
| SCO  | Scotland                 |            57 |
| WAL  | Wales                    |            32 |
| NIR  | Northern Ireland         |            18 |

The modern total is 650 (`TOTAL_UK_COMMONS_SEATS`), with a majority threshold
of 326. The `1953-default` preset uses `UK_COMMONS_SEATS_1953`, totaling 625
seats with a 313-seat majority. The `1991-default` preset uses
`UK_COMMONS_SEATS_1991`, 650 seats on the 1983 boundaries. All three maps and
`getUkCommonsSeats(preset)` are in `src/lib/constants/states.ts`. Do not use the `UK_REGIONS.constituencies` display metadata
for seat allocation.

UK regions use adapted census dimensions and country-specific group weights.
They do not simply reuse the US demographic group ids.

### House of Commons elections

- Each region runs one multi-seat `commons` race.
- Seats are allocated using Hare-quota largest remainder (`pr_hareQuota`).
- The active election window is 48 hours: 24 hours of primary and 24 hours of
  general election (`commons` in `src/lib/constants/electionDurations.ts`).
- The regular cycle is 240 turns, or 5 game years (`CYCLE_TURNS.commons` in
  `src/lib/constants/partyOrg.ts`). A snap election resets the next
  regular-cycle anchor.
- Candidacy is normally tied to the character's home region, subject to the
  live entry rules for the office and candidate.

See [UK Elections](./uk-elections.md) for preset-aware seat maps, vacancy
handling, and cycle timing.

### Government formation

The canonical record is `governmentFormations`, updated through
`src/lib/turn/parliamentaryGovernment.ts`. Its status is `pending`, `formed`,
or `collapsed`.

After a Commons cycle, seat totals are refreshed and lower-chamber members may
nominate a Prime Minister through the shared appointment-vote flow. Formation
may be recorded as a majority, coalition, or minority government. Coalition
party ids and their supporting seats are included when applicable. A successful
appointment writes the PM to `governmentFormations`, marks the government
formed, and clears the previous cabinet.

Votes of no confidence need an absolute majority of all Commons seats
(`floor(totalSeats / 2) + 1`, 326 of 650), not a majority of votes cast. Any
elected Commons member may propose and vote; the mechanism is not restricted to
the governing block. The motion is open for 24 turns and a new one cannot be
filed for 48 turns after the last (`src/lib/constants/governmentFormation.ts`). See [Parliamentary Government](./parliamentary-government.md)
and [PM and No Confidence](./uk-pm-no-confidence.md).

The canonical Downing Street route is `/country/uk/executive`.
`/executive/uk` (through the generic `/executive/:code` redirect) and `/uk/government` redirect there (`next.config.ts`).

### Cabinet

The sitting PM appoints eligible player-controlled MPs to era-aware positions
from `UK_CABINET_POSITIONS`. Appointees need not belong to the governing party
or coalition. An appointment starts a 24-turn lock for that cabinet seat; the
lock remains if the minister is fired (`COOLDOWN_TURNS` in
`src/lib/countries/uk/cabinetApi.ts`). See [UK Cabinet](./uk-cabinet.md).

### Legislation

UK national bills use `UK_NATIONAL_CONFIG` in
`src/lib/countries/uk/elections/billLifecycle.ts`:

1. The Commons votes by simple majority.
2. About 28% of passed bills (`lordsRevisionFlavor.chance = 0.28`) enter a
   1 to 2 turn Lords-revision hold (`delayTurnsMin = 1`, `delayTurnsMax = 2`).
3. The bill then receives automatic Royal Assent and is enacted. The other 72%
   enact immediately on Commons pass.

The Lords are not a playable elected chamber. While
`governmentFormations.status` is `pending`, the UK lifecycle is frozen through
`skipWhenGovPending` and resumes automatically when a government forms.

### Devolved regional executives

Scotland, Wales, and Northern Ireland use First Minister labels; London uses a
Mayor. English regions outside London do not have a devolved executive office.
Regional legislation and assent use the country-aware regional office mapping
described in [State-Level Power](./state-level-power.md).

## Data

| Collection | Use | Notes |
| --- | --- | --- |
| `electedOfficials` | Commons seats (`commons` office), holder-less records for vacancies | seats counted by party for the Commons tally |
| `elections` and races | one multi-seat `commons` race per region; `snap_commons` for snaps | results shown on the elections pages |
| `governmentFormations` | `status` (`pending`, `formed`, `collapsed`), PM, coalition party ids, `seatsByParty`, `majorityThreshold`, `totalSeats`, `activeVoteId`, `pmVacancyDeadlineTurn` | shown on the Downing Street page |
| `noConfidenceVotes` | motions against the PM | see [UK PM and No Confidence](./uk-pm-no-confidence.md) |
| `ukCabinetCooldowns` | 24-turn lock per cabinet seat | read by `cabinetApi.ts` |
| bills collections | UK national bills driven by `UK_NATIONAL_CONFIG` | status and Lords hold visible to players |

Country-specific demographic and seed data live under `src/lib/countries/uk/` (for example `seed.ts`, `seedLegislation.ts`, `seedBudgets.ts`).

## Configuration

| Setting | Default | Set in |
| --- | --- | --- |
| Era preset `1953-default` | 625 seats, majority 313 | `UK_COMMONS_SEATS_1953`, `TOTAL_UK_COMMONS_SEATS_1953`, `src/lib/constants/states.ts` |
| Era preset `1991-default` | 650 seats on 1983 boundaries | `UK_COMMONS_SEATS_1991`, `src/lib/constants/states.ts` |
| Any other preset | 650 seats, majority 326 | `UK_COMMONS_SEATS`, `TOTAL_UK_COMMONS_SEATS`, `getUkCommonsSeats(preset)` |
| `lowerChamber` method | `pr_hareQuota` | `src/lib/countries/uk/institutionsFacts.ts` |
| `lordsRevisionFlavor` | chance 0.28, delay 1 to 2 turns | `UK_NATIONAL_CONFIG`, `src/lib/countries/uk/elections/billLifecycle.ts` |
| `skipWhenGovPending` | true | `UK_NATIONAL_CONFIG` |
| `VOTING_HOURS` | 24 | `billLifecycle.ts` |
| `commons` election duration | 48 hours (24 primary, 24 general) | `src/lib/constants/electionDurations.ts` |
| `CYCLE_TURNS.commons` | 240 turns | `src/lib/constants/partyOrg.ts` |
| `COOLDOWN_TURNS` (cabinet seat lock) | 24 | `src/lib/countries/uk/cabinetApi.ts` |
| `PM_VACANCY_DEADLINE_TURNS` | 96 | `src/lib/constants/turnTime.ts` |
| `SNAP_ELECTION_LIMIT` and `SNAP_ELECTION_COOLDOWN_TURNS` | 2 per appointment, 336 turns | `src/lib/turn/snapElection.ts` |
| `UK_GOVERNOR_REGIONS` | SCO, WAL, NIR, LON | `src/lib/turn/perpetualElections/shared.ts` |
| Cabinet positions | era-aware | `UK_CABINET_POSITIONS`, `src/lib/constants/cabinetPositions.ts` |

## Timing

Per turn, in order (`src/simulation/phases/turnPhaseRegistry.ts`):

1. Commons races spawn and resolve (`ensureUKElections`,
   `src/lib/countries/uk/elections/perpetual.ts`).
2. If a whole Commons slate resolved, the dissolution slate is cleared: Commons
   bills fail, an active no-confidence vote is cancelled, and a confidence
   motion opens for the incumbent PM if they kept a seat
   (`runPostElectionGovernmentPhases`, `src/lib/turn/countryPhases.ts`).
3. `parliamentaryGovernmentPhases`: seat refresh, expired PM and no-confidence
   votes resolve, NPP auto-votes run every 4th turn.
4. `parliamentaryVacancyWatcher`: a government still `pending` after
   `PM_VACANCY_DEADLINE_TURNS = 96` turns (`src/lib/constants/turnTime.ts`)
   triggers an automatic snap Commons election.

Bills move on their own lifecycle: a Commons vote window of 24 hours
(`VOTING_HOURS` in `billLifecycle.ts`), then the Lords roll, then assent.

## Worked trace

Scotland (57 seats, `UK_COMMONS_SEATS.SCO`) under Hare-quota largest remainder, with 1,000,000 votes: party A 450,000, party B 350,000, party C 200,000.

1. Quota = 1,000,000 / 57 = 17,543.86.
2. Full quotas: A 450,000 / 17,543.86 = 25.65, B = 19.95, C = 11.40. Whole seats: 25, 19, 11 = 55 seats.
3. Two seats remain. Remainders: B 0.95, A 0.65, C 0.40. B and A each take one.
4. Result: A 26, B 20, C 11 = 57.

Nationally the seat map sums to 650 (75+90+58+60+47+57+54+75+27+57+32+18), so the majority threshold is `floor(650 / 2) + 1 = 326`. If party A ends with 326 or more seats across all regions, `updateParliamentaryGovernmentSeats` copies the tally into `governmentFormations` and A can be recorded as a majority government when its PM wins the appointment vote. In the 1953 preset the same sums give 625 and 313.

A bill passes the Commons vote (24-hour window) at turn 500. The Lords roll succeeds with probability 0.28 (`lordsRevisionFlavor.chance`). On a hit the bill is held for 1 or 2 turns (`delayTurnsMin`, `delayTurnsMax`) and is enacted at turn 501 or 502 with automatic Royal Assent. On a miss (72%) it is enacted at turn 500. While the government is `pending` none of this advances.

## Edge cases and limits

- **Pending government:** UK national bills freeze (`skipWhenGovPending`) and
  resume when a government forms.
- **Lords:** not a playable chamber. The 28% hold is pacing and flavor only; it
  cannot block or amend a bill.
- **Regional split:** only Scotland, Wales, Northern Ireland and London have a
  devolved executive. The other eight English regions have none
  (`UK_GOVERNOR_REGIONS` in `src/lib/turn/perpetualElections/shared.ts`).
- **Era presets:** seat map, majority threshold and cabinet seats all follow the
  active preset or live game year, so the 1953 and 1991 worlds do not use the
  modern 650-seat split or modern cabinet names.
- **Snap limits:** PM-called snaps are capped at 2 per appointment with a
  336-turn cooldown (`src/lib/turn/snapElection.ts`).

## Invariants

- Per-region seat maps sum to the stated total (650, 625, 650). Enforced by `src/lib/constants/ukCommonsSeats1953.test.ts` and `src/lib/constants/ukCommonsSeats1991.test.ts`.
- Majority threshold is `floor(totalSeats / 2) + 1`. Enforced by `lowerChamberMajorityThreshold` (`src/lib/legislature/lowerChamberSeats.ts`).
- UK national bills do not advance while `governmentFormations.status` is `pending`. Enforced by `skipWhenGovPending` in the lifecycle; see `src/lib/turn/ukBillLifecycle.test.ts`.
- A cabinet seat cannot be re-appointed within 24 turns. Enforced at appointment time in `cabinetApi.ts`; see `src/lib/countries/uk/cabinetApi.test.ts`.
- At most 2 PM-called snaps per appointment, 336 turns apart. Enforced in `snapElection.ts`; see `src/lib/turn/snapElection.test.ts`.
- Seat totals in `governmentFormations` match the live Commons. Re-derived every turn by `updateParliamentaryGovernmentSeats`; no standalone invariant check.

## Failure and recovery

- **Commons record drift** (missing or stale seat fields on `commons` records): `ensureUKElections` heals Commons fields each turn and logs the count healed.
- **Government stuck `pending`**: the vacancy watcher triggers an automatic snap Commons election after 96 turns, which recovers the country without manual action.
- **Stale seat totals** on `governmentFormations`: rewritten on the next turn by the seat refresh.
- **Missing government record**: the seat refresh seeds the document when none exists.

## Connections

**Driven by:**

- [UK Elections](./uk-elections.md): the Commons result sets seat totals that
  `updateParliamentaryGovernmentSeats` copies into `governmentFormations`.
- [Snap Elections](./snap-elections.md): `triggerSnapElection` replaces the
  Commons slate and vacates the PM.

**Affects:**

- [UK Cabinet](./uk-cabinet.md): the PM appoints from the seated Commons, and a
  vacated PM clears the cabinet.
- [UK PM and No Confidence](./uk-pm-no-confidence.md): the seated Commons is the
  electorate for the motion.
- [Bills and legislation](./bills-legislation.md): `UK_NATIONAL_CONFIG` gates
  national bills on government status.
- [State-Level Power](./state-level-power.md): regional offices and assent.

Related pages:

- [UK Elections](./uk-elections.md)
- [UK Cabinet](./uk-cabinet.md)
- [Parliamentary Government](./parliamentary-government.md)
- [Snap Elections](./snap-elections.md)
- [UK PM and No Confidence](./uk-pm-no-confidence.md)

## Tests

- `src/lib/constants/ukCommonsSeats1953.test.ts`, `src/lib/constants/ukCommonsSeats1991.test.ts`: seat maps and totals.
- `src/lib/turn/ukGovernment.test.ts`, `src/lib/turn/ukGovernmentFormation.test.ts`: seat tally, largest party, majority and coalition tracking, per-turn gauges.
- `src/lib/turn/ukBillLifecycle.test.ts`: UK national bill lifecycle.
- `src/lib/turn/election/seatAllocation.test.ts`: seat allocation and election methods.
- `src/lib/countries/uk/cabinetApi.test.ts`, `src/lib/countries/uk/cabinetEligibility.test.ts`: cabinet appointments and eligibility.
- `src/lib/countries/uk/seed.demographics.test.ts`: UK demographic seed.
- `src/lib/turn/commonsByElections.test.ts`, `src/lib/countries/uk/elections/commonsVacancyStatus.test.ts`: Commons vacancies.
- Gaps: no test pins the 0.28 Lords-hold chance or the redirect from `/uk/government`.

## Known issues and history

- `UK_REGIONS.constituencies` is display metadata only and must not be used for seat allocation.
- Before the per-preset maps existed, spawn and allocation used the modern 650-seat map in every era; `getUkCommonsSeats(preset)` fixed this for the 1953 and 1991 presets (recorded in code comments in `src/lib/constants/states.ts`).
- The Lords hold is pacing only; there is no playable upper chamber.

Last checked: 2026-10-29, version 1.18.0
