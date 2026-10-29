# Contingent Election

## Summary

The US 12th Amendment fallback when no presidential candidate reaches an Electoral College majority. The House elects the President; the Senate elects the Vice President. Source: `src/lib/elections/contingentElection.ts`.

Player guide: [Contingent Election](https://www.ahousedividedgame.com/wiki/contingent-election)

This is not a raw 435-member roll call. Each **state delegation** casts one combined vote. Representatives only decide how their state's single delegation vote is cast. DC has electoral votes but no voting House delegation and is excluded from the House ballot. The Senate elects the VP on a one-vote-per-senator basis.

The rule exists to mirror the real constitutional fallback: small states weigh as much as large ones, so a candidate needs breadth across the map and not just a big caucus.

## Rules

### Eligibility

| Chamber | Ballot | Candidates eligible |
| --- | --- | --- |
| House | President | Top 3 candidates by electoral vote (`getTopContingentPresidentCandidates`, ties broken by id) |
| Senate | Vice President | Running mates of the top 2 presidential tickets by EV (`getTopContingentVicePresidentCandidateIds`) |

`resolveContingentElection` throws if the presidential candidate list includes anyone outside the expected top 3 (`assertPresidentCandidatesEligible`), or if the list is empty.

The ballot is reached only when no candidate holds an Electoral College majority. That majority is era-aware: `electoralMajorityFor(total) = floor(total / 2) + 1` (`src/lib/elections/presidentialResolutionDisplay.ts`), so 270 of 538 on a modern map and 266 of 531 in a 1950s world. `runPresidentialContingentBallot` (`src/lib/turn/election/presidentContingentBallot.ts`) runs the ballot.

### Constants

| Constant | Value | Source | Meaning |
| --- | --- | --- | --- |
| `HOUSE_CONTINGENT_THRESHOLD` | 26 | `src/lib/elections/contingentConstants.ts` | Fallback majority of state delegations, used only when no roster is supplied |
| `SENATE_CONTINGENT_THRESHOLD` | 51 | `src/lib/elections/contingentConstants.ts` | Fallback majority of senators, same rule |
| `contingentMajorityOf(n, fallback)` | `floor(n / 2) + 1`, or `fallback` when `n` is not a positive finite number | `src/lib/elections/contingentConstants.ts` | The live threshold: more than half of the roster actually on the ballot |
| `CONTINGENT_EXCLUDED_HOUSE_STATE` | `"DC"` | `src/lib/elections/contingentConstants.ts` | Excluded from the House delegation ballot |
| `CONTINGENT_HOUSE_STATE_IDS` | 50 states | `src/lib/elections/contingentElection.ts` | Delegations with a House ballot (`Object.keys(HOUSE_SEATS).sort()`, `HOUSE_SEATS` in `src/lib/constants/states.ts`) |
| `PARTY_MATCH_BONUS` | 35 | `src/lib/elections/contingentElection.ts` | Score bonus when voter and candidate share a party |
| `COALITION_MATCH_BONUS` | 30 | `src/lib/elections/contingentElection.ts` | Score bonus when the candidate's party is a coalition partner of the voter's party |
| `CONTINGENT_HOUSE_VOTE_TURNS` | 24 | `src/lib/turn/election/contingentActingPresidency.ts` | Turns the House keeps voting after a deadlock (one turn is one game hour) |

Thresholds are computed from the roster on the ballot. The resolver computes `houseThreshold = contingentMajorityOf(houseDelegations.length, 26)` and `senateThreshold = contingentMajorityOf(senators.length, 51)`. A modern world (50 delegations, 100 senators) gives 26 and 51.

The House roster is always the 50 `HOUSE_SEATS` states: `padHouseDelegationsToAllStates` in `src/lib/turn/election/loadContingentElectionData.ts` adds an empty delegation for any state with no seated voters, and `HOUSE_SEATS_1953` omits AK and HI, which then sit on the ballot as empty delegations that abstain. So the House threshold is **26 in every era**, while the Senate threshold follows the seated senator count (49 for 96 senators in a 1950s world). The helper itself would give 25 for 48 delegations (`src/lib/elections/eraElectoralMajority.test.ts`), but the live path never passes 48 (see Known issues).

If the Vice President ballot has exactly one eligible candidate, that candidate wins outright with no Senate vote. With two or more, the Senate votes.

### Voter preference model

Each House member and senator scores every eligible candidate:

```
score = partyBonus - ideologyDistance
partyBonus = 35 if same party, else 30 if candidate's party is in voter.coalitionParties, else 0
ideologyDistance = |voter.economic - candidate.economic| + |voter.social - candidate.social|
```

`PARTY_MATCH_BONUS` is kept modest so ideology distance (roughly 0 to 20) can still swing close races. `pickPreferredCandidate` returns the candidate with the best score; a voter-level tie is broken deterministically by hashing `tieSeed` with the sorted tied candidate ids (`sha256`, first byte mod tie-count).

NPP bloc officials can be aggregated into a single voter with a `weight` field (default 1) instead of one row per official. Voter weight is the official's `seatsHeld` (default 1) for House members; senators always weigh 1.

Voter and candidate positions come from the character's or NPP's `policies`, falling back to the party's `economicPosition` and `socialPosition`, then 0 (`buildVoterProfile`). Sitting presidents and vice presidents are excluded as voters (`policiesForOfficial`).

### House delegation vote

`calculateHouseDelegationVote` sums each delegation's weighted picks per candidate. A delegation votes for the candidate with the strict plurality of its own weighted picks (the single highest total, not necessarily a majority); a delegation-level tie means that state abstains (`null`). DC always abstains. A delegation with zero eligible voters or zero eligible candidates also abstains.

`calculateHouseDelegationVotes` runs this across all delegations and returns per-state votes plus a candidate to delegation-count total (one point per state, not per representative).

#### Ballot 2: compromise ballot

If the best first-ballot total is below `houseThreshold` and more than two candidates were on the ballot, `resolveContingentElection` runs a second ballot:

1. The candidate with the fewest delegation votes withdraws (ties broken by lower original EV, then id).
2. Each delegation votes again among the remaining candidates (`calculateCompromiseDelegationVote`), using the same plurality rule, seeded with `{tieSeed}:ballot:2`. A delegation that is still tied instead sums each voter's weighted preference score per candidate and picks the highest, with a `sha256` hash only if those sums tie. A compromise delegation therefore always casts a vote unless it is DC or has no voters.

Both ballots are recorded in `houseBallots`.

### Senate VP vote

`calculateSenateVpVotes` is a flat one-senator-one-vote tally over the eligible VP candidates using the same preference model, keyed with `tieSeed:senate:{senatorId}`.

### Winner resolution

`resolveWinnerFromTotals` (shared by House and Senate):

1. Rank candidates by vote total, ties broken by id.
2. If the leader's total meets the chamber threshold, that candidate wins outright.
3. Otherwise **deadlock**: among the tied leaders, a deterministic hash of `electionId:deadlock:{context}:{sortedIds}` picks a winner (`sha256`, first byte mod tie-count). `deadlockBreakerUsed = true` and a `deadlockBreakerReason` string is recorded.
4. If the ballot produced **no votes at all** (every voter unable to pick, or an empty chamber), `resolveContingentEvFallback` breaks the tie by original electoral-vote count instead of chamber votes, with its own deterministic hash keyed `electionId:ev-fallback:{context}:{sortedIds}`.

For the Senate the hash winner is the final Vice President. For the House the hash winner is only a placeholder: a House deadlock sets `houseDeadlocked`, and the presidency is handled as below instead of seating that candidate. Note that case 4 also sets `houseDeadlocked`, so a House with no usable votes is treated as a deadlock too.

### House deadlock: acting president and continued voting

When `houseDeadlocked` is true and a Senate VP was elected (`needsActingPresidency` in `src/lib/turn/election/contingentActingPresidency.ts`):

1. `seatActingPresidencyForHouseVote` seats the Senate's VP pick as **acting president** (an appointment, not an elected term) and leaves the vice presidency vacant.
2. A `contingentHouseVote` record opens on the vote tally with `closesTurn = openedTurn + 24`.
3. Each later turn, `closeDueContingentHouseVotes` (`src/lib/turn/election/contingentHouseVoteClose.ts`) takes a ballot using live standings (`loadHouseVoteStandings`). The first counting ballot is the turn after the vote opened, so there are 24 ballots (turns `openedTurn + 1` to `closesTurn`). A player member's explicit vote always counts; members who have not voted, and all NPPs, follow the party whip, then the coalition whip, then preference scoring (`src/lib/elections/contingentHouseStandings.ts`). Players cast and change picks through `/api/elections/[id]/contingent-vote`; party and coalition chairs whip through `/api/elections/[id]/contingent-vote/whip`.
4. The moment a candidate holds a majority of delegations the vote closes, that candidate is seated as President, and the acting president becomes Vice President (unless they have left the game, then the vice presidency stays vacant).
5. If the 24 turns pass with no majority, the vote closes with no winner and the acting president keeps serving. The plurality leader is never seated.
6. A winner whose seating fails stays flagged `seatingPending`; the next turn retries only the seating.

Whip resolution (`whipFor`): a member's party whip applies first, else their coalition's. A whip of `"free"` leaves members to vote freely and is not overridden by the coalition. A whip for a candidacy no longer on the ballot is ignored. A player who votes against the whip that applies to them is recorded as a defiance. Candidacies that withdrew, whose character was deleted, or whose NPP retired are dropped from the live ballot (`partitionEligibleCandidates`).

### Determinism

All random-seeming choices (voter-level ties, delegation-level ties, chamber-level deadlocks, and the EV fallback) are `sha256`-hashed off `electionId` plus a context string, never `Math.random()`. The same election always resolves the same way if replayed.

## Data

| Collection | Field | Notes |
| --- | --- | --- |
| `electionVoteTallies` | `contingentResult` | The `ContingentElectionResult` below; shown on the election results page |
| `electionVoteTallies` | `contingentResolutionPending` | Set when the ballot throws; retried next turn |
| `electionVoteTallies` | `contingentChamberSnapshot` | Frozen House and Senate voters so a retry uses the same chamber; internal |
| `electionVoteTallies` | `contingentHouseVote` | `status`, `openedTurn`, `closesTurn`, `actingPresidentId`, `actingPresidentName`, `eligibleCandidateIds`, `votes` (member to candidacy), `whips`, `ballots`, `presidentWinnerId`, `closedTurn`, `seatingPending`, `lastBallotTurn`, `lastReminderTurn`; shown on the House vote panel |
| `electionVoteTallies` | `executiveSeatingPending` | Seating retry flag |
| `electedOfficials` | read | House (`officeType: "house"`, with `state`) and Senate members forming the voters |
| `characters`, `npps` | read | `party`, `policies`, `currentOffice` (to exclude sitting executives) |
| `politicalParties` | read | `economicPosition`, `socialPosition` fallback |
| `coalitions` | read | Member parties, for the coalition bonus and coalition whips |
| `electionCandidates` | read | Candidacies and `runningMateId` |
| `elections` | read | Election and country |

`ContingentElectionResult` (`src/lib/elections/contingentElection.ts`):

| Field | Meaning |
| --- | --- |
| `resolutionMode` | `"contingent"` (threshold met outright) or `"contingent_deadlock"` (tiebreaker used, House or Senate or both) |
| `eligiblePresidentCandidateIds` / `eligibleVicePresidentCandidateIds` | The ballots actually run |
| `houseDelegationVotes` / `senateVotes` | Per-state / per-senator raw picks |
| `houseVoteTotals` / `senateVoteTotals` | Aggregated totals |
| `houseBallots` | Each House ballot (1 or 2), with active candidates, votes, totals and reason |
| `presidentWinnerId` / `vicePresidentWinnerId` | Final winners (`vicePresidentWinnerId` is `null` only if no running mates were eligible); `presidentWinnerId` is only the plurality leader when `houseDeadlocked` |
| `houseThreshold` / `senateThreshold` | Majorities in force, echoed for display |
| `houseDeadlocked` | No candidate reached the House majority |
| `deadlockBreakerUsed` / `deadlockBreakerReason` | Whether and why a tiebreak fired |
| `topElectoralVoteTotal` | The winning EV count from the original election, for context copy |

Seating writes presidency and vice presidency through `seatPresidentialExecutive` (`src/lib/turn/election/presidentExecutiveSeating.ts`), and a notification and a country game-event post announce the acting presidency and the House vote closing.

## Configuration

There are no gameConfig fields, flags or per-country presets for the contingent election. Behaviour that varies by world comes from data:

| Input | Effect | Where set |
| --- | --- | --- |
| Electoral college size | EV majority (`floor(total / 2) + 1`) | Apportionment for the active preset, `loadApportionment` |
| Seated senators | Senate threshold (`floor(n / 2) + 1`) | Elected officials in the world |
| House roster | Always the 50 `HOUSE_SEATS` states, padded | `src/lib/constants/states.ts` |
| Coalition membership | Coalition bonus 30 and coalition whips | `coalitions` collection |
| Country | US only (`election.countryId ?? "US"`) | election document |

All constants (35, 30, 24, top 3, top 2) are code constants, not configurable.

## Timing

- The contingent ballot runs inside the `electionResolution` phase of the turn processor (`src/simulation/phases/turnPhaseRegistry.ts`), when `resolveGeneralElections` resolves the presidential race (`src/lib/turn/election/presidentResolution.ts`) and finds no Electoral College majority.
- House and Senate general elections resolve before the president, so contingent ballots use the incoming Congress (`src/lib/turn/electionResolution.ts`). The chamber roster is snapshotted on the tally (`contingentChamberSnapshot`) so a retry uses the same voters.
- If the ballot fails, the tally is marked `contingentResolutionPending` and resolution is retried next turn (`markContingentResolutionPending`).
- On a deadlock, the follow-up House ballots run in the same `electionResolution` phase on later turns, right after `resolveGeneralElections` (`closeDueContingentHouseVotes`).

```
electionResolution phase, turn T
  resolveGeneralElections
    House and Senate races resolve first (incoming Congress)
    President race: no EV majority
      runPresidentialContingentBallot
        ballot 1 (50 delegations) -> [ballot 2 compromise] -> Senate VP vote
        House majority? yes -> President + VP seated
                        no  -> houseDeadlocked
                               VP pick seated as acting president, vote opens (closesTurn = T + 24)
  closeDueContingentHouseVotes (every later turn, same phase)
    finish any pending seating
    turns T+1 .. T+24: live ballot (explicit votes, whips, preference)
      majority -> close, seat President, acting president becomes VP
      T+24 and no majority -> close, acting president keeps serving
```

## Worked trace

A modern-map election: A has 262 EV, B has 261 EV, C has 15 EV (538 total, 270 needed, so nobody wins). `getTopContingentPresidentCandidates` returns A, B, C; the running mates of A and B (call them a and b) are the VP ballot. Thresholds are `contingentMajorityOf(50, 26) = 26` delegations and `contingentMajorityOf(100, 51) = 51` senators.

**One voter's score.** A party R representative at economic 3, social -2 scores candidate A (party R, economic 4, social -1) as `35 - (|3-4| + |-2-(-1)|) = 35 - 2 = 33`; candidate B (party D, economic -5, social 4) as `0 - (8 + 6) = -14`; a coalition-partner candidate at economic 0, social 0 as `30 - (3 + 2) = 25`. The voter picks A.

**One delegation.** A state with 3 R members (pick A) and 2 D members (pick B), each weight 1: A 3, B 2, so the delegation votes A. Had it been 2 and 2 with a third member picking C, A and B tie for the top and the state abstains on ballot 1.

**Ballot 1 totals.** A 24, B 23, C 2, 1 state abstained (tied): 24 + 23 + 2 + 1 = 50. The leader has 24, below 26, and there are three candidates, so C (fewest delegations, 2) withdraws.

**Ballot 2.** Every delegation votes again between A and B. C's two states and the tied state are decided by plurality or, if still tied, summed preference scores. Say that gives A 25 and B 25. Neither reaches 26, so `resolveWinnerFromTotals` finds a tie at 25 (ranked by id), hashes `electionId:deadlock:house:A:B` to pick a placeholder, and `houseDeadlocked` is true.

**Senate.** b receives 54 of 100 senators, a gets 46: 54 >= 51, so b is Vice President-elect with no tiebreak.

**Result.** `needsActingPresidency` is true (deadlocked, VP exists). b is seated as acting president, the vice presidency is left vacant, and the House vote opens on turn T with `closesTurn = T + 24`. On turn T+1 the first live ballot is taken. If A reaches 26 delegations on any ballot up to T+24, the vote closes, A becomes President and b becomes Vice President. If no ballot reaches 26 by T+24, the vote closes and b keeps serving. The result is stored with `resolutionMode: "contingent_deadlock"`.

## Edge cases and limits

- **Fewer than three candidates.** The ballot uses whoever exists; the second House ballot only runs with more than two candidates.
- **Delegation ties abstain.** A split state counts for nobody on ballot 1. Ballot 2 resolves tied states by summed preference.
- **Single VP candidate.** Wins with no Senate vote (shared running mate case).
- **No VP candidates.** `vicePresidentWinnerId` is `null`; a House deadlock then cannot seat an acting president (`needsActingPresidency` requires a VP).
- **DC.** Has electors but never a House vote.
- **No usable votes.** Falls back to original EV count with a deterministic hash for equal EV.
- **Determinism.** All tie-breaks are `sha256` hashes off `electionId` plus a context string, never `Math.random()`, so a replay resolves identically.
- **US only.** The House vote handler skips elections whose `countryId` is not `US`, and the vote routes reject non-presidential elections.
- **Empty delegations.** A state with no seated House voters still counts toward the 26-delegation threshold, which makes the bar harder to reach in an era with fewer states.
- **Left-the-game acting president.** If the acting president has left the game by the time the House elects someone, the vice presidency stays vacant.
- **Winner has no candidacy row.** Seating is skipped, `seatingPending` is cleared, and an error is logged.
- **Closed vote.** Player votes and whips on a closed House vote return 409; DC members cannot vote (403).

## Invariants

- Only the top 3 EV candidates are on the House ballot. Enforced at runtime by `assertPresidentCandidatesEligible`; tested in `src/lib/turn/election/contingentElection.test.ts`.
- DC never casts a House vote. Enforced in `calculateHouseDelegationVote` and `computeHouseVoteStandings`; tested.
- One vote per state delegation, one per senator. Structural in the tally code; tested.
- A replay of the same election resolves identically (deterministic hashing). Tested ("is deterministic for identical inputs").
- A ballot is claimed at most once per turn: `takeBallot` updates only where `lastBallotTurn` is not the current turn, so a repeated turn cannot double-count. Covered in `contingentHouseVoteClose.test.ts`.
- The plurality leader is never seated without a majority. Enforced by `takeBallot` seating only `standings.majorityWinnerId`.
- Threshold is more than half of the roster. Enforced by `contingentMajorityOf`; tested in `eraElectoralMajority.test.ts` (helper only, not the live roster).
- Votes for candidacies not on the ballot are ignored. Enforced in `computeHouseVoteStandings`.

## Failure and recovery

- **Ballot throws.** The tally is marked `contingentResolutionPending` and the whole resolution retries next turn on the same frozen chamber snapshot.
- **Acting seating fails.** `executiveSeatingPending` is set and seating is retried next turn; the retry reuses the original vote window and does not re-announce.
- **House winner seating fails.** The vote is closed with `seatingPending`, and `closeDueContingentHouseVotes` finishes at most one pending seating per turn.
- **Two workers racing.** Each ballot is claimed with a conditional update before anything is seated, so only one proceeds.
- **Notification or webhook failure.** Logged and swallowed; seating is never undone by messaging.
- **Wrong result or stuck state.** Repaired by an admin heal on the tally and executive seating, then a rerun of resolution. A stuck pending flag is the usual signature.

## Connections

**Driven by:**

- [Elections](./elections.md): an Electoral College result without a majority sends the race here (`src/lib/turn/election/presidentResolution.ts`).
- House and Senate composition: the delegations and senators on the ballot come from the incoming Congress (`src/lib/turn/election/loadContingentElectionData.ts`).
- [Congress Leadership](./congress-leadership.md): party chairs can whip House votes during the deadlock window.

**Affects:**

- The presidency and vice presidency, via `seatPresidentialExecutive` (`src/lib/turn/election/presidentExecutiveSeating.ts`).
- Term limits: an acting presidency is recorded as an appointment and does not count as an elected term.
- Presidential tenure ledger (`recordPresidentialTenure`) when the House elects a winner.
- Live election projection, which runs the same ballot against the expected incoming Congress (`src/lib/elections/contingentProjection.ts`).

## Tests

- `src/lib/turn/election/contingentElection.test.ts`: eligibility, preference scoring, coalition bonus, delegation plurality and tie, DC, NPP weights, senator votes, compromise ballot, deadlock, EV fallback, determinism, "26 House states and 51 Senate votes".
- `src/lib/elections/eraElectoralMajority.test.ts`: EV and contingent majority helpers (modern and 1950s).
- `src/lib/elections/contingentHouseStandings.test.ts`, `src/lib/elections/contingentHouseVoteView.test.ts`, `src/lib/turn/election/contingentHouseVoteStandings.test.ts`: live House vote, whips, defiance.
- `src/lib/turn/election/contingentActingPresidency.test.ts`, `src/lib/turn/election/contingentHouseVoteClose.test.ts`, `src/lib/turn/election/contingentHouseVoteNotices.test.ts`, `src/lib/turn/election/contingentPersonIds.test.ts`, `src/lib/turn/election/loadContingentElectionData.test.ts`.
- `src/lib/turn/election/presidentResolution.test.ts`: resolution path.
- `src/app/api/elections/[id]/contingent-vote/route.test.ts` and `.../whip/route.test.ts`: the vote and whip routes.

Gaps: no test runs the live resolver against a 1950s roster, which is why the House threshold mismatch below went unnoticed; the projection module has no dedicated test file under `src/lib/elections/`.

## Known issues and history

- **House threshold in 1950s worlds.** `contingentMajorityOf` is documented as giving 25 of 48 delegations, and this page and the player wiki both said so. The live path pads the House roster to the 50 `HOUSE_SEATS` states, so `houseDelegations.length` is always 50 and the House threshold is 26 in every era. AK and HI sit on the 1950s ballot as empty delegations. Either the padding or the documented number should change; this page now states the code behaviour.
- **Player wiki contradictions** (`src/lib/seeds/wiki/content/contingentElection.ts`): the wiki says the House majority is "25 of 48 in the 1950s" (code: 26 of 50); says a delegation needs "a strict majority" of its members' picks (code: strict plurality, the single highest weighted total); says the Senate needs "a majority of the senators voting" (code: more than half of the seated senators, `floor(n / 2) + 1`); and its walkthrough skips the recorded compromise ballot (ballot 2) that runs before a House deadlock is declared.
- A House whose ballot produced no usable votes at all sets `houseDeadlocked` through the EV-fallback path, so it also seats an acting president when a Senate VP exists.

Last checked: 2026-10-29, version 1.18.0
