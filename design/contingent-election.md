# Contingent Election

## Overview

The US 12th Amendment fallback when no presidential candidate reaches an Electoral College majority. The House elects the President; the Senate elects the Vice President. Source: `src/lib/elections/contingentElection.ts`.

Player guide: [Contingent Election](https://www.ahousedividedgame.com/wiki/contingent-election)

This is not a raw 435-member roll call. Each **state delegation** casts one combined vote. Representatives only decide how their state's single delegation vote is cast. DC has electoral votes but no voting House delegation and is excluded from the House ballot. The Senate elects the VP on a one-vote-per-senator basis.

The rule exists to mirror the real constitutional fallback: small states weigh as much as large ones, so a candidate needs breadth across the map and not just a big caucus.

## Eligibility

| Chamber | Ballot | Candidates eligible |
| --- | --- | --- |
| House | President | Top 3 candidates by electoral vote (`getTopContingentPresidentCandidates`, ties broken by id) |
| Senate | Vice President | Running mates of the top 2 presidential tickets by EV (`getTopContingentVicePresidentCandidateIds`) |

`resolveContingentElection` throws if the presidential candidate list includes anyone outside the expected top 3 (`assertPresidentCandidatesEligible`), or if the list is empty.

## Rules and constants

| Constant | Value | Source | Meaning |
| --- | --- | --- | --- |
| `HOUSE_CONTINGENT_THRESHOLD` | 26 | `src/lib/elections/contingentConstants.ts` | Fallback majority of state delegations, used only when no roster is supplied |
| `SENATE_CONTINGENT_THRESHOLD` | 51 | `src/lib/elections/contingentConstants.ts` | Fallback majority of senators, same rule |
| `contingentMajorityOf(n, fallback)` | `floor(n / 2) + 1` | `src/lib/elections/contingentConstants.ts` | The live threshold: more than half of the roster actually on the ballot |
| `CONTINGENT_EXCLUDED_HOUSE_STATE` | `"DC"` | `src/lib/elections/contingentConstants.ts` | Excluded from the House delegation ballot |
| `CONTINGENT_HOUSE_STATE_IDS` | 50 states | `src/lib/elections/contingentElection.ts` | Delegations with a House ballot (`Object.keys(HOUSE_SEATS).sort()`) |
| `PARTY_MATCH_BONUS` | 35 | `src/lib/elections/contingentElection.ts` | Score bonus when voter and candidate share a party |
| `COALITION_MATCH_BONUS` | 30 | `src/lib/elections/contingentElection.ts` | Score bonus when the candidate's party is a coalition partner of the voter's party |
| `CONTINGENT_HOUSE_VOTE_TURNS` | 24 | `src/lib/turn/election/contingentActingPresidency.ts` | Turns the House keeps voting after a deadlock (one turn is one game hour) |

Thresholds are era-aware. The resolver computes `houseThreshold = contingentMajorityOf(houseDelegations.length, 26)` and `senateThreshold = contingentMajorityOf(senators.length, 51)`. A modern world (50 delegations, 100 senators) gives 26 and 51. A 1950s world (48 delegations, 96 senators) gives 25 and 49.

If the Vice President ballot has exactly one eligible candidate, that candidate wins outright with no Senate vote. With two or more, the Senate votes.

## Voter Preference Model

Each House member and senator scores every eligible candidate:

```
score = partyBonus - ideologyDistance
partyBonus = 35 if same party, else 30 if candidate's party is in voter.coalitionParties, else 0
ideologyDistance = |voter.economic - candidate.economic| + |voter.social - candidate.social|
```

`PARTY_MATCH_BONUS` is kept modest so ideology distance (roughly 0 to 20) can still swing close races. `pickPreferredCandidate` returns the candidate with the best score; a voter-level tie is broken deterministically by hashing `tieSeed` with the sorted tied candidate ids (`sha256`, first byte mod tie-count).

NPP bloc officials can be aggregated into a single voter with a `weight` field (default 1) instead of one row per official.

## House Delegation Vote

`calculateHouseDelegationVote` sums each delegation's weighted picks per candidate. A delegation votes for the candidate with the strict plurality of its own weighted picks (the single highest total); a delegation-level tie means that state abstains (`null`). DC always abstains. A delegation with zero eligible voters or zero eligible candidates also abstains.

`calculateHouseDelegationVotes` runs this across all delegations and returns per-state votes plus a candidate to delegation-count total (one point per state, not per representative).

### Ballot 2: compromise ballot

If the best first-ballot total is below `houseThreshold` and more than two candidates were on the ballot, `resolveContingentElection` runs a second ballot:

1. The candidate with the fewest delegation votes withdraws (ties broken by lower original EV, then id).
2. Each delegation votes again among the remaining candidates (`calculateCompromiseDelegationVote`), using the same plurality rule. A delegation that is still tied instead sums each voter's weighted preference score per candidate and picks the highest, with a `sha256` hash only if those sums tie. A compromise delegation therefore always casts a vote unless it is DC or has no voters.

Both ballots are recorded in `houseBallots`.

## Senate VP Vote

`calculateSenateVpVotes` is a flat one-senator-one-vote tally over the eligible VP candidates using the same preference model, keyed with `tieSeed:senate:{senatorId}`.

## Winner Resolution

`resolveWinnerFromTotals` (shared by House and Senate):

1. Rank candidates by vote total, ties broken by id.
2. If the leader's total meets the chamber threshold, that candidate wins outright.
3. Otherwise **deadlock**: among the tied leaders, a deterministic hash of `electionId:deadlock:{context}:{sortedIds}` picks a winner (`sha256`, first byte mod tie-count). `deadlockBreakerUsed = true` and a `deadlockBreakerReason` string is recorded.
4. If the ballot produced **no votes at all** (every voter unable to pick, or an empty chamber), `resolveContingentEvFallback` breaks the tie by original electoral-vote count instead of chamber votes, with its own deterministic hash keyed `electionId:ev-fallback:{context}:{sortedIds}`.

For the Senate the hash winner is the final Vice President. For the House the hash winner is only a placeholder: a House deadlock sets `houseDeadlocked`, and the presidency is handled as below instead of seating that candidate.

## House deadlock: acting president and continued voting

When `houseDeadlocked` is true and a Senate VP was elected (`needsActingPresidency` in `src/lib/turn/election/contingentActingPresidency.ts`):

1. `seatActingPresidencyForHouseVote` seats the Senate's VP pick as **acting president** (an appointment, not an elected term) and leaves the vice presidency vacant.
2. A `contingentHouseVote` record opens on the vote tally with `closesTurn = openedTurn + 24`.
3. Each later turn, `closeDueContingentHouseVotes` (`src/lib/turn/election/contingentHouseVoteClose.ts`) takes a ballot using live standings (`loadHouseVoteStandings`). The first counting ballot is the turn after the vote opened. A player member's explicit vote always counts; members who have not voted, and all NPPs, follow the party whip, then the coalition whip, then preference scoring (`src/lib/elections/contingentHouseStandings.ts`). Players cast and change picks through `/api/elections/[id]/contingent-vote`; party and coalition chairs whip through `/api/elections/[id]/contingent-vote/whip`.
4. The moment a candidate holds a majority of delegations the vote closes, that candidate is seated as President, and the acting president becomes Vice President (unless they have left the game, then the vice presidency stays vacant).
5. If the 24 turns pass with no majority, the vote closes with no winner and the acting president keeps serving. The plurality leader is never seated.
6. A winner whose seating fails stays flagged `seatingPending`; the next turn retries only the seating.

## Result Shape

`ContingentElectionResult`:

| Field | Meaning |
| --- | --- |
| `resolutionMode` | `"contingent"` (threshold met outright) or `"contingent_deadlock"` (tiebreaker used, House or Senate or both) |
| `eligiblePresidentCandidateIds` / `eligibleVicePresidentCandidateIds` | The ballots actually run |
| `houseDelegationVotes` / `senateVotes` | Per-state / per-senator raw picks |
| `houseVoteTotals` / `senateVoteTotals` | Aggregated totals |
| `houseBallots` | Each House ballot (1 or 2), with active candidates, votes, totals and reason |
| `presidentWinnerId` / `vicePresidentWinnerId` | Final winners (`vicePresidentWinnerId` is `null` only if no running mates were eligible); `presidentWinnerId` is only the plurality leader when `houseDeadlocked` |
| `houseThreshold` / `senateThreshold` | Era-aware majorities (26 / 51 modern), echoed for display |
| `houseDeadlocked` | No candidate reached the House majority |
| `deadlockBreakerUsed` / `deadlockBreakerReason` | Whether and why a tiebreak fired |
| `topElectoralVoteTotal` | The winning EV count from the original election, for context copy |

## Timing

- The contingent ballot runs inside the `electionResolution` phase of the turn processor (`src/simulation/phases/turnPhaseRegistry.ts`), when `resolveGeneralElections` resolves the presidential race (`src/lib/turn/election/presidentResolution.ts`) and finds no Electoral College majority.
- House and Senate general elections resolve before the president, so contingent ballots use the incoming Congress (`src/lib/turn/electionResolution.ts`). The chamber roster is snapshotted on the tally (`contingentChamberSnapshot`) so a retry uses the same voters.
- If the ballot fails, the tally is marked `contingentResolutionPending` and resolution is retried next turn (`markContingentResolutionPending`).
- On a deadlock, the follow-up House ballots run in the same `electionResolution` phase on later turns, right after `resolveGeneralElections` (`closeDueContingentHouseVotes`).

## Edge cases and limits

- **Fewer than three candidates.** The ballot uses whoever exists; the second House ballot only runs with more than two candidates.
- **Delegation ties abstain.** A split state counts for nobody on ballot 1. Ballot 2 resolves tied states by summed preference.
- **Single VP candidate.** Wins with no Senate vote (shared running mate case).
- **No VP candidates.** `vicePresidentWinnerId` is `null`; a House deadlock then cannot seat an acting president (`needsActingPresidency` requires a VP).
- **DC.** Has electors but never a House vote.
- **No usable votes.** Falls back to original EV count with a deterministic hash for equal EV.
- **Determinism.** All tie-breaks are `sha256` hashes off `electionId` plus a context string, never `Math.random()`, so a replay resolves identically.
- **US only.** The House vote handler skips elections whose `countryId` is not `US`.

## Worked example

A modern-map election: A has 262 EV, B has 261 EV, C has 15 EV (nobody reaches 270). All three are on the House ballot; the running mates of A and B are on the Senate ballot. Thresholds are 26 delegations and 51 senators.

Ballot 1 delegation totals: A 24, B 23, C 2, 1 state abstained (tied). The leader has 24, below 26, and there are three candidates, so C withdraws. On ballot 2 every delegation votes again between A and B; C's two states and the tied state are decided by plurality or, if still tied, summed preference scores. Say that gives A 25 and B 25. Neither reaches 26, so `houseDeadlocked` is true. The Senate meanwhile elects B's running mate with 54 of 100. That running mate becomes acting president and the House keeps balloting for 24 turns. If A reaches 26 delegations on any later turn, A becomes President and B's running mate becomes Vice President.

## Connections

**Driven by:**

- [Elections](./elections.md): an Electoral College result without a majority sends the race here (`src/lib/turn/election/presidentResolution.ts`).
- House and Senate composition: the delegations and senators on the ballot come from the incoming Congress (`src/lib/turn/election/loadContingentElectionData.ts`).
- [Congress Leadership](./congress-leadership.md): party chairs can whip House votes during the deadlock window.

**Affects:**

- The presidency and vice presidency, via `seatPresidentialExecutive` (`src/lib/turn/election/presidentExecutiveSeating.ts`).
- Term limits: an acting presidency is recorded as an appointment and does not count as an elected term.

## Determinism

All random-seeming choices (voter-level ties, delegation-level ties, chamber-level deadlocks, and the EV fallback) are `sha256`-hashed off `electionId` plus a context string, never `Math.random()`. The same election always resolves the same way if replayed.

Last checked: 2026-10-29, version 1.18.0
