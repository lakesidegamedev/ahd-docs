# Demographics & Targeting

Understanding voter demographics is key to winning elections. Each state has a unique demographic profile that determines which candidates appeal to which voters.

**Note on the live model:** the electorate that actually casts votes is a granular Layer-1 census lattice, not the 12 archetypes below, see [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md). The archetypes are legacy authoring vocabulary that gameplay effects (approvals, legislation, GOTV) are still keyed by; they project onto the real cell-based electorate via `archetypeBucketMap.ts` rather than having independent vote logic. The targeting concepts below (appeal, reach, turnout) still apply, they just resolve against cells now.

## Demographic Groups

The game's legacy authoring vocabulary is **12 voter archetypes**, each with distinct policy leans:

| Group                 | Economic Lean     | Social Lean       |
| --------------------- | ----------------- | ----------------- |
| College Liberals      | -5 (far left)     | -5 (far left)     |
| Evangelicals          | +4 (right)        | +5 (far right)    |
| Rural Traditionalists | +4 (right)        | +4 (right)        |
| Libertarians          | +5 (far right)    | +2 (center-right) |
| Young Renters         | -4 (left)         | -4 (left)         |
| Small Business        | +4 (right)        | +2 (center-right) |
| Secular Professionals | -3 (center-left)  | -4 (left)         |
| Union & Trades        | -3 (center-left)  | +1 (center)       |
| Public Sector         | -3 (center-left)  | -2 (center-left)  |
| New Americans         | -2 (center-left)  | -1 (center)       |
| Retirees              | +2 (center-right) | +3 (center-right) |
| Soccer Moms           | varies by state   | varies by state   |

## How Demographics Affect Elections

1. **Reach**, Your Political Influence determines how many voters you can reach
2. **Appeal**, Policy alignment between your positions and each group's leans
3. **Turnout**, Each group has a baseline turnout rate modified by canvassing and GOTV
4. **Vote share**, Groups where you have high appeal and they have high turnout give you more votes

## Turnout System

Each demographic group has a turnout modifier (-20% to +20%):

- **Decay**, Under campaign rules version 1 (current elections) modifiers decay with a 6 turn half-life, about 10.9% per turn (`src/lib/campaignTargeting/rules.ts`). Legacy elections still decay 2% per turn (`src/lib/utils/turnoutDecay.ts`)
- **Party GOTV**, Your party passively boosts aligned demographics
- **Player canvassing**, Campaign action to boost specific demographics
- **Campaign season**, Canvassing effectiveness doubles 4 turns before election
- **Diminishing returns**, Larger existing modifiers receive smaller boosts

## Ideology-Modulated Leans

Some groups (Retirees, Soccer Moms, Union & Trades, Rural Traditionalists) shift their leans based on state ideology composition. A conservative state will push these groups further right; a progressive state pushes them left.

## Targeting Strategy

- **Know your state**, Use the Poll action to see your appeal breakdown
- **Play to strengths**, Campaign in demographics close to your positions (higher appeal multiplier)
- **Shore up weaknesses**, Ads can boost favorability in demographics where you're weak
- **Watch turnout**, A demographic that loves you but doesn't vote is worthless

## State Political Lean

State lean is a turnout-weighted average of all group leans. The display thresholds:

- Very Left / Left / Center / Right / Very Right
- Center boundary: +/-0.2, Very boundary: +/-0.6

## Related Pages

- [Demographics](./demographics.md), Full demographic system details
- [Campaign Strategy](./campaign-strategy.md), Action allocation and timing
- [Election Mechanics](./elections.md), How votes are counted
