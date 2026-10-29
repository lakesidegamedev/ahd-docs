# Min-Maxing Guide

## Summary

Optimize every aspect of gameplay for maximum political impact. This is a strategy guide for experienced players rather than a single mechanic, so this page ties each piece of advice to the rule and source file behind it: influence upkeep, fund income, spending efficiency, starting positions, state choice and election timing.

Player guide: [Power Player Guide](https://www.ahousedividedgame.com/wiki/power-player-guide)

## Rules

### Action efficiency

You have limited actions each turn. Every action should produce maximum value.

Action priority by phase:

**Early game (no office)**

1. Campaign: build influence to 30%+.
2. Fundraise: build a war chest for ads.
3. Poll: understand your demographic appeal (do this once).

**Mid game (holding House seat)**

1. Campaign: maintain or grow influence.
2. Run ads: boost favorability in weak demographics before election season.
3. Fundraise: office income covers basics; fundraise for extra.

**Late game (Senate/Governor+)**

1. Strategic campaigning during election season only.
2. Ads targeting swing demographics.
3. NPP management (if party chair or vice chair): shape your competition, see [party-influence.md](./party-influence.md).

### The influence sweet spot

- Influence decays by 0.75% of its current value per turn (`POLITICAL_INFLUENCE_DECAY_RATE = 0.0075` in `shared/constants/formulas.ts`), so the higher you are the more points you lose each turn. At 80 you lose 0.6 points a turn, at 40 you lose 0.3.
- Members of the party that holds the national executive decay faster: the decay is multiplied by `2 - approval / 100`, so 1.0x at 100% approval, 1.5x at 50%, 2.0x at 0% (`executivePartyInfluenceDecayMultiplier`).
- Each Campaign use gains `max(0.1, 1 - max(0, influence - 50) / 75)` times your effectiveness multiplier (`campaignInfluenceGain` in `src/lib/actions/rules.ts`). The gain shrinks above 50, which is why holding a very high number is expensive.
- Maintain 40-60% influence outside election season; surge to 80%+ during campaigns.
- Do not waste actions maintaining 90%+ influence when no election is near.
- New characters start at 10 influence (`NEW_CHARACTER_STARTING_INFLUENCE`); NPPs never decay below 10 (`NPP_POLITICAL_INFLUENCE_FLOOR`), players have a floor of 0.
- Favorability above 60 drains by `(favorability - 60) x 0.05` per turn, and infamy above 20 drains it by `(infamy - 20) x 0.05` (`calculateFavorabilityAboveThresholdPenalty`, `calculateInfamyFavorabilityDrain`). Time favorability gains close to the vote.
- National influence decays 1% per turn (`NATIONAL_INFLUENCE_DECAY_RATE`) and gains from state influence (`calculateNationalInfluenceGain`): -0.5 per turn at state influence 0, 0 at 25, +0.5 at 50, +1.25 at 75, +2.0 at 100.

### Fund optimization

Income per turn is computed by `calculateFullFundDistribution` in `src/lib/utils/fundGeneration.ts`:

`total = round(baseRate(pop tier) x gdpScalar x priceLevel) + round(donorBonus x gdpScalar x priceLevel) + round(officeBonus x priceLevel)`

| Piece | Value |
| --- | --- |
| Base rate by state population | under 2M: 5,000; 2M to 8M: 10,000; 8M to 20M: 20,000; 20M and over: 40,000 |
| Donor bonus per level | small 100, medium 200, large 400, mega 800 (`DONOR_BASE_BONUS_PER_LEVEL`), times `1 + stateInfluence / 100` (1.0x at 0, 2.0x at 100) |
| GDP scalar | state GDP per capita over the country baseline, clamped 0.9 to 1.5 (`getIncomeGdpScalar`) |
| Office bonus | House 5,000; State Senator 3,000; Senate 15,000; Governor 15,000; Vice President 25,000; President 50,000 (`OFFICE_FUND_BONUS`) |
| Taxes | state and national tax are each `floor(total x rate / 100)`, rates 0 to 33 (`calculateTaxAmount`) |

Income maximization:

- **Win office early.** Even a House seat gives 5,000 per turn passive.
- **Low-tax party.** Consider party tax rates when choosing allegiance: both the state and the national rate come out of your total.
- **Stacked bonuses.** Office bonus plus donor level plus state population tier. The office bonus is flat and not scaled by state wealth; it is scaled by the era price level, like the other legs.

Spending efficiency:

- **Don't hoard.** Cash held as campaign funds earns nothing on its own; savings and other economy products are separate systems ([economic-systems.md](./economic-systems.md)). Spend on ads when elections are near.
- **Batch ads and canvassing.** Spend them close to the vote. The campaign season doubling (final 4 turns before an election closes) applies to canvassing and to campaign passives such as media spending and opposition research, not to ads (see [Canvassing](./canvassing.md) and [Campaign Manager](./campaign-manager.md)).
- **Target ROI demographics.** Ads on demographics close to your positions give better returns. A favorability ad gains `max(1, floor(3 - 0.1 x max(0, favorability - 70)))` before your charisma multiplier (`advertiseFavorabilityGain`), so the same ad is worth 3 at 70 and 1 at 90.

### Position optimization

You choose economic and social positions (-5 to +5) at character creation. They are not locked: voting on a bill moves each axis by at most 0.25 (`VOTE_SHIFT_STEP` in `src/lib/policyShift.ts`). An Aye moves you toward the bill's average position and never past it; a Nay moves you 0.25 away; an abstention moves nothing (see [Player Progression](./player-progression.md)). Choose a starting point wisely:

Safe positions (broad appeal):

- Center-left (-2/-2) or center-right (+2/+2) appeal to the most demographics.
- Match your party's median to win primaries more easily.

Risky positions (niche power):

- Extreme positions (-5/-5 or +5/+5) dominate aligned demographics but alienate others.
- Only works in heavily-leaned states where your demographics are the majority.

### State selection

Your home state determines your entire career path.

Optimal states:

- **Swing states.** The closest states for the current era and lean (check the Lean map overlay, see [Map Services](./map-services.md)); elections are exciting but harder.
- **Aligned states.** States matching your policy positions; easier to win but less competitive.
- **High-population states.** Higher donor base for fundraising (large and mega tiers pay 4x to 8x the small-state donor bonus per level).

Avoid:

- States where the opposite party has overwhelming lean (unless you join that party).
- Very small states (low donor base, few House seats).

### Election timing

When to enter:

- Enter primaries early to lock your slot before an NPP does. This does not stop NPP challengers: an NPP can still join an already filled primary with a base 15% chance per cycle, scaled by the NPP's office-seeking trait and halved in countries with players (`CHALLENGER_BASE_PROBABILITY`, `PLAYER_COUNTRY_CHALLENGER_MULT` in `src/lib/turn/npp/electionEntry.ts`; see [NPP Opponents](./npp-opponents.md)).
- Don't enter too many races. Focus resources on one winnable race.

When to campaign hard:

- Final 4 turns before the election closes: the campaign season multiplier is active for canvassing and campaign passives (`endTurn - currentTurn <= 4`, `seasonMultiplier` in `src/lib/turn/campaignTurn.ts`).
- During primary only if contested. Save resources if you are unopposed.

### Party leadership meta

Winning party chair or vice chair gives you NPP management actions (boost favorability and influence, strengthen loyalty, improve cooperation; relocation for national leaders):

- **Clear your primary.** The party influence "request withdrawal" action is no longer offered. To keep NPPs from splitting your vote, slate them into a different race in the same state (a compliant NPP is withdrawn from the old race), or, as a national leader, relocate them ([party-slate.md](./party-slate.md), [party-influence.md](./party-influence.md)).
- **Stack endorsements.** Get NPPs to endorse you for a vote boost by requesting an endorsement from the NPP profile; NPP endorsements are manual-only and never happen on their own ([npp-system.md](./npp-system.md)).
- **Deny opponents.** The old "oppose candidate" action is no longer offered. The practical lever is to request endorsements first and to keep your own NPP bench loyal.

### Multi-office strategy

1. Start with House (easiest to win).
2. Build funds and influence with office bonuses.
3. Run for Senate or Governor (statewide races).
4. If ambitious: Presidential run. Presidential races are scored on National Political Influence (NPI), which builds from state influence, so build state influence early; party org in swing states then pays off in the general election ([Player Progression](./player-progression.md)).

## Data

This page does not own any state. The advice reads the following.

| Value | Where it lives | Player-visible |
| --- | --- | --- |
| Influence, national influence, favorability, infamy | `characters.politicalInfluence`, `nationalInfluence`, `favorability`, `infamy` | yes |
| Donor level, positions | `characters.donorBaseLevel`, `characters.policies` | yes |
| State population, GDP | `states.population`, `states.gdp` | yes |
| Office held | `characters.currentOffice`, `electedOfficials` | yes |
| Party tax rates | `politicalParties` and `statePartyOrg` tax fields | yes |
| Campaign season | `elections.endTurn` | yes |
| Executive approval (decay multiplier) | government approval record for the country | yes |
| Bill stances | bill provisions' `economic` and `social` values | yes |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| Influence decay | 0.0075 per turn | `shared/constants/formulas.ts` |
| Fund rates and office bonuses | tables above | `src/lib/utils/fundGeneration.ts` |
| GDP baseline per country and era | per country and preset | `src/lib/campaigns/rules/gdpBaseline.ts` |
| Era price level for income | 1 unless `campaignEraPriceLevelEnabled` is on | `gameConfig` flag, resolved from `gameState.preset` |
| Starting influence | at least 10 | `gameConfig.startingPoliticalInfluence`, `NEW_CHARACTER_STARTING_INFLUENCE` |
| Tax cap | 33 | `MAX_TAX_RATE` |
| Vote shift step | 0.25, axis range -5 to +5 | `src/lib/policyShift.ts` |
| NPP challenger chance | 0.15 base, x0.5 in player countries | `src/lib/turn/npp/electionEntry.ts` |

## Timing

Per turn, the pieces of this guide resolve in this order (`src/simulation/phases/turnPhaseNames.ts` and `src/lib/turn/actionRefresh.ts`):

1. Income step: fund generation and taxes, using the population tier, donor level, state influence and office.
2. Action refresh: influence decay (0.75%, with the executive-party multiplier), national influence decay and gain, favorability and infamy drains.
3. `campaignTurn`: campaign passives, doubled when the election ends within 4 turns.
4. `primaryResolution`, `voteAccumulation`, `electionResolution`.

Request-time: Campaign, Run Advertisements, Fundraise, Poll and canvassing resolve when used; bill votes move your positions as you cast them.

## Worked trace

Influence upkeep. Assume effectiveness multiplier 1, one Campaign use per turn, and a party outside the executive.

| PI | Decay `0.0075 x PI` | Gain `max(0.1, 1 - (PI - 50) / 75)` | Net per turn |
| --- | --- | --- | --- |
| 40 | 0.300 | 1.000 | +0.700 |
| 60 | 0.450 | 0.867 | +0.417 |
| 80 | 0.600 | 0.600 | 0.000 |
| 90 | 0.675 | 0.467 | -0.208 |

One Campaign use per turn therefore settles at 80: solving `1 - (x - 50) / 75 = 0.0075 x` gives `x = 80`. Two uses per turn settle at `2 x (1.6667 - 0.013333 x) = 0.0075 x`, which is `x = 97.6`. If your party holds the presidency at 50% approval, the decay is 1.5x, so one use per turn settles lower: `1.6667 - 0.013333 x = 0.01125 x` gives `x = 67.8`.

Income. A House member in a large state (population 12,000,000), donor level 10, state influence 50, GDP scalar 1.0, price level 1, with 5% state tax and 5% national tax.

| Step | Calculation | Result |
| --- | --- | --- |
| Base | large tier | 20,000 |
| Donor bonus | `round(400 x 10 x (1 + 50 / 100))` | 6,000 |
| Office bonus | House | 5,000 |
| Total generation | 20,000 + 6,000 + 5,000 | 31,000 |
| State tax | `floor(31,000 x 0.05)` | 1,550 |
| National tax | `floor(31,000 x 0.05)` | 1,550 |
| Character receives | 31,000 - 1,550 - 1,550 | 27,900 |

Position shift. A character at economic +2.0 votes on a bill whose provisions average +3.0 on that axis: Aye moves `min(0.25, 1.0)` to 2.25, Nay moves to 1.75. At economic +2.9 an Aye moves only 0.1 to 3.0, never past the bill; a Nay still moves 0.25 away.

## Edge cases and limits

- Influence is capped at 100 and the decay is zero at 0. A gain below 0.1 is floored at 0.1, so a Campaign use is never fully wasted.
- Favorability gain from an ad is floored at 1 and capped by the 100 ceiling.
- Characters that predate the stat system omit stats and get neutral multipliers; Campaign and Fundraise reject missing stats where the rules require them.
- The GDP scalar is clamped to 0.9 to 1.5 so poor states earn slightly less and rich states at most half again as much.
- Taxes over 33 percent are rejected, and `calculateTaxAmount` returns 0 for a rate of 0 or above the cap.
- The vote shift is snapped to a 0.05 grid and clamped to -5 to +5.
- Changing country, party or home state resets or penalises some of these values (see [Player Progression](./player-progression.md)).
- Entering a primary early secures a slot against the generic NPP fill but not against NPP challengers.

## Invariants

- Influence stays within 0 to 100 after decay and gain (`applyPoliticalInfluenceDecay` clamps; `shared/constants/formulas.test.ts`).
- Population tiers, base rates and the GDP baseline per country are fixed by `src/lib/utils/fundGeneration.test.ts`. Each tax rate is capped at 33 percent (`taxRateSchema`).
- Vote shifts never push a position outside -5 to +5 and never overshoot the bill on an Aye (`src/lib/policyShift.test.ts`).
- State and national tax are capped separately, so the combined take can reach 66 percent. Nothing limits the sum; this is not enforced.

## Failure and recovery

- **Income looks wrong after an era or country change.** The GDP baseline and price level come from the world's preset; a missing baseline row throws by design rather than silently using the US figure. The repair is to seed the missing baseline.
- **Decay seems faster than 0.75%.** The party holds the national executive; the multiplier is up to 2.0x. This is expected, not a fault.
- **Wrong position after a vote.** The shift is computed from the position before that bill, so re-voting cannot stack; each shift is recorded as a `PolicyShiftLedgerEntry`, which is the audit trail for any repair.
- **Missing donor or influence field on an old character.** Reads default to neutral values: donor level 0 gives no donor bonus and missing stats give a 1.0x multiplier.

## Connections

**Driven by:**

- [Formula Deep-Dive](./formula-deep-dive.md): the underlying action formulas.
- [Player Progression](./player-progression.md): stats, positions and office bonuses.
- [Canvassing](./canvassing.md) and [Campaign Manager](./campaign-manager.md): the season multiplier.
- [Government approval](./government-approval.md): executive-party decay multiplier.

**Affects:**

- Player decisions only; this page changes no state. [Meta Strategy](./meta-strategy.md) covers the multi-player side.

## Tests

| Area | Test file |
| --- | --- |
| Influence decay, executive multiplier, national influence | `shared/constants/formulas.test.ts` |
| Fund generation and tax | `src/lib/utils/fundGeneration.test.ts` |
| Vote shifts | `src/lib/policyShift.test.ts` |
| NPP primary challengers | `src/lib/turn/npp/electionEntry.test.ts` |
| NPP management actions | `src/lib/influence/partyExecutor.test.ts` |
| Endorsements | `src/lib/nppEndorsements.test.ts` |

Gaps: nothing tests that the action priority advice is sound, and the equilibrium values in the worked trace are derived, not asserted.

## Known issues and history

- Earlier text said a vote shifts positions by 0.25 in the direction of the bill. The code moves an Aye toward the bill and never past it, and a Nay moves away by 0.25. Fixed here.
- Earlier text suggested using party influence to withdraw NPP opponents and to oppose NPP endorsements. Those actions are blocked at both routes in the live release. Fixed here.
- Earlier text said funds never compound, which overlooked savings and other economy products. The claim now applies only to campaign funds.
- [Player Progression](./player-progression.md) says the flat office bonus is not scaled by era price level; the code multiplies it by the price level (`Math.round(officeBonus * priceLevel)`). The page above follows the code.

## Related Pages

- [Campaign Strategy](./campaign-strategy.md) - Foundation strategy guide
- [Formula Deep-Dive](./formula-deep-dive.md) - Exact formulas for optimization
- [Demographics & Targeting](./demographics-targeting.md) - Voter group mechanics
- [State-Level Power](./state-level-power.md) - State office strategy
- [Meta Strategy](./meta-strategy.md) - Multi-player tactics

Last checked: 2026-10-29, version 1.18.0
