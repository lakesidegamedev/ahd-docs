# NPP Opponents Guide

Player guide: [NPPs Overview](https://www.ahousedividedgame.com/wiki/npps-overview), with [NPP Elections](https://www.ahousedividedgame.com/wiki/npp-elections) and [NPP Behavior](https://www.ahousedividedgame.com/wiki/npp-behavior).

## Summary

Non-Player Politicians (NPPs) are AI-controlled politicians that fill offices, run in elections, and vote on legislation. This page is the opponent-facing view: how NPPs enter races, what handicaps they carry against players, what a player can do to them, and how they vote. It is the companion to [npp-system.md](./npp-system.md), which has the full mechanical detail. Where the two disagree, `npp-system.md` is authoritative.

Everything below was checked against the code in `src/lib/turn/npp/`, `src/lib/electionEngine/constants.ts` and `src/lib/capital/actions.ts`.

## Rules

### Election entry

NPP entry is deterministic and priority-based, not a random ambition roll (`src/lib/turn/npp/electionEntry.ts`, `src/lib/turn/nppEntryLogic.ts`). There is no per-turn dice roll for whether an NPP shows up for an empty slot.

Entry runs in a fixed order each turn:

1. **Defending incumbents** auto-file first for the seat they already hold, bypassing that seat's cooldown (`shouldDefendPrimary`).
2. **Accepted Slate NPPs** file next, even if this creates a same-party primary against a defending incumbent.
3. **Fallback fill** adds at most one generic same-party NPP to an otherwise open primary, following `RACE_PRIORITY` order (`src/lib/turn/rules/nppElectionPriority.ts`): state senate and regional or subnational races first, national legislature after them, governor last. A party with no regional organisation row in a region cannot field a new candidate there (`canPartyFieldInState`).
4. **Consolidation** (autonomy engine v6): in the closing window of a primary with no player in it, a clearly trailing non-incumbent NPP withdraws and receives an `electionCooldowns` entry for that primary.
5. **Ambitious challenger pass** (autonomy level v3 and above): may add a second same-party NPP to an already-filled primary.

| Constant | Value | Source |
| --- | --- | --- |
| `CHALLENGER_BASE_PROBABILITY` | 0.15 per already-filled party slot per cycle, times the challenger's `officeSeekingMult` | `src/lib/turn/npp/electionEntry.ts` |
| `PLAYER_COUNTRY_CHALLENGER_MULT` | 0.5 in player-enabled countries | `src/lib/turn/npp/electionEntry.ts` |
| `NPP_CHALLENGERS_PER_COUNTRY_PER_PASS` | 2 challengers per country per entry pass; a given player candidate is challenged at most once per election | `src/lib/nppAutonomy/playerImpactBudget.ts` |
| `PRESIDENTIAL_CHALLENGER_POOL` | 5 strongest NPPs nationwide (v6 only) | `src/lib/turn/npp/electionEntry.ts` |
| `RACE_PRIORITY` | 18 race types, unknown types rank 999 (last) | `src/lib/turn/rules/nppElectionPriority.ts` |

Other entry rules:

- **Country isolation.** NPPs only enter elections in their own `countryId`.
- **One race at a time.** An NPP already in an active race is not eligible for another (`isNPPAvailable`).
- **Presidential entry is blocked** by default. Autonomy-active, non-player-enabled countries lift the bar, and direct Russian first-round ballots are the other exception.
- **Retired and technocrat NPPs** never enter.

### NPP advantages

- A **political influence floor of 10** (`NPP_POLITICAL_INFLUENCE_FLOOR` in `shared/constants/formulas.ts`): decay never takes them below it. Players have a decay floor of 0, but new characters also start at 10 (`NEW_CHARACTER_STARTING_INFLUENCE`).
- Realistic policy positions based on party, plus avatars and names.
- They act on their own: roughly every 4 turns an NPP picks one action with an action AI (`campaign`, `advertise`, `buildDonorBase`, `partyDonation`, or `fundraise` as a last resort; `src/lib/npp/actionAi.ts`, `src/lib/turn/nppActionProcessing.ts`). They do campaign, advertise and raise funds, but they do not plan timing the way a player does.

### NPP handicaps against players

| Handicap | Value | Applies when | Source |
| --- | --- | --- | --- |
| `NPP_PRIMARY_SCORE_MULTIPLIER` | 0.5 on the NPP's primary score | At least one human player is in the NPP's party primary | `src/lib/electionEngine/constants.ts`, used in `src/lib/primaryScore.ts` |
| `NPP_GENERAL_WEIGHT_MULTIPLIER` | 0.8 on the NPP's per-group vote weight | A player is in the general election race | `src/lib/electionEngine/constants.ts`, used in `src/lib/electionEngine/voteDistribution.ts` |
| `NPP_STAGGER_EXTRA_MULTIPLIER` | 0.6 more, stacking to 0.48 | Presidential primary stagger waves with a player in the same party primary | `src/lib/electionEngine/constants.ts` |

Dropout cooldowns: an NPP that withdraws through consolidation gets `electionCooldowns[electionId]` set to the primary's end time. Fallback fill respects it; defending incumbents can still re-file for their own seat.

### Influence actions on an NPP

The NPP profile page (`/politicians/npp/[id]`) exposes a deterministic direct-interaction set (`CAPITAL_ACTIONS` in `src/lib/capital/actions.ts`). There is no hidden roll except the endorsement willingness check.

| Action | Actions | Campaign funds | Gate | Effect |
| --- | --- | --- | --- | --- |
| `request_endorsement` | 6 | $0 | Hidden check: relationship at least `40 + min(10, abs(econ diff) + abs(social diff))` | Creates or refreshes an arranged endorsement for one active campaign |
| `private_meeting` | 3 | $0 | Relationship at least -50 | +5 relationship |
| `boost_favorability` | 5 | $10,000 | none | +3 favorability, +2 relationship |
| `reduce_favorability` | 5 | $10,000 | Relationship at least -100 | -3 favorability, -2 relationship |
| `boost_influence` | 6 | $20,000 | none | +2 influence, +2 relationship |
| `reduce_influence` | 6 | $20,000 | Relationship at least -100 | -2 influence, -2 relationship |

Only positive relationship and favorability gains are scaled by the player's charisma (`statMultiplier`, `1 + (stat - 5.5) * 0.04`, so 0.82 at stat 1 and 1.18 at stat 10), rounded to a whole number. Costs and influence changes are not scaled. Party chairs and vice chairs get a separate party-side surface for NPP management (recruitment, `boost_loyalty`, `reduce_stubbornness`), see [party-influence.md](./party-influence.md).

### Beating NPPs

In primaries:

1. Enter early. Your presence in the party primary is what triggers the 0.5 NPP score penalty.
2. Build influence. NPPs have a floor of 10; exceed it significantly.
3. Stay ideologically aligned. NPPs sit close to their party median; match or exceed their alignment.
4. Remember they can only be in one primary at once; if they are in yours, they are not elsewhere.

In general elections:

1. Leverage your party organisation. NPPs benefit from party organisation too, but you can actively improve yours.
2. Campaign actively. NPPs take about one action every 4 turns, so a player who campaigns every turn out-paces them.
3. Target their weak demographics. NPP positions barely move (they drift slowly toward their state's lean, `nppStanceDrift`); find demographics they do not appeal to.

### Bill voting

NPPs vote on legislation through a deterministic cross-pressure verdict, not a pure ideology roll (`src/lib/turn/npp/billVoting.ts`, `src/lib/turn/npp/crossPressure.ts`). Each vote sums four signed forces: ideology, whip, district or home-region sentiment, and donors. The result is `for` above +5, `against` below -5, otherwise `abstain` (`VERDICT_THRESHOLD = 5` in `crossPressure.ts`). An NPP holding several seats in a chamber casts a vote weighted by its seats (`aggregateNppMandateWeights`, `seatsHeld` for state chambers). The force formulas are in [npp-system.md](./npp-system.md).

## Data

| Collection | Use here | Shown to players |
| --- | --- | --- |
| `npps` | Politician profile: `politicalInfluence`, `favorability`, `policies`, `personality`, `electionCooldowns`, `retiredAt` | Influence, favorability and policies; personality and cooldowns are hidden |
| `electionCandidates` | NPP candidacies (`isNPP`, `nppId`, `party`, `status`) written at filing | Yes |
| `nppRelationships` | Per player and NPP `relationshipScore` (-100 to 100), `lastAttemptTurn`, attempt counters | The player's own relationship |
| `capitalActionLogs` | One row per direct action: cost, relationship before and after, effect summary | The player's own history |
| `nppEndorsements` | Arranged endorsements, with source `arranged`, active flag and withdrawal reason | Yes |
| `nppVotePredictions` | Force vector, donors label, raw verdict and resolved vote per NPP and bill | Via the forecast surface |

## Configuration

| Setting | Effect | Default and where set |
| --- | --- | --- |
| `gameState.nppAutonomyLevel` (`off`, `v0` to `v6`) | Gates the consolidation (v6), challenger (v3), presidential-entry and other autonomous behaviour | Read through `getNppAutonomyLevel` in `src/lib/nppAutonomy/featureFlag.ts`; falls back to `v0` when only the legacy boolean `nppAutonomyEnabled` is set, else `off` |
| Player-enabled country flag | Halves challenger rate; blocks NPP presidential entry | `isCountryEnabledForPlayers` in `src/lib/countryAccess` |
| Party regional presence | A party without a `statePartyOrg` row or with `hasPresence: false` cannot field new candidates there. Regions with no org data at all are exempt | `statePartyOrg` collection, `canPartyFieldInState` |
| One-party-state rules | Banned-party and independent NPPs cannot file | `src/lib/turn/onePartyConstraints.ts` |

## Timing

```text
processNPPTurn (phase nppBehavior)
  mortality -> load shared context -> slate persistence sync -> slate responses
  -> election entry (incumbents, slate, fill, consolidation, challengers)
  -> endorsement cleanup -> federal bill voting -> local bill voting
later in the same turn: nppActionProcessing (every 4th turn per NPP), primaryResolution, electionResolution
```

Slate responses run before entry so accepted rows are ready for the filing pass. Voting happens before `billLifecycle`, so NPP votes are in before bills resolve. Direct influence actions run at request time, not in the turn.

## Worked trace

A player with charisma 10 (multiplier `1 + (10 - 5.5) * 0.04 = 1.18`) works on NPP "N", who starts at relationship 10, favorability 50 and influence 10.

| Step | Cost | Calculation | Result |
| --- | --- | --- | --- |
| `boost_favorability` | 5 actions, $10,000 | favorability +3 * 1.18 = 3.54, rounds to 4; relationship +2 * 1.18 = 2.36, rounds to 2 | favorability 54, relationship 12 |
| `boost_influence` | 6 actions, $20,000 | influence +2 (not scaled); relationship +2 * 1.18 = 2.36, rounds to 2 | influence 12, relationship 14 |
| `reduce_influence` | 6 actions, $20,000 | influence -2, relationship -2 (negative deltas are not scaled) | influence 10, relationship 12 |

Total for the three: 17 actions and $50,000. The last step returns N to influence 10, so a reduce undoes a boost exactly. A reduce action can take N below 10 (the stored value clamps at 0), but per-turn decay never will.

Primary effect: if N's primary score is 80 and a player is in the party primary, N is scored at `80 * 0.5 = 40`. In the general, N's per-group vote weight is multiplied by 0.8, so a weight of 1,000 counts as 800.

## Edge cases and limits

- Boost favorability is refused with `target_at_cap` when favorability is 100, and boost influence at influence 100. Reduce actions are refused with `target_at_floor` at 0. The player is not charged.
- Retired NPPs cannot be targeted (`npp_retired`).
- `request_endorsement` needs an active candidacy and shares a country with the NPP; the endorsement applies to that one race.
- An abstain on a veto override vote becomes `against` (federal US veto override and Japanese Shugiin override, and state-bill veto overrides).
- US congressional leadership votes (Speaker, House and Senate leadership) are player-driven. The turn pass does not cast NPP leadership votes; only a player's whip routes can direct NPPs there.
- Technocrat NPPs (for example autonomous central-bank chairs) never enter elections or vote on bills.
- The influence floor of 10 applies to decay only; a player action can still reduce an NPP below it (the stored value clamps to 0 to 100).

## Invariants

| Invariant | Enforced by |
| --- | --- |
| One generic NPP per party per primary from the fallback fill | `filledThisTurn` in `electionEntry.ts`; the contested-primary case is covered in `src/lib/turn/npp/electionEntry.test.ts` ("does not add a second challenger when a primary is already contested") |
| An NPP is in at most one active race | Upsert keyed on `{ characterId, status: "active" }` in `electionEntry.ts`; the duplicate-key case is tested in `electionEntry.test.ts` |
| No ambitious challenger below autonomy v3, and a lone player candidate is challenged at most once | `electionEntry.test.ts` ("does not add a challenger when autonomy is below v3", "challenges a lone PLAYER candidate at most once") |
| An NPP only votes on its own country's bills | `src/lib/turn/npp/billVoting.test.ts` (regression for #0699) |
| Direct actions never overdraw actions or funds | Conditional `findOneAndUpdate` on `actions` and funds in `src/lib/npps/commands/directAction.ts` (throws on a balance conflict) |
| Relationship stays in -100 to 100, favorability and influence in 0 to 100 | Clamps in `directAction.ts`; `src/lib/capital/actions.test.ts` covers validation |

## Failure and recovery

- **A race has no NPP.** Typically an organisation gate or a cooldown; the next turn's fill pass retries. If an entire chamber is unseeded, the roster seed is re-run.
- **A direct action fails midway.** Spending, relationship, NPP stats and the log write run in one transaction where available and are rolled back (with refunds on non-transaction fallbacks) so a player is never charged for a no-op.
- **A stale endorsement.** Cleared at the next turn by `processNppEndorsements` when the election ended, the candidate left, or the NPP and election no longer share a country.
- **A vote cast on bad inputs.** The force vector is stored in `nppVotePredictions`, so a bad vote can be replayed and diagnosed. Voted NPPs are skipped on later turns, so a wrong vote is repaired by a data heal of the bill record, not by the next turn.

## Connections

Driven by:

- [Party slate](./party-slate.md): accepted Slate NPPs file second in the entry order.
- [Party whips](./party-whips.md): whip direction feeds the whip force.
- [Party influence](./party-influence.md): party actions change loyalty, stubbornness, favorability and influence.

Affects:

- [Election engine](./election-engine.md): NPP primary and general handicaps scale scores and vote weights.
- [Campaign strategy](./campaign-strategy.md): the overall plan for beating NPP opponents.
- [Bills and legislation](./bills-legislation.md): NPP votes decide bills.

Related pages:

- [npp-system.md](./npp-system.md), full NPP mechanics documentation
- [election-engine.md](./election-engine.md), how elections work
- [campaign-strategy.md](./campaign-strategy.md), overall strategy guide

## Tests

| Area | Test files |
| --- | --- |
| Entry logic and priority | `src/lib/turn/nppEntryLogic.test.ts`, `src/lib/turn/npp/electionEntry.test.ts`, `src/lib/turn/rules/nppElectionPriority.test.ts` |
| Challenger budget | `src/lib/nppAutonomy/__tests__/playerImpactBudget.test.ts` |
| Handicap multipliers | `src/lib/electionEngine/voteDistribution.test.ts`, `src/lib/actions/granularPollPayload.test.ts` |
| Influence floor | `shared/constants/formulas.test.ts` |
| Direct actions | `src/lib/capital/actions.test.ts`, `src/lib/npps/commands/directAction.crossCountry.test.ts` |
| Bill voting | `src/lib/turn/npp/crossPressure.test.ts`, `src/lib/turn/npp/crossPressure.v2.test.ts`, `src/lib/turn/npp/billVoting.test.ts`, `src/lib/turn/npp/stateBillVoting.test.ts` |

Gaps: no test pins the 0.5 primary multiplier at the `primaryScore.ts` call site, and the charisma rounding of direct actions has no dedicated test.

## Known issues and history

- The earlier version of this page said NPPs cannot run ads or fundraise. The action AI does both; corrected 2026-10-29.
- The earlier version said a 50 percent score penalty applies whenever an NPP competes against a player. It applies only when a player is in the NPP's own party primary; corrected 2026-10-29.
- The caucus whip force exists in `crossPressure.ts` but every turn-voting caller passes `caucusWhip: null`, so a caucus whip does not currently reach autonomous votes. The player wiki describes a caucus whip of 40; see [npp-system.md](./npp-system.md).
- `ambition` is stored but the entry pass weights challengers by `officeSeekingMult` from the career-archetype model; the personality field is otherwise reserved.

Last checked: 2026-10-29, version 1.18.0
