# Prime Minister No-Confidence Vote

## Overview

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

## Voting process

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

## Resolution

`resolveParliamentaryNoConfidenceVote` recomputes the tally from the seat-weighted `computeParliamentaryGovernmentTally` (the single source of truth; in-memory counters on the vote doc are reconciled to match) and applies `noConfidenceMotionCarries`:

- **Threshold:** an **absolute majority of the whole chamber** (`majorityThreshold`, falling back to `floor(totalSeats / 2) + 1`), not a majority of votes cast. Abstentions and unvoted seats count against the motion by default. The government survives unless "aye" actually clears the chamber majority. This is deliberately different from the legislative cloture rule (3/5 of votes cast). If neither number is on the formation record the fallback is a plain majority of votes cast.
- Resolution is claimed atomically (`status: "active" → "passed"/"failed"` conditional write) so a race between the turn processor and an inline API resolve cannot double-resolve the same vote.

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

## Timing

Inside the per-turn pipeline (`src/simulation/phases/turnPhaseRegistry.ts`), the `parliamentaryGovernmentPhases` phase runs `runParliamentaryCountry` for each parliamentary country, in this order (`src/lib/turn/countryPhases.ts`):

1. Refresh seat totals (`updateParliamentaryGovernmentSeats`).
2. `processParliamentaryGovernmentVotes`: resolve expired PM appointment votes, then resolve the expired no-confidence vote (one at a time, after appointments).
3. `processParliamentaryNPPAutoAye`: NPP auto-votes on every 4th turn.
4. `appointNppPrimeMinister` and ruling-party sync.

The `parliamentaryVacancyWatcher` phase runs afterwards, so a PM removed in step 2 starts a fresh 96-turn deadline that cannot fire in the same turn.

A regular Commons election resolving cancels any active no-confidence vote (`cancelActiveNoConfidenceVotes`) and opens a confidence motion for the incumbent PM instead. A PM-triggered snap election cannot be called while a no-confidence vote is active (`src/lib/turn/snapElection.ts`), so a PM cannot pre-empt a motion by dissolving.

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

## Database schema

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

## API routes

| Route                                               | Method | Access                            | Purpose                  |
| --------------------------------------------------- | ------ | --------------------------------- | ------------------------ |
| `/api/country/[code]/pm/no-confidence`              | POST   | Any lower-chamber member          | Propose a motion         |
| `/api/country/[code]/pm/no-confidence/[voteId]`     | GET    | Any                               | Get status of a vote     |
| `/api/country/[code]/pm/no-confidence/[voteId]/vote` | POST   | Any lower-chamber member          | Cast a vote (`aye`/`nay`) |

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

## Related documentation

- [Parliamentary Government](./parliamentary-government.md), Government formation and the legislation freeze during pending formation
- [UK Elections](./uk-elections.md), Commons elections and initial PM selection
- [Elections](./elections.md), General election mechanics

Last checked: 2026-10-29, version 1.18.0
