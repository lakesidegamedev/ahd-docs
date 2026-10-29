# Voter blocs

Every US state is divided into eight voter blocs. Each bloc has its own size, lean, likelihood of turning out and list of issues it cares about. Your actions reach blocs separately, so knowing who lives in the state you are targeting tells you where a dollar or a rally does the most.

These are the blocs in a US campaign. Other countries model their electorates with their own regions and parties.

## How it works

A state's electorate is split among the eight blocs by their national share, then adjusted for the state's makeup. Mississippi has 2.4 times the usual share of Black voters, Hawaii 3.5 times the usual share of Asian American and other voters, and Texas 1.9 times the usual share of Hispanic and Latino voters. The shares are then scaled to total 100%.

Each bloc starts with a lean toward one side. The game calibrates every state so the blocs together reproduce the real result of the chosen election. Your campaign then moves each bloc away from its starting lean. A bloc's weight in the final count is its size times its base turnout times its current enthusiasm (see [Polls and scoring](polls-and-scoring.md)).

### The eight blocs

Lean is the bloc's national two-party Democratic share in the 2020 baseline.

| Bloc | Share of voters | Base turnout | Lean (Democratic share) | Cares most about |
| --- | --- | --- | --- | --- |
| Working-class white voters | 30% | 0.62 | Republican (36%) | Economy, trade, immigration, law and order |
| College-educated white voters | 18% | 0.72 | Slightly Democratic (52%) | Economy, COVID response, healthcare, climate |
| Suburban women | 9% | 0.70 | Swing, slightly Democratic (55%) | COVID response, healthcare, abortion, economy |
| Black voters | 12% | 0.60 | Strongly Democratic (90%) | Race and policing, healthcare, economy |
| Hispanic and Latino voters | 11% | 0.52 | Leans Democratic (62%) | Economy, immigration, healthcare |
| Asian American and other voters | 5% | 0.58 | Leans Democratic (65%) | Economy, healthcare, immigration |
| Seniors (65 and over) | 10% | 0.75 | Slightly Republican (48%) | COVID response, healthcare, economy, law and order |
| Young voters (18 to 29) | 5% | 0.46 | Leans Democratic (60%) | Climate, race and policing, healthcare, economy |

Shares add to 100%. There is no separate evangelical or religious bloc. Those voters sit inside the working-class and college-educated white blocs.

### Why blocs are not equal

- **Size matters for state-wide ads.** An ad bought for a whole state is split across blocs in proportion to their size, so a big bloc moves more than a small one. Working-class white voters, at 30% nationally, take about six times the shift from the same ad as young voters at 5%.
- **Turnout weight matters for the count.** Seniors cast 0.75 of a vote for each unit of size, young voters 0.46. A senior counts for about 1.6 times a young voter, before enthusiasm.
- **Strong leans resist.** A bloc already far from 50% moves much less per push. Black voters at 90% Democratic are not persuadable, but they can be mobilized.
- **Alignment sets the payoff.** How well your positions fit the bloc's ideal positions, weighted by what the country cares about this year, sets how well ads land.

### Worked example

You push get-out-the-vote in a state where you have full ground game (1.0). The push has more upside for blocs that usually stay home. The unsaturated shift on the vote scale for each bloc is `0.12 x (0.5 + (1 - turnout))`:

| Bloc | Base turnout | GOTV shift at full ground game |
| --- | --- | --- |
| Young voters | 0.46 | 0.125 |
| Hispanic and Latino voters | 0.52 | 0.118 |
| Asian American and other voters | 0.58 | 0.110 |
| Black voters | 0.60 | 0.108 |
| Working-class white voters | 0.62 | 0.106 |
| Suburban women | 0.70 | 0.096 |
| College-educated white voters | 0.72 | 0.094 |
| Seniors | 0.75 | 0.090 |

Young voters gain about 39% more than seniors from the same push. That is before each bloc's own resistance to change, so in a state where young voters are tiny the total effect is still small. GOTV also raises every bloc's enthusiasm by 0.03 times your ground game.

## What you can do

- **Look up the state before you spend.** The state detail panel shows the bloc breakdown with lean and turnout for that state. Aim ads at states where a large, movable bloc fits your positions.
- **Pick the right tool for the bloc.** Rallies and ads persuade. Get-out-the-vote and enthusiasm help blocs that vote less, such as young voters and Hispanic and Latino voters.
- **Court the swing blocs.** Suburban women are only 9% of voters but turn out at 0.70, and opposition research and flip-flops hit them and college-educated white voters directly.
- **Use issue pivots to win a bloc.** Moving your position toward a bloc's ideal on an issue it cares about raises your appeal there, and costs you with groups that preferred your old position.
- **Watch the big blocs.** Working-class white voters are 30% of the electorate nationally and take the largest share of any state-wide ad, so a small move in them is worth more than a large move in a 5% bloc.

