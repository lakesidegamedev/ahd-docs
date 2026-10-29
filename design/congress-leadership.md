# Congress Leadership

Design and status for US House and Senate leadership roles. The underlying
presiding-officer election framework is shared across countries; see
[Chamber Leadership by Country](./chamber-leadership-by-country.md) for the DE
Bundestagspraesident, NG National Assembly presiding officers, and CN CPPCC
Chairman / NPCSC Chairman variants.

Player guide: [Congress Leadership](https://www.ahousedividedgame.com/wiki/congress-leadership)

The Speaker's own election and motion to vacate have a deeper page: [Congress Speaker System](./congress-speaker.md).

## Rules and constants

| Rule | Value | Source |
| --- | --- | --- |
| Election window | 24 hours, closing on turn `currentTurn + 24` (`endsOnTurn`); one turn is one game hour | `LEADERSHIP_ELECTION_DURATION_MS` in `src/lib/congress/leadershipElections.ts` |
| Winner | Plurality of the seat-weighted vote; no absolute majority needed | `resolveLeadershipElection` in `src/lib/congress/leadershipElections.ts` |
| Tie-break | Earlier nomination (`createdAt`) wins | `resolveLeadershipElection` |
| No candidates | Role is vacated and the election closes | `resolveLeadershipElection` |
| Withdrawal cost | 3 political influence (NPI), must have at least 3 | `src/app/api/congress/house-leadership/route.ts`, `senate-leadership/route.ts`, `src/lib/congress/speaker/actions.ts` |
| One race at a time | A character can hold one open candidacy across Speaker, House and Senate leadership | `src/lib/congress/leadershipRaceGuard.ts` |
| NPPs | Do not run or vote in leadership elections (player-only) | `src/app/api/congress/speaker/route.ts`, `src/lib/congress/leadershipElections.ts` |
| Cabinet confirmation window | 24 hours | `VOTING_DURATION_HOURS` in `src/app/api/whitehouse/cabinet/nominations/route.ts` |

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

## Current implementation

### House: Speaker, Majority Leader, Minority Leader, Whips (24-hour plurality)

- **Status**: Implemented.
- **Flow**: These elections auto-open for 24 hours when a House general election resolves, but only for a role whose controlling party differs from the current holder's party, or whose seat is vacant (`hasControllingPartyChanged` in `src/lib/congress/leadershipElections.ts`). Majority roles and the Speaker are compared against the largest single party; minority roles against the minority bloc's dominant party. The sitting Speaker is auto-nominated if still seated. The sitting Majority Leader is auto-nominated when still seated and still in the largest party. The sitting Minority Leader is auto-nominated when still seated and still outside the majority bloc.
- **Eligibility**: see the table above. Leadership elections are player-only.
- **API**: `GET/POST /api/congress/speaker` (Speaker), `GET/POST /api/congress/house-leadership` (body `role: "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip"`, actions: `start_election` | `declare` | `withdraw` | `vote`).
- **Data**: `congressLeaders`, `speakerElections`, `speakerNominations`; `houseLeadershipElections`, `houseLeadershipNominations`. Helper: `getHouseComposition()` in `src/lib/congress/houseComposition.ts`.
- **Whips**: Majority Whip and Minority Whip run in the same 24-hour cycle with the same reopen rule and the same party gates as the matching Leader.

### Senate: President Pro Tempore, Majority Leader, Minority Leader, Whips (24-hour plurality)

- **Status**: Implemented.
- **Trigger cadence**: When a Senate general election resolves, each role (President Pro Tempore, Majority Leader, Minority Leader, both Whips) reopens only if the party that should hold it under the current seat counts differs from the current holder, or the role is vacant (`hasControllingPartyChanged`). This rule is the same for every Senate class, so a Class II or III cycle with an unchanged majority reopens nothing. The sitting Pro Tempore is auto-nominated if still seated; the sitting Majority or Minority Leader is auto-nominated when still seated and still eligible for that side of the chamber.
- **API**: `GET/POST /api/congress/senate-leadership` (body `role: "pro_tempore" | "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip"`, actions: `start_election` | `declare` | `withdraw` | `vote`).
- **Data**: `congressLeaders`, `senateLeadershipElections`, `senateLeadershipNominations`. Helper: `getSenateComposition()` in `src/lib/congress/senateComposition.ts`.

## Timing

Order inside the turn processor (`src/simulation/phases/turnPhaseRegistry.ts`):

1. A House or Senate general election resolves in the `electionResolution` phase. When it finishes seating a chamber, `triggerLeadershipElectionsAfterChamberVote` (called from `src/lib/turn/election/generalResolution.ts` and `generalResolutionHelpers.ts`) opens the leadership races whose controlling party changed.
2. `leadershipVacate` runs `vacateLeadershipForLostSeats` every turn after resolution: any leader who no longer holds a seat in their chamber is vacated.
3. `leadershipPartyEligibility` runs `reconcileAllLeadershipPartyEligibility`: a Pro Tempore, Majority Leader or Majority Whip who has left the largest party is vacated and a fresh race opens for the seat. A Speaker is never vacated by a party switch, since the Speaker policy is `any-seated`.
4. `leadershipElections` runs `resolveExpiredLeadershipElections` every turn: every race whose window has closed is resolved and the winner installed.

Races also open outside a general election when a seat is vacated, either by the steps above or, for the Speaker, by a successful motion to vacate. Admins can start, reset or force-end a race.

## Edge cases and limits

- **Nobody declares.** The role is vacated and the race closes. No poller reopens it; the next controlling-party change, party-eligibility vacancy or admin start opens a new one.
- **Ties.** The nomination created first wins. Ties are rare because votes are tallied by seat weight, not raw count.
- **Seat lost mid-race.** Votes from members who have since lost their seat are dropped from the tally (`computeCongressLeadershipTally`).
- **Majority changes.** Nominations from a party that is no longer eligible are failed (`clearIneligibleHouseLeadershipNominations`) when a chamber result changes the alignment.
- **Party switches.** Majority-gated holders are vacated on the spot and the seat goes to a fresh 24-hour race. Losing the majority without switching reopens the seat at the next chamber-changing vote instead.
- **One seat at a time.** Declaring in a second race while holding an open candidacy is rejected with 409.
- **Changing votes.** A member can switch candidates while the window is open; only the latest vote counts.
- **Rank bonuses.** Only a holder's single highest leadership bonus applies (see Affects).

## Worked example

The House has 435 seats. Party A holds 230, party B 150, party C 55. The previous Majority Leader is from party B and the previous Speaker is from party B.

A House general election resolves. The largest single party is now A, so the Majority Leader and Majority Whip roles have a controlling-party change (B holds them, A should) and both open for 24 hours. Only A members may run or vote. Minority Leader and Minority Whip reopen only if their holder is not from the minority bloc's dominant party; B and C members, being outside the majority bloc, may run for them. The Speaker race also opens because the controlling party for the role changed from B to A; any of the 435 members may run, not just A, but the sitting Speaker (party B) is auto-nominated only if still seated.

Votes close at the 24th turn. If A's candidate X gets 140 seat-weighted votes and A's candidate Y gets 90, X wins; no majority of A is required. If only one A member declared, they win by default; if none declared, the Majority Leader seat is left Vacant.

## Data model

- **congressLeaders**: One document per role. Fields: `role`, `characterId`, `characterName`, `party`, `nominatedBy`, `electedAt`, `createdAt`, `updatedAt`.
- **House**: `speakerElections` (\_id: "current"), `speakerNominations`; `houseLeadershipElections` (\_id: majority_leader | minority_leader | majority_whip | minority_whip), `houseLeadershipNominations` (role field).
- **Senate**: `senateLeadershipElections` (\_id: pro_tempore | majority_leader | minority_leader | majority_whip | minority_whip), `senateLeadershipNominations` (role field).

## UI

- **Congress → Composition**: Member list shows **leader badges** (Speaker, Maj. Leader, Min. Leader, Pro Tempore, etc.) next to the name for the current holder.
- **Congress → Leadership**: House and Senate each show Majority/Minority sections with bloc-aware seat counts; each elected role (Speaker, Pro Tempore, Majority Leader, Minority Leader, Whips) has election UI (start 24h election, declare, vote, candidacy cards with plurality wording). Portraits and name (D-TX) for each leader.

## Cabinet Nominations (Senate Role)

Cabinet nominations are initiated by the President but require Senate confirmation before a character is installed in a cabinet position.

- **Trigger**: President posts a nomination via `/api/whitehouse/cabinet/nominations`
- **Senate action**: Active nominations appear on both the Cabinet page and the Congress Senate tab; senators vote For / Against / Abstain
- **Window**: 24 hours from nomination
- **Threshold**: More For votes than Against votes (`didPass` in `src/lib/billLifecycleHelpers.ts`: `votesFor > votesAgainst`). Abstentions are ignored, and a tie fails.
- **Resolution**: On window expiry, `processCabinetNominationLifecycle` (`src/lib/cabinetNominationLifecycle.ts`, phase `cabinetNominations`) tallies and confirms or rejects
- **Exceptions**: Vice President nominations need a majority in both the House and the Senate. Seats configured as direct appointments (for example the US Chief of Staff) skip the vote and are seated when the zero-length window closes.
- **NPP senators**: Unlike leadership races, NPP senators do vote on cabinet nominations, by party-line heuristic (`nppCabinetVote`).
- **Rejection**: Position remains vacant; President may re-nominate
- **Confirmed**: Nominee added to `cabinetMembers` collection; displayed on `/whitehouse/cabinet`

See [Cabinet](./cabinet.md) for full position list and lifecycle details.

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

## Future work

1. Leadership effects on agenda, committee assignments, or persuasion, to be defined later.
2. Cabinet resign (member voluntarily leaving), not yet implemented.

Last checked: 2026-10-29, version 1.18.0
