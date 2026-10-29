# Coalitions

Player guide: [Coalitions](https://www.ahousedividedgame.com/wiki/coalitions)

Coalitions are country-scoped alliances between national parties. They are
still lighter than parties, but they are no longer just a nameplate plus invite
list.

## Core Purpose

Coalitions currently serve two different roles:

- **organizational alignment** between member parties
- **leadership-bloc aggregation** in chamber-leadership contexts

They are not a full party merge, and they do not replace party identity.
Why anyone joins: pooled seats make the bloc the majority bloc, which decides
who is shut out of the minority-side leadership posts, and the shared priorities
give the member chairs a common agenda to vote on.

## Rules

| Constant or rule | Value | Source |
| --- | --- | --- |
| Name length | 3 to 60 characters | `src/app/api/country/[code]/coalitions/route.ts` |
| Abbreviation length | 2 to 10 characters | `src/app/api/country/[code]/coalitions/route.ts` |
| `MAX_ACTIVE_COALITION_PRIORITIES` | 3 | `src/lib/coalitions/priorities.ts` |
| Priority title length | 1 to 80 characters | `src/app/api/country/[code]/coalitions/[id]/priorities/route.ts` |
| Priority description length | 1 to 280 characters | `src/app/api/country/[code]/coalitions/[id]/priorities/route.ts` |
| Priority pass or reject threshold | `floor(memberParties / 2) + 1` votes | `getPriorityVoteTally` in `src/lib/coalitions/priorities.ts` |
| `DISBAND_VOTE_DURATION_HOURS` | 24 (expires 24 turns after it starts) | `src/app/api/country/[code]/coalitions/[id]/disband/start/route.ts` |
| Disband threshold | `floor(totalMembers / 2) + 1` yes votes | `resolveExpiredDisbandVotes` in `src/lib/turn/coalitionDisbandCheck.ts` |
| Cohesion `Strong` | score 70 or more | `calculateCoalitionCohesion` in `src/lib/coalitions/priorities.ts` |
| Cohesion `Mixed` | score 45 to 69 | same |
| Cohesion `Fractured` | score under 45 | same |

Cohesion score, per active priority: `(support - oppose + memberParties) / (2 x memberParties)`, averaged over the active priorities and scaled to 0 to 100 and rounded. A coalition with no active priorities, or no member parties, is `Unaligned` with score 0. Abstentions count for neither side, so they pull the score toward 50 per priority.

Worked example: a coalition of 3 member parties has one active priority with 2 support, 1 oppose. Score = `(2 - 1 + 3) / 6` = 0.667, so 67, which is `Mixed`. Passing needs `floor(3 / 2) + 1` = 2 votes.

## Gameplay Effects

### Chamber Leadership

Coalitions aggregate member-party seats into a bloc. `computeBlocsForCountry`
(`src/lib/congress/blocs.ts`) builds one bloc per coalition, with the summed seats of
its members that hold seats in that chamber, and one bloc per party that is in no coalition.
Blocs are sorted by seats, highest first; the largest is the majority bloc and the
second-largest is the minority bloc. On a tie, the sort is stable, so the order
the blocs were built in decides: coalition blocs come before unaffiliated parties.

- the largest bloc is the majority bloc
- the second-largest bloc is the minority bloc
- the dominant party of the majority bloc (its largest member by seats) drives President Pro Tempore and Majority Leader/Whip eligibility
- Minority Leader/Whip exclude every party in the majority bloc
- Speaker, and the DE Bundestagspräsident, are open to any seated chamber member and do not key off blocs

Callers: `senateComposition.ts`, `bundestagComposition.ts`, `npcComposition.ts`
and `ngChamberLeadership/composition.ts` under `src/lib/congress/`. The bloc math is not used by countries that form governments through their own parliamentary systems.

### Everything Else

Outside those leadership-bloc contexts, coalitions remain a lighter system.

They do **not** currently provide:

- treasury bonuses
- whip bonuses
- election bonuses
- general legislative vote overrides

## Formation and Membership

### Formation

- national party chairs (or the vice-chair when the chair seat is vacant) can create coalitions
- a coalition is country-scoped
- the creator's party becomes the first member
- the creator becomes coalition chair

### Membership

Member parties can join through:

- chair-issued invites
- join requests

Both are limited to national party chairs (or acting vice-chair). A party can be in
only one coalition. Banned parties cannot join or be invited, and in a one-party
state only the ruling party can invite (`canInviteToCoalition`,
`src/lib/turn/onePartyConstraints.ts`).

Leaving, kicking, succession, and disband votes all remain active parts of the
system. Only the coalition chair can invite, kick, propose priorities, archive
priorities and start a disband vote, and the chair cannot kick their own party.

## Priorities

Coalitions now have a real `Priorities` system rather than a placeholder tab.

### Priority Limits

- up to `3` active priorities at once

### Priority Types

Current supported priority types:

- `policy theme` (ten themes, such as Economic Growth, Tax Relief and Climate: `COALITION_POLICY_THEME_OPTIONS`)
- `bill priority` (must target a bill that is currently live)
- `leadership goal` (six goals, such as Speaker, Government Formation and No-Confidence Strategy: `COALITION_LEADERSHIP_GOAL_OPTIONS`; carries an expiry)

All in `src/lib/coalitions/priorities.ts`.

### Visibility

Each priority is either:

- `public`
- `internal`

Public priorities are visible to everyone on the coalition page. Internal
priorities are intended for coalition members and admin-facing oversight.

### Governance

Coalition priorities use a party-vote model:

1. the chair creates a proposal, which starts with the chair party's `support` vote
2. member-party chairs vote `support`, `oppose` or `abstain`
3. the proposal becomes `active` at `floor(members / 2) + 1` support votes, or is rejected at the same number of oppose votes

This makes priorities a real coalition-governance layer instead of just a chair
note field. Bill priorities expire when the bill is no longer live; leadership goals expire on their game-clock turn (`expiresOnTurn`), with a date fallback for old records (`normalizeCoalitionPriorities`).

### Cohesion

Coalitions also expose a `cohesion` summary (thresholds in Rules above):

- `Strong`
- `Mixed`
- `Fractured`
- `Unaligned` when there are no active priorities

Right now cohesion is primarily a **health / alignment signal**, not a major
mechanical buff. It tells leadership whether coalition members are actually
lining up behind the same agenda.

## Disband Votes

Disband votes remain a live coalition mechanic:

- started by the coalition chair; refused if a vote is already active
- 24-hour voting window (24 turns on the game clock)
- one vote per member party
- resolved by turn processing once expired
- passes only with `floor(totalMembers / 2) + 1` yes votes out of all members, so members who do not vote count against disbanding
- a failed vote just clears the vote; a passed vote clears `coalitionId` on member parties and deletes the coalition

## Lifecycle and Cleanup

Coalitions are meant to clean themselves up correctly when the world changes.

Current lifecycle behavior:

- leaving or kicking updates membership immediately
- chair succession goes to the member party that joined earliest (`joinedAt`) if the chair party exits
- the last member leaving deletes the coalition
- `reconcileAllCoalitionChairs` (`src/lib/coalitions/syncCoalitionChair.ts`) re-syncs each coalition's chair character to its lead party's current chair, so a changed or vacated party chair does not leave a stale coalition chair
- game reset clears coalition records and clears stale `coalitionId` links from
  surviving default parties

## Timing

- `coalitionDisbandVotes` phase (`src/simulation/phases/turnPhaseRegistry.ts`) runs `resolveExpiredDisbandVotes`. In the phase list (`src/simulation/phases/turnPhaseNames.ts`) it comes after `emptyPartyCleanup` and before `nppRelationshipMaintenance`, so a party deleted that turn is already gone when the vote resolves.
- Chair reconciliation runs inside the `nationalCommitteeElections` phase, after committee results are applied.
- Bloc math is computed on demand whenever a chamber composition is built, not stored; it always reflects current seats and current membership.
- Joins, leaves, kicks, invites and priority votes are immediate API actions, not turn work.

## Edge cases and limits

- A party in the coalition but holding no seats in that chamber adds nothing to the bloc.
- Equal-seat blocs: the stable sort decides, coalitions first.
- Fewer than two blocs: `minorityBloc` is `null`; no bloc at all gives both `null`.
- Cohesion with zero member parties returns `Unaligned` rather than dividing by zero.
- Disband threshold counts all members, not votes cast, so a 3-party coalition needs 2 yes votes even if only 2 parties vote.
- A coalition cannot hold more than 3 active priorities; proposing a fourth is refused until one is archived or expires.
- Pre-fix data where a party's `coalitionId` pointed elsewhere is left alone: disband and leave only clear the link when it points at this coalition.
- Outside the chamber-leadership countries (US, DE, CN, NG), joining a coalition has no mechanical effect on government formation.

## UI

Current coalition page tabs:

- `Overview`
- `Parties`
- `Priorities`
- `Chair's Office` (chair only)
- `Admin` (admin only)

`Priorities` is no longer a placeholder; it is part of the intended system.

## Connections

**Driven by:**

- [Parties](./parties.md): coalition membership is a relationship between national parties; party chair changes flow in through `syncCoalitionChairsForParty`.
- Party seat counts in each chamber: the input to `computeBlocsForCountry`.
- [One-party states](./china.md): `canInviteToCoalition` restricts invites to the ruling party.

**Affects:**

- [Chamber leadership by country](./chamber-leadership-by-country.md): majority and minority bloc decide who may stand for the bloc-keyed leadership posts, via `src/lib/congress/blocs.ts`.
- [Congress leadership](./congress-leadership.md): Pro Tempore and Majority and Minority Leader/Whip eligibility.

## Related Docs

- [parties.md](./parties.md)
- [npp-system.md](./npp-system.md)

Last checked: 2026-10-29, version 1.18.0
