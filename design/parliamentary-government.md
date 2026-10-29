# Parliamentary Government

## Summary

Government formation, head-of-government appointment votes, post-election Confidence Motions, Votes of No Confidence (VONC) and the legislation freeze. It applies wherever `isParliamentarySystem(config)` is true (`src/lib/constants/countriesCore.ts`): `parliamentaryMonarchy`, `parliamentaryRepublic` and `onePartyState`. That covers the UK, Japan, Germany, Ireland and the one-party countries that seat a head of government through the shared path. A pending government freezes legislation; a sitting government can be removed by a VONC or by losing a post-election confidence motion; a country stuck without a head of government for 96 turns is sent to an automatic snap election.

Player guide: [Government Formation](https://www.ahousedividedgame.com/wiki/government-formation)

## Rules

| Constant or rule | Value | Source |
| --- | --- | --- |
| PM appointment vote, confidence motion and VONC duration | 24 turns (`PM_VOTE_DURATION_HOURS`, one turn is one game hour) | `src/lib/constants/governmentFormation.ts` |
| PM vacancy deadline (orphaned-PM safety net, re-armed on every vacate) | 96 turns (`PM_VACANCY_DEADLINE_TURNS`) | `src/lib/constants/turnTime.ts` |
| Cooldown between no-confidence votes | 48 turns (`NO_CONFIDENCE_COOLDOWN_TURNS`), measured from the last vote's `turnProposed` | `src/lib/constants/governmentFormation.ts` |
| Chamber majority threshold | `floor(totalSeats / 2) + 1` (`lowerChamberMajorityThreshold`) | `src/lib/legislature/lowerChamberSeats.ts` |
| Minimum seats to nominate (minority bid) | `ceil(lowerChamberSeats * 0.1538)`, so 100 of 650 and 72 of 465 (`MINORITY_SEAT_FRACTION`); at or above the majority threshold the bid is `majority` | `src/lib/government/rules/appointmentEligibility.ts` |
| Vote closes when | `currentTurn >= closesOnTurn`; falls back to `closesAt` only for documents without `closesOnTurn` (`isVoteClosed`) | `src/lib/turn/parliamentaryGovernment.ts` |
| Tally | Recomputed seat-weighted at resolution (`computeParliamentaryGovernmentTally`); the cached running counters are overwritten | `src/lib/turn/parliamentaryGovernment.ts` |
| Appointment vote passes when | `votesFor > votesAgainst` (a tie seats nobody) | `resolveParliamentaryAppointmentVote` |
| Confidence motion passes when | `votesFor >= votesAgainst` (a tie, or an empty ballot, keeps the PM) | `resolveParliamentaryAppointmentVote` |
| VONC carries when | `votesFor >= majorityThreshold` of the whole chamber; abstentions and unvoted seats count for the government (`noConfidenceMotionCarries`) | `src/lib/turn/parliamentaryGovernment.ts` |
| VONC threshold fallbacks | stored `majorityThreshold`, else `floor(totalSeats / 2) + 1`, else `votesFor > votesAgainst` when neither number exists | `noConfidenceMotionCarries` |
| Freeze applies when | `isParliamentarySystem(config)` and `governmentFormations.status === "pending"` | `src/lib/government/legislationFreeze.ts` |
| Freeze message | "Government is in formation; legislation is frozen until a PM is seated" (`LEGISLATION_FREEZE_MESSAGE`) | `src/lib/government/legislationFreeze.ts` |
| Who may move a VONC | the ruling-party tier only in one-party states (`canTriggerNoConfidence`) | `src/lib/government/commands/parliamentaryGovernment.ts` |

The appointment rule and the VONC rule are deliberately different. A VONC removes a sitting government, so it needs a majority of the whole chamber, not a majority of whoever voted. The confidence motion is the inverse of an appointment: the incumbent stays unless nays strictly outnumber ayes. The asymmetry exists so that a tie, or a low turnout, never unseats a sitting government.

### Confidence Motion

When a lower-chamber general election resolves and the incumbent PM retained a lower-chamber seat, `openConfidenceMotionForIncumbent` files a `pmAppointmentVotes` document with `isConfidenceMotion: true`, the incumbent as nominee, and a 24 turn window. The PM stays in office (`status` stays `"formed"`) while it runs. Vote resolution:

- **Passes:** the PM stays. No `appointPrimeMinister` call is made, so there is no cabinet clear, no duplicate "appointed" career event, and `formedAt`, `formedTurn`, `snapElectionsUsed` and `pmVacancyDeadlineTurn` are left alone because the office never vacated.
- **An alternative candidate's appointment vote passes first:** the alternative is seated through `appointPrimeMinister`. When the motion later fails, the resolver looks for a passed non-motion vote closed since the motion opened and, finding one, skips the vacate.
- **Fails with no alternative passed:** `unformGovernmentAndVacatePM` runs with `reason: "confidence-motion-failed"`. Status goes `pending`, cabinet cleared, the 96 turn vacancy clock re-armed, and the legislation freeze starts.

### VONC-parallel PM nominations

PM appointment votes can be filed when `status === "pending"`, or when `status === "formed"` and an active `noConfidenceVotes` document exists for the country. `proposePmAppointment` (`src/lib/government/commands/parliamentaryGovernment.ts`) returns a 400 only when neither is true. Nomination needs an eligible party chair or coalition chair (`checkAppointmentEligibility`) and is serialized by a 30 second lock on the formation document.

- **VONC passes:** `unformGovernmentAndVacatePM` with `reason: "no-confidence"`. Parallel appointment votes keep running on their own timers and resolve in the new pending window.
- **VONC fails:** all active PM appointment votes for the country are set to `cancelled` with `closedAt = now`, each character nominee is notified, and the PM gets a "Survived No-Confidence Vote" notification that names the seat threshold.

### Legislation freeze

While `governmentFormations.status === "pending"` for a parliamentary country, legislation is frozen. The shared rule is `isLegislationFrozen(db, countryId)`; the HTTP wrapper is `checkLegislationFreeze` in `src/lib/api/parliamentaryFreeze.ts`, which returns a 400 with the freeze message.

- **Route gates** (under `src/app/api/`): `country/[code]/legislature/bills`, `country/[code]/legislature/cabinet-bills`, `country/[code]/legislature/cabinet-bills/[id]/vote`, `country/[code]/international-organizations/[orgId]/propose-leave`, `country/[code]/constitution/proposal` (RU), `country/[code]/federation/proposal`, the three `electoral-reform` proposal routes, `country/[code]/constitutional-reform/1991/proposal`, and `congress/bills`.
- **Turn gate:** bill lifecycle configs with `skipWhenGovPending: true` are skipped by `src/lib/turn/billLifecycle/engine.ts` while the government is pending. That flag is set in `src/lib/turn/billLifecycle/configs/configuredCountry.ts`, `src/lib/countries/uk/elections/billLifecycle.ts` and `src/lib/countries/jp/elections/billLifecycle.ts`. Bills in flight keep their status.
- **NPP gate:** `src/lib/turn/npp/billSponsorship.ts` calls `isLegislationFrozen` directly, so NPP sponsorship and the HTTP gate apply the identical rule.
- **Lift:** automatic. The next turn sees `status === "formed"` and processes normally.

### Government confidence gauge

A separate 0..100 gauge (`confidenceGauge` on the formation document) is ticked every turn for formed governments in every parliamentary country except the UK, which the phase skips (`src/simulation/phases/parliamentaryGovernmentConfidencePhase.ts`). Per-turn drift: at approval `a >= 50` it recovers `((a - 50) / 50) * 5`; below 50 it erodes `((50 - a) / 50) * 2 * erosionScale`, where `erosionScale = clamp(turnsInOffice / rampTurns, 0, 1)`. Event hits include `lostVonc` 40, `budgetDefeat` 60, `lostKeyVote` 15, `ministerFired` 8 and `ministerResigned` 12 (`src/lib/countries/uk/confidence/confidenceGauge.ts`). Automatic dissolution at 0 is off unless the `UK_CONFIDENCE_GAUGE_DISSOLUTION` environment variable is `1`. See [uk-pm-no-confidence.md](./uk-pm-no-confidence.md).

## Data

| Collection | Key fields | Player visible |
| --- | --- | --- |
| `governmentFormations` (`_id` is the `CountryId`) | `status` (`pending`, `formed`, `collapsed`), `pmCharacterId`, `pmNppId`, `pmName`, `governingPartyId`, `coalitionId`, `coalitionPartyIds`, `confidenceAbstentionPartyIds`, `formationType`, `cycle`, `seatsByParty`, `totalSeats`, `majorityThreshold`, `totalSeatsSupporting`, `lostMajority`, `activeVoteId`, `pmVacancyDeadlineTurn`, `snapElectionsUsed`, `lastSnapElectionTurn`, `collapsedAt`, `formedAt`, `formedTurn`, `confidenceGauge`, `confidenceGaugeHistory` | PM, status, seat counts and governing party are shown; locks and counters are not |
| `pmAppointmentVotes` | `nomineeCharacterId`, `nomineeNppId`, `nomineeMode`, `nomineePartyId`, `nominatedByCharacterId`, `coalitionPartyIds`, `votes`, `votesFor`, `votesAgainst`, `isConfidenceMotion`, `office` (`headOfState` for ceremonial seats), `status`, `closesOnTurn`, `closesAt`, `openedAt`, `closedAt` | Yes |
| `noConfidenceVotes` | `proposedByCharacterId`, `targetPmCharacterId`, `votes`, `votesFor`, `votesAgainst`, `status`, `closesOnTurn`, `turnProposed` | Yes |
| `electedOfficials` | read for seat tallies and the incumbent-seat check | Yes |
| `cabinetMembers`, `ukCabinetCooldowns` | deleted on every vacate | Yes |
| `characters`, `npps` | `currentOffice` cleared for the head-of-government office on vacate | Yes |
| `governmentApprovals` | read by the confidence gauge | Yes |
| `gameState` | `currentTurn` read for deadlines | No |

Types are in `src/lib/db/types/governmentFormation.ts`.

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `governmentType` | per country | `src/lib/constants/countries.ts` (type in `countriesCore.ts`); runtime value on `countryState` |
| `confidenceVoteMechanism` | `true` for parliamentary monarchy and republic, `false` for `presidential` and `onePartyState` | `CONFIDENCE_VOTE_MECHANISM_DEFAULTS_BY_GOVERNMENT_TYPE` in `src/lib/constants/countriesCore.ts`; per-country override in `countries.ts` |
| `snapElectionsAllowed` | `true` for parliamentary types, `false` for `presidential` and `onePartyState` | `SNAP_ELECTIONS_ALLOWED_DEFAULTS_BY_GOVERNMENT_TYPE` in `countriesCore.ts` |
| `skipWhenGovPending` | `true` on the configured-country, UK and JP bill lifecycles | the bill lifecycle config files listed above |
| `UK_CONFIDENCE_GAUGE_DISSOLUTION` | unset (off) | environment variable read by `isConfidenceDissolutionEnabled` in `src/lib/countries/uk/confidence/confidenceGaugeStore.ts` |
| Era preset | selects which country set and configs are parliamentary | `getParliamentaryCountryIds(preset)` in `src/lib/turn/parliamentaryGovernment.ts` |

Consequence: one-party states count as parliamentary for the freeze and for the seat and vote phases, but with the defaults above they get no post-election confidence motion and no automatic snap election.

## Timing

Turn phase order from `src/simulation/phases/turnPhaseNames.ts`:

```
billLifecycle            (reads the freeze status left by the previous turn)
...
electionResolution       -> runPostElectionGovernmentPhases
leadershipVacate
parliamentaryGovernmentFormation
russianCouncilComposition / russianAssemblyCampaigns
parliamentaryGovernmentPhases      (per country: seats, votes, NPP auto-aye, NPP PM, ruling party sync)
parliamentaryGovernmentConfidence  (confidence gauge tick, every parliamentary country except UK)
parliamentaryVacancyWatcher        (auto-snap when the 96 turn deadline has passed)
postConversionElections
perpetualElections
```

- `runPostElectionGovernmentPhases` (`src/lib/turn/countryPhases.ts`) runs when a lower-chamber general or snap election resolved within the last turn and no other region of the same cycle is still active or upcoming. It fails in-progress lower-chamber bills (`failInProgressBills`), cancels active VONCs (`cancelActiveNoConfidenceVotes`), and for countries with the confidence mechanism opens the confidence motion and refreshes seat counts (`updateSeatCountsOnly`).
- `runParliamentaryGovernmentPhases` runs each country in isolation inside a try/catch, in this order: seat update, vote resolution (`processParliamentaryGovernmentVotes`), NPP auto-aye, `appointNppPrimeMinister`, ruling-party sync. A throw in one country cannot starve the others.
- Votes resolve on the first turn where `currentTurn >= closesOnTurn`. All expired appointment votes resolve in one loop; if one passes, it cancels the siblings. One VONC resolves at a time.
- The vacancy watcher (`src/lib/turn/pmVacancyDeadline.ts`) runs after the phases so a PM seated this turn has their deadline cleared first.
- The freeze is read live. `billLifecycle` runs earlier in the turn than formation, so it sees the status from the previous turn.

## Worked trace

A 100 seat lower chamber, so the majority threshold is `floor(100 / 2) + 1 = 51`.

1. A VONC is filed on turn 1000. `closesOnTurn = 1000 + 24 = 1024`. The last VONC in that country was proposed on turn 960, so `1000 - 960 = 40 < 48` and the filing is refused with "8 more turns". Filed instead on turn 1008 it is accepted (`48 >= 48`), `closesOnTurn = 1032`.
2. At turn 1032 the tally is 48 ayes, 20 nays, 32 seats unvoted. `48 >= 51` is false, so the motion does not carry even though ayes outnumber nays. The PM survives, `activeVoteId` is cleared, any open appointment votes are cancelled and their nominees notified.
3. Had it been a post-election confidence motion with 40 ayes and 40 nays, `40 >= 40` passes and the PM stays. As an appointment vote, 40 to 40 fails because `40 > 40` is false.
4. If instead a post-election confidence motion closing on turn 1032 fails 30 to 45 with no alternative passed, `unformGovernmentAndVacatePM` stores `status: "pending"`, `pmCharacterId: null`, `formedTurn: null`, and `pmVacancyDeadlineTurn = 1032 + 96 = 1128`. Legislation is frozen from that moment.
5. If nobody is seated by turn 1128, the vacancy watcher triggers an auto snap election with `bypassLimits: true`, if the country supports snap elections.

## Edge cases and limits

- An empty or tied confidence motion keeps the PM. An appointment vote needs ayes strictly above nays, so a tie seats nobody.
- A VONC needs the seat threshold, not a vote majority. 215 ayes and no nays does not carry a 625 seat chamber (threshold 313).
- If the sitting PM no longer holds a lower-chamber seat, no confidence motion is filed (`incumbent-lost-seat`). Separately, the seat update step in `updateParliamentaryGovernmentSeats` checks `hasRequiredPrimeMinisterSeat` every turn and, when the PM has lost the seat, vacates the government with `reason: "lost-seat"` and cancels every active appointment vote and VONC. So the government does not stay formed with a seat mismatch for long; it goes pending at the next seat update.
- NPP PMs are covered. `openConfidenceMotionForIncumbent` accepts either `pmCharacterId` or `pmNppId` and files the motion with `nomineeMode: "npp"`, `nominatedByCharacterId: null`.
- The motion is skipped when there is no incumbent, the government is not `formed`, or a motion is already active.
- A failed VONC cancels every open PM appointment vote. A passed VONC does not.
- An election resolving cancels any active VONC for the country (`cancelActiveNoConfidenceVotes`).
- The freeze covers the routes and lifecycle phases listed in Rules. Bills in flight keep their status. Reason: no mandate means no new law.
- A country with no `governmentFormations` row is never frozen; the seat update step seeds a pending row on the next turn.
- US and CA are not parliamentary, so they are never frozen. DE is parliamentary and is subject to the freeze.
- One-party states count as parliamentary because `isParliamentarySystem` includes `onePartyState`; see [one-party-states-as-shipped.md](./one-party-states-as-shipped.md). They have no confidence motion or snap election by default.
- The head-of-state appointment (`office: "headOfState"`, for example the RU Chairman of the Presidium) shares the `pmAppointmentVotes` collection but resolves through `resolveHeadOfStateAppointmentVote` in `src/lib/turn/hosAppointment.ts` and has no cabinet or confidence side effects.

## Invariants

- Only one of `pending` and `formed` is the live state at a time; a vacate always re-arms `pmVacancyDeadlineTurn`. Covered by `unformGovernmentAndVacatePM` tests in `src/lib/turn/parliamentaryGovernment.test.ts`.
- A vote resolves once: the resolvers claim a vote with an atomic `active` to final status update and the loser returns early. Enforced in code; no direct concurrency test.
- A tie or empty ballot never unseats a sitting PM (tests "empty confidence motion (0-0) does not vacate the incumbent" and the ticket-1137 VONC tests in `parliamentaryGovernment.test.ts`).
- Cabinet and PM `currentOffice` are cleared on every vacate, scoped to the country. Tested ("scopes PM office clear to the given country").
- A frozen country accepts no new bill proposals through the listed routes. Route tests cover the main ones; there is no test that enumerates every gate, so a new proposal route can miss the freeze without a failing test.

## Failure and recovery

- **Stuck pending government:** no eligible chair nominates, or votes keep failing. The 96 turn vacancy watcher fires an auto snap election; if the country does not support snap elections it will stay pending and frozen until a staff repair seats a PM or dissolves.
- **A throw in one country's phase:** logged and isolated, so other countries continue; the affected country skips that turn's seat sync and votes and retries next turn.
- **Stale cached counters or a de-seated voter:** the resolver ignores the running counters and recomputes the seat-weighted tally, so drift self-corrects at resolution.
- **Missing formation row:** the seat update step seeds a fresh pending row from config.
- **Orphaned PM (office holder cleared but status still formed, or the reverse):** repaired by a data heal that realigns the formation row and `currentOffice`; the next seat update re-derives the rest.
- **Dissolved or merged countries:** the phases only visit registered countries, so a merged country no longer receives a ghost government.

## Connections

**Driven by:**

- [Snap elections](./snap-elections.md): a snap dissolution reopens formation (`runPostElectionGovernmentPhases`); the vacancy watcher calls `triggerSnapElection`.
- [UK PM no-confidence](./uk-pm-no-confidence.md): a passed VONC calls `unformGovernmentAndVacatePM`.
- [NPPs](./npp-system.md): NPP deputies vote in appointment votes and VONCs (`autoAyeNPPsForParliamentaryAppointment`, `autoVoteNPPsForNoConfidence`); `appointNppPrimeMinister` seats an NPP leader where no player can be nominated.
- [One-party states](./one-party-states-as-shipped.md): ruling-party-only VONC gate.

**Affects:**

- [Bills and legislation](./bills-legislation.md): `skipWhenGovPending` in `src/lib/turn/billLifecycle/engine.ts` and `isLegislationFrozen` in `src/lib/turn/npp/billSponsorship.ts` pause bills.
- [Parties](./parties.md): the governing party and coalition come from `seatsByParty`.
- [Cabinet](./cabinet.md): the cabinet is cleared on every vacate.

Related: [snap-elections.md](./snap-elections.md), [uk-pm-no-confidence.md](./uk-pm-no-confidence.md), [bills-legislation.md](./bills-legislation.md).

## Tests

- `src/lib/turn/parliamentaryGovernment.test.ts`: vote closing, VONC cancel, dissolution bill failure, vacate semantics, confidence motion open and fail branches, VONC-fail cancels appointment votes, VONC chamber-majority rule.
- `src/lib/turn/parliamentaryGovernment.era.test.ts`, `parliamentaryGovernment.eventCards.test.ts`, `parliamentaryGovernment.runtimeExecutive.test.ts`: era sets, event cards, runtime executive offices.
- `src/lib/turn/pmVacancyDeadline.test.ts`: auto snap on the 96 turn deadline.
- `src/lib/api/parliamentaryFreeze.test.ts`: the HTTP freeze gate.
- `src/lib/turn/billLifecycle/engine.test.ts`: `skipWhenGovPending`.
- `src/lib/government/commands/runtimeParliamentaryGovernment.test.ts`, `src/app/api/country/[code]/pm/appoint/route.test.ts`: appointment and VONC commands.
- `src/lib/turn/onePartyConstraints.parliamentary.test.ts`: one-party states under the parliamentary path.

Gaps: no test for the VONC-parallel nomination window, none for the NPP confidence motion, and none that checks every freeze route is gated.

## Known issues and history

- S#17 introduced the Confidence Motion, the legislation freeze and VONC-parallel nominations.
- Ticket-1137 changed the VONC rule from a majority of votes cast to a majority of the chamber, after a minority motion unseated a government.
- The earlier version of this page said NPP PMs get no confidence motion and that the appointment rule also accepts a seat-majority threshold. The code does the opposite on both: NPP PMs get a motion, and the threshold rule applies to the VONC only.
- The constant is named `PM_VOTE_DURATION_HOURS` but the stored deadline is in turns; it only equals hours because one turn is one game hour.
- The confidence gauge is documented and tested under the UK paths, though it ticks for every parliamentary country except the UK.

Last checked: 2026-10-29, version 1.18.0
