# Congress Leadership

Design and status for US House and Senate leadership roles. The underlying
presiding-officer election framework is shared across countries; see
[Chamber Leadership by Country](./chamber-leadership-by-country.md) for the DE
Bundestagspraesident, NG National Assembly presiding officers, and CN CPPCC
Chairman / NPCSC Chairman variants.

The Speaker's own election and motion to vacate have a deeper page: [Congress Speaker System](./congress-speaker.md).

## Summary

The US House and Senate each elect their floor leaders by short plurality ballots: Speaker of the House, President Pro Tempore, Majority and Minority Leaders and both Whips in each chamber. Each role has one eligibility policy that decides who may run, who may vote and who keeps the office after a party switch. Holders get a per-turn action bonus and a national influence tier. The Senate also confirms cabinet nominations, documented at the end of the Rules section.

Player guide: [Congress Leadership](https://www.ahousedividedgame.com/wiki/congress-leadership)

## Rules

### Constants

| Rule | Value | Source |
| --- | --- | --- |
| Election window | 24 hours, closing on turn `currentTurn + 24` (`endsOnTurn`); one turn is one game hour. A legacy `endsAt` date is used only when `endsOnTurn` is absent | `LEADERSHIP_ELECTION_DURATION_MS` in `src/lib/congress/leadership/openElection.ts` (a second private copy lives in `src/lib/congress/leadershipElections.ts`), `isLeadershipElectionClosed` |
| Winner | Plurality of the seat-weighted vote; no absolute majority needed | `resolveLeadershipElection` in `src/lib/congress/leadershipElections.ts` |
| Tie-break | Earlier nomination (`createdAt`) wins | `resolveLeadershipElection` |
| No candidates | Role is vacated and the election closes | `resolveLeadershipElection` |
| Withdrawal cost | 3 political influence (NPI), must have at least 3; logged to `influenceHistory` | `src/app/api/congress/house-leadership/route.ts`, `senate-leadership/route.ts`, `src/lib/congress/speaker/actions.ts` |
| One race at a time | A character can hold one open candidacy across Speaker, House and Senate leadership | `src/lib/congress/leadershipRaceGuard.ts` |
| NPPs | Do not run or vote in leadership elections (player-only) | `src/app/api/congress/speaker/route.ts`, `src/lib/congress/leadershipElections.ts` |
| Cabinet confirmation window | 24 hours | `VOTING_DURATION_HOURS` in `src/app/api/whitehouse/cabinet/nominations/route.ts` |
| Action bonus | Speaker +3; Majority and Minority Leaders (both chambers) +2; Pro Tempore +1; each Whip +1; highest only | `LEADERSHIP_ACTION_BONUS` in `src/lib/actions/positionNiBonus/rules.ts` |
| National influence tier | Speaker, Majority Leaders, Pro Tempore 2.0; Minority Leaders 1.5; Whips none; highest across all offices, not stacked | `CONGRESS_LEADER_NI_BONUS` in `src/lib/actions/positionNiBonus/rules.ts` |

Tally: votes are weighted by seats held, and only voters who still hold a seat in the chamber count (`computeCongressLeadershipTally` in `src/lib/congress/governmentVoteBreakdown.ts`). A member may change their vote while the window is open; only the latest counts (`castLeadershipVoteBallot` in `src/lib/congress/leadershipVoteBallots.ts`).

### Eligibility by role

Each role has one policy in `POLICY_BY_ROLE` (`src/lib/congress/leadership/rolePolicy.ts`). The same policy decides who may run, who may vote and who keeps the office after a party switch.

| Role | Policy | Who may run and vote |
| --- | --- | --- |
| Speaker of the House | `any-seated` | Any sitting House member, any party |
| House Majority Leader, Majority Whip | `largest-single-party` | Members of the single party with the most House seats |
| House Minority Leader, Minority Whip | `non-coalition` | Members of seated parties outside the majority bloc |
| President Pro Tempore | `largest-single-party` | Members of the single party with the most Senate seats |
| Senate Majority Leader, Majority Whip | `largest-single-party` | Same, in the Senate |
| Senate Minority Leader, Minority Whip | `non-coalition` | Seated Senate parties outside the majority bloc |

Why the split: the Speaker presides over everyone, so the whole chamber chooses; majority offices belong to the party that runs the floor, so a coalition partner cannot take them; minority offices go to parties that are not in the governing bloc.

The majority bloc is the largest coalition or single unaffiliated party (`src/lib/congress/blocs.ts`); the minority bloc is the second largest, and its dominant party is the one minority roles are compared against.

### House: Speaker, Majority Leader, Minority Leader, Whips (24-hour plurality)

- **Status**: Implemented.
- **Flow**: These elections auto-open for 24 hours when a House general election resolves, but only for a role whose controlling party differs from the current holder's party, or whose seat is vacant (`hasControllingPartyChanged` in `src/lib/congress/leadershipElections.ts`). Majority roles and the Speaker are compared against the largest single party; minority roles against the minority bloc's dominant party. The sitting Speaker is auto-nominated if still seated. The sitting Majority Leader is auto-nominated when still seated and still in the largest party. The sitting Minority Leader is auto-nominated when still seated and still outside the majority bloc.
- **Eligibility**: see the table above. Leadership elections are player-only.
- **API**: `GET/POST /api/congress/speaker` (Speaker), `GET/POST /api/congress/house-leadership` (body `role: "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip"`, actions: `start_election` | `declare` | `withdraw` | `vote`, plus admin-only `reset_election` and `force_end`).
- **Data**: see Data. Helper: `getHouseComposition()` in `src/lib/congress/houseComposition.ts`.
- **Whips**: Majority Whip and Minority Whip run in the same 24-hour cycle with the same reopen rule and the same party gates as the matching Leader.

### Senate: President Pro Tempore, Majority Leader, Minority Leader, Whips (24-hour plurality)

- **Status**: Implemented.
- **Trigger cadence**: When a Senate general election resolves, each role (President Pro Tempore, Majority Leader, Minority Leader, both Whips) reopens only if the party that should hold it under the current seat counts differs from the current holder, or the role is vacant (`hasControllingPartyChanged`). This rule is the same for every Senate class, so a Class II or III cycle with an unchanged majority reopens nothing. The sitting Pro Tempore is auto-nominated if still seated; the sitting Majority or Minority Leader is auto-nominated when still seated and still eligible for that side of the chamber.
- **API**: `GET/POST /api/congress/senate-leadership` (body `role: "pro_tempore" | "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip"`, actions: `start_election` | `declare` | `withdraw` | `vote`, plus the admin actions).
- **Data**: see Data. Helper: `getSenateComposition()` in `src/lib/congress/senateComposition.ts`.

### Cabinet Nominations (Senate Role)

Cabinet nominations are initiated by the President but require Senate confirmation before a character is installed in a cabinet position.

- **Trigger**: President posts a nomination via `/api/whitehouse/cabinet/nominations`
- **Senate action**: Active nominations appear on both the Cabinet page and the Congress Senate tab; senators vote For / Against / Abstain
- **Window**: 24 hours from nomination
- **Threshold**: More For votes than Against votes (`didPass` in `src/lib/billLifecycleHelpers.ts`: `votesFor > votesAgainst`). Abstentions are ignored, and a tie fails.
- **Resolution**: On window expiry, `processCabinetNominationLifecycle` (`src/lib/cabinetNominationLifecycle.ts`, phase `cabinetNominations`) tallies and confirms or rejects
- **Exceptions**: Vice President nominations need a majority in both the House and the Senate. Seats configured as direct appointments (for example the US Chief of Staff) skip the vote and are seated when the zero-length window closes.
- **NPP senators**: Unlike leadership races, NPP senators do vote on cabinet nominations, by party-line heuristic (`nppCabinetVote`).
- **Incompatible offices**: a non-VP nominee who holds an office incompatible with cabinet service (`getIncompatibleOfficeHolders`, for example a central bank seat) fails regardless of the vote.
- **Rejection**: Position remains vacant; President may re-nominate
- **Confirmed**: Nominee added to `cabinetMembers` collection; displayed on `/whitehouse/cabinet`

See [Cabinet](./cabinet.md) for full position list and lifecycle details.

## Data

- **congressLeaders**: One document per role. Fields: `role`, `characterId`, `characterName`, `party`, `nominatedBy`, `electedAt`, `createdAt`, `updatedAt`. A vacant role has `characterId: null` and `characterName: "Vacant"`. `party` is stamped at election and not updated on a later party switch, so readers needing the live party use the character or seat row (`resolveSeatHolderParty` in `src/lib/congress/leadership/openElection.ts`). Shown to players on the Congress pages and leader badges.
- **House**: `speakerElections` (\_id: "current"), `speakerNominations`; `houseLeadershipElections` (\_id: majority_leader | minority_leader | majority_whip | minority_whip), `houseLeadershipNominations` (role field), `houseLeadershipBallots`.
- **Senate**: `senateLeadershipElections` (\_id: pro_tempore | majority_leader | minority_leader | majority_whip | minority_whip), `senateLeadershipNominations` (role field), `senateLeadershipBallots`.
- **Election documents**: `status` (`voting` or `closed`), `startedAt`, `endsAt`, `endsOnTurn`, `updatedAt`. Nomination documents: `role`, `nomineeId`, `nomineeName`, `nomineeParty`, `nomineeState`, `nominatedById`, `nominatedByName`, `status` (`open`, `voting`, `confirmed`, `failed`), `votesFor`, `votesAgainst`, `votes` (voter to for/against), `createdAt`. The candidacy cards and tallies are player-visible; the `votes` map is internal.
- **Read**: `electedOfficials` (seat holders, party, `seatsHeld`), `characters` (`party`, `politicalInfluence`, `homeState`), `politicalParties`, `coalitions` (bloc computation).
- **Written on withdraw**: `characters.politicalInfluence` (-3) and `influenceHistory`.
- **Cabinet**: `cabinetNominations` (votes, `houseVotes`), `cabinetMembers`.

## Configuration

There are no gameConfig fields, flags or era presets for these elections. The window, costs, bonuses and policies are code constants (see Rules). Variation by world comes from data:

| Input | Effect | Where set |
| --- | --- | --- |
| Chamber seat counts and parties | Which party is the majority, which bloc is the minority | `electedOfficials`, `politicalParties` |
| Coalition membership | Majority bloc grouping | `coalitions` |
| Direct-appointment cabinet seats | Skip the Senate vote | `appointedWithoutConfirmation` in `src/lib/constants/cabinetPositions.ts` |
| Country | US only; other countries use their own presiding-officer variants | See [Chamber Leadership by Country](./chamber-leadership-by-country.md) |

## Timing

Order inside the turn processor (`src/simulation/phases/turnPhaseRegistry.ts`):

1. A House or Senate general election resolves in the `electionResolution` phase. When it finishes seating a chamber, `triggerLeadershipElectionsAfterChamberVote` (called from `src/lib/turn/election/generalResolution.ts` and `generalResolutionHelpers.ts`) opens the leadership races whose controlling party changed.
2. `leadershipVacate` runs `vacateLeadershipForLostSeats` every turn after resolution: any leader who no longer holds a seat in their chamber is vacated, and a race to refill the chair is opened.
3. `leadershipPartyEligibility` runs `reconcileAllLeadershipPartyEligibility`: a Pro Tempore, Majority Leader or Majority Whip who has left the largest party is vacated and a fresh race opens for the seat. A Speaker is never vacated by a party switch, since the Speaker policy is `any-seated`.
4. `leadershipElections` runs `resolveExpiredLeadershipElections` every turn: every race whose window has closed is resolved and the winner installed.

```
turn N
  electionResolution ---- chamber seated ----> open races where the controlling party changed
  leadershipVacate ------ holder lost seat --> vacate + open race
  leadershipPartyEligibility - party switch -> vacate + open race (majority-gated roles)
  leadershipElections --- window closed -----> resolve: winner installed, or role vacated
turn N+24 (or later)
  leadershipElections resolves the races opened on turn N
cabinetNominations (separate phase, same turn loop)
  24-hour nomination windows are tallied and confirmed or rejected
```

Races also open outside a general election when a seat is vacated, either by the steps above or, for the Speaker, by a successful motion to vacate. Admins can start, reset or force-end a race.

## Worked trace

The House has 435 seats. Party A holds 230, party B 150, party C 55 (230 + 150 + 55 = 435). The previous Majority Leader is from party B and the previous Speaker is from party B.

A House general election resolves. The largest single party is now A, so the Majority Leader and Majority Whip roles have a controlling-party change (B holds them, A should) and both open for 24 turns on turn N (`endsOnTurn = N + 24`). Only A members may run or vote. Minority Leader and Minority Whip reopen only if their holder is not from the minority bloc's dominant party; B and C members, being outside the majority bloc, may run for them. The Speaker race also opens because the controlling party for the role changed from B to A; any of the 435 members may run, not just A, but the sitting Speaker (party B) is auto-nominated only if still seated.

Votes close at the 24th turn. All 230 A members vote, weighted one each: candidate X gets 140 and candidate Y gets 90 (140 + 90 = 230). X wins; no majority of A is required, and 140 is already above half. If X and Y had both ended on 115, the one who declared first wins. If only one A member declared, they win by default; if none declared, the Majority Leader seat is left Vacant and the race closes.

Winner effects: X is written to `congressLeaders` (role `majority_leader_house`), `markCongressLeadershipHeld` records the achievement, and X gains +2 actions per turn and a 2.0 national influence tier. If X was also a party chair (2.0 tier), the tier stays 2.0, not 4.0.

Withdrawal: a candidate with 10 NPI who withdraws drops to 7 and the candidacy is marked `failed`; one with 2 NPI is refused with 403.

## Edge cases and limits

- **Nobody declares.** The role is vacated and the race closes. No poller reopens it; the next controlling-party change, party-eligibility vacancy or admin start opens a new one.
- **Ties.** The nomination created first wins. Ties are rare because votes are tallied by seat weight, not raw count.
- **Seat lost mid-race.** Votes from members who have since lost their seat are dropped from the tally (`computeCongressLeadershipTally`).
- **Majority changes.** Nominations from a party that is no longer eligible are failed (`clearIneligibleHouseLeadershipNominations`) when a chamber result changes the alignment.
- **Party switches.** Majority-gated holders are vacated on the spot and the seat goes to a fresh 24-hour race. Losing the majority without switching reopens the seat at the next chamber-changing vote instead.
- **One seat at a time.** Declaring in a second race while holding an open candidacy is rejected with 409.
- **Changing votes.** A member can switch candidates while the window is open; only the latest vote counts.
- **Rank bonuses.** Only a holder's single highest leadership bonus applies (see Connections).
- **No second bloc.** If no minority bloc exists, the expected minority party is null and `hasControllingPartyChanged` returns true, so minority races reopen at every chamber-changing vote unless one is already running.
- **A chamber with no seats.** `vacateLeadershipForLostSeats` skips a chamber that has no seat rows at all, treating it as an unseeded or failed read instead of a mass loss of seats.
- **Live race in flight.** A new race is not opened for a role whose existing election is still `voting` and not yet closed.
- **Closed windows.** `declare`, `withdraw` and `vote` return 409 once the window has closed.

## Invariants

- A character holds at most one open candidacy across Speaker, House and Senate leadership. Enforced by the declare checks and `failNominationIfLeadershipConflict` after insert (`leadershipRaceGuard.test.ts`).
- A role has at most one live race. Enforced by `openCongressLeadershipElection` and the in-flight guards (`openElection.test.ts`).
- Incumbent auto-nomination is idempotent (an upsert on the active role and nominee, plus a partial unique index as backstop).
- Closing is claimed once: `claimStatusTransition` flips `voting` to `closed` so only one resolver announces the result (`leadershipElections.resolveIdempotency.test.ts`).
- Every winner was eligible under the role's policy when they declared and voted. Enforced at declare and vote; eligibility is not re-checked at resolution, so a candidate who switched party mid-race is handled by the reconciler instead.
- Both window anchors (`endsAt`, `endsOnTurn`) are written together on open and cleared together on reset. Tested in `openElection.test.ts`.
- Vacated roles never double-open: vacating is scoped to the expected holder (`expectCharacterId`) so overlapping requests cannot both claim one vacancy.
- Rank bonuses never stack. Enforced by `Math.max` in `resolveLeadershipActionBonus` and `resolvePositionNiBonus`.

## Failure and recovery

- **Chair stuck vacant.** A role with no candidate vacates and stays that way by design. Repair is an admin `start_election`, or a controlling-party change.
- **Race resolves instantly or never.** A stale window anchor makes a fresh race look closed or open. The shared opener and reset write and clear both anchors; an admin `reset_election` followed by `start_election` repairs a bad one.
- **Missed party switch.** Direct edits to a character's party bypass the switch cleanup. The `leadershipPartyEligibility` phase and the Congress page reads catch these and vacate and reopen.
- **Wrong or phantom leader.** `leadershipVacate` removes leaders whose seat has gone; a stale holder from a bad composition read is guarded by the empty-chamber check. Data repair is an admin heal of `congressLeaders` followed by a rerun.
- **Duplicate result posts.** The atomic close claim prevents a second announcement when two workers overlap.
- **Resolution error.** The race stays `voting`, so the next turn's `leadershipElections` phase retries; `force_end` by an admin resolves it immediately.

## Connections

**Driven by:**

- [Elections](./elections.md): House and Senate general election results set seat counts and fire the races (`triggerLeadershipElectionsAfterChamberVote`).
- Party switches and seat loss: vacate holders through `reconcileAllLeadershipPartyEligibility` and `vacateLeadershipForLostSeats`.
- [Party Whips](./party-whips.md): party whips can direct members' leadership votes.
- [Chamber Leadership by Country](./chamber-leadership-by-country.md): the shared presiding-officer framework.

**Affects:**

- Action points and national influence: leaders get a per-turn action bonus (Speaker +3; House and Senate Majority and Minority Leaders +2; Pro Tempore +1; Whips +1) and a national influence tier (Speaker, Majority Leaders and Pro Tempore 2.0; Minority Leaders 1.5; Whips none), only the highest counted, in `src/lib/actions/positionNiBonus/rules.ts`.
- [Congress Speaker System](./congress-speaker.md): the Speaker's election and removal.
- [Cabinet](./cabinet.md): the Senate confirms nominations.
- Achievements and career history (`markCongressLeadershipHeld`).
- [Contingent Election](./contingent-election.md): party chairs whip House votes during a deadlock.

### UI

- **Congress → Composition**: Member list shows **leader badges** (Speaker, Maj. Leader, Min. Leader, Pro Tempore, etc.) next to the name for the current holder.
- **Congress → Leadership**: House and Senate each show Majority/Minority sections with bloc-aware seat counts; each elected role (Speaker, Pro Tempore, Majority Leader, Minority Leader, Whips) has election UI (start 24h election, declare, vote, candidacy cards with plurality wording). Portraits and name (D-TX) for each leader.

## Tests

- `src/lib/congress/leadershipElections.test.ts`, `leadershipElections.lostSeats.test.ts`, `leadershipElections.resolveIdempotency.test.ts`: resolution, seat loss, idempotent close.
- `src/lib/congress/leadership/rolePolicy.test.ts`, `openElection.test.ts`, `reconcilePartyEligibility.test.ts`, `electionRoleMap.test.ts`: policies, opener, party-switch reconciliation, role mapping.
- `src/lib/congress/leadershipRaceGuard.test.ts`, `leadershipVoteBallots.test.ts`: one-race rule and vote changes.
- `src/app/api/congress/senate-leadership/route.test.ts` and `src/app/api/congress/congress.integration.test.ts`: routes.
- `src/lib/actions/positionNiBonus.test.ts`: influence tiers.
- `src/lib/cabinetNominationLifecycle.test.ts`: cabinet confirmation.

Gaps: no route test for `house-leadership` (it has no `route.test.ts`); the action bonus table has no dedicated test of every role's value; `triggerLeadershipElectionsAfterChamberVote` reopen rules are covered only indirectly.

## Known issues and history

- **Player wiki contradictions** (`src/lib/seeds/wiki/content/congressLeadership.ts`): the wiki says Whips are "appointed ... not elected, so there is no ballot to run in", but the code runs 24-hour elections for Majority and Minority Whip in both chambers (they have election roles, nomination collections and routes). The wiki also says Senate Class I elections reopen the Pro Tempore and Minority Leader seats while Class II and III reopen only the Majority Leader; in the code every Senate role reopens on any Senate general election if the controlling party changed, regardless of class.
- `LEADERSHIP_ELECTION_DURATION_MS` is defined twice (a private copy in `leadershipElections.ts` and an exported one in `leadership/openElection.ts`); both are 24 hours.
- `congressLeaders.party` is stamped at election and goes stale after a party switch; code that needs the live party must read the character or seat.
- Leadership effects on agenda, committee assignments, or persuasion, to be defined later.
- Cabinet resign (member voluntarily leaving), not yet implemented.

Last checked: 2026-10-29, version 1.18.0
