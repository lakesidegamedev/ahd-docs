# Demographics & Targeting

Player guide: [Demographics & Targeting](https://www.ahousedividedgame.com/wiki/demographics-targeting). Also see [Demographics](https://www.ahousedividedgame.com/wiki/demographics) and [Canvassing](https://www.ahousedividedgame.com/wiki/canvassing).

Understanding voter demographics is key to winning elections. Each state has a unique demographic profile that determines which candidates appeal to which voters. This page is the strategy-level technical summary: which constants matter when choosing where to spend actions. Full formulas and sources are in [Demographics](./demographics.md).

**Note on the live model:** the electorate that actually casts votes is a granular census lattice of cells, not 12 archetypes, see [Granular Electorate (as shipped)](./granular-electorate-as-shipped.md). The archetypes (Young Renters, Evangelicals, Rural Traditionalists, Union & Trades, Soccer Moms, College Liberals, Small Business, Public Sector, Retirees, Libertarians, New Americans, Secular Professionals) are legacy authoring vocabulary that gameplay effects (approvals, legislation, GOTV) are still keyed by; they project onto the real electorate via `src/lib/demographics/archetypeBucketMap.ts` rather than having independent vote logic.

Why cells: a single archetype lump hid that, for example, a young voter and a rural voter can be the same person. Cells let a voter belong to one bucket of every census dimension at once (race, age, education, wealth), so turnout and appeal act on real overlaps.

The per-archetype lean table that used to sit here is removed: those numbers are authoring defaults that differ by country and are not live vote inputs. Live leans come from the era census tables in `src/lib/demographics/`.

## How Demographics Affect Elections

1. **Reach**: your Political Influence determines how many voters you can reach (`sqrt(min(100, PI) / 100)`, `src/lib/utils/normalizeNPI.ts`)
2. **Appeal**: policy alignment between your positions and each cell's leans (`src/lib/utils/demographicAppeal.ts`, exponent 1.5)
3. **Turnout**: each bucket has a baseline turnout rate modified by canvassing and GOTV
4. **Vote share**: cells where you have high appeal and they have high turnout give you more votes

## Turnout System

Each demographic bucket has a turnout modifier (-20 to +20 points, `TURNOUT_CAP` in `src/lib/campaignTargeting/rules.ts`):

- **Decay**: under campaign rules version 1 (current elections) modifiers decay with a 6 turn half-life, about 10.9% per turn (`TURNOUT_HALF_LIFE`, `src/lib/campaignTargeting/rules.ts`). Elections created before that version still decay 2% per turn (`src/lib/utils/turnoutDecay.ts`).
- **Party GOTV**: your party passively boosts the one bucket its budget targets. Boost = spend / 5000 × alignment (`src/lib/utils/demographicAlignment.ts`).
- **Player canvassing**: 100 funds and 1 action for `2 × fit²` points, where fit runs from 0.2 to 1.0 with how close your position is to the audience.
- **Closing window**: canvassing effectiveness doubles when a qualifying race ends within 4 turns (`src/app/api/canvassing/route.ts`).
- **Diminishing returns**: a boost in the direction a modifier already points is reduced by `current / 20`.

## Targeting decisions

| Action | Effect | Cost | Best when |
| --- | --- | --- | --- |
| Canvass a bucket | `2 × fit² (× 2 closing)` turnout points, immediate | 100 funds, 1 action | Your positions sit close to the bucket and a race ends within 4 turns |
| Party GOTV | `spend / 5000 × alignment` points per turn | percent of party revenue, 0 to 25 percent | Sustained, passive support for one bucket the party aligns with |
| Targeted ad | Capped competitive bonus, `AD_BONUS_CAP = 0.25`, +0.01 per action, 24 turn half-life (`rules.ts`) | 100 funds, 1 action, up to 50 per buy | You need persuasion rather than turnout |
| Poll | Reveals appeal and turnout per bucket | see [Stats & Actions](./stats-actions.md) | Before committing any of the above |

A bucket that loves you but does not vote is worth nothing, and a bucket that votes but sits far from you gains little from canvassing (fit floor 0.2 gives a boost of only 0.08 points).

## Worked allocation

A candidate with perfect fit (boost 2 per canvass) has 30 actions and 3,000 funds in one state.

- All 30 on one bucket from 0: `20 × (1 - 0.9^30) = 19.3` points.
- 15 on each of two buckets: `2 × 20 × (1 - 0.9^15) = 31.8` points in total (15.9 each).

Splitting wins because each canvass on a bucket loses `modifier / 20` of its size. Timing matters equally: the same 30 actions in the 4-turn closing window have boost 4, giving `20 × (1 - 0.8^15) = 19.3` points per bucket for two buckets, `38.6` in total, and decay (half-life 6 turns) has little time to eat them.

## FAQ

- **Why did canvassing do so little?** A canvass is worth at most 2 points, shrinks with distance from the audience, and shrinks again as the bucket approaches +20. Ten perfect canvasses from zero reach about 13 points.
- **How do I see how age and race groups vote?** Run the Full Demographic Poll; it breaks appeal down by bucket.
- **Do I campaign in the right state?** You can only canvass in your active campaign state (home state, or the travel or primary state for presidential candidates).

## Ideology-Modulated Leans

Some groups (Retirees, Soccer Moms, Union & Trades, Rural Traditionalists) shift their leans based on state ideology composition. A conservative state will push these groups further right; a progressive state pushes them left.

## State Political Lean

State lean is a turnout-weighted average of all group leans (`src/lib/utils/demographics.ts`). The display label is the lean rounded to the nearest whole step on the -5..+5 ruler (Far Left, Strong Left, Left, Lean Left, Center-Left, Centrist, Center-Right, Lean Right, Right, Strong Right, Far Right, `src/lib/utils/politics.ts`). Any lean under 0.5 in absolute value reads Centrist, so most states do. Full table in [Demographics](./demographics.md).

## Connections

**Driven by:**

- [Demographics](./demographics.md): turnout modifiers and cell leans set the base the targeting acts on.
- [Parties](./parties.md): party budget and position drive GOTV.
- [Campaign Strategy](./campaign-strategy.md): action allocation and timing.

**Affects:**

- [Election Mechanics](./elections.md): turnout and appeal decide vote totals per cell (`src/lib/elections/resolveElection.ts`).
- [Election Engine](./election-engine.md): reach, appeal, approval and Org scalars.

## Related Pages

- [Demographics](./demographics.md), Full demographic system details
- [Campaign Strategy](./campaign-strategy.md), Action allocation and timing
- [Election Mechanics](./elections.md), How votes are counted

Last checked: 2026-10-29, version 1.18.0
