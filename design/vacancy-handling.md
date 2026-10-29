# Vacancy Handling

## Summary

When elected officials resign, retire, die or are removed from office, their seats are filled in one of three ways: by gubernatorial appointment (US Senate), by an off-calendar by-election (US and Russian Governors, UK Commons), or by waiting for the next regular election (US House, US State Senate and other offices).

Time units: one turn is one real hour and 48 turns make one game year (`MS_PER_TURN`, `TURNS_PER_YEAR` in `src/lib/constants/calendar.ts`). A 24-turn window is half a game year, or 24 real hours.

Player guide: no dedicated player page covers vacancies yet. The nearest player-facing pages are [Election Mechanics](https://www.ahousedividedgame.com/wiki/election-mechanics) (cycles) and [Reference: Offices](https://www.ahousedividedgame.com/wiki/reference-offices) (what each office does).

## Rules

### Vacancy types by office

| Office | How it is filled | Duration | Source |
| --- | --- | --- | --- |
| **US Senate** | Governor appoints a replacement (player character or NPP) | Until the next election of that Senate class | `src/lib/government/commands/appointments.ts` |
| **US House** | Seat stays vacant, no by-election | Until the next regular House election (2 game years, 96 turns, at most) | `src/lib/turn/byElections.ts` (House deferred) |
| **US Governor** and **RU regional First Secretary** | Special election `special_governor` | 24-turn filing and primary window, then a 24-turn general | `src/lib/turn/byElections.ts` |
| **US State Senate** | Seat stays vacant | Until the next regular State Senate election (4 game years, 192 turns, at most) | `src/lib/turn/byElections.ts` (deferred) |
| **UK Commons** | Special election `special_commons` over the vacated seat only | 24-turn filing window, then a 24-turn general | `src/lib/turn/commonsByElections.ts` |

House and State Senate seats are elected as a whole state delegation in one race, so a single-seat by-election needs a per-district design that does not exist yet. German list-seat promotion is also deferred.

### Constants

| Constant | Value | Source |
| --- | --- | --- |
| `SPECIAL_GOVERNOR_FILING_TURNS` | 24 | `src/lib/turn/byElections.ts` |
| `SPECIAL_GOVERNOR_GENERAL_TURNS` | 24 | `src/lib/turn/byElections.ts` |
| `BY_ELECTION_RETRY_COOLDOWN_TURNS` | 48 | `src/lib/turn/byElections.ts` |
| `BY_ELECTION_COUNTRIES` | US, RU | `src/lib/turn/byElections.ts` |
| `COMMONS_BY_ELECTION_FILING_TURNS` | 24 | `src/lib/countries/uk/elections/commonsRecallRules.ts` |
| `COMMONS_BY_ELECTION_GENERAL_TURNS` | 24 | `src/lib/countries/uk/elections/commonsRecallRules.ts` |
| `COMMONS_BY_ELECTION_RETRY_COOLDOWN_TURNS` | 48 | `src/lib/countries/uk/elections/commonsRecallRules.ts` |
| `RECALL_INFAMY_THRESHOLD` | 70 (opens a recall petition at once) | `src/lib/countries/uk/elections/commonsRecallRules.ts` |
| `RECALL_LOW_APPROVAL_LINE` and `RECALL_SUSTAINED_TURNS` | favorability 25 or lower for 4 consecutive turns | `src/lib/countries/uk/elections/commonsRecallRules.ts` |
| `RECALL_SIGNATURES_REQUIRED` | 5 player signatures open a petition from a watch | `src/lib/countries/uk/elections/commonsRecallRules.ts` |
| `RECALL_PETITION_OPEN_TURNS` | 12 turns collecting signatures | `src/lib/countries/uk/elections/commonsRecallRules.ts` |
| Appointment deadline | none, the seat can be filled at any time while vacant | `src/lib/government/commands/appointments.ts` |
| Fallback appointment term | 6 years from now, used only when no election of that class is scheduled | `src/lib/government/commands/appointments.ts` |
| Resign endpoint rate limit | 10 requests per 60 seconds per user | `src/app/api/officials/[id]/resign/route.ts` |

### Senate vacancies (US only)

A Senate seat becomes vacant when the senator resigns, is removed by an admin, or retires. `notifyGovernorOfSenateVacancy` (`src/lib/governors/senateVacancy.ts`) sends the sitting governor, if a player character holds the office, the notification "A Senate seat in [State] (Class [N]) has become vacant. You may appoint a replacement."

**Appointment** (`POST /api/governors/appoint-senator`, `appointSenator`):

1. The caller must hold the governor office in the US and the state must have a Senate seat of that class (`US_SENATE_2020`).
2. The seat must be empty (no character and no NPP in it).
3. The appointee is a player character or an NPP. They must have `homeState` equal to the governor's state, must not already hold an elected office or `currentOffice`, an NPP must not be retired, and a character must belong to a player. There is no party requirement.
4. The seat record is created or refilled with `isAppointment: true`, `appointedBy: <governor character>`, `senateClass`, and `termEnds` set to the end time of the next election for that state and class, or six years out if none is scheduled.
5. The appointee's `currentOffice` is set, an office-transition record is written, and both appointee and governor are notified.

`GET /api/governors/eligible-appointees?senateClass=1|2|3` lists the candidates (same state, no current office, player characters and NPPs).

The appointee serves until the next election for that Senate class. There are no special elections for the Senate: voters get no say until the regular class election. This avoids mid-cycle election spam.

**Example.** A Class 1 senator is elected in game year 2020 (turn 0) with a term ending in 2026 (turn 288). In game year 2022 (turn 110) the senator resigns and the governor appoints a replacement. The appointee serves 178 turns, about 3.7 game years, until the Class 1 election completes at turn 288.

**Fields** (`src/lib/db/types/officials.ts`): `isAppointment?: boolean` and `appointedBy?: ObjectId` on `ElectedOfficial`; `termEnds` is the term end date.

### House and State Senate vacancies

The seat stays vacant with no appointment and no special election. It fills only when the next regular election completes (every 2 game years for the House, every 4 for the State Senate). While vacant the chamber's total seat count drops (the House below 435), party seat counts fall, and the state delegation is smaller.

**Example.** A House member resigns 16 game months into a 24-month term; the seat stays empty for the remaining 8 game months (32 turns) until the regular House election.

### Governor vacancies (US and Russia)

When a governor resigns, retires, dies or is removed mid-term, `processByElectionWatcher` spawns a `special_governor` election (`spawnGovernorByElection`):

- A **mid-term vacancy** is an `electedOfficials` governor record with no character and no NPP in it (the holder-less record left by retirement or removal). A state that has never seated a governor has no such record and is filled by the regular cycle instead, so a new world does not flood with specials.
- The election runs a 24-turn filing and primary window, then a 24-turn general. The filing window exists because candidates can only file while the primary is open.
- The winner is seated as a plain governor, and the next regular Governor election spawns on its normal calendar.
- Russia is status-gated: its watcher runs only when the country is beta or active.
- No Lieutenant Governor succession exists in the game.

**Suppressed when:** a live regular governor race will resolve before a by-election spawned now could (`regularRaceFillsSeatFirst`: its `endTurn` is within 48 turns), a special is already live, or a special resolved within the last 48 turns (so an uncontested seat does not respawn a race every turn).

**Impact:** while the seat is empty the state has no governor, so no executive powers are available, including appointing senators.

### UK MP (Commons) vacancies

When an MP dies, retires, resigns, defects, is recalled or is removed, the seat is recorded as a durable vacancy (`UkCommonsVacancy`, reasons `death`, `retirement`, `defection`, `resignation`, `recall`, `removal`; `src/lib/countries/uk/elections/commonsVacancyShell.ts`). The holder-less `commons` record is kept as the anchor.

- `processCommonsByElectionWatcher` groups open vacancies per region and spawns one `special_commons` race per region, claiming those vacancies (they move `open` to `scheduled`).
- The by-election contests only the vacated seats. AHD models regions with a seat count rather than constituencies, so the race runs over the regional electorate scaled down to `carveFraction = vacatedSeats / totalRegionSeats`, clamped to 0-1 (`computeByElectionCarveFraction`, `src/lib/countries/uk/elections/byElectionCarve.ts`). The regional mix of groups and leans is preserved and the reduced electorate goes through the normal vote engine.
- The winner is seated as a plain Commons member. Sitting MPs keep their rows (the resolve is additive).
- **Recall:** each seated MP has a recall watch. Infamy at or above 70 opens a petition immediately; favorability at or below 25 for 4 consecutive turns opens one; 5 player signatures also open one. A petition collects signatures for up to 12 turns, then a constituency support check decides whether the MP is removed, which creates a `recall` vacancy.

**Suppressed when:** a live `special_commons` already covers the region, a regular or snap general will resolve before a by-election could (`commonsByElectionGate`), or a special resolved within the last 48 turns. A snap dissolution cancels live specials, and a general that resolves after a vacancy was scheduled marks that vacancy `subsumed` rather than filled.

**Impact:** the Commons can sit below 650 seats while seats await a by-election, party seat counts drop, and confidence votes can be affected (fewer MPs voting). See [United Kingdom](./united-kingdom.md) and [UK Elections](./uk-elections.md).

### Resignation

Two code paths exist.

- **Settings resignation** (`resignOfficial`, `src/lib/settings/resignations.ts`): the path used from the player settings. UK Commons seats are tombstoned (holder cleared, record kept) and a `resignation` vacancy is written. Senate resignations notify the governor. The character's `currentOffice` is cleared.
- **`POST /api/officials/[id]/resign`** (`src/app/api/officials/[id]/resign/route.ts`): the caller must be the office holder or an admin, the official must be in office, and a legislator cannot resign while actively running in an election (executive offices may, so a VP can step down before a contingent ballot). Non-executive resignations delete the record outright, a Senate resignation notifies the governor, and the character receives "You have resigned from [office]".

An admin removal uses the same endpoint with admin auth and has the same effect.

## Data

| Collection | Use | Fields |
| --- | --- | --- |
| `electedOfficials` | the seat; vacancy is a holder-less record | `isAppointment`, `appointedBy`, `senateClass`, `termEnds` (`src/lib/db/types/officials.ts`) |
| `ukCommonsVacancies` | durable UK vacancy record | `countryId`, `state`, `officialId`, `seats`, `reason`, `vacatedTurn`, `vacatedAt`, `status` (`open`, `scheduled`, `filled`, `subsumed`), `electionId` (`src/lib/countries/uk/db/ukByElectionTypes.ts`) |
| `ukRecallPetitions` | recall watch and petitions | signatures, trigger, status |
| elections and races | `special_governor` and `special_commons` races | 48 hours each (24 primary, 24 general), `src/lib/constants/electionDurations.ts` |
| characters | `currentOffice` set or cleared | |
| office-transition records | written on appointment and resignation | |
| notifications | governor and appointee messages | |

Player-visible: the race and results, notifications, empty seats in chamber counts, and a recall petition's progress. The vacancy bookkeeping documents are not shown directly.

## Configuration

| Setting | Default | Set in |
| --- | --- | --- |
| `BY_ELECTION_COUNTRIES` | US, RU | `src/lib/turn/byElections.ts` |
| Russia watcher gating | runs only when the country is beta or active | country status in `byElections.ts` |
| Founding period | both watchers skipped while `gameState.preIteration.active` | `src/simulation/phases/turnPhaseRegistry.ts` |
| By-election durations and cooldowns | 24, 24, 48 (see Constants) | `byElections.ts`, `commonsRecallRules.ts` |
| Recall thresholds | infamy 70, favorability 25, 4 turns, 5 signatures, 12 turns | `commonsRecallRules.ts` |
| Country-scoped election types | `special_governor`, `special_commons` | `electionDurations.ts` |

No gameConfig field or era preset changes this system; the UK Commons seat map follows the era preset (see [United Kingdom](./united-kingdom.md)).

## Timing

All watchers run in the hourly turn (`src/simulation/phases/turnPhaseRegistry.ts`), in the election coverage group:

1. `perpetualElections`, country election phases, leadership elections and `staleCandidateCleanup` run first.
2. `byElectionWatcher` (`processByElectionWatcher`) runs next and reads the settled seat state.
3. `commonsByElectionWatcher` runs immediately after, with a separate country scope (UK) and election type.
4. Both are skipped while the world is in its founding period, since every seat is being elected and nothing is mid-term.

Within the Commons watcher the order is: backstop untracked holder-less records into vacancies, advance recall petitions, reconcile scheduled vacancies against finished races, then spawn new by-elections.

Senate appointment is not a turn event: it happens when the governor calls the API, at any time while the seat is empty.

## Worked trace

UK London, modern map (75 seats), one MP dies at turn 2000.

1. The holder-less `commons` record is backstopped into a `UkCommonsVacancy` with `reason: "death"`, `seats: 1`, `status: "open"`, `vacatedTurn: 2000`.
2. The Commons watcher checks the gate: no live `special_commons` for LON, no regular or snap general resolving first, no special resolved in the last 48 turns. It spawns one `special_commons` race and moves the vacancy to `scheduled`.
3. Carve fraction: `computeByElectionCarveFraction = 1 / 75 = 0.0133`, clamped to 0-1. The regional electorate is scaled by 0.0133 with its group mix preserved.
4. The race runs 24 turns of filing and primary (turns 2000 to 2024), then 24 turns of general (to 2048).
5. The winner is seated as a plain Commons member and the vacancy moves to `filled`. The Commons is back to 650 seats.
6. If nobody wins a seat, the seat stays vacant and the next by-election can spawn no earlier than turn 2048 + 48 = 2096.

Senate example (from Rules): resignation at turn 110, class term ends turn 288, so the appointee serves `288 - 110 = 178` turns, which is `178 / 48 = 3.7` game years.

## Edge cases and limits

- **No governor, no appointment.** If the sitting governor is an NPP or the office is itself vacant, no notification is sent and no player can appoint. The seat stays vacant until the next class election.
- **Uncontested by-election.** The seat stays vacant after it resolves, and the 48-turn cooldown prevents an instant respawn.
- **Several vacancies in one UK region** are filled by one race; count-less records are sized from the region's deficit, never below one seat each.
- **Duplicate trigger.** Vacancy creation is idempotent per record, so a turn retry or simultaneous triggers do not double a race.
- **Appointee rules.** Anyone who already holds an office, an NPP that is retired, and anyone from another state is refused.
- **Deliberately excluded:** House and State Senate special elections (no per-district race design), Lieutenant Governor succession, death and expulsion by chamber vote.

## Invariants

- A vacancy is filled by one path only (appointment, by-election or regular election). Enforced by the suppression checks (`regularRaceFillsSeatFirst`, `commonsByElectionGate`); covered by `src/lib/turn/byElections.test.ts` and `src/lib/turn/commonsByElections.test.ts`.
- At most one live special per region. Enforced by the gate; tested ("does not spawn while a live special or an imminent general covers the region").
- A vacancy is recorded exactly once per holder-less record. Tested ("records a removal vacancy ... exactly once").
- Vacancies claimed by a race are marked `filled`, `subsumed` or reopened. Tested (reconcile cases in `commonsByElections.test.ts`).
- An appointed senator must live in the governor's state and hold no office. Enforced in `appointSenator`; no dedicated test was found.
- Chamber seat totals never exceed their statutory size. Not enforced by a dedicated check.

## Failure and recovery

- **Vacancy never recorded** (a holder-less UK record that no code path hooked): the Commons watcher backstops untracked records into vacancies each turn.
- **Claimed race vanished**: the reconcile step reopens the vacancy and retries the spawn in the same pass.
- **General resolved while a vacancy was scheduled**: marked `subsumed`, not filled.
- **Duplicate spawn after a turn retry**: vacancy creation is idempotent per record and the live-special check blocks a second race.
- **Governor seat stuck empty with no race**: look for the suppression reasons (cooldown, live regular race); otherwise a data repair re-creates the holder-less record so the watcher picks it up.
- **Senate seat left vacant**: no automatic recovery before the class election; only a governor can appoint.

## Connections

**Driven by:**

- [Election Mechanics](./elections.md): regular cycles decide when a vacancy is superseded (`regularRaceFillsSeatFirst`, `ensurePerpetualElections`).
- Resignation, retirement and removal (`src/lib/settings/resignations.ts`, `src/lib/retireCharacter.ts`) create the holder-less record the watchers read.
- UK recall petitions (`recallPetitionShell.ts`) create `recall` vacancies.

**Affects:**

- [State-Level Power](./state-level-power.md): a vacant governorship removes executive powers, including senate appointments.
- [United Kingdom](./united-kingdom.md): Commons seat counts and confidence votes.
- Chamber seat counts and party seat counts (House, State Senate, Senate, Commons).
- Action and fund bonuses: an appointed senator receives the Senate office bonuses at the next refresh (see [Stats & Actions](./stats-actions.md)).

Related pages:

- [Election Mechanics](./elections.md) - Election cycles and perpetual races
- [United Kingdom](./united-kingdom.md) - Commons vacancies and by-elections
- [State-Level Power](./state-level-power.md) - Governors and appointments

## Tests

- `src/lib/turn/byElections.test.ts`: governor by-election watcher, cooldown, suppression, RU gating.
- `src/lib/turn/commonsByElections.test.ts`: UK vacancy recording, carve sizing, spawn and reconcile, recall triggers.
- `src/lib/countries/uk/elections/byElectionCarve.test.ts`, `src/lib/countries/uk/elections/commonsVacancyStatus.test.ts`: carve fraction and vacancy status.
- `src/lib/settings/resignations.test.ts`: settings resignation path.
- Gaps: no test found for `appointSenator` or the eligible-appointees route, none for the resign endpoint's rate limit, and none for recall petition signature or support-check resolution.

## Known issues and history

Not built (deliberately excluded):

1. Special elections for House and State Senate.
2. Lieutenant Governor office with automatic succession.
3. Death and mortality events that trigger vacancies.
4. Chamber expulsion by a two-thirds vote.

- The Senate appointment fallback term (6 years) is a fixed 6 * 365 days, not game-calendar based.
- The two resignation code paths differ: the settings path tombstones UK Commons seats and writes a vacancy, while the resign endpoint deletes non-executive records outright.

Last checked: 2026-10-29, version 1.18.0