Common questions: *Which bloc decides the state?* The one with the most votes (size times turnout) that is still close to 50-50. A huge bloc at 90% or 10% is decided already; a mid-sized bloc near the middle is where the margin is made. *Why did my rally barely move anyone?* A rally is small per bloc (about 0.05) and strong leans resist, so it works through momentum and enthusiasm more than direct persuasion.

## Connections

**Driven by:**

- [Campaign actions](campaign-actions.md): ads, rallies, get-out-the-vote, oppo research and pivots all shift bloc leans and enthusiasm.
- [The campaign week](the-campaign-week.md): every weekly resolution relaxes bloc enthusiasm 40% back toward normal.
- [Elections](elections.md): the chosen election sets each state's real baseline result and the national issue concerns that decide alignment.

**Affects:**

- [Polls and scoring](polls-and-scoring.md): bloc size, lean and turnout add up to every state result, the electoral vote count and your score.
- [Campaign actions](campaign-actions.md): a bloc's issues and resistance decide how far each action moves it and where it is worth spending.

## Status

The eight US blocs, their national shares and turnout are fixed in every US election, and each election changes the state results and the issue concerns instead. Difficulty does not change the blocs, but Easy shifts every bloc 0.55 toward the player once at the start. The list on this page is US only.

Last checked: 2026-10-29, version October 2026 release

## Exact rules

Source: `src/content/blocs.ts` unless stated.

### Constants

| Bloc id | Name in game | `nationalShare` | `turnoutPropensity` | `nationalDemShare` |
| --- | --- | --- | --- | --- |
| `noncollege_white` | Working-class white voters | 0.30 | 0.62 | 0.36 |
| `college_white` | College-educated white voters | 0.18 | 0.72 | 0.52 |
| `suburban_women` | Suburban women | 0.09 | 0.70 | 0.55 |
| `black` | Black voters | 0.12 | 0.60 | 0.90 |
| `hispanic` | Hispanic & Latino voters | 0.11 | 0.52 | 0.62 |
| `asian_other` | Asian American & other voters | 0.05 | 0.58 | 0.65 |
| `seniors` | Seniors (65+) | 0.10 | 0.75 | 0.48 |
| `youth` | Young voters (18-29) | 0.05 | 0.46 | 0.60 |

Each bloc also has `issueWeights` (0 to 1, how much it cares) and `idealPositions` (-1 left to +1 right) per issue, in the same file. The national issue values per election are in `src/content/issues.ts` and `src/content/scenarios.ts`.

### Building a state (`buildBlocsForState`, `src/engine/setup.ts`)

1. For each bloc, `share = nationalShare * stateProfileMultiplier` (default 1). State profiles are in `src/content/states.ts`, for example `SOUTH_BLACK` (Black 2.1, working-class white 0.9, college-educated white 0.85), `SOUTHWEST_HISP` (Hispanic 2.4), `WHITE_WORKING` (working-class white 1.45), `COLLEGE_COAST` (college-educated white 1.3), `RETIREE` (seniors 1.6).
2. Shares are normalized to sum to 1, and `size = state electorate * share`.
3. A single logit shift is solved by bisection (60 steps between -10 and 10) so `sum(size * turnout * sigmoid(logit(nationalDemShare) + shift)) / sum(size * turnout)` equals the state's real Democratic two-party share.
4. Each bloc starts with `baselineMargin = logit(nationalDemShare) + shift`, `campaignMargin = 0` and `enthusiasm = 1`.

Logit input is clamped to 0.001 to 0.999. Maine and Nebraska district units are built the same way; the at-large units have no blocs of their own (`aggregateOf`).

### How blocs move

`liveBlocDemShare = sigmoid(baselineMargin + campaignMargin + stateMomentum * 0.0017)`. Votes are `size * turnoutPropensity * enthusiasm` (`src/engine/voteModel.ts`).

Alignment of a candidate with a bloc, used by ads, rallies and surrogates, is `sum(weight * align) / sum(weight)` over issues, where `weight = issueWeight * national salience`, `align = 1 - |position - ideal| / 2` (`src/engine/actions.ts`). A state-wide ad's shift on each bloc is multiplied by `bloc size / state size * number of blocs`, so a bloc with an average share is unchanged and a 30% bloc in an eight-bloc state gets 2.4 times the base.

The shift is limited by `saturate`: `room = max(0, 1 - |campaignMargin| / 0.7)`, `leanResist = 1 / (1 + |baselineMargin| * 1.8)`. GOTV raw shift is `0.12 * ground * (0.5 + (1 - turnoutPropensity))`, then saturated. Enthusiasm: rally +0.01 (cap 1.25), GOTV +0.03 times ground game (cap 1.3), contrast ads -0.018 (floor 0.78); weekly `1 + (enthusiasm - 1) * 0.6`.

### Edge cases

- A contest with no blocs (the Maine and Nebraska at-large units) cannot be targeted by actions.
- Opposition research and the flip-flop tax act only on `college_white` and `suburban_women`, in every state.
- Easy difficulty adds 0.55 to every bloc's `baselineMargin` in the player's favour (`src/engine/setup.ts`).
- There is no evangelical, religious or other bloc beyond the eight above.
