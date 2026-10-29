# United Kingdom

The UK uses the shared political and economic simulation with a parliamentary
monarchy, country-specific electorate data, Commons elections, devolved
regional offices, Prime Minister formation votes, and an era-aware Cabinet.

Player guide: [United Kingdom](https://www.ahousedividedgame.com/wiki/uk-overview).

## Regions and Commons seats

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

## House of Commons elections

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

## Government formation

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
`/executive/uk` and `/uk/government` redirect there (`next.config.ts`).

## Cabinet

The sitting PM appoints eligible player-controlled MPs to era-aware positions
from `UK_CABINET_POSITIONS`. Appointees need not belong to the governing party
or coalition. An appointment starts a 24-turn lock for that cabinet seat; the
lock remains if the minister is fired (`COOLDOWN_TURNS` in
`src/lib/countries/uk/cabinetApi.ts`). See [UK Cabinet](./uk-cabinet.md).

## Legislation

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

## Devolved regional executives

Scotland, Wales, and Northern Ireland use First Minister labels; London uses a
Mayor. English regions outside London do not have a devolved executive office.
Regional legislation and assent use the country-aware regional office mapping
described in [State-Level Power](./state-level-power.md).

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

## Related pages

- [UK Elections](./uk-elections.md)
- [UK Cabinet](./uk-cabinet.md)
- [Parliamentary Government](./parliamentary-government.md)
- [Snap Elections](./snap-elections.md)
- [UK PM and No Confidence](./uk-pm-no-confidence.md)

Last checked: 2026-10-29, version 1.18.0
