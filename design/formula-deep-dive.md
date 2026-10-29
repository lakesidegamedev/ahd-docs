# Formula Deep-Dive

This reference documents the key formulas and calculations that drive election, influence, turnout, fund and action mechanics. Every constant is listed with its value and the source file it lives in, so the page can be checked against the code.

Player guide: [Reference: Formulas](https://www.ahousedividedgame.com/wiki/reference-formulas)

## Election Vote Calculation

### Vote Turn Pool

Each turn, votes are allocated to candidates based on:

```
effectiveTurnPool = turnPool × (1 + (stateApproval - 0.5) × 0.2) × officeStrength
```

`turnPool` is the share of the race's total vote pool cast this turn (`turnVoteWeight`, `src/lib/electionEngine/voteCalculations.ts`). The general-election window is split into three bands: the early band casts `EARLY_POOL_SHARE = 0.5` of the pool, the ramp band (up to `RAMP_TURNS = 8` turns) casts `RAMP_POOL_SHARE = 0.2`, and the final `ELECTION_DAY_TURNS = 4` turns cast `FINAL_POOL_SHARE = 0.3`. Races of 4 turns or fewer spread the pool evenly. If there is no early band, its share folds into the ramp so the shares still sum to 1. The window starts at the end of the primary, not at the race start, so primary turns do not dilute the early band.

Approval is a small modifier, not a direct multiplier: 50% approval gives 1.0x, and each 10 points of approval above or below 50 shifts the pool by about 2% (`tallyManagement.ts`). `officeStrength` comes from `partyStrengthWeight` in the country's office-type config (`src/lib/constants/countries.ts`), defaulting to 0.9 when unset. US values:

- Governor: 1.0
- President: 1.0
- House: 0.9
- Senate: 0.8
- State Senate: 0.85

Why: the pool is scaled by how the state judges the party in power, but only by a few percent, so approval can tilt a close race without deciding it alone.

**Worked example.** A House race has a 20 turn general window and a total pool of 1,000,000 votes. The early band has 8 turns (20 - 4 - 8), so each early turn casts 0.5 x 1,000,000 / 8 = 62,500. Each ramp turn casts 0.2 x 1,000,000 / 8 = 25,000. Each of the final 4 turns casts 0.3 x 1,000,000 / 4 = 75,000. With state approval at 60%, strength is (1 + (0.6 - 0.5) x 0.2) x 0.9 = 0.918, so a final-turn pool is 75,000 x 0.918 = 68,850 votes, split among candidates by weight.

### Candidate Vote Share

Votes are allocated per demographic group, not with a single state-wide formula. For each group, every candidate gets a weight:

```
weight = appeal × reach × approval × org × regResistance × regBaseline × supportMood
         × nppPenalty × infamyMult × pgfMult × regimeMult × partyFit
         × stateOrgMult × homeStateMult × partyInfluenceMult
```

(`distributeVotesByGroupLevelAllocation` in `src/lib/electionEngine/voteDistribution.ts`). The candidate's share of that group's vote pool is `weight / totalWeight` across candidates in the group. There is no separate "state lean" multiplier: lean is baked into `appeal`, computed per group from the group's own economic/social lean versus the candidate's position (`calcAppeal` in `src/lib/utils/demographicAppeal.ts`). Several of the other factors (org, regResistance, regBaseline, supportMood, state-org bonus, home-state bonus, party-influence bonus) only apply when relevant (general election, presidential primary, etc.); they default to 1.0x (no-op) otherwise.

- **Reach** = normalized political influence (or national influence, presidential path), floored at `VOTE_REACH_FLOOR = Math.sqrt(1/100)` (`electionFormulaFactors.ts`) so influence 0 never produces a literal 0x weight.
- **Appeal** = `positionScore + directionBonus + influenceScore` (`calcAppeal`, `src/lib/utils/demographicAppeal.ts`). `positionRaw = max(0, 50 - 5 x |econDiff| - 5 x |socialDiff|)` and `positionScore = 25 x (positionRaw / 50) ^ APPEAL_POSITION_EXPONENT + APPEAL_POSITION_FLOOR` with `APPEAL_POSITION_EXPONENT = 1.5` and `APPEAL_POSITION_FLOOR = 0.5` (so no candidate is fully locked out of a group). The per-axis tribal direction bonus is `DIRECTION_BONUS_PER_AXIS = 5` times a factor that is 1 when the candidate leans the group's way by at least `DIRECTION_RAMP = 0.5`, `CENTER_FRACTION = 1/3` for a dead-centre candidate, and 0 when opposed; it is also 0 when a leaning candidate points against their own party on that axis, or when the group sits at exactly 0 on the axis. `influenceScore = normalizeNPI(influence) x 12.5`, used in presidential generals only. Appeal therefore tops out at 35.5 in state races (25.5 + 10) and 48 in presidential generals; `MAX_APPEAL = 50` is the normalization ceiling other code scales against.
- **Party org (general elections only)** = `orgVoteWeight` = `(ownOrg / totalStateOrg) ^ ORG_WEIGHT_EXPONENT` with `ORG_WEIGHT_EXPONENT = 0.2` (`src/lib/electionEngine/electionFormulaFactors.ts`). A 3:1 org lead gives about a 1.25:1 weight edge (0.75^0.2 = 0.944 against 0.25^0.2 = 0.758). If no party has any org in the state the weight is a neutral 1; a party with 0 org in a populated state gets 0, softened by the personal floor `PERSONAL_ORG_FLOOR_CAP x reach x approval` with `PERSONAL_ORG_FLOOR_CAP = 0.1`.
- **Tenure erosion** (general elections): once a seat has been held for more than one consecutive term, influence and favorability are scaled by `1 - min(0.15, 0.03 x (terms - 1))` (`PERSONAL_STAT_TENURE_EROSION_PER_TERM = 0.03`, `PERSONAL_STAT_TENURE_EROSION_MAX = 0.15`, `personalStatTenureRetention` in `electionFormulaFactors.ts`). Worst case a long-serving holder keeps 85% of both.
- **Approval** = `approvalScalar(effectiveFavorability)` = `(favorability / 100) ^ APPROVAL_SCALAR_EXPONENT` with `APPROVAL_SCALAR_EXPONENT = 0.8` (`src/lib/utils/demographicAppeal.ts`). Effective favorability is the candidate's favorability plus half the group's own approval of them, clamped to 0 to 100.
- **Infamy** (`infamyMult`) = `1 - INFAMY_PENALTY_MAX x infamy / 100`, with `INFAMY_PENALTY_MAX = 0.05` and infamy clamped to 0 to 100 (`src/lib/utils/infamy.ts`). Infamy 100 costs 5% of weight.
- **Independent penalty** applies to independent presidential candidates only: 0.3x (`src/lib/presidentialElectionEngine.ts`).

Factors a player can move: appeal (change position or build influence), reach (political influence), approval (favorability), org (party organisation), and infamy. The rest are structural.

Other terms in the stack, in plain words: `regResistance` is own-registration making voters harder to peel away, 1.0x to 1.3x (`REG_RESISTANCE_MAX_BONUS = 0.3`); `regBaseline` prices a party's current registration where a world authors partisan baselines; `supportMood` is the candidate's Support, 0.6x to 1.4x and neutral 1.0x at Support 50 (`SUPPORT_MOOD_FLOOR`, `SUPPORT_MOOD_CEILING`); `nppPenalty` is the NPP multiplier, `pgfMult` is the party-group favorability boost from addresses, `regimeMult` is the regime multiplier, and `partyFit` is the candidate's fit with the party platform.

### State Org and Home State Bonuses

Not part of the vote-share formula above but stack into it as `stateOrgMult` / `homeStateMult` (`src/lib/electionEngine/constants.ts`):

- `MAX_STATE_ORG_BONUS_PRIMARY = 0.25` (primary path cap; the fraction of it delivered follows an uncapped exponential-approach curve, `1 − (1 − 0.75)^(level / 10)`, not a linear ramp, level 10 buys 75% of the max bonus, level 20 buys 93.8%, approaching but never reaching 100%)
- `MAX_STATE_ORG_BONUS_GENERAL = 0.15` (general path cap, smaller so it doesn't dominate lean × party position)
- `HOME_STATE_BONUS_PRIMARY = 0.2` (flat bonus in a candidate's home state during a primary)
- `HOME_STATE_BONUS_GENERAL = 0.05` (smaller general-election equivalent)

Both bonuses multiply the weight as `1 + bonus`. **Worked example.** At org level 10 in a general election the org bonus is 0.15 x 0.75 = 0.1125, and at home the candidate adds 0.05, so the weight is multiplied by 1.1125 x 1.05 = 1.168. In a primary at level 10 it is 1.1875 x 1.2 = 1.425.

### Minimum Vote Floor

There is no 50%-of-base-vote floor. The actual floors are on the individual factors that feed the weight: `VOTE_REACH_FLOOR` clamps reach to at least ~0.1x, and `APPEAL_POSITION_FLOOR` (0.5, about 2% of max appeal) keeps position score above zero per axis. Together these keep even a badly-misaligned, low-influence candidate from hitting a literal zero weight in a group, but they do not guarantee any fixed share of the base vote pool.

## Political Influence

### Decay

```
decay = clamp(influence, 0, 100) × POLITICAL_INFLUENCE_DECAY_RATE × multiplier
POLITICAL_INFLUENCE_DECAY_RATE = 0.0075  (0.75% per turn)
```

Source: `shared/constants/formulas.ts` (`calculatePoliticalInfluenceDecay`, `applyPoliticalInfluenceDecay`). `multiplier` is 1 for most characters. Members of the party holding the national executive use `executivePartyInfluenceDecayMultiplier(approval) = 2 - approval / 100`: 2.0x at 0% approval, 1.5x at 50%, 1.0x at 100%. The multiplier is stored on the character as `politicalInfluenceDecayMultiplier` by the action refresh (`src/lib/turn/actionRefresh.ts`).

Why: holding power costs home-state standing, and a government that is popular pays less of it.

**Worked example.** Influence 40 loses 40 x 0.0075 = 0.30 per turn, so 39.70 next turn. A member of the governing party at 50% approval loses 0.30 x 1.5 = 0.45.

### Floors

- Players: floor 0 (decay cannot take influence below 0).
- NPPs: floor `NPP_POLITICAL_INFLUENCE_FLOOR = 10`. The floor is a barrier, not a pull: an NPP already below 10 (a deliberately low-profile shell at 1, for example) is held in place, not raised.
- New characters start at `NEW_CHARACTER_STARTING_INFLUENCE = 10` (a minimum over the configured starting value, `shared/constants/formulas.ts`).

### National influence

Decay is `NATIONAL_INFLUENCE_DECAY_RATE = 0.01` of current national influence per turn. Passive gain from state influence (`calculateNationalInfluenceGain`) is `si / 50 - 0.5` for state influence `si` up to 50, and `0.5 + (si - 50) x 0.03` above 50 (so -0.5 at 0, 0 at 25, +0.5 at 50, +1.25 at 75, +2.0 at 100). Each turn applies decay first, then the gain, floored at 0 (`applyNationalInfluenceTurn`). Every role settles where gain equals decay, at 100 x gain.

## Presidential Election Scoring

### Primary Score

```
score = alignmentScore(0-40) + partyInfluenceScore(0-20) + nationalReachScore(0-15) + favorabilityScore(0-25)
```

Weights are `PRESIDENT_PRIMARY_ALIGNMENT_WEIGHT = 40`, `PRESIDENT_PRIMARY_PARTY_INFLUENCE_WEIGHT = 20`, `PRESIDENT_PRIMARY_NATIONAL_REACH_WEIGHT = 15`, `PRESIDENT_PRIMARY_FAVORABILITY_WEIGHT = 25` (`src/lib/primaryScore.ts`, rebalanced 2026-08-19). Party influence, not "party org," is the second term; it scales linearly and is uncapped above the reference scale (party influence 150). Favorability was raised from 10 to 25 because it is the single most decisive variable in the general election (`approvalScalar` measured at ~0.45 vote-share points per favorability point) while party influence never enters the general-vote formula at all, the old weighting let parties nominate candidates the electorate had already rejected.

The component curves are in `src/lib/utils/normalizeNPI.ts`:

- National reach: `1 - exp(-NPI / 45)` (`PRESIDENTIAL_PRIMARY_NATIONAL_REACH_TAU = 45`), so NPI 25 gives 0.426, 55 gives 0.706, 100 gives 0.892, 200 gives 0.988. It approaches 1 but never reaches it.
- Party influence: `partyInfluence / 150` (`PRESIDENTIAL_PRIMARY_PARTY_INFLUENCE_SCALE = 150`), linear and uncapped.
- Alignment: `max(0, 40 - (|econDiff| + |socialDiff|) x 2.0)` against the party position only.
- Favorability: `favorability / 100 x 25`.
- The infamy multiplier above is applied to the total, and the result is rounded to one decimal.

### State-level primary score

Used for House, Senate, Governor and State Senate style races (`calcPrimaryScore`, `src/lib/primaryScore.ts`):

```
score = (stateAlignment(0-25) + partyAlignment(0-15) + favorability(0-35) + influence(0-25)) × infamyMult
stateAlignment = max(0, 25 - (|econDiff_state| + |socialDiff_state|) × 1.25)
partyAlignment = max(0, 15 - (|econDiff_party| + |socialDiff_party|) × 0.75)
favorability   = favorability / 100 × 35
influence      = normalizeNPI(politicalInfluence) × 25   // sqrt(PI / 100), PI clamped to 0-100
```

With no cached state lean the alignment collapses to a single party-only term, `max(0, 40 - (|econDiff_party| + |socialDiff_party|) × 2.0)`. NPP candidates in a primary that has at least one player in the same party take `NPP_PRIMARY_SCORE_MULTIPLIER = 0.5` (`src/lib/electionEngine/constants.ts`), and are not subject to the infamy penalty. The score sets a candidate's standing; it is not a direct vote count.

**Worked example.** State distance 4, party distance 2, favorability 60, influence 36, infamy 40: state alignment 25 - 5 = 20; party alignment 15 - 1.5 = 13.5; favorability 21; influence sqrt(0.36) x 25 = 15. Raw 69.5. Infamy multiplier 1 - 0.05 x 0.4 = 0.98, so the score is 68.1.

Why the presidential weights differ: the presidential primary is national, so no state lean is involved, and favorability gets the larger weight because it is the most decisive variable in the general election.

### Electoral College

- 538 total electoral votes
- 270 needed to win
- ME and NE split by congressional district with lean proxies (UNIT_LEAN)
- 269-269 tie: deterministic coin flip (SHA-256 of election + candidate IDs)

### Independent Penalty

Independent presidential candidates receive a 0.3x vote multiplier (`src/lib/presidentialElectionEngine.ts`).

## Demographic Turnout

### Turnout Modifier Range

Each demographic group: -20 to +20 percentage points (`TURNOUT_CAP = 20`, `src/lib/campaignTargeting/rules.ts`; the legacy path clamps at the same 20 in `src/lib/utils/diminishingReturns.ts`).

### Decay

```
modifier = modifier × 2^(-1/6)   (TURNOUT_HALF_LIFE = 6 turns, about 10.9% per turn)
```

Values with magnitude under 0.01 snap to 0. This is the rule for races created under campaign rules version 1 (`CAMPAIGN_RULES_VERSION = 1`). Legacy races use `modifier × 0.98` (`DECAY_RATE = 0.02`, `src/lib/utils/turnoutDecay.ts`).

| Turns since canvassing | Remaining (v1 races) | Remaining (legacy) |
| --- | --- | --- |
| 0 | 100% | 100% |
| 4 | 63% | 92% |
| 10 | 31% | 82% |
| 20 | 10% | 67% |

### Canvassing Effectiveness (campaign rules version 1)

```
distanceSquared = ((charEcon - demoEcon)² + (charSocial - demoSocial)²) / 2
fit             = 0.2 + 0.8 × exp(-distanceSquared / 18)
boost           = CANVASS_BASE_BOOST × fit² × (closing ? 2 : 1)       // CANVASS_BASE_BOOST = 2 points
resistance      = max(0, sign(boost) × current) / 20
new             = clamp(current + boost × (1 - resistance), -20, +20)
```

Source: `canvassingBoost` and `addTurnoutBoost` in `src/lib/campaignTargeting/rules.ts`. The closing sprint is the final 4 turns of the race, which doubles the boost. Resistance is directional: pushing further the way a bucket is already pushed gets harder, while a positive action can recover a suppressed bucket.

**Worked example.** A candidate at distance squared 0 from a group has fit 1.0, so a canvass adds 2 points (4 in the closing sprint). At distance squared 9 the fit is 0.2 + 0.8 x exp(-0.5) = 0.685, so the boost is 2 x 0.685² = 0.94. With the modifier already at +10 the resistance is 0.5 and the boost halves to 0.47.

Legacy races (`src/lib/turn/demographicTurnoutCalculations.ts`):

```
distance      = |charEcon - demoEcon| + |charSocial - demoSocial|
alignmentMult = max(0.1, 1.0 - distance × 0.15)
rawBoost      = 0.05 × alignmentMult × (campaign season ? 2.0 : 1.0)
boost         = applyDiminishingReturns(current, rawBoost)   // × (1 - |current| / 20), floored at 0
```

The alignment multiplier floor of 0.1 is reached at distance 6.

### Party GOTV

Party budgets have a GOTV allocation targeted at a specific category or group (`gotvTargetCategory` / `gotvTargetGroup`), which feeds turnout for the tally (`processPartyGOTV`, `src/lib/turn/demographicTurnoutTurn.ts`).

```
spend = floor(revenue × gotvBudgetPercent / 100)        // percent 0-25; legacy flat gotvBudgetPerTurn if percent is 0
boost = spend / DOLLARS_PER_TURNOUT_POINT × alignmentMultiplier
DOLLARS_PER_TURNOUT_POINT = 5000   (src/lib/utils/demographicAlignment.ts)
```

A national budget divides the spend evenly across the country's regions before applying the formula; a state-scoped budget applies in full to one state. The alignment multiplier runs from 1.0 at perfect alignment with the target bucket down to a 0.1 floor. Diminishing returns apply on top (`applyDiminishingReturns`: the boost is multiplied by `1 - |current| / 20`), so at a +10 modifier a 1 point boost becomes 0.5. No rule boosts demographics automatically for being near the party position; only the budget allocation above does that.

**Worked example.** A party with 200,000 revenue an hour and a 5% GOTV budget spends 10,000, which is 2 points at alignment 1.0, or 0.8 points at alignment 0.4. At a current modifier of +10 the 0.8 becomes 0.4.

## Fund Generation

### Passive Income

```
income = round((baseRate + donorBonus) × gdpScalar × priceLevel) + round(officeBonus × priceLevel)
```

Source: `getTotalFundGeneration`, `src/lib/utils/fundGeneration.ts`. Rates are per hour (one turn).

| State population | `baseRate` | Donor bonus per level |
| --- | --- | --- |
| under 2,000,000 (small) | $5,000 | $100 |
| 2,000,000 to 7,999,999 (medium) | $10,000 | $200 |
| 8,000,000 to 19,999,999 (large) | $20,000 | $400 |
| 20,000,000 and over (mega) | $40,000 | $800 |

- `donorBonus` = donor-base level x the per-level amount x `(1 + stateInfluence / 100)`, where state influence is clamped to 0 to 100 (so 1.0x at 0 influence, 2.0x at 100). Level 0 or below gives 0.
- `gdpScalar` = state GDP per capita divided by the country-era baseline, clamped to 0.9 to 1.5.
- `priceLevel` is the era price scalar, 1 when the era price level is off.
- Taxes are taken from the total: `floor(total × rate / 100)` per tax, only for rates above 0 and up to `MAX_TAX_RATE = 33`; a rate outside that range yields no tax at all.

**Worked example.** A medium state, donor level 10, state influence 50, GDP scalar 1.0, price level 1: donor bonus is 200 x 10 x 1.5 = 3,000; base plus donor is 13,000; a House member adds $5,000 for $18,000 per hour.

### Office Fund Bonuses

Flat per hour, not scaled by GDP (`OFFICE_FUND_BONUS`, `src/lib/utils/fundGeneration.ts`):

| Office | Bonus |
| --- | --- |
| House, Commons, Bundestag, parliamentary and UK cabinet | +$5,000/hr |
| State Senate, Landtag | +$3,000/hr |
| Senate, Governor, Minister-President | +$15,000/hr |
| Vice President | +$25,000/hr |
| President, Prime Minister, Chancellor | +$50,000/hr |

## Action Economy

### Base Actions

`baseActionsPerTurn = 4`, plus the per-turn office bonus from `officeActionBonus` (`src/lib/seeds/reference/gameConfig.ts`, used by `src/lib/actions/officeActionBonus.ts`):

| Office | Bonus |
| --- | --- |
| House, State Senate, Commons, Regional Council, Bundestag, Landtag, Sangiin, Shugiin, cabinet seats | +1 |
| Senate, Governor, Vice President, Bundesrat, Minister-President, Premier | +2 |
| President, Prime Minister, Chancellor | +4 |

A cabinet bonus stacks on top of the holder's legislative seat. The central bank chair adds `chairActionBonus = 3`. These are game-config values, so a world may override them.

### Action Costs

Action costs vary by action and target. For example, setting a travel or primary campaign state costs 3, 5, 7 or 10 actions depending on the state's electoral votes (`getTravelActionCost` in `src/lib/constants/states.ts`). Advertise, fundraise and influence actions have their own costs.

### State Adjacency Costs

- Home state: 1.0x
- Neighboring state: 1.25x (`NEIGHBORING_STATE`, `src/lib/states/adjacency.ts`)
- Non-neighboring: 1.5x

These multipliers apply to the action cost of Support and Attack only. Campaign, Advertise and Barnstorm have no distance multiplier.

## State Lean Calculation

```
stateLean = weightedAverage(groupLeans, groupPopulations × groupTurnout)
```

Lean is stored on an integer **-5 to +5** scale per axis (economic, social), not a -1..1 float. Display labels (`getEconomicPositionName` / `getSocialPositionName`, `src/lib/utils/politics.ts`) use 11 discrete buckets, one per integer value:

Economic axis: Far Left (-5), Strong Left (-4), Left (-3), Lean Left (-2), Center-Left (-1), Centrist (0), Center-Right (1), Lean Right (2), Right (3), Strong Right (4), Far Right (5).

Social axis: Far Liberal (-5), Strong Liberal (-4), Liberal (-3), Lean Liberal (-2), Center-Liberal (-1), Moderate (0), Center-Trad (1), Lean Trad (2), Traditional (3), Strong Trad (4), Far Traditional (5).

## Timing

The formulas run in different parts of the hourly turn (1 turn = 1 game week). The order is set in the turn processor (`src/lib/turn/`).

| Formula group | Turn group | Notes |
| --- | --- | --- |
| Action refresh, fund generation, influence decay | Resources (group 1) | First, so later phases read the new action pool and treasury. `src/lib/turn/actionRefresh.ts` |
| Turnout decay, party GOTV | Demographics (group 2) | `src/lib/turn/demographicTurnoutTurn.ts` |
| Primary resolution, vote accumulation, general resolution | Election resolution (group 7) | Strictly sequential: primary resolution, then vote accumulation, then general resolution |

Vote accumulation (`src/lib/electionEngine/tallyManagement.ts`) runs once per active race per turn, after turnout decay has already moved the modifiers it reads.

## Edge cases and limits

- Influence: player decay floors at 0, NPP decay floors at 10, and influence is clamped to 0 to 100 inside the decay and in `normalizeNPI`. Above 100 it counts as 100 in the general election.
- Reach never reaches zero: `VOTE_REACH_FLOOR` is 0.1, and `APPEAL_POSITION_FLOOR` keeps position score above zero per axis. This is why even a badly placed, unknown candidate gets a small share.
- Org: an empty org map is neutral, a zero-org party in a populated state is not (see the org bullet above).
- Turnout modifiers clamp at +/-20 points, snap to 0 under 0.01, and decay by half-life on current races, 2% per turn on legacy races.
- Tenure erosion stops at 15%. A first-term holder, open seat or fresh nominee is untouched.
- Races of 4 turns or fewer have no early or ramp band: the pool is spread evenly.
- A tie at 269-269 in the Electoral College is a deterministic coin flip (SHA-256 of election and candidate IDs), so the same inputs always give the same result.
- Presidential party influence is uncapped (live values exceed 200), unlike national reach, which saturates toward 1.

## Connections

**Driven by:**

- [Government Approval](./government-approval.md): state approval scales the turn pool in `tallyManagement.ts`, and executive-party approval sets the influence decay multiplier in `shared/constants/formulas.ts`.
- [Demographics & Targeting](./demographics-targeting.md): group appeal and turnout come from the demographic cells read by `voteDistribution.ts`.
- [Stats & Actions](./stats-actions.md): favorability, infamy and influence are the stats the formulas read.

**Affects:**

- [Election Mechanics](./elections.md): the weight stack and pool bands decide every vote tally and primary result.
- [Fundraising & Ads](./fundraising-ads.md): fund generation feeds the campaign treasury.
- [Canvassing](./canvassing.md): turnout boosts and decay are the canvassing mechanic's numbers.

## Related Pages

- [Election Mechanics](./elections.md), Election system overview
- [Demographics & Targeting](./demographics-targeting.md), Demographic details
- [Stats & Actions](./stats-actions.md), Action costs and stats
- [Government Approval](./government-approval.md), Approval system

Last checked: 2026-10-29, version 1.18.0
