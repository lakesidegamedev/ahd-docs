# Formula Deep-Dive

This reference documents the key formulas and calculations that drive game mechanics. Understanding these helps you make optimal decisions.

## Election Vote Calculation

### Vote Turn Pool

Each turn, votes are allocated to candidates based on:

```
effectiveTurnPool = turnPool × (1 + (stateApproval - 0.5) × 0.2) × officeStrength
```

Approval is a small modifier, not a direct multiplier: 50% approval gives 1.0x, and each 10 points of approval above or below 50 shifts the pool by about 2% (`tallyManagement.ts`). `officeStrength` comes from `partyStrengthWeight` in the country's office-type config (`src/lib/constants/countries.ts`), defaulting to 0.9 when unset. US values:

- Governor: 1.0
- House: 0.9
- Senate: 0.8
- State Senate: 0.85

### Candidate Vote Share

Votes are allocated per demographic group, not with a single state-wide formula. For each group, every candidate gets a weight:

```
weight = appeal × reach × approval × org × regResistance × regBaseline × supportMood
         × nppPenalty × infamyMult × pgfMult × regimeMult × partyFit
         × stateOrgMult × homeStateMult × partyInfluenceMult
```

(`distributeVotesByGroupLevelAllocation` in `src/lib/electionEngine/voteDistribution.ts`). The candidate's share of that group's vote pool is `weight / totalWeight` across candidates in the group. There is no separate "state lean" multiplier: lean is baked into `appeal`, computed per group from the group's own economic/social lean versus the candidate's position (`calcAppeal` in `src/lib/utils/demographicAppeal.ts`). Several of the other factors (org, regResistance, regBaseline, supportMood, state-org bonus, home-state bonus, party-influence bonus) only apply when relevant (general election, presidential primary, etc.); they default to 1.0x (no-op) otherwise.

- **Reach** = normalized political influence (or national influence, presidential path), floored at `VOTE_REACH_FLOOR = Math.sqrt(1/100)` (`electionFormulaFactors.ts`) so influence 0 never produces a literal 0x weight.
- **Appeal** = a position score (power curve, exponent `APPEAL_POSITION_EXPONENT = 1.5`) plus a per-axis tribal "direction bonus" (`DIRECTION_BONUS_PER_AXIS = 5`) when the candidate's lean matches the group's lean direction, plus an influence score if enabled. Floored at `APPEAL_POSITION_FLOOR = 0.5` per axis so no candidate is fully locked out of a group. Max appeal is 50 (`demographicAppeal.ts`).
- **Party org (general elections only)** = `orgVoteWeight`, a diminishing-returns curve on normalized state org share, not a flat 0.3-1.0 range.
- **Approval** = `approvalScalar(effectiveFavorability)`, a balanced curve centered on 50% favorability.

### State Org and Home State Bonuses

Not part of the vote-share formula above but stack into it as `stateOrgMult` / `homeStateMult` (`src/lib/electionEngine/constants.ts`):

