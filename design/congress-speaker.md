# Congress Speaker System

## Summary

The Congress Speaker System manages Speaker of the House elections in the US Congress. The Speaker is elected by plurality among sitting House members, and any seated member of any party may run and vote. A separate motion to vacate lets the House remove a sitting Speaker mid-term.

Player guide: [Congress Leadership](https://www.ahousedividedgame.com/wiki/congress-leadership) (Speaker and motion to vacate sections). The shared leadership framework for the other House and Senate roles is in [Congress Leadership](./congress-leadership.md).

The rule is `any-seated` on purpose: the Speaker presides over the whole House and, unlike the Majority Leader, is not the head of one party's caucus, so the whole chamber chooses.

**Location:** `src/lib/congress/speaker/`

**Key files:**

- `actions.ts` - Action handlers (declare, withdraw, vote, start, reset, force_end, file and vote on a vacate motion)
- `resolveSpeakerElection.ts` - Election resolution logic
- `responseBuilder.ts` - Response formatting
- `vacateSpeakerIfLostSeat.ts` - Auto-vacate logic when Speaker loses seat
- `openSpeakerElection.ts` - Opens a fresh 24-hour election for a vacant chair
- `resolveVacateMotion.ts`, `autoVoteNppsForVacate.ts`, `nppVacateVote.ts` - Motion to vacate resolution and NPP ballots
- `types.ts` - Type definitions (API response shapes)

The HTTP surface is `GET` and `POST /api/congress/speaker` (`src/app/api/congress/speaker/route.ts`), rate limited to 30 requests per 60 seconds per user on `POST`.

## Rules

### Constants

| Rule | Value | Source |
| --- | --- | --- |
| Election window | 24 hours (`ELECTION_DURATION_MS = 24 * 60 * 60 * 1000`); closes on `endsOnTurn = currentTurn + 24` (one turn is one game hour) | `src/lib/congress/speaker/actions.ts`, `src/lib/congress/speaker/openSpeakerElection.ts` |
| Window close test | If `endsOnTurn` is set, closed when `currentTurn >= endsOnTurn`; otherwise closed when `effectiveNow >= endsAt` (`isLeadershipElectionClosed`) | `src/lib/congress/leadershipElections.ts` |
| Who may run and vote | Any sitting House member of any party (`speaker_of_the_house: { kind: "any-seated" }`) | `POLICY_BY_ROLE` in `src/lib/congress/leadership/rolePolicy.ts` |
| Winner | Plurality of the seat-weighted vote | `src/lib/congress/speaker/resolveSpeakerElection.ts` |
| Tie-break | Earlier `createdAt` on the nomination | `src/lib/congress/speaker/resolveSpeakerElection.ts` |
| Declare cost | None | `handleDeclare` in `src/lib/congress/speaker/actions.ts` |
| Withdraw cost | 3 political influence (NPI), at least 3 required | `src/lib/congress/speaker/actions.ts` |
| Vacate motion window | 24 hours (same `ELECTION_DURATION_MS`), `endsOnTurn = currentTurn + 24` | `src/lib/congress/speaker/actions.ts` |
| Vacate motion threshold | `Math.floor(totalSeats / 2) + 1` votes for (absolute majority of all seats) | `vacateThreshold` in `src/lib/congress/speaker/resolveVacateMotion.ts` |
| NPP stance distance | Per-axis 2 on the -5 to +5 stance scale (`NPP_VACATE_STANCE_DISTANCE`), both axes must be within 2 to count as close | `src/lib/congress/speaker/nppVacateVote.ts` |
| Coin flip | `rng() < 0.5` gives "for"; `Math.random` in production, injected in tests | `src/lib/congress/speaker/nppVacateVote.ts`, `src/lib/congress/speaker/autoVoteNppsForVacate.ts` |
| Seat weight | `seatsHeld ?? 1` per `electedOfficials` row | `buildVoterPartyAndWeightMaps` in `src/lib/congress/governmentVoteBreakdown.ts` |
| Speaker national influence tier | 2.0 | `CONGRESS_LEADER_NI_BONUS` in `src/lib/actions/positionNiBonus/rules.ts` |
| Speaker action bonus | +3 per turn (highest leadership bonus held, not stacked) | `LEADERSHIP_ACTION_BONUS` in `src/lib/actions/positionNiBonus/rules.ts` |

### Eligibility

**To run for Speaker:**

1. Must be a sitting House member (an `electedOfficials` row with `officeType: "house"` for the character).
2. Any party. The Speaker policy is `any-seated`, so there is no majority-party or bloc gate (`isPartyEligible` only checks the member's party holds a House seat).
3. Must not already have an open or voting candidacy for Speaker, or for any House or Senate leadership race.

**To vote for Speaker:**

1. Must be a sitting House member.
2. Any party. Each member has one active vote and can change it while the window is open.

### Election timing rules

- **Duration:** 24 hours from start (`ELECTION_DURATION_MS` in `actions.ts` / `openSpeakerElection.ts`).
- **End condition:** The window closes (resolved by the `leadershipElections` turn phase or lazily on a read of `GET /api/congress/speaker`) OR an admin force-ends.
- **Resolution:** Plurality wins (most votes, no majority required).

### NPPs

Speaker races are player-only. NPPs do not run or vote in the election (`src/app/api/congress/speaker/route.ts`). NPP blocs do vote on the motion to vacate, at window close only.

### Action handlers

Every handler except the three admin ones first requires a character and a House seat (403 "Only sitting House members can participate in Speaker elections.").

#### `start_election`

**Authorization:** Admin only

**Behavior:**

1. Check no active election exists (409 if one is live)
2. Fail all open and voting nominations
3. Create new 24-hour election window
4. Auto-nominate incumbent Speaker if eligible (still holds a House seat and passes the policy), with `nominatedByName: "Incumbent"` and status `voting`

**Response:**

```json
{
  "success": true,
  "message": "Speaker election started. Voting ends in 24 hours (<timestamp>). Only any seated chamber member may run and vote. Plurality wins."
}
```

#### `reset_election`

**Authorization:** Admin only

**Behavior:**

1. Set all open and voting nominations to "failed"
2. Close the current election (upsert, so it works with no prior election)
3. Allows starting fresh election

**Response:**

```json
{
  "success": true,
  "message": "Speaker election reset. You can start a new 24-hour election."
}
```

#### `force_end`

**Authorization:** Admin only

**Behavior:**

1. Immediately resolve the current election (`resolveSpeakerElection(..., force = true)`)
2. Install the winner, or vacate the office if there are no candidates
3. Returns 409 "No active election to end." if there is no election in `voting`

**Response:**

```json
{
  "success": true,
  "message": "Speaker election ended. Winner or vacancy is set."
}
```

#### `declare`

**Authorization:** Sitting House member (any party)

**Checks:**

1. Election is in voting phase and its window has not closed (409)
2. Character's party passes the Speaker policy (any party with a House seat) (403)
3. No existing open or voting candidacy under the character or its NPP id (409)
4. Not running for another leadership position: checked against `houseLeadershipNominations` and `senateLeadershipNominations` (409), then `failNominationIfLeadershipConflict` re-checks after the insert to close a race between two simultaneous declarations (409)

**Cost:** None

**Effects:**

1. Create `speakerNominations` record with status `open`
2. Trigger achievement check (`speaker_candidate`)

**Response:**

```json
{
  "success": true,
  "message": "{name} has declared for Speaker. Voting ends {endTime}. Top vote-getter wins.",
  "status": 201
}
```

#### `withdraw`

**Authorization:** House member with active candidacy

**Checks:**

1. Election is in voting phase (409)
2. Has active candidacy (404)
3. Has 3 or more political influence (403)

**Cost:** 3 political influence

**Effects:**

1. Deduct 3 NPI from character (`$inc: { politicalInfluence: -3 }`)
2. Log influence history (`influenceHistory`, reason "Withdrew from Speaker election")
3. Set candidacy status to "failed"

**Response:**

```json
{
  "success": true,
  "message": "Candidacy withdrawn. 3 NPI deducted."
}
```

#### `vote`

**Authorization:** Sitting House member (any party)

**Checks:**

1. Election is in voting phase (409)
2. Character's party passes the Speaker policy (any party with a House seat) (403)
3. Valid nomination ID (400), pointing at a nomination still `open` or `voting` (404)

**Behavior:**

- Vote is changeable (can switch candidates)
- Previous vote is automatically removed
- Only one active vote per member

**Effects:**

1. Record the ballot in `speakerLeadershipBallots` (one per voter), replacing any previous one (`castLeadershipVoteBallot` in `src/lib/congress/leadershipVoteBallots.ts`)
2. Move the vote between nominations and adjust the `votesFor` counters
3. Clear any Player Whip snapshot on the vote on both the new and the previous nomination (`clearWhippedFromVote`)

**Response:**

```json
{
  "success": true,
  "message": "Vote recorded for {candidateName}. Top vote-getter when the window closes wins."
}
```

### Vote structure

Each nomination document carries a `votes` map, and each voter has one row in `speakerLeadershipBallots` that points at their current nomination:

```typescript
votes: {
  "characterId1": "for",
  "characterId2": "for",
  // ...
}
```

**Vote changing:** When a member votes for a different candidate:

1. The voter's ballot row is repointed to the new nomination (`castLeadershipVoteBallot`)
2. The vote is removed from the old nomination and set on the new one
3. `votesFor` counters are adjusted

### Election resolution

`resolveSpeakerElection()`, called when the election ends (window closed, or admin force-end):

1. Find the `current` election; return if it is not in `voting` (or, when not forced, if the window has not closed).
2. Load active nominations (`open` or `voting`).
3. **No candidates:** vacate the role (`vacateCongressLeadershipRole`, leaving `characterName: "Vacant"`) and close the election.
4. **Otherwise:** count each candidate with the seat-scoped, seat-weighted tally (`computeCongressLeadershipTally` in `src/lib/congress/governmentVoteBreakdown.ts`), not the cached `votesFor`, so votes from members who have since lost their seat do not count and the winner matches what the leadership page shows.
5. Sort by count descending, then by earliest nomination `createdAt`. The top entry is confirmed, the others are set to `failed`.
6. Upsert the `speaker_of_the_house` leader document with the winner, mark the leadership achievement (`markCongressLeadershipHeld`), and close the election with an atomic `voting` to `closed` claim (`claimStatusTransition`) so only one resolver posts the Discord result announcement.

**Tie breaking.** Ties on the seat-weighted count are broken by the earliest nomination (`createdAt`), so an auto-nominated incumbent beats a challenger who ties.

### Auto-vacate logic

`vacateSpeakerIfLostSeat()`: if the sitting Speaker no longer has a House seat (`electedOfficials` row with `officeType: "house"` matching `characterId` or `nppId`), the leader document is set to `characterId: null` / `characterName: "Vacant"` and `openSpeakerElection` opens a fresh 24-hour election with no incumbent nomination. The leader document is never deleted. Once vacant, later calls return early, so the election opens exactly once per vacancy.

Two paths run this:

- **Every turn:** the `leadershipVacate` phase calls `vacateLeadershipForLostSeats` (`src/lib/congress/leadershipElections.ts`), which covers all 13 leadership roles and opens a refill race for each vacated chair (`vacateAllLeadershipRoles` in `src/lib/congress/leadership/reconcilePartyEligibility.ts`). It runs after general election resolution so it reads settled seats.
- **On read:** `GET /api/congress/speaker` calls `vacateSpeakerIfLostSeat` as a lazy safety net.

A party switch does not vacate the Speaker, because eligibility is by seat, not party (`qualifiesAfterPartySwitch` in `src/lib/congress/leadership/rolePolicy.ts`).

### Controlling-party trigger

After a House general election, `triggerLeadershipElectionsAfterChamberVote` (`src/lib/congress/leadershipElections.ts`) opens a Speaker race when `hasControllingPartyChanged` is true: the House majority party is unknown, the chair is vacant, or the Speaker's recorded party differs from `house.majorityParty`. It skips this if a live election is already running, fails any dangling nominations, upserts the election with `endsOnTurn = currentTurn + 24`, and auto-nominates the sitting Speaker if still seated and eligible (`autoNominateStandingIncumbent`).

### Motion to vacate

A sitting House member can move to remove the current Speaker without waiting for the next general election.

**Location:** `src/lib/congress/speaker/actions.ts` (`handleFileVacateMotion`, `handleVoteVacateMotion`), `src/lib/congress/speaker/resolveVacateMotion.ts`, collection `speakerVacateMotions`.

#### Filing (`file_vacate_motion`)

- **Authorization:** Any sitting House member (not restricted to majority party).
- **Precondition:** There must be a sitting Speaker (`characterId` set on the `speaker_of_the_house` leader doc). A motion cannot be filed against a vacant chair (409).
- **Conflict guard:** Rejected with 409 if a motion is already `voting` and its window has not yet closed.
- **Effect:** Creates/overwrites the singleton `speakerVacateMotions` doc (`_id: "current"`) with a 24-hour voting window (`ELECTION_DURATION_MS`), snapshotting filer and target. The filer's own vote is recorded as `"for"` immediately. There is no cost to file.

#### Voting (`vote_vacate_motion`)

- **Authorization:** Any sitting House member.
- **Vote values:** `"for"` (vacate) or `"against"` (keep); anything else is 400.
- Votes are tallied via `computeCongressLeadershipTally`, which is seat-scoped and seat-weighted, and drops votes from members who have since lost their seat.
- A vote can be changed while the window is open (409 once it has closed). Choosing a vote clears any Player Whip snapshot on it.
- Each vote call also tries to resolve the motion, so the vote that reaches the threshold carries it at once.

#### Resolution (`resolveSpeakerVacateMotion`)

- **Threshold to pass:** Absolute majority of the House (`Math.floor(totalSeats / 2) + 1` for-votes), not a plurality.
- Can resolve early once the threshold is reached, or when the 24-hour window closes (whichever comes first). It is also checked lazily on every `GET /api/congress/speaker`.
- **NPP blocs.** Leadership elections are player-only, but a motion to vacate is not an election, and the all-seats bar would be unreachable if blocs abstained. When the window closes, every NPP bloc with a House seat and no ballot gets a graded one (`autoVoteNppsForVacateMotion`, using `nppVacateMotionVote`):

| Bloc | Vote |
| --- | --- |
| No party | against |
| Same party as the Speaker | against |
| Both blocs' parties are Major, stances not within 2 on both axes (or no usable stance for either side) | for |
| Both Major, stances within 2 on both axes | coin flip |
| Not both Major (minor, unaligned or Speaker party unknown), stances not within 2 on both axes | coin flip |
| Not both Major, stances close or no usable stance | against |

  Existing ballots, including whipped ones, are never overwritten (each write is guarded by `votes.<key> $exists: false`). NPPs are deliberately not auto-voted while the motion is live, so they cannot carry it before players can whip them.
- An unvoted seat counts the same as a vote to keep.
- Concurrency-safe: the motion is claimed via a conditional `status: voting` to `passed|failed` write so two concurrent resolvers cannot double-vacate.
- **On pass:** the Speaker is vacated (`vacateCongressLeadershipRole`) and a fresh 24-hour Speaker election is opened immediately (`openSpeakerElection`), shared with the lost-seat vacancy path.
- **On fail** (window closed without reaching the threshold): the motion is marked `failed` and the sitting Speaker stays in place.

### Error responses

| Status | Condition |
| --- | --- |
| 400 | Invalid action, missing character, invalid nomination ID, vacate vote not "for" or "against" |
| 403 | Not a House member, not an eligible party, insufficient NPI to withdraw, non-admin on an admin action |
| 404 | Candidacy not found, no candidacy to withdraw |
| 409 | Election already running, already running for office, no election open, no sitting Speaker to vacate, motion already live, no motion open |

## Data

### Collections

| Collection | Purpose | Access | Player-visible |
| --- | --- | --- | --- |
| `speakerElections` | Current election state (`_id: "current"`) | read, write | Yes: status and end time on the Speaker page |
| `speakerNominations` | Candidacies and the `votes` map | read, write | Yes: candidates, vote counts, party split; individual ballots are not listed |
| `speakerLeadershipBallots` | One ballot per voter, pointing at a nomination | read, write | Own vote only (`isMyVote`) |
| `speakerVacateMotions` | Current motion to vacate (`_id: "current"`) | read, write | Yes: motion status, counts, threshold, own vote |
| `congressLeaders` | Installed Speaker (`role: "speaker_of_the_house"`) | read, write | Yes: current Speaker |
| `electedOfficials` | House membership, party and `seatsHeld` weight | read | Indirect |
| `characters` | NPI deduction, party, stance (`policies`) | read, write (`politicalInfluence`) | NPI is shown on the profile |
| `npps`, `politicalParties` | NPP party and stance, party tier for the vacate heuristic | read | No |
| `influenceHistory` | NPI spending log | write | Own history |
| `houseLeadershipNominations`, `senateLeadershipNominations` | Read only for the one-race-at-a-time guard | read | No |

### Document types

The types below are from `src/lib/db/types/leadership.ts`.

```typescript
interface SpeakerElection {
  _id: "current"; // Singleton document
  status: "voting" | "closed" | "cancelled";
  startedAt: Date;
  endsAt: Date;
  endsOnTurn?: number; // turn on which voting closes; preferred over endsAt
  updatedAt: Date;
}

interface SpeakerNomination {
  _id: ObjectId;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty?: string;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: "open" | "voting" | "confirmed" | "failed" | "cancelled";
  votesFor: number; // cached, not used to pick the winner
  votesAgainst: number;
  votes: Record<string, "for" | "against">; // characterId -> vote
  whippedFromVote?: WhippedFromVoteMap;
  createdAt: Date;
  updatedAt: Date;
}

interface SpeakerVacateMotion {
  _id: "current";
  status: "voting" | "passed" | "failed";
  filedById: ObjectId;
  filedByName: string;
  filedByParty?: string;
  targetSpeakerId: ObjectId;
  targetSpeakerName: string;
  startedAt: Date;
  endsAt: Date;
  endsOnTurn?: number;
  votes: Record<string, "for" | "against">; // characterId or "npp_<id>" -> vote
  whippedFromVote?: WhippedFromVoteMap;
  resolvedAt?: Date;
  updatedAt: Date;
}

interface CongressLeader {
  _id: ObjectId;
  role: LeadershipRole; // "speaker_of_the_house" here
  characterId: ObjectId | null; // null while vacant
  characterName: string; // "Vacant" while vacant
  party?: string;
  nominatedBy?: ObjectId;
  electedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## Configuration

There is no gameConfig field for the Speaker system. Behaviour is set by constants and one policy table.

| Setting | Default | Where set |
| --- | --- | --- |
| Eligibility policy for `speaker_of_the_house` | `{ kind: "any-seated" }` | `POLICY_BY_ROLE` in `src/lib/congress/leadership/rolePolicy.ts` |
| Election and motion window | 24 turns | `ELECTION_DURATION_MS` in `actions.ts` and `openSpeakerElection.ts`; `LEADERSHIP_ELECTION_DURATION_MS` in `leadershipElections.ts` for the controlling-party trigger |
| Withdraw cost | 3 NPI | literals in `handleWithdraw` (`actions.ts`) |
| NPP closeness distance | 2 per axis | `NPP_VACATE_STANCE_DISTANCE` (`nppVacateVote.ts`) |
| Speaker NI tier and action bonus | 2.0 and +3 | `src/lib/actions/positionNiBonus/rules.ts` |

Scope: the system is US only. Other countries' presiding officers (Bundestag, NPCSC, National Guard) use different role keys and the shared leadership framework, not this module. The motion to vacate has no flag or era gate; it is available whenever a Speaker is seated.

## Timing

Phases in the turn processor (`src/simulation/phases/turnPhaseRegistry.ts`), in order:

```
electionResolution            House general resolves -> controlling-party trigger may open a race
   |
leadershipVacate              Speaker without a House seat -> vacate + open refill race (every turn)
   |
leadershipPartyEligibility    does not touch the Speaker (any-seated)
   |
leadershipElections           resolveExpiredLeadershipElections: closed window -> resolveSpeakerElection

(outside the turn)  GET /api/congress/speaker -> vacateSpeakerIfLostSeat, resolve closed election,
                    resolveSpeakerVacateMotion
(outside the turn)  POST vote_vacate_motion   -> resolveSpeakerVacateMotion on every ballot
```

| Phase | What it does for the Speaker |
| --- | --- |
| `electionResolution` | A House general election resolves; `triggerLeadershipElectionsAfterChamberVote` opens a Speaker race if the largest party differs from the Speaker's party or the chair is vacant, auto-nominating the sitting Speaker if still seated |
| `leadershipVacate` | `vacateLeadershipForLostSeats` vacates a Speaker who lost their seat and opens a refill race (every turn) |
| `leadershipPartyEligibility` | `reconcileAllLeadershipPartyEligibility`: does not touch the Speaker (any-seated), but runs just before the next phase |
| `leadershipElections` | `resolveExpiredLeadershipElections` resolves a Speaker race whose window has closed |

The motion to vacate is not resolved in a turn phase of its own: it resolves on the vote that reaches the threshold and lazily on each `GET /api/congress/speaker`. NPP ballots are added at window close, so with no one reading the page and no vote cast, a closed motion stays `voting` until the next read or vote. The window itself is turn-based (`endsOnTurn`), so game-clock drift does not move the deadline.

## Worked trace

**Election.** A House of 435 seats, each `electedOfficials` row weighing 1 (`seatsHeld` unset). The chair is vacant at turn 1000, so `openSpeakerElection` writes `endsOnTurn = 1000 + 24 / 1 = 1024` (`ELECTION_DURATION_MS / 3_600_000 = 24`). Three candidates declare: X (turn 1002, `createdAt` earliest), Y (turn 1005), Z (turn 1010). The window is closed from `currentTurn >= 1024`, and the `leadershipElections` phase on turn 1024 calls `resolveSpeakerElection`. Seat-weighted votes: X 200, Y 200, Z 35, which sum to 435 with every seat voted. X and Y tie at 200; sorting by count descending, then `createdAt` ascending, puts X first. X is `confirmed`, Y and Z are set to `failed`, `congressLeaders` takes X, and the claim `voting` to `closed` posts one announcement. A candidate who lost a seat before turn 1024 has that ballot dropped by the tally even though the cached `votesFor` still shows it.

**Motion to vacate.** A member files against X at turn 1100; `endsOnTurn = 1124`, and the filer's vote is `for`. `vacateThreshold(435) = floor(435 / 2) + 1 = 217 + 1 = 218`. At turn 1124 players have cast 150 for (including the filer) and 120 against, and 165 seats are unvoted NPP blocs. `autoVoteNppsForVacateMotion` grades each bloc: blocs of X's party vote against, a Major opposition bloc not within 2 on both axes votes for, and so on. Say those blocs add 70 for votes and 95 against: for = 150 + 70 = 220, which is at least 218, so the claim flips to `passed`, X is vacated (`characterName: "Vacant"`), and `openSpeakerElection` opens a new race ending at turn 1148 with no incumbent. If the NPP blocs had added only 67 for votes, 217 for is under 218 and the motion is marked `failed` with X still seated. Had the 150 humans alone reached 218 earlier in the window, the vote that crossed it would have carried the motion at once and NPP blocs would never have been polled.

**Withdraw.** A candidate with 5 NPI withdraws: NPI becomes 2, an `influenceHistory` row of `-3` is written, the nomination is `failed`. A candidate with 2 NPI is refused with 403 and stays in.

## Edge cases and limits

- **No candidates.** The chair is left Vacant and the election closes. It is not reopened automatically; the next vacancy transition, controlling-party change or admin start opens one.
- **Incumbent.** Auto-nominated at an election opened by a controlling-party change or admin start, only if still seated. A race opened to fill a vacancy has no incumbent.
- **Withdrawing** costs 3 NPI and requires at least 3; with less, the withdrawal is refused (403). Withdrawing sets the candidacy to `failed`.
- **One race at a time.** A character with an open candidacy in a House or Senate leadership race cannot declare for Speaker (409).
- **Motion in flight.** A second motion cannot be filed while one is voting (409); a motion cannot be filed against a vacant chair (409). A finished motion (`passed` or `failed`) is overwritten by the next filing and its `resolvedAt` is unset.
- **Filing.** Any sitting House member, not only the majority; the filer's vote counts as "for". There is no cost to file.
- **Absolute majority.** With 435 seats, 218 votes for are needed; a failed motion leaves the Speaker in place. The bar uses `house.totalSeats`, not votes cast, so abstention is a vote to keep.
- **Multi-seat blocs.** A voter's weight is `seatsHeld ?? 1`, so an NPP bloc holding several seats moves that many votes at once.
- **Stale voters.** A ballot from someone who lost their seat, or from another country, carries no weight and is excluded from both elections and motions.
- **No stance data.** A Major-vs-Major bloc with a missing stance on either side votes "for" (not a coin flip); a minor bloc with missing stance votes "against".
- **NPPs and the election.** NPPs never run or vote in the Speaker election, only on the motion.
- **Party switch.** Does not vacate the Speaker (seat-based eligibility). It can change the controlling party recorded against the Speaker and so open a race at the next House general election.
- **Admin-only actions** (`start_election`, `reset_election`, `force_end`) exist for operations and recovery and are not available to players.
- **Deliberate exclusion.** Withdrawing costs influence to discourage spoiler declarations; declaring is free so the race stays open to the whole chamber.

## Invariants

- At most one `speakerElections` document and one `speakerVacateMotions` document exist (`_id: "current"`). Enforced by the fixed `_id`; no test.
- A voter holds at most one active ballot per race, and a changed vote moves between nominations atomically. Enforced by `castLeadershipVoteBallot` (`src/lib/congress/leadershipVoteBallots.ts`), tested in `src/lib/congress/leadershipVoteBallots.test.ts` (including the `seatsHeld` weighting of `votesFor`).
- A vacancy opens exactly one election. Enforced by the early return on `characterId: null` in `vacateSpeakerIfLostSeat` (tested in `vacateSpeakerIfLostSeat.test.ts`) and, on the sweep path, by skipping chairs that are already vacant (tested in `leadershipElections.lostSeats.test.ts`: "ignores a chair that is already vacant, so it cannot re-open a race forever").
- A result is announced once and a motion is resolved once. Enforced by the atomic claims in `resolveSpeakerElection` and `resolveSpeakerVacateMotion`; tested in `resolveSpeakerElection.test.ts` ("announces exactly once...", "does not announce when another worker already closed...") and `resolveVacateMotion.test.ts` ("bails without side effects if it loses the atomic claim").
- NPP blocs are not auto-voted while a motion is live. Tested in `resolveVacateMotion.test.ts` ("does NOT auto-vote blocs while the window is still open", "...on the early-pass branch either").
- Auto-votes never overwrite an existing ballot. Enforced by the `$exists: false` guard; tested in `autoVoteNppsForVacate.test.ts`.
- The winner is derived from the seat-weighted tally, never the cached `votesFor`. Enforced by `resolveSpeakerElection` code; the tie-break and de-seated-voter paths have no dedicated test (see Tests).
- A character holds at most one active leadership candidacy across Speaker, House and Senate races. Enforced by `failNominationIfLeadershipConflict`; tested in `leadershipRaceGuard.test.ts`.

## Failure and recovery

- **Chair left empty.** A sweep that vacated the chair without opening a race once left the House with no Speaker, because the Speaker's own auto-open then early-returned. The sweep now opens the refill race itself (`vacateAllLeadershipRoles`). If a chair is nevertheless empty with no election, an admin runs `start_election` (a stale or corrupted leader row is repaired as a data fix, then the race is started).
- **Election stuck in `voting`.** The turn phase or any Speaker page read resolves a closed window. An admin can `force_end` or `reset_election` then `start_election`.
- **Motion stuck in `voting` past its window.** Resolved on the next page read, vote or (for the NPP ballots) the next resolver call. Nothing in the turn pipeline resolves it, so an unread page leaves it open until someone looks.
- **Two resolvers racing** (a turn phase and a request, or two containers during a redeploy). Both claim with a conditional write; the loser changes nothing.
- **Winner lost their seat before close.** Resolution does not recheck the winner's own seat, so they can be installed; the next `leadershipVacate` sweep (or page read) then vacates them and opens a new race.
- **Stale cached `votesFor`.** Cosmetic only, since resolution recomputes from `votes`.

## Connections

**Driven by:**

- [Elections](./elections.md): House general election results change the largest party and trigger the race (`src/lib/turn/election/generalResolution.ts`, then `triggerLeadershipElectionsAfterChamberVote`).
- House seat changes (lost seat, resignation, move to another chamber): trigger `vacateLeadershipForLostSeats`.
- [Party Whips](./party-whips.md): party whips can direct members' Speaker and vacate-motion votes (`clearWhippedFromVote`).
- NPP behavior (`src/lib/congress/speaker/nppVacateVote.ts`): NPP blocs vote on vacate motions at window close.

**Affects:**

- Action points and national influence for the holder (`src/lib/actions/positionNiBonus/rules.ts`).
- [Congress Leadership](./congress-leadership.md): shares the election framework and `congressLeaders` collection.
- Achievements: `speaker_candidate` on declaring, leadership-held marker on winning (`src/lib/wiki/markCongressLeadership.ts`).
- Discord game-event feed: result announcement posted once per resolution (`sendCountryGameEvent`).
- House Composition: `src/lib/congress/houseComposition.ts` supplies the largest party, bloc and `totalSeats` the threshold reads.

## Tests

- `src/lib/congress/speaker/resolveSpeakerElection.test.ts`: announce-once idempotency.
- `src/lib/congress/speaker/resolveVacateMotion.test.ts`: threshold, pass, fail, claim loss, NPP auto-vote ordering.
- `src/lib/congress/speaker/vacateMotionVote.test.ts`: vacate ballot recording, validation, closed window, non-members.
- `src/lib/congress/speaker/autoVoteNppsForVacate.test.ts`: batching, conditional writes, whipped blocs, same-party defence.
- `src/lib/congress/speaker/nppVacateVote.test.ts`: the bloc voting table and the closeness test.
- `src/lib/congress/speaker/vacateSpeakerIfLostSeat.test.ts`: lost-seat vacate and election open.
- `src/lib/congress/leadershipElections.lostSeats.test.ts`, `leadershipElections.test.ts`, `leadershipElections.resolveIdempotency.test.ts`, `leadershipRaceGuard.test.ts`, `leadershipVoteBallots.test.ts`: shared framework.
- `src/app/api/congress/congress.integration.test.ts`: `POST /api/congress/speaker`.

Gaps: `leadershipRaceGuard.test.ts` covers the cross-race guard in general, but no test goes through the Speaker `declare` handler. There is also no dedicated test for the plurality tie-break on `createdAt`, for withdraw's NPI check, or for the controlling-party trigger specifically for the Speaker role.

## Known issues and history

- Behaviour that differs from older text of this page (fixed here): a Major-party bloc with no usable stance votes "for", and close Major blocs and distant minor blocs flip a coin; the old text said "unless within 2" and "no usable signal votes against" without the randomness.
- A motion to vacate has no turn phase, so a closed motion resolves only on a read or a vote. Open limitation.
- `SpeakerElection.endsOnTurn` is still optional "during the transition" in the type; elections created by current code always set it.
- No contradiction was found between this page, the code and the player wiki page Congress Leadership (`src/lib/seeds/wiki/content/congressLeadership.ts`): the 24 hour windows, 218 of 435 threshold, +3 actions, 2.0 influence tier and NPP behaviour all agree.

Last checked: 2026-10-29, version 1.18.0
