# Japan - Elections & Bills

## Summary

Technical rules for how Japan elects its Diet, how the Prime Minister can dissolve the lower house, and how a bill moves between the two chambers. Both Diet chambers and the regional bodies use proportional seat sharing by largest remainder (the "Hare quota" method). The Shūgiin can be dissolved by the PM (snap election); the Sangiin cannot. Bills pass through Cabinet review, Shūgiin and Sangiin, with Shūgiin supremacy on rejection.

Player guide: [Japan](https://www.ahousedividedgame.com/wiki/jp-overview). Country structure: [Japan](./japan.md).

## Rules

### Electoral System

Japan uses **Hare-quota proportional representation** (`pr_hareQuota`) for Shūgiin, Sangiin, and Regional Council seats (`electionSystems` in `src/lib/countries/jp/institutionsFacts.ts`, and every era override under `src/lib/countries/jp/eras/`). A mixed-member system is not used for regular races. The 1991 world carries a frozen record of the pre-1994 multi-member law (`sntv-1991-v1`) that fixes its seat map, and a bill-gated 1994 reform to 300 district plus 200 list seats can replace it from 1994 on (`src/lib/countries/jp/rules/shugiinElectoralLaw.ts`). Some description strings in the country config still say "FPTP"; the electoral system key is what the engine reads.

Seat totals depend on the starting preset (`getJpShugiinSeats`, `getJpSangiinSeats` in `src/lib/countries/jp/data/jpSeats.ts`):

| Preset | Shūgiin | Sangiin | Coalition threshold in config | Majority the live government uses | Source |
| --- | --- | --- | --- | --- | --- |
| Modern default (2019 and later) | 465 | 248 | 233 | 233 | `jpSeats.ts`, `institutionsFacts.ts` |
| `1953-default` | 466 | 248 | 234 | 234 | `jpSeats.ts`, `eras/1953.ts` |
| `1991-default` | 512 | 252 | 233 (inherited, not overridden) | 257 | `jpSeats.ts`, `eras/1991.ts` |

The live majority is `floor(seats / 2) + 1` of the live chamber (`lowerChamberMajorityThreshold` in `src/lib/legislature/lowerChamberSeats.ts`), stored on the government formation as `majorityThreshold`. The config `coalitionThreshold` is only a fallback.

#### How seats are shared

`allocateSeats` calls `largestRemainderSeats` (`src/lib/turn/election/seatAllocation.ts`) for each regional race:

1. Each party's candidate votes are pooled. A party enters the pool only if its pooled votes are at least `minShare` of **all votes cast** in the race.
2. `exact = partyVotes / poolVotes x seats`; each party gets `floor(exact)`.
3. Remaining seats go to the largest fractional remainders.
4. If nobody clears the gate, seats fill in ranked order. Sub-threshold parties are never re-admitted next to qualifying ones.

`minShare` comes from `getMultiSeatMinShare` (`src/lib/turn/election/rules/seatEligibility.ts`):

| Election type | Gate |
| --- | --- |
| `shugiin`, `snap_shugiin`, `regionalCouncil` | 0.10 (`STANDARD_MULTI_SEAT_MIN_SHARE`) |
| `sangiin` | No entry in the function, so it falls through to the default **0.20** |

#### Seat maps

| Region | Shūgiin | Sangiin | Class 1 | Class 2 |
| --- | --- | --- | --- | --- |
| Hokkaido | 12 | 7 | 4 | 3 |
| Tohoku | 37 | 20 | 10 | 10 |
| Kanto | 150 | 80 | 40 | 40 |
| Chubu | 81 | 44 | 22 | 22 |
| Kansai | 82 | 44 | 22 | 22 |
| Chugoku | 28 | 14 | 7 | 7 |
| Shikoku | 14 | 8 | 4 | 4 |
| Kyushu | 61 | 31 | 16 | 15 |
| Total | 465 | 248 | 125 | 123 |

Source: `src/lib/countries/jp/data/jpSeats.ts` (`getJpSangiinClassSeats`). Class 1 is `ceil(regionSeats / 2)`, Class 2 is `floor(regionSeats / 2)`.

#### The 1994 reform (1991 world only)

`isJapanShugiinReformEligible` requires preset `1991-default`, country JP and a game year of 1994 or later. Once the reform bill passes, new races use `mixed-1994-v1`, frozen per race in `japanShugiinRules` (`ruleVersion`, `districtSeats`, `listSeats`). Old campaigns keep SNTV 512 until an explicit approval.

| Region | District seats (`JP_SHUGIIN_1994_DISTRICT_SEATS`) | List seats (`JP_SHUGIIN_1994_LIST_SEATS`) |
| --- | --- | --- |
| HOK | 13 | 9 |
| TOH | 26 | 16 |
| KAN | 85 | 63 |
| CHU | 57 | 36 |
| KNS | 47 | 33 |
| CGK | 21 | 13 |
| SHI | 13 | 7 |
| KYU | 38 | 23 |
| Total | 300 | 200 |

### Election Types

#### Shugiin (House of Representatives)

- **465 seats** across 8 regions in the default setup; the 1953 start has 466 and the 1991 start has 512 (`src/lib/countries/jp/data/jpSeats.ts`)
- **Duration:** 192 turns (168 primary + 24 general), `DEFAULT_DURATIONS.shugiin` in `src/lib/constants/electionDurations.ts`
- **Term cycle:** 4 game years (192 turns; 48 turns per game year)
- All seats contested every cycle
- Can be dissolved via snap election

#### Sangiin (House of Councillors)

- **248 seats** across 8 regions in the default setup (252 in the 1991 start), split into 2 staggered classes
- **Duration:** 144 turns (120 primary + 24 general), `DEFAULT_DURATIONS.sangiin`
- **Term cycle:** 6 game years (288 turns, `JP_SANGIIN_CYCLE_PERIOD_HOURS`) per class; half-elections every 3 game years (144 turns)
- Every region contests **both** classes. Class 1 seats = `ceil(regionSeats / 2)` (**125** total). Class 2 seats = `floor(regionSeats / 2)` (**123** total). Together they sum to 248 (`getJpSangiinClassSeats`). The 1991 map has all-even regional totals, so each class holds 126 of 252.
- Class 1 / Class 2 are not "some regions vs others." Hokkaido 4+3, Tohoku 10+10, Kanto 40+40, Chubu 22+22, Kansai 22+22, Chugoku 7+7, Shikoku 4+4, Kyushu 16+15.
- Cannot be dissolved - provides legislative continuity

#### Governor

- **1 per region** (8 total)
- **Duration:** 192 turns (168 primary + 24 general), `DEFAULT_DURATIONS.governor`
- **Term cycle:** 4 game years (192 turns)
- Uses generic `ensurePerpetualElections` path (same as US governors), via `ensureRegionalGovernorElections("JP", ...)`

#### Regional Council

- Spawned by `ensureJPRegionalCouncilElections`, using the `regionalCouncil` duration entry (48 turns: 24 primary + 24 general).

### Snap Elections

The PM can dissolve the Shugiin and trigger a snap election.

#### Snap rules

- **Who:** Sitting PM only
- **Limit:** 2 snap elections per PM appointment (`SNAP_ELECTION_LIMIT`, resets on new PM)
- **Cooldown:** 336 turns (`SNAP_ELECTION_COOLDOWN_TURNS`, 2 real-time weeks) between snap elections, refused while `currentTurn - lastSnapElectionTurn < 336`
- **Blocked while** a vote of no confidence is active
- Limit and cooldown are in `src/lib/turn/snapElection.ts`
- **Scope:** Shugiin only - Sangiin is unaffected
- **Duration:** 48 turns (24 primary + 24 general), `DEFAULT_DURATIONS.snap_shugiin`
- **Election type:** `"snap_shugiin"` (distinct from regular `"shugiin"`)

#### Effects

`triggerSnapElection` runs these steps in order:

1. All active/upcoming regular Shugiin elections and Shugiin by-elections are cancelled, and their candidates withdrawn.
2. In-progress Shūgiin bills are failed (`failInProgressBills`, statuses in `LOWER_CHAMBER_FAIL_STATUSES`). Sangiin-origin, Cabinet-review, and enrolled bills are preserved.
3. Fresh snap elections spawn for all 8 regions, starting immediately.
4. Every sitting Shūgiin member is vacated (`vacateDissolvedLowerChamber`: official records deleted, `currentOffice` cleared on characters and NPPs).
5. `snapElectionsUsed` is incremented and `lastSnapElectionTurn` stamped.
6. The PM is vacated and the government resets to "pending" (`unformGovernmentAndVacatePM`), arming the 96-turn vacancy clock; a new PM appointment process begins.
7. After resolution, the next regular Shūgiin cycle is anchored at the snap election's end turn plus 192 turns (`planNextLowerChamberCycle`).

A snap imposed by a peace settlement (`reason: "regime-change"`) spends no snap allowance and does not shift the regular calendar.

#### Tracking

- `snapElectionsUsed: number` on GovernmentFormation document
- `lastSnapElectionTurn: number | null` on GovernmentFormation document
- Both reset when a new PM is appointed

#### API

- `POST /api/country/[code]/pm/snap-election` - PM-only, config-gated via `snapElectionsAllowed` (`src/app/api/country/[code]/pm/snap-election/route.ts`)

### Major Party Spoiler Modeling

Vote accumulation still uses configured major-party sets when applying spoiler redistribution before PR allocation (`src/lib/constants/countries.ts`):

- **Kansai (KNS):** `{ ishin, ldp }` - Nippon Ishin dominates as opposition
- **All other regions:** `{ ldp, cdp }` - from `COUNTRY_CONFIGS.JP.majorPartyIds` (`ryo`, `jsp` in the 1953 preset)

### Government Formation

Parliamentary system matching the UK pattern:

1. Post-election: largest party leader nominated as PM
2. PM appointment vote in Shugiin (lower house only)
3. Coalition negotiation if no majority (the majority is `floor(seats / 2) + 1`, 233 for the modern preset)
4. Minority government attempt if no coalition: a bloc with at least `ceil(seats x 0.1538)` seats (`MINORITY_SEAT_FRACTION`, `src/lib/government/rules/appointmentEligibility.ts`; 72 of 465) may propose a PM
5. No-confidence vote handling (48-turn cooldown, `NO_CONFIDENCE_COOLDOWN_TURNS` in `src/lib/constants/governmentFormation.ts`)

If no PM is appointed within 96 turns of the government entering "pending" (`PM_VACANCY_DEADLINE_TURNS` in `src/lib/constants/turnTime.ts`, stored as `pmVacancyDeadlineTurn`), an automatic snap election fires with limits bypassed.

### Bills - Bicameral Lifecycle

#### Diet Bill Flow

```
Cabinet-origin:
  "cabinet_review" → "active" (Shugiin) → "active_other" (Sangiin) → "signed"
                                                 ↓ reject
                                           "override_shugiin" → "signed" / "failed"

Shugiin-origin (Diet member):
  "active" (Shugiin) → "active_other" (Sangiin) → "signed"
                              ↓ reject
                        "override_shugiin" → "signed" / "failed"

Sangiin-origin (Diet member):
  "active" (Sangiin) → "active_other" (Shugiin) → "signed"
                               ↓ reject
                            "failed"   (no override - Shugiin supremacy)
```

#### Key Differences from US System

- **No executive veto** - passage in both chambers = enacted immediately
- **Shugiin override** - if Sangiin rejects, Shugiin can override with 2/3 of votes cast (`passRule: "twoThirdsCast"`). Every other vote (Cabinet, Shugiin, Sangiin) is a simple majority of votes cast, and a tie fails. Each chamber vote lasts 24 hours (`VOTING_HOURS`). The whole lifecycle is frozen while the JP government is forming (`skipWhenGovPending`).
- Defined in `src/lib/countries/jp/elections/billLifecycle.ts` (`JP_NATIONAL_CONFIG`)
- **Chamber keys:** `"shugiin"` / `"sangiin"` (not `"house"` / `"senate"`)
- Entering `override_shugiin` clears the Shūgiin whip records so the override is a fresh vote.

#### Cabinet-Origin Bills

- PM or Cabinet members can propose bills through Cabinet review
- `"cabinet_review"` status with 24-hour vote duration (`CABINET_VOTE_DURATION_MS`, `src/app/api/country/[code]/legislature/cabinet-bills/route.ts`)
- PM + all player-held cabinet positions vote (simple majority of votes cast); proposing needs at least 2 distinct player-held positions including the PM (counted as distinct characters, so one person holding two portfolios counts once)
- NPP-held positions don't vote and don't count against threshold
- On pass: enters normal Shugiin → Sangiin cycle with `originChamber: "cabinet"`
- Limit: 1 cabinet bill in `"cabinet_review"` at a time per country
- Config-gated: `cabinetBillsEnabled: true` (only JP in v1)

#### Diet-Member Bills

Any seated Shūgiin or Sangiin member may propose a national bill.

- Proposals follow the shared Diet proposal form (category + 1-3 provisions), with the standard action-point and national-influence costs defined in `shared/constants/legislation.ts`.
- **Origin chamber** is the sponsor's own chamber - Shūgiin members originate in Shūgiin, Sangiin members originate in Sangiin.
- **Second chamber** is the opposing chamber. On passage there, the bill enacts (no executive signing step - Japan's parliamentary system has no PM signature).
- **Shūgiin supremacy on rejection:** if the second chamber rejects, behavior depends on origin:
  - Shūgiin-origin bills rejected by the Sangiin → Shūgiin 2/3 override vote.
  - Sangiin-origin bills rejected by the Shūgiin → fail outright; the Sangiin cannot override the Shūgiin.
- **Cabinet bills** continue to use the existing `cabinet_review` path (PM + ministers).

## Data

| Collection | Read | Written | Player-visible |
| --- | --- | --- | --- |
| `governmentFormations` (`_id: "JP"`) | `status`, `snapElectionsUsed`, `lastSnapElectionTurn`, `pmVacancyDeadlineTurn`, `pmCharacterId`, `majorityThreshold` | `snapElectionsUsed`, `lastSnapElectionTurn`, `status` (to `pending`), PM fields cleared, `pmVacancyDeadlineTurn` | Government page, yes (counters partly) |
| `elections` | active and upcoming `shugiin` rows and by-elections | `status: "cancelled"` on dissolved races; new `snap_shugiin` rows (`cycle`, `electionYear`, `startTurn`, `primaryEndTurn`, `endTurn`, `totalSeats`, `allocationMethod`, `japanShugiinRules`, `imposedSnap`) | Yes |
| `electionCandidates` | rows of cancelled races | `status: "withdrawn"`, `withdrawnAt` | Yes |
| `electedOfficials` | seated Shūgiin and Sangiin members (votes are scoped to current holders) | Shūgiin rows deleted on dissolution; seat rows written at resolution | Yes |
| `characters`, `npps` | `currentOffice` | `currentOffice: null` for dissolved Shūgiin members | Yes |
| `bills` | `status`, `currentChamber`, `originChamber`, `votes`, `otherChamberVotes`, `votingEndsAt` | `status`, `currentChamber`, `failedAt` | Yes |
| `billWhips` | Shūgiin whips for the bill | deleted on entering `override_shugiin` | Whip owners |
| `cabinetMembers` | player-held positions (for quorum and voters) | no | Yes |
| `noConfidenceVotes` | active vote blocks a PM snap | no | Yes |
| `seats`, `states` | seat totals per region, region list | no | Seat maps, yes |
| `countryGameStates` (`_id: "JP"`) | `jpShugiinElectoralMandate` | set when the 1994 reform bill passes | No |
| `gameState` | `currentTurn`, `preset` | no | No |

## Configuration

| Setting | Default and where set | Effect |
| --- | --- | --- |
| `gameState.preset` | world seed (`1953-default`, `1991-default`, or modern) | Seat totals, era overrides, 1994 reform eligibility |
| `electionSystems` (`lowerChamber`, `upperChamber`, `subNationalChamber`) | `pr_hareQuota` in `src/lib/countries/jp/institutionsFacts.ts` and each era file | Chooses the allocation path |
| `lowerElectionSystem.snapElectionsAllowed` | true (`institutionsFacts.ts`); `upperElectionSystem.snapElectionsAllowed` false | Gates the snap API and the vacancy watcher |
| `termYears`, `seatsContested`, `staggeredClasses` | 4 / all / (6, partial, 2 classes) in `institutionsFacts.ts` | Cycle shape |
| `coalitionThreshold` | 233 in `institutionsFacts.ts`, 234 in `eras/1953.ts` | Fallback only, see the seat table |
| `majorPartyIds` | `["ldp", "cdp"]`, `["ryo", "jsp"]` in 1953 | Spoiler sets |
| `cabinetBillsEnabled` | true for JP only (`institutionsFacts.ts`) | Enables the Cabinet-review route |
| `cabinetEligibleChamberKeys` | `["shugiin", "sangiin"]` | Who can sit in Cabinet |
| `DEFAULT_DURATIONS` | `src/lib/constants/electionDurations.ts` | All election window lengths |
| `SNAP_ELECTION_LIMIT`, `SNAP_ELECTION_COOLDOWN_TURNS` | 2, 336 in `snapElection.ts` | PM snap gates |
| `PM_VACANCY_DEADLINE_TURNS`, `NO_CONFIDENCE_COOLDOWN_TURNS` | 96, 48 | Government clocks |
| `jpShugiinElectoralMandate` | unset until the reform bill passes | Switches new races to the 1994 mixed rules |

There are no per-world feature flags for the Diet bill flow itself.

## Timing

- **Regular races** open and resolve in the country election phases `jpElections` (Shūgiin), `jpCouncillorElections` (Sangiin), `jpGovernorElections` and `jpRegionalCouncilElections` (names in `src/simulation/phases/countryElectionPhaseNames.ts`; spawners in `src/lib/countries/jp/elections/perpetual.ts`).
- **Snap elections** are triggered synchronously by the PM through the API (`POST /api/country/[code]/pm/snap-election`), or by the turn-phase vacancy watcher `processPMVacancyDeadlines` (`src/lib/turn/pmVacancyDeadline.ts`, called from `src/lib/turn/countryPhases.ts`) once the 96-turn deadline passes. `triggerSnapElection` cancels the old races, fails Shūgiin bills, spawns the snap races and resets the government in one call.
- **Bills** advance in the `billLifecycle` turn phase (`src/simulation/phases/turnPhaseRegistry.ts`), which closes expired votes and moves each bill to its next status. Bills are frozen while the government is pending (`skipWhenGovPending`).
- After a snap, `planNextLowerChamberCycle` (`src/lib/elections/snapShift.ts`) anchors the next regular Shūgiin to the snap's end turn plus 192. If that leaves less than 24 turns of primary or general, `pickNextCanonicalCycle` skips forward to a later cycle.

```
PM call (or 96-turn vacancy watcher)
  -> triggerSnapElection
       cancel regular Shugiin races -> fail Shugiin bills -> spawn snap_shugiin x8
       -> vacate Shugiin seats -> count snap -> PM vacated, government "pending"
  snap runs 48 turns (24 + 24) -> resolves per region
  -> PM appointment vote (Shugiin) ... bills frozen until government forms
  -> next regular Shugiin anchored at snap end + 192
```

## Worked trace

**Seat sharing.** A Shūgiin region elects 14 seats. 104,000 votes are cast: A 49,000, B 31,000, C 18,000, D 6,000. The gate is 10% of 104,000 = 10,400, so D (5.8%) is out. Pool votes are 98,000. Exact shares: A `49,000 / 98,000 x 14` = 7.0000, B 4.4286, C 2.5714. Floors: 7, 4, 2 (13 seats). Remainders: A 0, B 0.4286, C 0.5714, so C takes the last seat. Result: A 7, B 4, C 3, D 0. The same votes in a Sangiin race with the 0.20 gate (20,800 votes): only A (47.1%) and B (29.8%) qualify, C at 17.3% does not. Pool 80,000: A `8.575`, B `5.425`, floors 8 and 5, A has the larger remainder, so A 9, B 5, C 0.

**Snap election.** On turn 10,000 a PM with no previous snaps calls one. The snap lasts 48 turns, so primaries end on turn 10,024 and the general on 10,048. The next regular Shūgiin race is anchored to 10,048 + 192 = 10,240, so it spans turns 10,048 to 10,240 with its general starting at 10,216. `snapElectionsUsed` becomes 1 and `lastSnapElectionTurn` is 10,000, so the next call is refused until turn 10,336 (336 turns later). A call is refused if the used count is already 2. Vacating the PM arms the vacancy clock at `pmVacancyDeadlineTurn = 10,000 + 96 = 10,096`; if the government is still pending at that turn, the watcher fires an automatic snap that ignores both gates.

**Bill.** A Shūgiin-origin bill passes the Shūgiin at 24 hours, then the Sangiin rejects it (simple majority of votes cast needed, a tie fails). It moves to `override_shugiin`, whips are cleared, and the Shūgiin needs 2/3 of votes cast: with 300 votes cast, 200 are needed, 199 fails the bill.

## Edge cases and limits

- The Sangiin is never dissolved, and its half-election schedule is untouched by a Shūgiin snap.
- A snap does not fail Sangiin-origin, Cabinet-review or enrolled bills.
- A Sangiin-origin bill rejected by the Shūgiin fails outright; the Sangiin has no override, which is the Shūgiin supremacy rule.
- Cabinet bills: only one in review per country at a time; NPP-held cabinet positions do not vote and do not raise the threshold; fewer than 2 player holders blocks a proposal. Cabinet bills are enabled only for Japan (`cabinetBillsEnabled`).
- Kansai's spoiler set is `{ishin, ldp}`; other regions use `majorPartyIds` (`ldp`, `cdp` modern; `ryo`, `jsp` in 1953).
- The Sangiin class split uses `ceil`/`floor`, never `ceil` for both, which would create phantom seats in Hokkaido and Kyushu.
- A region with no qualifying party seats in ranked order; a zero-vote pool seats the leading candidate rather than nobody.
- The vacancy watcher is idempotent: it does not start a second snap while a live `snap_shugiin` race exists (`shouldStartVacancySnap`).
- A snap is refused if the country has no election regions, before anything is cancelled.
- An old 1991 race still carrying the former SNTV snapshot is read through the proportional rule, so projection and result agree.

## Invariants

| Invariant | Enforced by |
| --- | --- |
| Seats awarded in a race sum to the race's seat total | `largestRemainderSeats`; tested in `src/lib/turn/election/largestRemainderSeats.test.ts`. A runtime cap scales down any over-allocation in `allocateSeats` |
| Class 1 plus Class 2 equals the regional Sangiin total | `getJpSangiinClassSeats`; tested in `src/lib/countries/jp/data/jpSeats1991.test.ts` |
| Shūgiin supremacy: Sangiin-origin bills never reach override | `JP_NATIONAL_CONFIG.onRejectFn`; tested in `src/lib/turn/jpBillLifecycle.test.ts` |
| At most 2 PM snaps per appointment and 336 turns between them | `triggerSnapElection`; tested in `src/lib/turn/snapElection.test.ts` |
| A dissolution never strands the country without races | Region check before any write; tested in `snapElection.test.ts` |
| One cabinet bill in review per country | Route check; no dedicated test found |
| 1994 reform race seat split is law-consistent (300 + 200) | `japanShugiinFrozenRegionCapacity`; tested in `src/lib/countries/jp/rules/shugiinElectoralLaw.test.ts` |

## Failure and recovery

- **Snap fails part-way** (a write error after races are cancelled). Steps are not one transaction; the auto-snap path claims the `lastSnapElectionTurn` stamp first so a retry on a later turn does not double-dissolve, and a failed pre-spawn attempt can retry. A half-applied PM-triggered snap is repaired by an admin heal of elections and government state.
- **Wrong race seat total** on a legacy 1991 race: healed from a legally valid frozen regional split (`shugiinElectoralLaw.test.ts` covers the heal rule).
- **PM never seated**: the 96-turn watcher dissolves the chamber automatically; repeated vacancies keep re-firing it without consuming the allowance.
- **Bills stuck** while the government is pending: they resume when a government forms, no manual step.
- **Seat shortfall or phantom seats** in a Sangiin class: a reseed of the seat map or a heal of the affected race fixes it.

## Connections

**Driven by:**
- [Parliamentary Government](./parliamentary-government.md): PM appointment, no-confidence and the vacancy deadline (`src/lib/turn/parliamentaryGovernment.ts`).
- [Snap Elections](./snap-elections.md): the shared trigger and limits (`src/lib/turn/snapElection.ts`).

**Affects:**
- [Bills and Legislation](./bills-legislation.md): in-progress Shūgiin bills fail on dissolution (`failInProgressBills`).
- [Government Approval](./government-approval.md): a new government clears the cabinet, which costs approval until seats are filled.
- [Live Election Results](./live-election-results.md): Shūgiin and snap Shūgiin results feed the national board.

## Tests

| File | Covers |
| --- | --- |
| `src/lib/turn/snapElection.test.ts` | Snap trigger, limit, cooldown, VONC block, bill failure, cycle numbering, JP 1994 rules on snap races, imposed snaps |
| `src/lib/turn/pmVacancyDeadline.test.ts` | Auto-snap watcher |
| `src/lib/turn/jpBillLifecycle.test.ts` | Diet bill transitions, override, cabinet review majority and tie |
| `src/lib/turn/election/seatAllocation.test.ts`, `largestRemainderSeats.test.ts` | Allocation method per preset, largest remainder |
| `src/lib/turn/election/rules/seatEligibility.test.ts` | Gate values (Shūgiin 0.10) |
| `src/lib/countries/jp/data/jpSeats1991.test.ts` | Seat maps and class split |
| `src/lib/countries/jp/rules/shugiinElectoralLaw.test.ts` | 1994 reform seat capacity |
| `src/app/api/country/[code]/legislature/cabinet-bills/route.test.ts` | Cabinet-bill route |
| `src/app/api/country/[code]/pm/snap-election/route.integration.test.ts` | Snap API |

Gaps: no test pins the Sangiin gate value; no test for `planNextLowerChamberCycle` with a JP snap; the Cabinet 2-holder quorum rule is not covered by a named test here.

## Known issues and history

- Contradiction with the player wiki: the Japan overview says both chambers use a 10% pooled-vote gate. `getMultiSeatMinShare` lists `shugiin` and `regionalCouncil` at 0.10 but has no `sangiin` entry, so Sangiin races use the 0.20 default. The code wins; it is unclear whether the omission is intended.
- Contradiction with the player wiki: it says 124 Sangiin seats are up per class. The code gives 125 (Class 1) and 123 (Class 2).
- Contradiction with the previous version of this page: durations were listed as 144+48 (Shūgiin, Governor) and 72+72 (Sangiin). The code has 168+24, 168+24 and 120+24.
- The 1991 era config does not override `coalitionThreshold` (inherits 233 of 512); the live government uses the derived 257, so the config value is stale but unused in practice.
- Some country config description strings still say "FPTP" and `singleMemberConstituencies: true`; the engine reads `electionSystems` only.
- The 1994 mixed reform is gated to the 1991 world from game year 1994 and by a passed bill.

Last checked: 2026-10-29, version 1.18.0