- `MAX_STATE_ORG_BONUS_PRIMARY = 0.25` (primary path cap; the fraction of it delivered follows an uncapped exponential-approach curve, `1 − (1 − 0.75)^(level / 10)`, not a linear ramp, level 10 buys 75% of the max bonus, level 20 buys 93.8%, approaching but never reaching 100%)
- `MAX_STATE_ORG_BONUS_GENERAL = 0.15` (general path cap, smaller so it doesn't dominate lean × party position)
- `HOME_STATE_BONUS_PRIMARY = 0.2` (flat bonus in a candidate's home state during a primary)
- `HOME_STATE_BONUS_GENERAL = 0.05` (smaller general-election equivalent)

### Minimum Vote Floor

There is no 50%-of-base-vote floor. The actual floors are on the individual factors that feed the weight: `VOTE_REACH_FLOOR` clamps reach to at least ~0.1x, and `APPEAL_POSITION_FLOOR` (0.5, about 2% of max appeal) keeps position score above zero per axis. Together these keep even a badly-misaligned, low-influence candidate from hitting a literal zero weight in a group, but they do not guarantee any fixed share of the base vote pool.

## Political Influence

### Decay

```
decay = influence × 0.0075  (0.75% per turn, `POLITICAL_INFLUENCE_DECAY_RATE` in `shared/constants/formulas.ts`)
```

### NPP Influence Floor

NPPs cannot decay below 10% Political Influence (`NPP_POLITICAL_INFLUENCE_FLOOR`).

## Presidential Election Scoring

### Primary Score

```
score = alignmentScore(0-40) + partyInfluenceScore(0-20) + nationalReachScore(0-15) + favorabilityScore(0-25)
```

Weights are `PRESIDENT_PRIMARY_ALIGNMENT_WEIGHT = 40`, `PRESIDENT_PRIMARY_PARTY_INFLUENCE_WEIGHT = 20`, `PRESIDENT_PRIMARY_NATIONAL_REACH_WEIGHT = 15`, `PRESIDENT_PRIMARY_FAVORABILITY_WEIGHT = 25` (`src/lib/primaryScore.ts`, rebalanced 2026-08-19). Party influence, not "party org," is the second term; it scales linearly and is uncapped above the reference scale (party influence 150). Favorability was raised from 10 to 25 because it is the single most decisive variable in the general election (`approvalScalar` measured at ~0.45 vote-share points per favorability point) while party influence never enters the general-vote formula at all, the old weighting let parties nominate candidates the electorate had already rejected.

### Electoral College

- 538 total electoral votes
- 270 needed to win
- ME and NE split by congressional district with lean proxies (UNIT_LEAN)
- 269-269 tie: deterministic coin flip (SHA-256 of election + candidate IDs)

### Independent Penalty

Independent candidates receive 0.3x vote multiplier.

## Demographic Turnout

### Turnout Modifier Range

Each demographic group: -20% to +20% modifier

### Decay

```
modifier = modifier × 2^(-1/6)  (6 turn half-life, about 10.9% per turn, campaign rules version 1)
```

Legacy elections still use `modifier × 0.98` (2% per turn).

### Canvassing Effectiveness

```
boost = baseBoost × alignmentMultiplier × seasonMultiplier × diminishingFactor
```

Where:

- **alignmentMultiplier** = 0.1 to 1.0 based on ideological distance
- **seasonMultiplier** = 2.0 during campaign season (4 turns before election), 1.0 otherwise
- **diminishingFactor** = smaller boost when existing modifier is already large

### Party GOTV

Party budgets have a GOTV allocation (`gotvBudgetPerTurn`, `gotvBudgetPercent`) targeted at a specific category or group (`gotvTargetCategory` / `gotvTargetGroup`), which feeds turnout for the tally. There is no verified "auto-boost demographics within 2 points of party position" rule in code, that claim is unconfirmed and removed rather than guessed at.

## Fund Generation

### Passive Income

```
income = statePopulationTier × donorLevelMultiplier + officeBonus
```

### Office Fund Bonuses

| Office    | Bonus       |
| --------- | ----------- |
| House     | +$5,000/hr  |
| Senate    | +$15,000/hr |
| Governor  | +$15,000/hr |
| VP        | +$25,000/hr |
| President | +$50,000/hr |

## Action Economy

### Base Actions

4 actions per turn (base), plus office bonuses:

- Governor: +2 actions
- Other offices: varies

### Action Costs

Action costs vary by action and target. For example, setting a travel or primary campaign state costs 3, 5, 7 or 10 actions depending on the state's electoral votes (`getTravelActionCost` in `src/lib/constants/states.ts`). Advertise, fundraise and influence actions have their own costs.

### State Adjacency Costs

- Home state: 1.0x
- Neighboring state: 1.25x
- Non-neighboring: 1.5x

## State Lean Calculation

```
stateLean = weightedAverage(groupLeans, groupPopulations × groupTurnout)
```

Lean is stored on an integer **-5 to +5** scale per axis (economic, social), not a -1..1 float. Display labels (`getEconomicPositionName` / `getSocialPositionName`, `src/lib/utils/politics.ts`) use 11 discrete buckets, one per integer value:

Economic axis: Far Left (-5), Strong Left (-4), Left (-3), Lean Left (-2), Center-Left (-1), Centrist (0), Center-Right (1), Lean Right (2), Right (3), Strong Right (4), Far Right (5).

Social axis: Far Liberal (-5), Strong Liberal (-4), Liberal (-3), Lean Liberal (-2), Center-Liberal (-1), Moderate (0), Center-Trad (1), Lean Trad (2), Traditional (3), Strong Trad (4), Far Traditional (5).

## Related Pages

- [Election Mechanics](./elections.md), Election system overview
- [Demographics & Targeting](./demographics-targeting.md), Demographic details
- [Stats & Actions](./stats-actions.md), Action costs and stats
- [Government Approval](./government-approval.md), Approval system
