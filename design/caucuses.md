# Caucuses

## Overview

Caucuses are opt-in sub-blocs inside a national party. They give players a way
to organize around a shared line, pool caucus funds, run caucus-specific whips,
and build a more disciplined internal faction without creating a separate party.

They are a **national-party-only** feature. State and regional party chapters do
not own caucuses.

Player guide: [Caucuses](https://www.ahousedividedgame.com/wiki/caucuses)

## Core Structure

Each caucus has:

- a `name`
- a `description`
- an optional `motto`
- a `color`
- a `Chair`
- a `Vice Chair`
- a caucus `treasury`
- a caucus `Tax` rate from `0%` to `5%` (`taxRate`, validated `min(0).max(5)` in the caucus routes under `src/app/api/country/[code]/parties/[id]/caucuses/`)
- a roster of player and NPP members
- a set of caucus policy positions

The current player-facing surface lives inside the national party page under the
`Caucuses` tab.

## Rules and constants

| Rule | Value | Source |
| --- | --- | --- |
| Min chair-NPP relationship to recruit | 60 (`CAUCUS_NPP_RECRUIT_MIN_RELATIONSHIP`) | `src/lib/constants/partyOrg.ts` |
| Recruit cooldown, caucus-wide | 12 turns (`CAUCUS_NPP_RECRUIT_COOLDOWN_TURNS`); wall-clock fallback `CAUCUS_NPP_RECRUIT_COOLDOWN_MS` = 12 hours for memberships without a `joinedAtTurn` | `src/lib/constants/partyOrg.ts` |
| Min chair-NPP relationship to stay | 20 (`CAUCUS_NPP_RETENTION_MIN_RELATIONSHIP`) | `src/lib/constants/partyOrg.ts` |
| Relationship decay | 0.1 per turn toward 0 (`NPP_RELATIONSHIP_DECAY_PER_TURN`), rounded to one decimal | `src/lib/constants/partyOrg.ts`, `src/lib/turn/partyOrg/caucusRelationshipMaintenance.ts` |
| Tax rate | 0 to 5 percent of each active member's per-turn campaign-fund income, rounded down | `src/lib/turn/caucusTax.ts` |
| Health recent window | 12 turns (`CAUCUS_RECENT_WINDOW_TURNS`) | `src/lib/caucus/caucusHealth.ts` |
| At-risk warning buffer | 10 above the retention floor, so under 30 (`CAUCUS_WARNING_BUFFER`) | `src/lib/caucus/caucusHealth.ts` |
| Exit risk labels | Critical below 20, Elevated below 25, Watch from 25 to under 30 | `classifyExitRisk` in `src/lib/caucus/caucusHealth.ts` |
| Chair election length | Same as the national party election, `NATIONAL_ELECTION_DURATION_TURNS` = 72 turns, when no national election exists to copy | `src/lib/nationalPartyElectionConstants.ts`, `src/lib/caucusChairElections.ts` |
| Name | 2 to 80 characters | caucus routes |
| Description | up to 500 characters | caucus routes |
| Motto | up to 120 characters | caucus routes |
| Colour | `#RRGGBB` hex | caucus routes |
| Caucuses per member | 1 (one active caucus per player or NPP) | `members/route.ts` under the caucus routes |

## Sub-Tabs

Each caucus currently exposes five sub-tabs:

- `Overview`
- `Roster`
- `Whip`
- `Elections`
- `Chair's Office` (Chair only)

## Membership

### Player Membership

Players can join or leave caucuses through the caucus membership flow. The caucus
roster shows both player and NPP members.

### NPP Membership

NPPs can be recruited into a caucus by the `Caucus Chair` through the
`Chair's Office`.

Current recruitment rules:

- NPP must be in the same party
- NPP must not be retired
- NPP must not already belong to another caucus
- the Chair must have at least `60` relationship with the NPP
- the caucus must not be on its 12-turn recruitment cooldown

The recruit menu intentionally hides:

- NPPs already in another caucus
- NPPs below the relationship threshold

So the picker only surfaces same-party NPPs that are actually in range to be
recruited once the caucus is off cooldown.

### Caucus-Wide Recruit Cooldown

Successful NPP recruitment triggers a **caucus-wide** cooldown of 12 turns (12h at standard cadence, freezes if the game is paused).

The UI always shows one of two recruitment states:

- `Recruitment Available`
- `Xh Ym cooldown`

This cooldown belongs to the caucus as a whole, not to an individual NPP.

## Relationship Maintenance

Caucus NPP membership is relationship-sensitive over time.

### Per-Turn Decay

Every stored NPP-to-character relationship drifts `0.1` toward neutral each turn:

- positive scores move down toward `0`
- negative scores move up toward `0`

This keeps one-off relationship gains from becoming permanent access to caucus
control, Slate leverage, or other NPP systems.

### Retention Threshold

After the decay pass, caucus NPPs are checked against the current Chair.

If an NPP's relationship with the Chair falls below `20`, the NPP automatically
leaves the caucus during turn upkeep.

This is intentionally much lower than the `60` recruit threshold, so caucus
membership is harder to earn than it is to maintain.

## Caucus Treasury

Caucuses maintain their own treasury and can tax caucus funds at `0-5%`.

Current caucus treasury controls in `Chair's Office`:

- edit caucus `Tax`
- send caucus funds to active caucus member players
- transfer caucus funds back to the parent national party treasury

These actions create treasury audit rows so caucus spending remains visible in
the broader party record.

## Caucus Whip

Each caucus has its own `Whip` sub-tab.

The caucus whip surface mirrors the main party `Whip Room`, but its scope is
limited to caucus members only.

Current behavior:

- `Players` and `NPPs` sub-tabs
- player `Soft` and `Hard` whip modes
- bill-by-bill whipping
- leadership whipping
- no standing-order-based caucus whip behavior in the current intended flow

See [party-whips.md](./party-whips.md) for the broader whip model.

## Caucus Chair Elections

Each caucus now has an `Elections` sub-tab where active caucus members can:

- view the active or most recent `Caucus Chair` election
- declare candidacy
- withdraw candidacy
- vote for the next caucus chair

### Schedule

Caucus chair elections run on the same cadence as the parent party's national
leadership cycle. In practice, caucus elections are anchored to the active
national `Chair` election window for the same party and country, so caucus
leadership turns over alongside party leadership.

### Participation Rules

- only active caucus player members may run or vote
- the same new-character cooldown used for party leadership elections applies
- NPPs do not run for or vote in caucus chair elections

### Resolution

When the election ends:

- the winning player becomes the new caucus `Chair`
- the outgoing chair's caucus membership role is demoted back to `member`
- the winner's caucus membership role is promoted to `chair`

Ties break toward the earliest declaration timestamp, matching the broader party
leadership election expectation.

## Chair's Office

The caucus `Chair's Office` is only visible to the current caucus `Chair`.

It is where caucus leadership manages:

- caucus identity fields (`name`, `motto`, `description`, `color`)
- caucus `Tax`
- caucus treasury sends and transfers
- NPP recruitment into the caucus

The NPP recruitment panel shows:

- the NPP's current relationship with the Chair
- the NPP's current office, if any
- caucus-wide recruitment cooldown state

## Caucus Health Dashboard

Party members get caucus-health visibility in two places:

- a high-level `Caucus Health` summary in the national party `Analytics` tab
- a richer per-caucus health view inside each caucus `Overview`

The health pass currently surfaces:

- a simple `Healthy`, `Strained`, or `Fragile` label for each caucus
- recent joins, leaves, and forced exits over the latest short turn window
- current caucus-whip defiance counts
- whether a caucus chair election is active
- NPP members who are drifting close to the Chair relationship exit threshold

## Policy Positions

Caucuses can define internal policy positions. These positions are intended to
signal what the caucus stands for inside the party and help support factional
identity beyond simple membership.

## Timing

- **`caucusTax` phase** runs in the party-and-treasury block of the turn (`src/simulation/phases/turnPhaseRegistry.ts`) alongside `treasuryTurn`, and must not overlap NPP fund generation because both increment NPP funds. Each active caucus with a positive `taxRate` taxes every active player and NPP member once per turn.
- **`nppRelationshipMaintenance` phase** runs later in the same turn, after `emptyPartyCleanup` and `coalitionDisbandVotes` and before NPP behavior. It first decays every stored NPP-to-character relationship, then removes active NPP caucus members whose decayed score with the current Chair is under 20. Order matters: the retention check uses the already-decayed score, not last turn's.
- **Chair elections** are created on the party's national leadership schedule, so a caucus Chair race opens and closes with the national Chair race for the same party and country.
- **Health labels** are not stored. They are computed when the page or analytics tab is read, from memberships, whip defiance and elections.

## Edge cases and limits

- A missing relationship record counts as 0, below the retention floor, so a neglected NPP link dissolves on the next maintenance pass.
- When a member leaves, is banned, or is deleted, `cleanupCaucusParticipationForCharacters` withdraws their candidacy, deletes their votes, closes their membership and clears any Chair or Vice Chair seat they held. The caucus then reads as Fragile (vacant Chair).
- Retention follows the current Chair. A new Chair inherits the NPP members but their relationship is measured against the new Chair, so a Chair change can trigger exits.
- Members who cannot afford their tax that turn are skipped and the treasury is not credited for them, so no member is pushed into negative funds.
- The 12-turn cooldown is per caucus, not per NPP, and freezes when the game is paused (turn-based, with the millisecond value only a fallback).
- NPPs never run or vote in Chair elections. Ties go to the earliest declaration.
- The 60 versus 20 gap is deliberate: recruiting is hard, keeping is easy, so one big meeting does not lock in a bloc, but regular upkeep does.
- Health precedence, first match wins: Fragile for vacant Chair, any Critical NPP, any forced exit in the last 12 turns, or 3 or more active whip defiance cases; Strained for any at-risk NPP, any voluntary leave in the window, any defiance case, or an election in progress; otherwise Healthy.

### Worked example

An NPP recruited at relationship 70 loses 0.1 per turn with no top-up. It enters the at-risk list as Watch just under 30 (turn 400), becomes Elevated below 25 (turn 450), Critical below 20 (turn 500), and exits on the first maintenance pass where the score is under 20 (turn 501). Any gain from relationship-building actions pushes that clock back by 10 turns per point.

## Connections

Driven by:
- Party membership and the national party Chair schedule (`src/lib/caucusChairElections.ts`).
- NPP relationship scores, which are raised by player relationship actions (see `src/lib/capital/actions.ts`) and decay in `caucusRelationshipMaintenance.ts`. See [party-influence.md](./party-influence.md).
- Member campaign-fund income (`projectCharacterGeneration` and `projectNppGeneration` in `src/lib/utils/fundGeneration.ts`), the base the tax applies to.
- Whip defiance snapshots (`buildWhipDefianceSnapshots` in `src/lib/partyWhips/whipDefiance.ts`), see [party-whips.md](./party-whips.md).

Affects:
- Caucus treasury and the parent party treasury through `emitTreasuryTransaction` audit rows (sends and transfers).
- NPP `factionId`, which other NPP systems read (Slate leverage, NPP behavior).
- Party analytics `Caucus Health` summary (`src/lib/parties/queries/analytics.ts`).
- Caucus whips on bills and leadership votes for members only.
- Member divergence scoring in one-party states: a member's score takes `CAUCUS_COHESION_WEIGHT` = 0.6 from their caucus (`src/lib/onePartyState/factionDivergence.ts`).

## Design Intent

Caucuses are meant to create:

- internal party faction play
- smaller whip blocs inside a large national party
- treasury and patronage decisions at a sub-party level
- relationship-driven NPP faction building

They are not meant to replace the national party itself, and they do not create
separate ballot lines or separate election parties.

## Related Docs

- [party-building.md](./party-building.md)
- [party-whips.md](./party-whips.md)
- [party-influence.md](./party-influence.md)

Last checked: 2026-10-29, version 1.18.0
