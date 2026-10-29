# Coalitions

Player guide: [Coalitions](https://www.ahousedividedgame.com/wiki/coalitions)

## Summary

Coalitions are country-scoped alliances between national parties. They are still lighter than parties, but they are no longer just a nameplate plus invite list.

Coalitions currently serve two different roles:

- **organizational alignment** between member parties
- **leadership-bloc aggregation** in chamber-leadership contexts

They are not a full party merge, and they do not replace party identity. Why anyone joins: pooled seats make the bloc the majority bloc, which decides who is shut out of the minority-side leadership posts, and the shared priorities give the member chairs a common agenda to vote on.

## Rules

| Constant or rule | Value | Source |
| --- | --- | --- |
| Creation cost | 25 actions, refunded if the insert fails | `src/app/api/country/[code]/coalitions/route.ts` |
| Name length | 3 to 60 characters | `src/app/api/country/[code]/coalitions/route.ts` |
| Abbreviation length | 2 to 10 characters | `src/app/api/country/[code]/coalitions/route.ts` |
| `MAX_ACTIVE_COALITION_PRIORITIES` | 3 | `src/lib/coalitions/priorities.ts` |
| Priority title length | 1 to 80 characters | `src/app/api/country/[code]/coalitions/[id]/priorities/route.ts` |
| Priority description length | 1 to 280 characters | `src/app/api/country/[code]/coalitions/[id]/priorities/route.ts` |
| Leadership goal target name length | 0 to 80 characters (optional) | same |
| Priority pass or reject threshold | `floor(memberParties / 2) + 1` votes | `getPriorityVoteTally` in `src/lib/coalitions/priorities.ts` |
| `DISBAND_VOTE_DURATION_HOURS` | 24 (expires 24 turns after it starts) | `src/app/api/country/[code]/coalitions/[id]/disband/start/route.ts` |
| Disband threshold | `floor(totalMembers / 2) + 1` yes votes | `resolveExpiredDisbandVotes` in `src/lib/turn/coalitionDisbandCheck.ts` |
| Cohesion `Strong` | score 70 or more | `calculateCoalitionCohesion` in `src/lib/coalitions/priorities.ts` |
| Cohesion `Mixed` | score 45 to 69 | same |
| Cohesion `Fractured` | score under 45 | same |

Cohesion score, per active priority: `(support - oppose + memberParties) / (2 x memberParties)`, averaged over the active priorities and scaled to 0 to 100 and rounded. A coalition with no active priorities, or no member parties, is `Unaligned` with score 0. Abstentions count for neither side, so they pull the score toward 50 per priority.

### Formation and membership

- national party chairs (or the vice-chair when the chair seat is vacant) can create coalitions
- a coalition is country-scoped
- the creator's party becomes the first member
- the creator becomes coalition chair

Member parties can join through chair-issued invites or join requests. Both are limited to national party chairs (or acting vice-chair). A party can be in only one coalition. Banned parties cannot join, be invited or create, and in a one-party state only the ruling party can invite or create (`canInviteToCoalition`, `src/lib/turn/onePartyConstraints.ts`). The one-party check reads the runtime government type, so a country that has converted away from one-party rule lifts the restriction at once.

Leaving, kicking, succession, chair transfer and disband votes all remain active parts of the system. Only the coalition chair can invite, kick, propose priorities, archive priorities and start a disband vote, and the chair cannot kick their own party.

### Chamber leadership

Coalitions aggregate member-party seats into a bloc. `computeBlocsForCountry` (`src/lib/congress/blocs.ts`) builds one bloc per coalition, with the summed seats of its members that hold seats in that chamber, and one bloc per party that is in no coalition. Blocs are sorted by seats, highest first; the largest is the majority bloc and the second-largest is the minority bloc. On a tie, the sort is stable, so the order the blocs were built in decides: coalition blocs come before unaffiliated parties.

- the largest bloc is the majority bloc
- the second-largest bloc is the minority bloc
- the dominant party of the majority bloc (its largest member by seats) drives President Pro Tempore and Majority Leader/Whip eligibility
- Minority Leader/Whip exclude every party in the majority bloc
- Speaker, and the DE Bundestagspräsident, are open to any seated chamber member and do not key off blocs

Callers, all under `src/lib/congress/`: `senateComposition.ts`, `houseComposition.ts`, `bundestagComposition.ts`, `npcComposition.ts` and `ngChamberLeadership/composition.ts`. The bloc math is not used by countries that form governments through their own parliamentary systems.

### Priorities

Coalitions have a `Priorities` system with up to `3` active priorities at once. Types (all in `src/lib/coalitions/priorities.ts`):

- `policy_theme` (ten themes, such as Economic Growth, Tax Relief and Climate: `COALITION_POLICY_THEME_OPTIONS`)
- `bill` (must target a bill that is currently live; live statuses are `active`, `active_other`, `active_both`, `veto_override`, `override_shugiin`, `filibustered`, `cabinet_review`)
- `leadership_goal` (six goals: Speaker, Lower Chamber Leadership, Upper Chamber Leadership, Government Formation, Cabinet Formation and No-Confidence Strategy, `COALITION_LEADERSHIP_GOAL_OPTIONS`; carries a required future expiry)

Each priority is either `public` (visible to everyone on the coalition page) or `internal` (intended for coalition members and admin-facing oversight), and has a `support` or `oppose` stance.

Governance uses a party-vote model:

1. the chair creates a proposal, which starts with the chair party's `support` vote
2. member-party chairs vote `support`, `oppose` or `abstain`
3. the proposal becomes `active` at `floor(members / 2) + 1` support votes, or is rejected at the same number of oppose votes

Bill priorities expire when the bill is no longer live; leadership goals expire on their game-clock turn (`expiresOnTurn`), with a date fallback for old records (`normalizeCoalitionPriorities`). The API accepts an absolute expiry time for leadership goals and converts it to a turn by dividing the time left by `MS_PER_TURN`.

Cohesion is primarily a **health / alignment signal**, not a major mechanical buff. It tells leadership whether coalition members are actually lining up behind the same agenda.

### Disband votes

- started by the coalition chair; refused if a vote is already active
- 24-hour voting window (24 turns on the game clock)
- one vote per member party
- resolved by turn processing once expired
- passes only with `floor(totalMembers / 2) + 1` yes votes out of all members, so members who do not vote count against disbanding
- a failed vote just clears the vote; a passed vote clears `coalitionId` on member parties, deletes the coalition and notifies every member chair

### What coalitions do not provide

They do **not** currently provide treasury bonuses, whip bonuses, election bonuses or general legislative vote overrides.

### Lifecycle and cleanup

- leaving or kicking updates membership immediately
- chair succession goes to the member party that joined earliest (`joinedAt`) if the chair party exits
- the last member leaving deletes the coalition
- `reconcileAllCoalitionChairs` (`src/lib/coalitions/syncCoalitionChair.ts`) re-syncs each coalition's chair character to its lead party's current chair, so a changed or vacated party chair does not leave a stale coalition chair
- game reset clears coalition records and clears stale `coalitionId` links from surviving default parties
- when a party is absorbed by a merge, `src/lib/coalitions/absorbParty.ts` swaps or removes it in the member list, reassigns the chair if it chaired, and drops dangling invites and requests

### UI

Current coalition page tabs: `Overview`, `Parties`, `Priorities`, `Chair's Office` (chair only), `Admin` (admin only).

## Data

| Collection | Fields | Player-visible |
| --- | --- | --- |
| `coalitions` | `sequentialId`, `countryId`, `name`, `abbreviation`, `color`, `logoUrl`, `discordInviteUrl`, `chairPartyId`, `chairCharacterId` (null when the chair seat is vacant), `members[]` (`partyId`, `partySequentialId`, `joinedAt`), `pendingInvites[]`, `joinRequests[]`, `disbandVote` (`initiatedBy`, `initiatedAt`, `expiresAt`, `expiresOnTurn`, `votes[]`), `priorities[]`, timestamps | yes, on the coalition page; `internal` priorities are limited to members and admins |
| `priorities[]` entries | `id`, `type`, `visibility`, `status` (`proposed`, `active`, `archived`, `rejected`, `expired`), `stance`, `title`, `description`, `policyThemeKey`, `billId`, `billTitle`, `leadershipGoalKey`, `targetName`, `expiresAt`, `expiresOnTurn`, `votes[]`, `activatedAt`, `resolvedAt`, `resolvedBy` | by visibility |
| `politicalParties` | `coalitionId` (written on join, leave, kick, disband), `chairId` (read for chair sync), `regimeStatus` (read for the one-party gates) | yes |
| `characters` | `actions` (25 deducted on creation) | yes, to the owner |
| `notifications` | `coalition_disbanded` rows to every member chair | yes |

The cohesion summary and the blocs are derived on read, not stored. Types are in `src/lib/db/types/coalition.ts`.

## Configuration

Coalitions have no `gameConfig` field, era preset or scenario flag. Behaviour comes from constants in code:

| Setting | Default | Where |
| --- | --- | --- |
| Active priority cap, thresholds, cohesion bands | the Rules table | `src/lib/coalitions/priorities.ts` |
| Disband window | 24 turns | `src/app/api/country/[code]/coalitions/[id]/disband/start/route.ts` |
| One-party restriction | on while `governmentType` is `onePartyState` at runtime | `src/lib/turn/onePartyConstraints.ts` |
| Countries that use bloc math | those whose chamber composition builders call `computeBlocsForCountry` (US House and Senate, DE, CN, NG) | `src/lib/congress/` |

## Timing

- `coalitionDisbandVotes` phase (`src/simulation/phases/turnPhaseRegistry.ts`) runs `resolveExpiredDisbandVotes`. In the phase list (`src/simulation/phases/turnPhaseNames.ts`) it comes after `emptyPartyCleanup` and before `nppRelationshipMaintenance`, so a party deleted that turn is already gone when the vote resolves.
- Chair reconciliation runs inside the `nationalCommitteeElections` phase, after committee results are applied.
- Bloc math is computed on demand whenever a chamber composition is built, not stored; it always reflects current seats and current membership.
- Joins, leaves, kicks, invites and priority votes are immediate API actions, not turn work.

```
nationalCommitteeElections (results applied -> reconcileAllCoalitionChairs)
  -> emptyPartyCleanup -> coalitionDisbandVotes -> nppRelationshipMaintenance
on demand: chamber composition -> computeBlocsForCountry
```

## Worked trace

Bloc math. A chamber has five seated parties: P1 40 seats, P2 25, P3 10, Q 60, R 30. P1, P2 and P3 are in coalition A.

1. Coalition bloc A = 40 + 25 + 10 = 75 seats, dominant party P1 (40).
2. Unaffiliated blocs: Q 60, R 30.
3. Sorted: A 75, Q 60, R 30. Majority bloc A, minority bloc Q.
4. P1 drives Pro Tempore and Majority Leader/Whip eligibility. Minority Leader/Whip exclude P1, P2 and P3, so the minority posts go to Q or R.

Priority and cohesion. Coalition A has 3 member parties, so the threshold is `floor(3 / 2) + 1` = 2.

1. The chair proposes "Tax Relief" as a policy theme. It starts with the chair party's support: 1 support, status `proposed`.
2. P2's chair votes support: 2 support, which meets 2. Status becomes `active` (active count was below 3).
3. P3's chair votes oppose: tally is 2 support, 1 oppose, 0 abstain.
4. Cohesion = `(2 - 1 + 3) / (2 x 3)` = 4 / 6 = 0.667, scaled to 67. 67 is in 45 to 69, so `Mixed`.

Disband. The chair starts a vote at turn 1,000, so `expiresOnTurn` = 1,024. P1 and P2 vote yes, P3 does not vote. At the first processing of `coalitionDisbandVotes` at or after turn 1,024, yes votes = 2 against a threshold of `floor(3 / 2) + 1` = 2, so the coalition is deleted and `coalitionId` is cleared on P1, P2 and P3. Had only P1 voted yes, 1 is below 2 and the vote would just clear.

## Edge cases and limits

- A party in the coalition but holding no seats in that chamber adds nothing to the bloc.
- Equal-seat blocs: the stable sort decides, coalitions first.
- Fewer than two blocs: `minorityBloc` is `null`; no bloc at all gives both `null`.
- Cohesion with zero member parties returns `Unaligned` rather than dividing by zero.
- Disband threshold counts all members, not votes cast, so a 3-party coalition needs 2 yes votes even if only 2 parties vote.
- The 3-priority cap is checked when a priority would become active, not when it is proposed. A fourth proposal is accepted as `proposed`, but proposing or voting it to the activation threshold is refused until one active priority is archived or expires.
- A single-member coalition activates a proposal immediately, since the chair's own vote meets `floor(1 / 2) + 1` = 1.
- Votes can only be cast on `proposed` or `active` priorities.
- Pre-fix data where a party's `coalitionId` pointed elsewhere is left alone: disband and leave only clear the link when it points at this coalition.
- A coalition that leads the government makes all its member parties count as governing parties and their seats count towards a government's supporting seats (`src/lib/government/governingPartyIds.ts`, `src/lib/turn/parliamentaryGovernment.ts`). This applies in any country with those formation records, not only the bloc countries.
- Bloc math applies only in the chamber-leadership countries that call `computeBlocsForCountry` (US, DE, CN, NG).

## Invariants

- A party is in at most one coalition: checked in the create and join routes against `party.coalitionId`; no database-level constraint was found.
- A coalition has at least one member: enforced by deleting the coalition when the last member leaves; not otherwise checked.
- Active priorities never exceed 3: enforced at propose and vote time in the two priority routes; not re-checked on read.
- `chairCharacterId` matches the lead party's `chairId`: restored every turn by `reconcileAllCoalitionChairs`, tested in `src/lib/coalitions/syncCoalitionChair.test.ts`.
- Disband resolution never orphans a party's link to another coalition: conditional `updateMany` on `coalitionId`, tested in `src/lib/turn/coalitionDisbandCheck.test.ts`.

## Failure and recovery

- **Stale coalition chair** after a party chair changes or is removed: the displayed coalition chair is the old character. The per-turn reconcile corrects it; the per-mutation sync helper is called by most chair-changing paths.
- **A coalition that should have been disbanded is still listed**: the disband phase did not run or errored that turn. The query matches every vote whose deadline has passed, so the next successful turn resolves it.
- **Dangling `coalitionId` on a party** after old data or a deleted coalition: the party cannot join another coalition. An admin repair or a heal clears the link; game reset clears it for surviving default parties.
- **Failed creation after the action debit**: the route refunds the 25 actions when the insert fails.

## Connections

**Driven by:**

- [Parties](./parties.md): coalition membership is a relationship between national parties; party chair changes flow in through `syncCoalitionChairsForParty`.
- Party seat counts in each chamber: the input to `computeBlocsForCountry`.
- [One-party states](./china.md): `canInviteToCoalition` restricts invites and creation to the ruling party.

**Affects:**

- [Chamber leadership by country](./chamber-leadership-by-country.md): majority and minority bloc decide who may stand for the bloc-keyed leadership posts, via `src/lib/congress/blocs.ts`.
- [Congress leadership](./congress-leadership.md): Pro Tempore and Majority and Minority Leader/Whip eligibility.
- Government records: a government formation with a `coalitionId`, or a coalition led by the governing party, widens the governing-party set in `src/lib/government/governingPartyIds.ts`.

Related docs: [parties.md](./parties.md), [npp-system.md](./npp-system.md).

## Tests

- `src/lib/coalitions/priorities.test.ts`: activation and rejection thresholds, expiry, cohesion.
- `src/lib/coalitions/syncCoalitionChair.test.ts`: chair sync, vacancy handling.
- `src/lib/coalitions/absorbParty.test.ts`: merge handling.
- `src/lib/turn/coalitionDisbandCheck.test.ts`: disband thresholds, ties, abstentions, notifications.
- `src/app/api/country/[code]/coalitions/route.test.ts` and `src/app/api/country/[code]/coalitions/[id]/priorities/route.test.ts`: creation and priority routes.
- `src/lib/congress/chamberComposition.test.ts`: bloc composition.
- Gaps: the 3-priority cap behaviour on a fourth proposal, tie-break order between a coalition and a party bloc, and the one-party creation restriction have no dedicated test that was found.

## Known issues and history

- The header comment in `src/lib/congress/blocs.ts` still says bloc math is scoped to the US and DE only; the code is also used for CN and NG.
- The player wiki and the old text of this page imply the cap blocks proposals; the code blocks only activation (see Edge cases).
- A coalition's chair was once left stale when a party chair changed; the per-turn reconcile and `syncCoalitionChairsForParty` were added for this (chair-sync fix, 2026-05-23, from the code comments).

Last checked: 2026-10-29, version 1.18.0
