# Prime Minister No-Confidence Vote

## Summary

This system is **country-agnostic**, not UK-only. It applies to any parliamentary country whose confidence-vote mechanism is enabled (`assertConfidenceVoteMechanism`), which today covers the UK and other parliamentary head-of-government countries. One-party states (e.g. China) have `confidenceVoteMechanism` disabled and are rejected at the route.

Any elected member of the lower chamber can propose a motion of no confidence in the sitting Prime Minister (or equivalent executive title). In a one-party state that opts into the mechanism, only a member of the ruling party may propose. Any elected lower-chamber member can then vote. If the motion reaches an absolute majority of the whole chamber, the PM is removed and government formation restarts.

Player guide: [No-Confidence Votes](https://www.ahousedividedgame.com/wiki/no-confidence-votes). See also [Government Formation](https://www.ahousedividedgame.com/wiki/government-formation) and [United Kingdom](https://www.ahousedividedgame.com/wiki/uk-overview).

**Location:** `src/lib/government/commands/parliamentaryGovernment.ts` (`proposeNoConfidence`, `castNoConfidenceVote`), `src/lib/turn/parliamentaryGovernment.ts` (`resolveParliamentaryNoConfidenceVote`, `noConfidenceMotionCarries`, `autoVoteNPPsForNoConfidence`, `unformGovernmentAndVacatePM`).

**Collection:** `noConfidenceVotes`

## Rules

| Constant | Value | Source |
| --- | --- | --- |
| `NO_CONFIDENCE_COOLDOWN_TURNS` | 48 turns between motions | `src/lib/constants/governmentFormation.ts` |
| `PM_VOTE_DURATION_HOURS` | 24 (the vote closes 24 turns after it opens, `closesOnTurn`) | `src/lib/constants/governmentFormation.ts` |
| `PM_VACANCY_DEADLINE_TURNS` | 96 turns, re-armed when a motion passes | `src/lib/constants/turnTime.ts` |
| Passing threshold | `majorityThreshold` from `governmentFormations`, else `floor(totalSeats / 2) + 1` | `noConfidenceMotionCarries`, `src/lib/turn/parliamentaryGovernment.ts` |
| NPP auto-vote cadence | every 4th turn, plus one final pass at resolution | `processParliamentaryNPPAutoAye`, `src/lib/turn/parliamentaryGovernment.ts` |

### Who can propose

Any elected member of the country's lower chamber (`getLowerChamberOfficeType(countryId)`) can propose. The only party gate is `canTriggerNoConfidence` in `src/lib/turn/onePartyConstraints.ts`: in a normal parliamentary government it returns true for every party, and in a one-party state it returns true only for the ruling party. So in the UK the opposition, a coalition partner, or a backbencher of the governing party can all move a motion. The proposer does not need to belong to the governing block.

- **Precondition:** Government must be `formed` with a sitting PM, and no vote already active (`govFormation.activeVoteId !== null` blocks a second motion).
- **Cooldown:** `NO_CONFIDENCE_COOLDOWN_TURNS = 48` turns since the last motion was proposed against this country. It is checked against the most recent `noConfidenceVotes` document for the country, not per PM, and counts from the turn the earlier motion was proposed, whether it passed or failed.

Why the cooldown exists: without it an opposition could re-file every 24 turns and keep the PM and the chamber in permanent crisis.

### Proposing the motion

1. An eligible lower-chamber member calls `POST /api/country/[code]/pm/no-confidence`.
2. A new `noConfidenceVotes` document is created with `status: "active"`, a 24-turn voting window, and the proposer's own vote is **not** auto-recorded (unlike the Speaker vacate-motion filer).
3. The sitting PM is notified: "{proposer} has proposed a vote of no confidence against you. {chamber} members will vote over the next 24 hours."

The system can also file a motion itself with no proposer: `triggerSystemNoConfidence` (`src/lib/sovereignDefault/political/triggerSystemNoConfidence.ts`) opens a 24-hour motion against the sitting PM when a parliamentary country ratifies a sovereign repudiation or monetization. It skips presidential countries, countries without the mechanism, countries with no PM, and countries with a motion already active.

### Voting process

### Eligible voters

**Any elected member of the country's lower chamber can vote.** Voting is not restricted to the ruling party or coalition, and neither is proposing, outside one-party states.

### Vote duration

- **Duration:** `PM_VOTE_DURATION_HOURS = 24` from proposal. The vote closes when `currentTurn >= closesOnTurn` (`isVoteClosed`), with the wall-clock `closesAt` as a fallback for old documents.
- **Resolution:** the turn processor resolves it at the first turn the window is closed. Votes cast after that are rejected ("The voting window has closed").

### Casting votes

Votes are cast as `"aye"` (remove PM) or `"nay"` (keep PM) via `POST /api/country/[code]/pm/no-confidence/[voteId]/vote`.

- Player members vote manually.
- NPP members are auto-voted along party lines (`autoVoteNPPsForNoConfidence`): NPPs of the governing party or coalition vote nay, other-party NPPs vote aye, and NPPs with no party abstain. A party whip overrides the default, and a vote already on the record is never overwritten. This runs every 4th turn while the motion is open and once more just before resolution, so benches that were never explicitly whipped still cast a seat-weighted vote. A government whose seats are entirely NPP-held cannot dodge the vote by inaction.
- Each vote is weighted by the member's `seatsHeld` (multi-seat constituencies), not one member = one vote.

### Resolution

`resolveParliamentaryNoConfidenceVote` recomputes the tally from the seat-weighted `computeParliamentaryGovernmentTally` (the single source of truth; in-memory counters on the vote doc are reconciled to match) and applies `noConfidenceMotionCarries`:

- **Threshold:** an **absolute majority of the whole chamber** (`majorityThreshold`, falling back to `floor(totalSeats / 2) + 1`), not a majority of votes cast. Abstentions and unvoted seats count against the motion by default. The government survives unless "aye" actually clears the chamber majority. This is deliberately different from the legislative cloture rule (3/5 of votes cast). If neither number is on the formation record the fallback is a plain majority of votes cast.
- Resolution is claimed atomically (`status: "active" → "passed"/"failed"` conditional write) so two overlapping resolution attempts cannot double-resolve the same vote (the turn processor is the only caller today, `src/lib/turn/parliamentaryGovernment.ts`).

Worked example, a 650-seat Commons (threshold 326): 310 seats vote aye, 290 vote nay, 50 do not vote. The motion fails, because 310 is under 326 even though aye beat nay. Had 326 voted aye, it would pass even if all other seats voted nay.

### If the motion fails

- PM retains office, and `activeVoteId` is cleared.
- Any PM appointment votes filed during the motion window are cancelled and their nominees notified, because the sitting PM survived.
- The PM is notified with the tally and the threshold.
- The 48-turn cooldown runs from the turn this motion was proposed.

### If the motion passes

- `unformGovernmentAndVacatePM` (reason `no-confidence`) sets the government to `pending`, clears the PM, cabinet (including UK seat locks in `ukCabinetCooldowns`) and `currentOffice`, and re-arms the government-formation vacancy clock (96 turns).
- Seats-by-party and governing party are recomputed.
- The removed PM is notified: "You have been removed as {executive title} by a vote of no confidence ({votesFor} for, {votesAgainst} against)." A country game event posts the vote split.
- Government formation restarts from scratch (new PM selection process), not a direct hand-off to a runner-up candidate. The removed PM is not barred from being nominated again.

## Data

Collections read and written:

| Collection | Access | Fields |
| --- | --- | --- |
| `noConfidenceVotes` | read, insert, update | see below |
| `governmentFormations` | read, update | `status`, `pmCharacterId`, `activeVoteId`, `majorityThreshold`, `totalSeats`, `pmVacancyDeadlineTurn` (`src/lib/db/types/governmentFormation.ts`) |
| `electedOfficials` | read | lower-chamber members and `seatsHeld` |
| `ukCabinetCooldowns` | delete on pass | UK cabinet seat locks |
| appointment votes | read, cancel on fail | PM appointment votes filed during the motion |
| notifications and country game events | insert | proposer, PM and voters messages; vote split event |

Player-visible: the vote status, the aye, nay and not-voted totals, the closing turn and the outcome message. Individual player ballots in `votes` are not shown to other players.

### Collection: `noConfidenceVotes`

Fields actually present on the document (from `proposeNoConfidence` / `castNoConfidenceVote`):

```ts
interface NoConfidenceVote {
  _id: ObjectId;
  countryId: CountryId;
  proposedByCharacterId: ObjectId;
  proposedByName: string;
  targetPmCharacterId: ObjectId;
  targetPmName: string;
  votesFor: number; // seat-weighted "aye" total
  votesAgainst: number; // seat-weighted "nay" total
  votes: Record<string, "aye" | "nay">; // characterId (or npp_<id>) -> vote
  status: "active" | "passed" | "failed";
  openedAt: Date;
  closesAt: Date;
  closesOnTurn: number;
  closedAt: Date | null;
  turnProposed: number;
}
```

### API routes

| Route                                               | Method | Access                            | Purpose                  |
| --------------------------------------------------- | ------ | --------------------------------- | ------------------------ |
| `/api/country/[code]/pm/no-confidence`              | POST   | Any lower-chamber member          | Propose a motion         |
| `/api/country/[code]/pm/no-confidence/[voteId]`     | GET    | Any                               | Get status of a vote     |
| `/api/country/[code]/pm/no-confidence/[voteId]/vote` | POST   | Any lower-chamber member          | Cast a vote (`aye`/`nay`) |

## Configuration

| Setting | Default | Set in |
| --- | --- | --- |
| `confidenceVoteMechanism` (country config) | `true` for `parliamentaryMonarchy` and `parliamentaryRepublic`, `false` for `presidential` and `onePartyState` | `CONFIDENCE_VOTE_MECHANISM_DEFAULTS_BY_GOVERNMENT_TYPE`, `src/lib/constants/countriesCore.ts`; an explicit boolean on the country config overrides it (`hasConfidenceVoteMechanism`) |
| `NO_CONFIDENCE_COOLDOWN_TURNS` | 48 | `src/lib/constants/governmentFormation.ts` |
| `PM_VOTE_DURATION_HOURS` | 24 | `src/lib/constants/governmentFormation.ts` |
| `PM_VACANCY_DEADLINE_TURNS` | 96 | `src/lib/constants/turnTime.ts` |
| Party whips | per party | override the NPP default in `autoVoteNPPsForNoConfidence` |

No gameConfig field, era preset or scenario override changes this system. The threshold follows the live lower-chamber seat count, which follows the era seat map (see [United Kingdom](./united-kingdom.md)).

## Timing

Inside the per-turn pipeline (`src/simulation/phases/turnPhaseRegistry.ts`), the `parliamentaryGovernmentPhases` phase runs `runParliamentaryCountry` for each parliamentary country, in this order (`src/lib/turn/countryPhases.ts`):

1. Refresh seat totals (`updateParliamentaryGovernmentSeats`).
2. `processParliamentaryGovernmentVotes`: resolve expired PM appointment votes, then resolve the expired no-confidence vote (one at a time, after appointments).
3. `processParliamentaryNPPAutoAye`: NPP auto-votes on every 4th turn.
4. `appointNppPrimeMinister` and ruling-party sync.

The `parliamentaryVacancyWatcher` phase runs afterwards, so a PM removed in step 2 starts a fresh 96-turn deadline that cannot fire in the same turn.

A regular Commons election resolving cancels any active no-confidence vote (`cancelActiveNoConfidenceVotes`) and opens a confidence motion for the incumbent PM instead. A PM-triggered snap election cannot be called while a no-confidence vote is active (`src/lib/turn/snapElection.ts`), so a PM cannot pre-empt a motion by dissolving.

## Worked trace

A modern 650-seat Commons, government `formed`, turn 1000, last motion proposed at turn 940.

1. Cooldown check: `1000 - 940 = 60`, which is not under `NO_CONFIDENCE_COOLDOWN_TURNS = 48`, so the proposal is accepted.
2. The document is inserted with `status: "active"`, `turnProposed: 1000`, `closesOnTurn: 1000 + 24 = 1024`. `governmentFormations.activeVoteId` is set by a conditional write on `activeVoteId: null`.
3. Threshold: `lowerChamberMajorityThreshold(650) = floor(650 / 2) + 1 = 326`.
4. Ballots by turn 1024: 310 seats aye, 290 seats nay, 50 seats unvoted. `votesFor = 310`, `votesAgainst = 290`.
5. At turn 1024 `isVoteClosed` is true (`1024 >= 1024`). `noConfidenceMotionCarries`: `310 >= 326` is false, so the motion fails. `status` becomes `failed`, `activeVoteId` is cleared, appointment votes filed during the window are cancelled.
6. Next motion allowed from turn `1000 + 48 = 1048`.

Alternative: with 326 aye the motion carries at turn 1024. `unformGovernmentAndVacatePM` sets `status: "pending"`, clears the PM, and writes `pmVacancyDeadlineTurn = 1024 + 96 = 1120`. If no PM is seated by turn 1120 the vacancy watcher triggers a snap election.

## Edge cases and limits

- **Second motion while one is open:** rejected (`activeVoteId`). A race between two proposers is settled by a conditional write on `activeVoteId: null`, and the loser's vote document is deleted.
- **Proposer is not in the lower chamber:** rejected with 403.
- **No PM or government not `formed`:** rejected ("There is no {executive title} currently in office").
- **Proposer's own vote:** not auto-recorded. They must vote like anyone else.
- **Abstention:** there is no abstain action. Seats that never vote count against the motion by default, which is why the bar is 326 of 650 and not a majority of those who showed up.
- **Multi-seat members:** weight is `seatsHeld`, so one member can carry several seats.
- **One-party states:** `confidenceVoteMechanism` is false, so the route returns 400. The ruling-party gate in `canTriggerNoConfidence` is a second line of defence for any one-party state that later opts in.
- **Reappointment:** the removed PM can be nominated again in the new formation flow. The motion carries no ban.
- **Confidence gauge:** `CONFIDENCE_HITS.lostVonc = 40` is defined in `src/lib/countries/uk/confidence/confidenceGauge.ts` but no code path applies it, so the resolver does not touch the gauge.

## Invariants

- At most one active motion per country. Enforced at runtime by the conditional write on `activeVoteId: null` (loser's document is deleted); not enforced by a database unique index.
- A motion resolves once. Enforced at runtime by the atomic `active` to `passed`/`failed` claim; covered by `resolveParliamentaryNoConfidenceVote` tests in `src/lib/turn/parliamentaryGovernment.test.ts`.
- A motion carries only when seat-weighted aye reaches the whole-chamber threshold. Enforced by `noConfidenceMotionCarries`, tested in the "chamber majority, not majority of votes cast" suite.
- Stored tallies match the seat-weighted recompute. Enforced at resolution (counters are reconciled to `computeParliamentaryGovernmentTally`).
- Minimum 48 turns between proposals. Enforced at proposal time; the arithmetic is asserted in `src/lib/sim/noConfidenceLifecycle.test.ts`.
- Votes cannot be cast after `closesOnTurn`. Enforced at cast time; no dedicated test is known.

## Failure and recovery

- **Stuck active motion** (turn processor skipped or failed, so a past-deadline motion stays `active` and blocks new ones): the next healthy turn resolves it because resolution only needs `currentTurn >= closesOnTurn`. If a document is left orphaned, a data repair clears `activeVoteId` and closes the document.
- **Orphaned `activeVoteId`** pointing at a deleted or closed vote: repaired by clearing the field on `governmentFormations`.
- **Government left `pending` with no deadline** after a pass: repaired by re-arming `pmVacancyDeadlineTurn`.
- **Duplicate resolution attempts** are prevented by the atomic status claim, so a retry is safe.
- **Lost notifications** do not affect state; the outcome is visible on the government page.

## Connections

**Driven by:**

- [UK Elections](./uk-elections.md): seat totals and `majorityThreshold` come from the Commons result via `updateParliamentaryGovernmentSeats` in `src/lib/turn/parliamentaryGovernment.ts`.
- [Parliamentary Government](./parliamentary-government.md): the motion requires a `formed` government and sets `activeVoteId` on `governmentFormations`.
- Sovereign default: `triggerSystemNoConfidence` files a system motion after a repudiation or monetization.

**Affects:**

- [Parliamentary Government](./parliamentary-government.md): a passed motion calls `unformGovernmentAndVacatePM` and returns the country to `pending`.
- [UK Cabinet](./uk-cabinet.md): the cabinet and its seat locks are cleared (`clearCabinetOnTransition`, `ukCabinetCooldowns` delete).
- [Snap Elections](./snap-elections.md): the re-armed 96-turn vacancy clock can end in an auto-snap, and an active motion blocks a PM-called snap.
- [Elections](./elections.md): see how a general election cancels an active motion.

Related documentation:

- [Parliamentary Government](./parliamentary-government.md), Government formation and the legislation freeze during pending formation
- [UK Elections](./uk-elections.md), Commons elections and initial PM selection
- [Elections](./elections.md), General election mechanics

## Tests

- `src/lib/turn/parliamentaryGovernment.test.ts`: `cancelActiveNoConfidenceVotes`, pass-branch end state, fail cancels parallel appointment votes, `noConfidenceMotionCarries` threshold cases, minority motion must not unseat, NPP bench auto-votes.
- `src/lib/turn/onePartyConstraints.test.ts`: `canTriggerNoConfidence`.
- `src/lib/sovereignDefault/political/__tests__/triggerSystemNoConfidence.test.ts`: system-filed motion preconditions.
- `src/lib/sim/noConfidenceLifecycle.test.ts`: 24-turn close and 48-turn cooldown math, lifecycle report.
- `src/lib/turn/snapElection.test.ts`: snap blocked while a motion is active.
- `src/lib/turn/countryPhases.test.ts`: phase order.
- Gaps: no test for casting a vote after the window closes, and none for the propose route's lower-chamber membership check.

## Known issues and history

- `CONFIDENCE_HITS.lostVonc = 40` is defined but no code path applies it (see Edge cases).
- A motion cannot end early: it always resolves at `closesOnTurn`, even if aye already exceeds the threshold. The player wiki says a motion can end early the moment aye reaches the threshold; the code (`castNoConfidenceVote`, `resolveParliamentaryNoConfidenceVote`) has no such path.
- Ticket 1137 (recorded in tests): a minority motion once risked unseating a PM; the whole-chamber threshold and the NPP bench auto-vote fix it.

Last checked: 2026-10-29, version 1.18.0
