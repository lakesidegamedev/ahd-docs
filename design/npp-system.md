# Non-Player Politicians (NPPs)

NPPs are AI-controlled politicians who keep the world populated and politically
active even when there are not enough players to fill every office. They can
hold office, enter elections, vote on legislation, join caucuses, receive party
pressure, and endorse candidates.

## Overview

- **Purpose**: Fill seats, create contested races, and act as strategic targets
  for player and party influence
- **Display**: NPPs appear across election pages, legislature pages, party
  surfaces, and state/region pages with an `NPP` badge
- **Profile page**: `/politicians/npp/[id]`
- **Current offices covered**: legislative, executive, and subnational offices
  across active countries

## Core Data Model

### Core Fields (`npps` collection)

| Field                | Type                    | Description                                                 |
| -------------------- | ----------------------- | ----------------------------------------------------------- |
| `name`               | `string`                | Procedurally generated politician name                      |
| `countryId`          | `CountryId`             | Country ownership; always required for cross-country safety |
| `homeState`          | `string`                | Home state / region / prefecture key                        |
| `party`              | `string`                | Party slug or sequential-id-backed party reference          |
| `avatarUrl`          | `string?`               | Optional portrait URL                                       |
| `politicalInfluence` | `number`                | 0-100, with a floor at 10                                   |
| `favorability`       | `number`                | 0-100                                                       |
| `policies`           | `PolicyPositions`       | Economic / social positions and issue-domain stances        |
| `currentOffice`      | `OfficeType \| null`    | Current office held, if any                                 |
| `personality`        | `NPPPersonality`        | `loyalty`, `ambition`, `stubbornness`                       |
| `electionCooldowns`  | `Record<string,string>` | Election re-entry lockouts after dropout                    |
| `retiredAt`          | `Date \| null`          | Retirement marker                                           |

### Personality Traits

| Trait          | Range   | Current role in gameplay                                                                     |
| -------------- | ------- | -------------------------------------------------------------------------------------------- |
| `loyalty`      | `0-100` | Party-discipline pressure, Slate acceptance, whip compliance, caucus stability               |
| `ambition`     | `0-100` | Reserved for future deeper challenger-behavior tuning; current entry is mostly deterministic |
| `stubbornness` | `0-100` | Resistance to influence, Slate assignments, whips, and cooperation asks                      |

## Election Behavior

Handled from `src/lib/turn/nppBehavior.ts` through the election-entry pass in
`src/lib/turn/npp/electionEntry.ts`.

### Entry Rules

Current NPP entry is **deterministic and priority-based**, not a pure random
ambition roll.

- NPP must not be retired
- NPP must not already be in another active race
- NPP must belong to the same `countryId` as the election
- NPP must match the race geography for subnational offices
- Presidential entry is blocked by default; the SP3 autonomy work lifts the bar
  only in autonomy-active, non-player-enabled countries (no player to contest
  the presidency there). See `src/lib/nppAutonomy/featureFlag.ts` (autonomy
  levels v0-v4) and `src/lib/nppAutonomy/appointNppPresident.ts`.

### Geographic Scope

- `house`, `senate`, `governor`, `stateSenate`: `homeState` must match the race
- `commons`, `regionalCouncil`, `shugiin`, `sangiin`: home geography must match
  the race geography
- Presidential auto-entry is blocked outside the SP3 autonomy-active case above

### Entry Order

NPP filing runs in a deliberate order:

1. **Defending incumbents** auto-file first for the seat they already hold
2. **Accepted Slate NPPs** file next, even if this creates a same-party primary
   against a defending incumbent
3. **Fallback fill** then adds at most one generic same-party NPP to an
   otherwise open primary

### Priority Order for Generic Fallback Fill

| Race Priority (highest first) |
| ----------------------------- |
| `stateSenate`                 |
| `regionalCouncil`             |
| `peoplesCongress`             |
| `republicSupremeSoviet`       |
| `landAssembly`                |
| `sangiin`                     |
| `house`                       |
| `milletMeclisi`               |
| `commons`                     |
| `special_commons`             |
| `senate`                      |
| `senato`                      |
| `shugiin`                     |
| `npcDelegate`                 |
| `supremeSovietDeputy`         |
| `nationalitiesDeputy`         |
| `unionCongressDeputy`         |
| `governor`                    |

Source: `RACE_PRIORITY` in `src/lib/turn/rules/nppElectionPriority.ts`. Snap variants share their regular race's priority.

### Cooldowns and Dropout

- NPPs who drop out receive an `electionCooldowns[electionId]` timestamp
- Generic fallback fill respects the cooldown
- Defending incumbents can still auto-defend their own seat even if they
  previously dropped from that same primary

## Bill Voting

Handled by:

- `src/lib/turn/npp/billVoting.ts`
- `src/lib/turn/npp/stateBillVoting.ts`
- `src/lib/turn/npp/crossPressure.ts`

### Scope

NPPs now autonomously vote on:

- **Federal bills** in `bills`
- **State / regional bills** in `stateBills`

The local pass currently covers:

- `stateSenate`
- `regionalCouncil`

### Cross-Pressure Model

Bill voting is now a **deterministic cross-pressure verdict**, not a simple
ideology roll. Each vote is the sum of four signed forces:

- `ideology`
- `whip`
- `district / home-region sentiment`
- `donors`

Verdict rule:

- total `> +15` -> `for`
- total `< -15` -> `against`
- otherwise -> `abstain`

