# Congress Speaker System

## Overview

The Congress Speaker System manages Speaker of the House elections in the US Congress. The Speaker is elected by House members, with voting restricted to the majority party.

**Location:** `src/lib/congress/speaker/`

**Key files:**

- `actions.ts` - Action handlers (declare, withdraw, vote, start, reset, force_end)
- `resolveSpeakerElection.ts` - Election resolution logic
- `responseBuilder.ts` - Response formatting
- `vacateSpeakerIfLostSeat.ts` - Auto-vacate logic when Speaker loses seat
- `types.ts` - Type definitions

## Election Rules

### Eligibility

**To run for Speaker:**

1. Must be a sitting House member
2. Must be from the majority party

**To vote for Speaker:**

1. Must be a sitting House member
2. Must be from the majority party

### Election Timing

- **Duration:** 24 hours from start (`ELECTION_DURATION_MS` in `actions.ts` / `openSpeakerElection.ts`)
- **End condition:** Time expires OR admin force-ends
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
4. Auto-nominate incumbent Speaker if eligible (has seat, majority party)

**Response:**

```json
{
  "success": true,
  "message": "Speaker election started. Voting ends in 24 hours. Only the majority party may run and vote. Plurality wins."
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

**Authorization:** House member from majority party

**Checks:**

1. Election is in voting phase
2. Character is from majority party
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

**Authorization:** House member from majority party

**Checks:**

1. Election is in voting phase
2. Character is from majority party
3. Valid nomination ID

**Behavior:**

- Vote is changeable (can switch candidates)
- Previous vote is automatically removed
- Only one active vote per member

**Effects:**

1. Remove previous vote (if any)
2. Add vote to new nomination
3. Increment votesFor counter

**Response:**

```json
{
  "success": true,
  "message": "Vote recorded for {candidateName}. Top vote-getter when the window closes wins."
}
```

## Election Resolution

### `resolveSpeakerElection()`

Called when election ends (time expiry or admin force-end):

```typescript
export async function resolveSpeakerElection(
  db: Db,
  partyMap: Map<string, PoliticalParty>,
  forceEnd: boolean
): Promise<boolean> {
  // 1. Find active election
  const election = await db
    .collection<SpeakerElection>("speakerElections")
    .findOne({ _id: "current" });
  if (!election || election.status !== "voting") return false;

  // 2. Find winner (plurality)
  const nominations = await db
    .collection<SpeakerNomination>("speakerNominations")
    .find({ status: { $in: ["open", "voting"] } })
    .sort({ votesFor: -1 })
    .toArray();

  if (nominations.length === 0) {
    // No candidates - close the election and vacate the office
  } else {
    // Winner is top vote-getter
    const winner = nominations[0];
    await installSpeaker(db, winner.nomineeId, winner.nomineeName, winner.nomineeParty);
  }

  // 3. Close election
  await db
    .collection<SpeakerElection>("speakerElections")
    .updateOne({ _id: "current" }, { $set: { status: "closed", updatedAt: new Date() } });

  return true;
}
```

### Tie Breaking

Ties are broken by the first nominee to reach the vote total (earlier `updatedAt`).

## Auto-Vacate Logic

### `vacateSpeakerIfLostSeat()`

Called during election resolution phase:

```typescript
export async function vacateSpeakerIfLostSeat(db: Db): Promise<void> {
  const leaderDoc = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: "speaker_of_the_house" });
  if (!leaderDoc?.characterId) return;
  const stillHasSeat = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: "house",
    $or: [{ characterId: leaderDoc.characterId }, { nppId: leaderDoc.characterId }],
  });
  if (stillHasSeat) return;
  const now = new Date();
  await db
    .collection<CongressLeader>("congressLeaders")
    .updateOne(
      { role: "speaker_of_the_house" },
      { $set: { characterId: null, characterName: "Vacant", updatedAt: now } }
    );
  // The chair is now empty, open an election so the House can refill it without
  // waiting on an admin to start one.
  await openSpeakerElection(db, now);
}
```

The leader doc is not deleted; it is set to `characterId: null` / `characterName: "Vacant"` so the singleton is idempotent (subsequent calls early-return once already vacant, so the election opens exactly once per vacancy). A fresh 24-hour Speaker election is opened automatically as part of this call.

**Trigger:** Runs in Group 7 (Election Resolution) after general elections resolve.

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

### Resolution (`resolveSpeakerVacateMotion`)

- **Threshold to pass:** Absolute majority of the House (`Math.floor(totalSeats / 2) + 1` for-votes), not a plurality.
- Can resolve early once the threshold is reached, or when the 24-hour window closes (whichever comes first).
- Concurrency-safe: the motion is claimed via a conditional `status: voting → passed|failed` write so two concurrent resolvers cannot double-vacate.
- **On pass:** the Speaker is vacated (`vacateCongressLeadershipRole`) and a fresh 24-hour Speaker election is opened immediately (`openSpeakerElection`), shared with the lost-seat vacancy path.
- **On fail** (window closed without reaching the threshold): the motion is marked `failed` and the sitting Speaker stays in place.

## Data Model

### Collections

| Collection           | Purpose                       |
| -------------------- | ----------------------------- |
| `speakerElections`   | Current election state        |
| `speakerNominations` | Candidacies and votes         |
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
  status: "open" | "voting" | "withdrawn" | "failed" | "elected";
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

Votes are stored as a map on the nomination document:

```typescript
votes: {
  "characterId1": "for",
  "characterId2": "for",
  // ...
}
```

**Vote changing:** When a member votes for a different candidate:

1. Previous vote is `$unset` from old nomination
2. New vote is `$set` on new nomination
3. `votesFor` counters are adjusted atomically

## Integration with Turn Processing

Speaker-related phases in turn processing:

| Phase                       | Group            | Purpose                                                         |
| --------------------------- | ---------------- | --------------------------------------------------------------- |
| Speaker election resolution | 4 (NPP behavior) | Shared leadership upkeep helpers; no live NPP speaker vote pass |
| Election resolution         | 7                | Vacate speaker if lost seat                                     |

## Error Responses

| Status | Condition                                                |
| ------ | -------------------------------------------------------- |
| 400    | Invalid action, missing character, invalid nomination ID |
| 403    | Not House member, not majority party, insufficient NPI   |
| 404    | Candidacy not found, no active election                  |
| 409    | Election already running, already running for office     |

## Related Systems

- **House Composition:** `src/lib/congress/houseComposition.ts` - Majority party calculation
- **NPP Behavior:** `src/lib/turn/npp/` - NPP bill voting, election entry, and current player-only leadership stance
- **Congress Leadership:** `docs/design/congress-leadership.md` - Leadership elections
- **Election Resolution:** `src/lib/turn/election/` - General election resolution
