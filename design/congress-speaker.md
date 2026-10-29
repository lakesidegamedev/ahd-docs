# Congress Speaker System

## Overview

The Congress Speaker System manages Speaker of the House elections in the US Congress. The Speaker is elected by plurality among sitting House members, and any seated member of any party may run and vote. A separate motion to vacate lets the House remove a sitting Speaker mid-term.

Player guide: [Congress Leadership](https://www.ahousedividedgame.com/wiki/congress-leadership) (Speaker and motion to vacate sections). The shared leadership framework for the other House and Senate roles is in [Congress Leadership](./congress-leadership.md).

The rule is `any-seated` on purpose: the Speaker presides over the whole House and, unlike the Majority Leader, is not the head of one party's caucus, so the whole chamber chooses.

**Location:** `src/lib/congress/speaker/`

**Key files:**

- `actions.ts` - Action handlers (declare, withdraw, vote, start, reset, force_end)
- `resolveSpeakerElection.ts` - Election resolution logic
- `responseBuilder.ts` - Response formatting
- `vacateSpeakerIfLostSeat.ts` - Auto-vacate logic when Speaker loses seat
- `openSpeakerElection.ts` - Opens a fresh 24-hour election for a vacant chair
- `resolveVacateMotion.ts`, `autoVoteNppsForVacate.ts`, `nppVacateVote.ts` - Motion to vacate resolution and NPP ballots
- `types.ts` - Type definitions

## Rules and constants

| Rule | Value | Source |
| --- | --- | --- |
| Election window | 24 hours (`ELECTION_DURATION_MS = 24 * 60 * 60 * 1000`); closes on `endsOnTurn = currentTurn + 24` | `src/lib/congress/speaker/actions.ts`, `src/lib/congress/speaker/openSpeakerElection.ts` |
| Who may run and vote | Any sitting House member of any party (`speaker_of_the_house: { kind: "any-seated" }`) | `POLICY_BY_ROLE` in `src/lib/congress/leadership/rolePolicy.ts` |
| Winner | Plurality of the seat-weighted vote | `src/lib/congress/speaker/resolveSpeakerElection.ts` |
| Tie-break | Earlier `createdAt` on the nomination | `src/lib/congress/speaker/resolveSpeakerElection.ts` |
| Withdraw cost | 3 political influence (NPI), at least 3 required | `src/lib/congress/speaker/actions.ts` |
| Vacate motion window | 24 hours (same `ELECTION_DURATION_MS`) | `src/lib/congress/speaker/actions.ts` |
| Vacate motion threshold | `Math.floor(totalSeats / 2) + 1` votes for (absolute majority of all seats) | `vacateThreshold` in `src/lib/congress/speaker/resolveVacateMotion.ts` |
| NPP stance distance | Per-axis 2 on the -5 to +5 stance scale | `NPP_VACATE_STANCE_DISTANCE` in `src/lib/congress/speaker/nppVacateVote.ts` |
| Speaker national influence tier | 2.0 | `CONGRESS_LEADER_NI_BONUS` in `src/lib/actions/positionNiBonus/rules.ts` |
| Speaker action bonus | +3 per turn | `LEADERSHIP_ACTION_BONUS` in `src/lib/actions/positionNiBonus/rules.ts` |

## Election Rules

### Eligibility

**To run for Speaker:**

1. Must be a sitting House member
2. Any party. The Speaker policy is `any-seated`, so there is no majority-party or bloc gate (`isPartyEligible` only checks the member's party holds a House seat).

**To vote for Speaker:**

1. Must be a sitting House member
2. Any party. Each member has one active vote and can change it while the window is open.

### Election Timing

- **Duration:** 24 hours from start (`ELECTION_DURATION_MS` in `actions.ts` / `openSpeakerElection.ts`)
- **End condition:** The window closes (resolved by the `leadershipElections` turn phase or lazily on a read of `GET /api/congress/speaker`) OR an admin force-ends
- **Resolution:** Plurality wins (most votes, no majority required)

### NPPs

Speaker races are player-only. NPPs do not run or vote (`src/app/api/congress/speaker/route.ts`).

## Action Handlers

### `start_election`

**Authorization:** Admin only

**Behavior:**

1. Check no active election exists
2. Clear failed nominations
3. Create new 24-hour election window
4. Auto-nominate incumbent Speaker if eligible (still holds a House seat)

**Response:**

```json
{
  "success": true,
  "message": "Speaker election started. Voting ends in 24 hours (<timestamp>). Only any seated chamber member may run and vote. Plurality wins."
}
```

### `reset_election`

**Authorization:** Admin only

**Behavior:**

1. Clear all active nominations to "failed"
2. Close current election
3. Allows starting fresh election

**Response:**

```json
{
  "success": true,
  "message": "Speaker election reset. You can start a new 24-hour election."
}
```

### `force_end`

**Authorization:** Admin only

**Behavior:**

1. Immediately resolve current election
2. Install the winner, or vacate the office if there are no candidates

**Response:**

```json
{
  "success": true,
  "message": "Speaker election ended. The winner is installed, or the office is vacant if nobody ran."
}
```

### `declare`

**Authorization:** Sitting House member (any party)

**Checks:**

1. Election is in voting phase
2. Character's party passes the Speaker policy (any party with a House seat)
3. No existing candidacy
4. Not running for other leadership position (House/Senate)

**Cost:** None

**Effects:**

1. Create SpeakerNomination record
2. Trigger achievement check (`speaker_candidate`)

**Response:**

```json
{
  "success": true,
  "message": "{name} has declared for Speaker. Voting ends {endTime}. Top vote-getter wins.",
  "status": 201
}
```

### `withdraw`

**Authorization:** House member with active candidacy

**Checks:**

1. Election is in voting phase
2. Has active candidacy
3. Has ≥3 political influence

**Cost:** 3 political influence

**Effects:**

1. Deduct 3 NPI from character
2. Log influence history
3. Set candidacy status to "failed"

**Response:**

```json
{
  "success": true,
  "message": "Candidacy withdrawn. 3 NPI deducted."
}
```

### `vote`

**Authorization:** Sitting House member (any party)

**Checks:**

1. Election is in voting phase
2. Character's party passes the Speaker policy (any party with a House seat)
3. Valid nomination ID

**Behavior:**

- Vote is changeable (can switch candidates)
- Previous vote is automatically removed
- Only one active vote per member

**Effects:**

1. Record the ballot in `speakerLeadershipBallots` (one per voter), replacing any previous one (`castLeadershipVoteBallot` in `src/lib/congress/leadershipVoteBallots.ts`)
2. Move the vote between nominations and adjust the `votesFor` counters
3. Clear any Player Whip snapshot on the vote

**Response:**

```json
{
  "success": true,
  "message": "Vote recorded for {candidateName}. Top vote-getter when the window closes wins."
}
```

## Election Resolution

### `resolveSpeakerElection()`

Called when the election ends (window closed, or admin force-end):

1. Find the `current` election; return if it is not in `voting` (or, when not forced, if the window has not closed).
2. Load active nominations (`open` or `voting`).
3. **No candidates:** vacate the role (`vacateCongressLeadershipRole`, leaving `characterName: "Vacant"`) and close the election.
4. **Otherwise:** count each candidate with the seat-scoped, seat-weighted tally (`computeCongressLeadershipTally` in `src/lib/congress/governmentVoteBreakdown.ts`), not the cached `votesFor`, so votes from members who have since lost their seat do not count and the winner matches what the leadership page shows.
5. Sort by count descending, then by earliest nomination `createdAt`. The top entry is confirmed, the others are set to `failed`.
6. Upsert the `speaker_of_the_house` leader document with the winner, mark the leadership achievement, and close the election with an atomic `voting` to `closed` claim so only one resolver posts the result announcement.

### Tie Breaking

Ties on the seat-weighted count are broken by the earliest nomination (`createdAt`), so an auto-nominated incumbent beats a challenger who ties.

## Auto-Vacate Logic

### `vacateSpeakerIfLostSeat()`

If the sitting Speaker no longer has a House seat (`electedOfficials` row with `officeType: "house"` matching `characterId` or `nppId`), the leader document is set to `characterId: null` / `characterName: "Vacant"` and `openSpeakerElection` opens a fresh 24-hour election with no incumbent nomination. The leader document is never deleted. Once vacant, later calls return early, so the election opens exactly once per vacancy.

Two paths run this:

- **Every turn:** the `leadershipVacate` phase calls `vacateLeadershipForLostSeats` (`src/lib/congress/leadershipElections.ts`), which covers all 13 leadership roles and opens a refill race for each vacated chair. It runs after general election resolution so it reads settled seats.
- **On read:** `GET /api/congress/speaker` calls `vacateSpeakerIfLostSeat` as a lazy safety net.

A party switch does not vacate the Speaker, because eligibility is by seat, not party (`qualifiesAfterPartySwitch` in `src/lib/congress/leadership/rolePolicy.ts`).

## Motion to Vacate

A sitting House member can move to remove the current Speaker without waiting for the next general election.

**Location:** `src/lib/congress/speaker/actions.ts` (`handleFileVacateMotion`, `handleVoteVacateMotion`), `src/lib/congress/speaker/resolveVacateMotion.ts`, collection `speakerVacateMotions`.

### Filing (`file_vacate_motion`)

- **Authorization:** Any sitting House member (not restricted to majority party).
- **Precondition:** There must be a sitting Speaker (`characterId` set on the `speaker_of_the_house` leader doc). A motion cannot be filed against a vacant chair.
- **Conflict guard:** Rejected with 409 if a motion is already `voting` and its window has not yet closed.
- **Effect:** Creates/overwrites the singleton `speakerVacateMotions` doc (`_id: "current"`) with a 24-hour voting window (`ELECTION_DURATION_MS`). The filer's own vote is recorded as `"for"` immediately.

### Voting (`vote_vacate_motion`)

- **Authorization:** Any sitting House member.
- **Vote values:** `"for"` (vacate) or `"against"` (keep).
- Votes are tallied via `computeCongressLeadershipTally`, which is seat-scoped and seat-weighted, and drops votes from members who have since lost their seat.
- A vote can be changed while the window is open. Choosing a vote clears any Player Whip snapshot on it.
- Each vote call also tries to resolve the motion, so the vote that reaches the threshold carries it at once.

### Resolution (`resolveSpeakerVacateMotion`)

- **Threshold to pass:** Absolute majority of the House (`Math.floor(totalSeats / 2) + 1` for-votes), not a plurality.
- Can resolve early once the threshold is reached, or when the 24-hour window closes (whichever comes first). It is also checked lazily on every `GET /api/congress/speaker`.
- **NPP blocs.** Leadership elections are player-only, but a motion to vacate is not an election, and the all-seats bar would be unreachable if blocs abstained. When the window closes, every NPP bloc without a ballot gets a graded one (`autoVoteNppsForVacateMotion`): a bloc in the Speaker's own party votes against, a partyless bloc votes against, an opposition Major-party bloc moves to vacate unless it is within 2 on both stance axes of the Speaker, and a bloc with no usable signal votes against. Existing ballots, including whipped ones, are never overwritten. NPPs are deliberately not auto-voted while the motion is live, so they cannot carry it before players can whip them.
- An unvoted seat counts the same as a vote to keep.
- Concurrency-safe: the motion is claimed via a conditional `status: voting → passed|failed` write so two concurrent resolvers cannot double-vacate.
- **On pass:** the Speaker is vacated (`vacateCongressLeadershipRole`) and a fresh 24-hour Speaker election is opened immediately (`openSpeakerElection`), shared with the lost-seat vacancy path.
- **On fail** (window closed without reaching the threshold): the motion is marked `failed` and the sitting Speaker stays in place.

## Data Model

### Collections

| Collection           | Purpose                       |
| -------------------- | ----------------------------- |
| `speakerElections`   | Current election state        |
| `speakerNominations` | Candidacies and votes         |
| `speakerLeadershipBallots` | One ballot per voter       |
| `speakerVacateMotions` | Current motion to vacate (`_id: "current"`) |
| `congressLeaders`    | Installed Speaker             |
| `electedOfficials`   | House membership verification |
| `characters`         | NPI deduction, career history |
| `influenceHistory`   | NPI spending log              |

### Document Types

```typescript
interface SpeakerElection {
  _id: "current"; // Singleton document
  status: "voting" | "closed";
  startedAt: Date;
  endsAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface SpeakerNomination {
  _id: ObjectId;
  nomineeId: ObjectId;
  nomineeName: string;
  nomineeParty: string;
  nomineeState?: string;
  nominatedById: ObjectId;
  nominatedByName: string;
  status: "open" | "voting" | "confirmed" | "failed" | "cancelled";
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">; // characterId -> vote
  createdAt: Date;
  updatedAt: Date;
}

interface CongressLeader {
  _id: ObjectId;
  role: "speaker_of_the_house";
  characterId: ObjectId;
  characterName: string;
  party: string;
  state: string;
  electedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

## Vote Structure

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

## Timing

Phases in the turn processor (`src/simulation/phases/turnPhaseRegistry.ts`), in order:

| Phase | What it does for the Speaker |
| --- | --- |
| `electionResolution` | A House general election resolves; `triggerLeadershipElectionsAfterChamberVote` opens a Speaker race if the largest party differs from the Speaker's party or the chair is vacant, auto-nominating the sitting Speaker if still seated |
| `leadershipVacate` | `vacateLeadershipForLostSeats` vacates a Speaker who lost their seat and opens a refill race (every turn) |
| `leadershipPartyEligibility` | `reconcileAllLeadershipPartyEligibility`: does not touch the Speaker (any-seated), but runs just before the next phase |
| `leadershipElections` | `resolveExpiredLeadershipElections` resolves a Speaker race whose window has closed |

The motion to vacate is not resolved in a turn phase of its own: it resolves on the vote that reaches the threshold and lazily on each `GET /api/congress/speaker`. NPP ballots are added at window close.

## Edge cases and limits

- **No candidates.** The chair is left Vacant and the election closes. It is not reopened automatically; the next vacancy transition, controlling-party change or admin start opens one.
- **Incumbent.** Auto-nominated at an election opened by a controlling-party change or admin start, only if still seated. A race opened to fill a vacancy has no incumbent.
- **Withdrawing** costs 3 NPI and requires at least 3; with less, the withdrawal is refused (403). Withdrawing sets the candidacy to `failed`.
- **One race at a time.** A character with an open candidacy in a House or Senate leadership race cannot declare for Speaker (409).
- **Motion in flight.** A second motion cannot be filed while one is voting (409); a motion cannot be filed against a vacant chair (409).
- **Filing.** Any sitting House member, not only the majority; the filer's vote counts as "for". There is no cost to file.
- **Absolute majority.** With 435 seats, 218 votes for are needed; a failed motion leaves the Speaker in place.
- **Admin-only actions** (`start_election`, `reset_election`, `force_end`) exist for operations and recovery and are not available to players.

## Worked example

A House of 435 seats. The Speaker race is open with three candidates: X (the incumbent, auto-nominated), Y, and Z. At the close, seat-weighted votes are X 200, Y 200, Z 35. X and Y tie, so the earlier nomination wins: X, auto-nominated when the race opened, beats Y who declared afterwards. Z fails.

Later a member files a motion to vacate X. The filer's vote counts as for (1). The threshold is `floor(435 / 2) + 1 = 218`. At window close players have cast 150 for and 120 against; 165 seats are unvoted NPP blocs. NPP blocs in X's party vote against, and an opposition Major-party bloc far from X on the stance axes votes for. If they add 70 for votes the total for reaches 220, at least 218, so the motion passes: X is vacated, and a new 24-hour race opens with no incumbent. If the total is 217 or less, the motion fails and X stays.

## Error Responses

| Status | Condition                                                |
| ------ | -------------------------------------------------------- |
| 400    | Invalid action, missing character, invalid nomination ID |
| 403    | Not a House member, not an eligible party, insufficient NPI to withdraw |
| 404    | Candidacy not found, no active election                  |
| 409    | Election already running, already running for office     |

## Connections

**Driven by:**

- [Elections](./elections.md): House general election results change the largest party and trigger the race (`src/lib/turn/election/generalResolution.ts`).
- House seat changes (lost seat, resignation, move to another chamber): trigger `vacateLeadershipForLostSeats`.
- [Party Whips](./party-whips.md): party whips can direct members' Speaker and vacate-motion votes (`clearWhippedFromVote`).
- NPP behavior (`src/lib/congress/speaker/nppVacateVote.ts`): NPP blocs vote on vacate motions at window close.

**Affects:**

- Action points and national influence for the holder (`src/lib/actions/positionNiBonus/rules.ts`).
- [Congress Leadership](./congress-leadership.md): shares the election framework and `congressLeaders` collection.
- Achievements: `speaker_candidate` on declaring, leadership-held marker on winning.
- Discord game-event feed: result announcement posted once per resolution.

## Related Systems

- **House Composition:** `src/lib/congress/houseComposition.ts` - Largest party and bloc calculation
- **NPP Behavior:** `src/lib/congress/speaker/nppVacateVote.ts` - NPP ballots on motions to vacate (NPPs do not run or vote in the Speaker election itself)
- **Congress Leadership:** [congress-leadership.md](./congress-leadership.md) - Leadership elections
- **Election Resolution:** `src/lib/turn/election/` - General election resolution

Last checked: 2026-10-29, version 1.18.0