### Federal vs Local Weighting

Federal and local bill voting share the same core structure, but local chambers
weight **home-region pressure more heavily** and **donor pressure more lightly**
than federal voting.

### Whips in Auto-Voting

Autonomous bill voting respects persisted party whips:

- `hard` whips contribute the stronger legacy force
- `soft` whips contribute weaker advisory pressure
- state-party whips outrank national-party whips for in-state NPPs
- caucus whips are scoped to caucus members only

### Immediate Bill Whips vs Autonomous Resolution

The Whip Room can also apply NPP bill whips immediately:

- `hard` whip -> hidden loyalty/stubbornness success roll; on success the vote
  is written immediately
- `soft` whip -> no immediate forced vote; instead it changes future
  autonomous cross-pressure

### Multi-Seat Weighting

If an NPP holds multiple seats in a chamber, their vote contributes their
`seatsHeld` weight to the tally.

## Leadership Voting

US congressional leadership elections are now treated as **player-only** for
NPP behavior purposes.

- `processSpeakerVoting()` is a deliberate no-op
- NPPs do **not** autonomously vote in Speaker, House leadership, or Senate
  leadership elections
- player whip routes and leadership UI still exist for player coordination, but
  NPP leadership fallback is not part of the intended current design

The helper logic in `src/lib/turn/npp/leadershipVoting.ts` remains as shared
infrastructure, but the live turn pass does not cast NPP congressional
leadership votes.

## Influence System

Players can still influence NPPs directly from the NPP profile page.

### Direct Interaction Actions

The live NPP profile panel now uses a deterministic `player -> NPP` interaction
surface instead of the older hidden-roll request table.

| Action                | Actions | Campaign Funds | Relationship Gate | Effect                                       |
| --------------------- | ------- | -------------- | ----------------- | -------------------------------------------- |
| `Request Endorsement` | `6`     | `$0`           | hidden `40-50`    | Creates or refreshes an arranged endorsement |
| `Private Meeting`     | `3`     | `$0`           | `-50`             | `+5 relationship`                            |
| `Boost Favorability`  | `5`     | `$10,000`      | none              | `+3 favorability`, `+2 relationship`         |
| `Reduce Favorability` | `5`     | `$10,000`      | none              | `-3 favorability`, `-2 relationship`         |
| `Boost Influence`     | `6`     | `$20,000`      | none              | `+2 influence`, `+2 relationship`            |
| `Reduce Influence`    | `6`     | `$20,000`      | none              | `-2 influence`, `-2 relationship`            |

These direct interactions:

- spend the player's normal `actions`
- spend `campaign funds` on all boost/reduce stat work
- are deterministic once resource gates and the hidden endorsement check are met
- write to the `capitalActionLogs` audit trail
- fully roll back on failure, including action/fund refunds on non-transaction fallbacks

## Party-Led NPP Management

See `party-influence.md` for the party-side surface. Current intended behavior:

- **National Party** gets broader NPP management and endorsement / withdrawal
  tools
- **State / regional party** gets local `Recruitment` and `Management`
  surfaces
- state / regional management currently focuses on:
  - `boost_favorability`
  - `boost_influence`
  - `boost_loyalty`
  - `reduce_stubbornness`
- local state / regional leadership gets a small hidden edge on
  `boost_loyalty` and `reduce_stubbornness`

## Party Whips

See `party-whips.md` for the full whip design. NPP-specific behavior to keep in
mind:

- NPP whips use a hidden loyalty/stubbornness success roll when a `hard` bill
  whip is immediately applied
- soft bill whips are advisory pressure only
- active non-compliance is surfaced through `Defiance` views rather than a
  permanent shame ledger
- if an NPP later votes back into line, that active defiance disappears

## Endorsements

Endorsements are now **manual-only** for NPPs. They do not organically endorse,
switch, or re-evaluate campaigns during the turn system anymore.

### Request Flow

Players request endorsements from the NPP profile panel, and the endorsement
only applies to the player's **currently active campaign** in that election.

- the ask is hidden behind a deterministic willingness check
- the UI shows only `Likely to Accept` or `Likely to Decline`
- the minimum successful relationship is `50`
- a perfect economic + social policy match lowers that to `40`
- each policy step away from the NPP increases the required relationship by `1`,
  capped at `50`

That means the live requirement is:

- `required relationship = 40 + min(10, |econ diff| + |social diff|)`

### Lifecycle

An arranged endorsement stays active only while that specific campaign remains
active and plausible.

- if the campaign resolves, the endorsement ends
- if the candidate withdraws or becomes inactive, the endorsement ends
- if the race stops being a plausible target, the endorsement ends

Because endorsements are election-scoped, the player must request them again in
future races.

### Mechanical Effect

Endorsements currently do two things:

- contribute to campaign-action generation where the campaign system uses them
- add a **small direct election-pressure effect** through candidate enrichment

## Caucus Interaction

NPPs can also participate in caucus systems:

- they can be recruited into caucuses when the Chair relationship is high enough
- they can be ejected over time if their relationship with the caucus chair
  decays too far
- caucus whips and caucus health surfaces treat them as real faction members

## Related Docs

- [bills-legislation.md](./bills-legislation.md)
- [campaign-manager.md](./campaign-manager.md)
- [caucuses.md](./caucuses.md)
- [parties.md](./parties.md)
- [party-influence.md](./party-influence.md)
- [party-whips.md](./party-whips.md)
- [party-slate.md](./party-slate.md)
