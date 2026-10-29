# Campaign actions

These are the actions in a US campaign, with what each one costs and when it pays off.

## Advertising

You choose the spend, $1M to $30M per buy. Targets any state. A pricier media market (0.75 to 1.6 times) makes each dollar go less far, and a single huge buy hits diminishing returns (`src/engine/actions.ts`).

Positive ads raise your appeal with blocs already inclined to you. Contrast ads attack the opponent but can depress turnout. Issue ads raise the national weight of an issue you choose.

Use positive ads in friendly states, contrast ads in toss-ups where you trail, and issue ads to move the national conversation onto your strengths.

## Rally

Costs one action. Targets any state.

Raises state momentum, national momentum and local enthusiasm. A charismatic candidate gets more out of it. The risk of a gaffe goes up when your candidate is tired or has travelled a lot this week. Avoid back-to-back rallies in low-energy weeks.

## Surrogate stop

Costs $250K. Targets any state.

Weaker than a rally by the candidate, but frees the candidate for somewhere else. Use it to cover states the candidate cannot reach, or stack it with a rally.

## Fundraising

Costs one action. National.

The haul depends on the candidate's fundraising skill, national momentum and some luck; each haul is $8M plus $120K per point of fundraising skill, so about $14M to $17M for a typical candidate, scaled up by national momentum and varied by 15 percent either way (`src/engine/actions.ts`). Do it early and often. It gets easier as you start winning.

## Field offices

Costs $1.5M and one unit of staff capacity. Targets any state.

Builds ground game that lasts for the rest of the campaign. You need it for get-out-the-vote to work. Build in battlegrounds by week 3 or 4, and put scarce staff where each dollar buys the most electoral votes.

## Get out the vote

Costs $1M. Targets a state with field offices.

A turnout push. It only works where you have ground game, and it matters most for blocs that tend not to vote. Repeating it in the same state fades, so spread it. Best late in the campaign where the margin is tight.

## Opposition research

Costs $2M. National.

Usually lands a national scandal on the opponent, which hurts them with college-educated white voters and suburban women everywhere. Otherwise it backfires and makes your campaign look desperate. Repeats have less effect. Use it when you are behind; avoid it when you are ahead.

## Debate prep and policy prep

Each costs one action and boosts your next debate.

Debate prep raises stagecraft; policy prep raises command of the issues and unlocks answers that need it. Both fade gently from week to week, so prepare in the week or two before a scheduled debate. Debates are scored head to head: the better showing wins the night, and a blowout swings momentum hard.

## Issue pivot

Free. National.

Changes your position on an issue. You gain blocs that like the new position and lose blocs that liked the old one, and pay a flip-flop penalty with suburban women and college-educated white voters. Use it rarely.
