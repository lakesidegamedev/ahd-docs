# Stats & Actions

## Summary

The reference for the core stats a character carries and every action they can spend. Each stat lists its scale, how it moves, and the source file the numbers come from. Costs for the money actions are formulas, not flat values, because they scale with the home state's economy and with the character's stats.

Player guide: [Stats & Actions](https://www.ahousedividedgame.com/wiki/stats-actions)

## Rules


### Character stats (the seven RPG stats)

Seven stats, each a float clamped to 1-10: Charisma, Debate, Energy, Fundraising, Business Acumen, Statecraft, Intellect (`src/lib/stats/statsConstants.ts`). A 28-point budget is spent at creation (`STAT_POINT_BUDGET`, minimum 1 each). Every stat gives a gentle efficacy multiplier `1 + (stat - 5.5) x 0.04` (`EFFICACY_PIVOT`, `EFFICACY_SLOPE`, applied in `src/lib/stats/statMultiplier.ts`), so a stat of 1 gives 0.82x and a stat of 10 gives 1.18x.

- **Charisma** scales Campaign influence gain and Advertise favorability gain.
- **Intellect** divides the fund cost of Campaign and polls (higher is cheaper).
- **Fundraising** multiplies the Fundraise yield and divides the Build Donor Network fund cost.
- **Energy** sets the action cap and the hoarding threshold (below).
- **Debate** has its own progression: Debate Prep costs 1 action and has a 15% chance to add 1 (`DEBATE_PREP_ACTION_COST`, `DEBATE_PREP_SUCCESS_CHANCE`), each resolved debate gives a free practice roll (`DEBATE_PRACTICE_BASE_CHANCE` 0.15, `DEBATE_PRACTICE_WIN_CHANCE` 0.30 for the winner), and it loses 1 per full 72 real hours (`DEBATE_DECAY_INTERVAL_MS`).
- Other stats grow by use: `USE_GROWTH_INCREMENT = 0.03` XP per qualifying action, flushed each turn by `applyTurnDrift` (`src/lib/stats/statDrift.ts`). Fundraise and Build Donor Network train Fundraising; Campaign and Advertise train Charisma; both polls train Intellect; every action except Debate Prep also trains Energy (`USE_GROWTH_STAT_BY_ACTION`, `src/lib/actions.ts`). Business Acumen gains `0.03 x` a profit multiplier each turn the character's corporation runs: 0.5 at or below zero margin, 1.0 up to 10%, 1.5 up to 25%, 2.0 above (`businessAcumenGrowthMultiplier`). **There is no idle decay:** stats are permanent apart from crisis events, and `applyTurnDrift` only adds XP. `ENERGY_MAINTENANCE_XP` (0.06) and `IDLE_DECAY_RATE` are referenced in comments but unused by the turn.

### Political Influence (PI, per state)

- **Scale:** 0-100. **Start:** 10 (`max(startingPoliticalInfluence, NEW_CHARACTER_STARTING_INFLUENCE)`, `src/app/api/auth/character/route.ts`, `shared/constants/formulas.ts`); referred characters start with `floor(10 x 1.1)` = 11, `floor(50 x 1.1)` = 55 favorability and 10 extra actions.
- **Gain:** Campaign, `max(0.1, (1 - max(0, PI - 50) / 75) x charismaMultiplier)` per action (`campaignInfluenceGain`, `src/lib/actions/rules.ts`). Against decay this settles a hard campaigner near 80, not 100.
- **Decay:** 0.75% of current PI per turn (`POLITICAL_INFLUENCE_DECAY_RATE = 0.0075`, `shared/constants/formulas.ts`), floor 0. Members of the party holding the national executive decay faster by `2 - approval/100` (x2.0 at 0% approval, x1.5 at 50%, x1.0 at 100%; `executivePartyInfluenceDecayMultiplier`).
- **Campaign eligibility:** blocked at PI 100 (`CAMPAIGN_MAX_INFLUENCE`).
- **Affects:** election vote reach in state races, campaign appeal and primary scores.

### National Political Influence (NPI)

- **Scale:** uncapped, floor 0, start 0.
- **Each turn:** `NPI' = max(0, NPI - 0.01 x NPI + gain)` (`applyNationalInfluenceTurn`, `NATIONAL_INFLUENCE_DECAY_RATE = 0.01`). `gain` is the state-influence term plus the highest position bonus.
- **State-influence term** (`calculateNationalInfluenceGain`): `PI/50 - 0.5` up to PI 50, then `0.5 + (PI - 50) x 0.03`. So PI 0 gives -0.5, PI 25 gives 0, PI 50 gives +0.5, PI 75 gives +1.25, PI 100 gives +2.0.
- **Position bonus** (one tier, the highest that applies; `src/lib/actions/positionNiBonus/rules.ts`, applied in `src/lib/turn/actionRefresh.ts`): executive head 2.5; deputy executive, presiding officers, majority leaders, national party chair 2.0; cabinet, governors, justices, central bank chair, minority leaders, party vice chairs 1.5; national legislators 1.0; sub-national legislators and state party chairs 0.5; large-corporation CEOs 0.3 or 0.15. International organisation heads add 1.0 on top.
- **Equilibrium:** because decay is proportional, NPI settles at `100 x gain`. Leaving office fades it over roughly one House cycle.
- **Used by:** presidential elections only, not House, Senate, Governor or State Senate races. General elections use `sqrt(min(NPI, 100) / 100)` (`normalizeNPI`, `src/lib/utils/normalizeNPI.ts`): NPI 25 gives 0.5x, 50 gives 0.71x, 85 gives 0.92x, 99 gives 0.995x, 100 or more gives 1.0x. Presidential primaries use `1 - exp(-NPI/45)` (`PRESIDENTIAL_PRIMARY_NATIONAL_REACH_TAU = 45`), which never hard-caps.

### Favorability

- **Scale:** 0-100. **Start:** 50 (`startingFavorability`, `src/lib/seeds/reference/gameConfig.ts`).
- **Gain:** Run Advertisements, `max(1, floor((3 - max(0, fav - 70) x 0.1) x charismaMultiplier))` (`advertiseFavorabilityGain`). Campaign passives and presidential travel (+1 per turn in the travel state) are curved by `diminishPassiveFavorabilityGain`: above 80 favorability each point costs 0.15 of the gain, floored at 0.5 per turn.
- **Natural decay:** `(fav - 60) x 0.05` per turn above 60 (`calculateFavorabilityAboveThresholdPenalty`, `FAVORABILITY_NATURAL_DECAY_THRESHOLD = 60`). It is 0 at or below 60 and 2.0 per turn at 100.
- **Infamy drain:** `(infamy - 20) x 0.05` per turn above 20 infamy (`calculateInfamyFavorabilityDrain`), using the infamy value from before this turn's decay.
- **Government accountability drain:** members of the governing party can lose extra favorability each turn (`memberAccountabilityDrain`, `src/lib/government/accountability.ts`).
- **Clamp:** the sum is clamped to 0-100 each turn.
- **Affects:** the approval multiplier in vote appeal across every race type; primary score (0-35 points).

### Infamy

- **Scale:** 0-100, **start** 0 (`startingInfamy`).
- **Gain:** +2 for every Attack (even a failed one) and for the NPP "lower" boost; Personal Campaign Donation adds `round(15 x (amount / 1,000,000)^0.564)`, capped at 100 (`calculateConvertCashInfamy`).
- **Attack failure:** the attacker rolls 0-999 and fails when the roll is below `infamy x 10`, so infamy 30 fails 30% of the time and infamy 100 always fails (`src/lib/influence/simpleInfluence.ts`). It is the attacker's infamy that counts, not the target's.
- **Decay:** `infamy x 0.95` per turn (`src/lib/turn/actionRefresh.ts`, mirrored in `src/lib/utils/decayProjections.ts`), a half-life of about 14 turns.
- **Other effects:** favorability drain above 20 (see above); primary score multiplier of 1.0 down to 0.95 at infamy 100; party influence penalty (below).

### Policy positions

- **Scale:** -5 to +5 per axis (economic, social), snapped to a 0.05 grid. Set at creation.
- **Voting on bills** moves a position by at most 0.25 per axis per bill (`VOTE_SHIFT_STEP`, `src/lib/policyShift.ts`): an Aye moves toward the bill's average position and never past it, a Nay moves 0.25 away, an abstain or an axis with no stance moves nothing. Re-voting is measured from the position held before that bill, so flipping cannot stack.
- **Compared against** demographic group leans for appeal, and the party position for primary scores and party influence closeness.

### Campaign Funds and Cash on Hand

- **Campaign Funds start:** 250,000 (`startingFunds`, `src/lib/seeds/reference/gameConfig.ts`). Spent on Campaign, Advertise, Build Donor Network, polls, NPP influence actions, party taxes and Support, Attack and Barnstorm. Stored in the local currency at the frozen campaign rate.
- **Cash on Hand start:** by wealth background, 1,000,000 (low), 2,500,000 (middle) or 5,000,000 (high), scaled down in earlier eras (`WEALTH_BONUS`, `getWealthBonus`, `src/lib/constants/characterWealth.ts`). The two pools do not mix. Sponsored news posts and Personal Campaign Donation draw on Cash on Hand. Cross-country wire transfers are blocked.
- **Per-turn fund generation** (`getTotalFundGeneration`, `src/lib/utils/fundGeneration.ts`):

```
income = round((baseRate + donorLevel x perLevelRate x (1 + PI/100)) x gdpScalar x priceLevel)
       + round(officeBonus x priceLevel)
```

| State population tier | Base per turn | Donor bonus per level |
| --- | --- | --- |
| Small (under 2M) | 5,000 | 100 |
| Medium (2M to under 8M) | 10,000 | 200 |
| Large (8M to under 20M) | 20,000 | 400 |
| Mega (20M and over) | 40,000 | 800 |

`gdpScalar` is state GDP per capita over the country baseline, clamped to 0.9-1.5. The office bonus is flat per turn: House 5,000, State Senate 3,000, Senate 15,000, Governor 15,000, Vice President 25,000, President 50,000, UK Commons 5,000, Prime Minister 50,000, Bundestag 5,000, Chancellor 50,000, Minister-President 15,000, Landtag 3,000, parliamentary and UK cabinet 5,000 (`OFFICE_FUND_BONUS`). Offices with no entry (for example Japanese, Canadian and Chinese seats) earn the base income only.

### Donor Base Level

- **Start:** 1. **No hard cap** for players.
- **Build Donor Network:** +1 level (`BUILD_DONOR_BASE_LEVEL_GAIN`). Fund cost `(3,000 + 1,500 x level) x gdpScalar / fundraisingMultiplier`, with `gdpScalar` clamped 0.85-2.0 (`BUILD_DONOR_BASE_FUND`, `BUILD_DONOR_BASE_FUND_PER_LEVEL`, `src/lib/actions/rules.ts`). Action cost `min(20, round(4 + (level/75)^1.4 x 16))`: level 0 costs 4, 10 costs 5, 25 costs 8, 50 costs 13, 65 costs 17, 75 and above costs 20.
- **Fundraise** requires level 1 or more. Yield `round((50,000 + 2,000 x level) x (1 + PI/100) x fundraisingMultiplier)`; costs 3 actions flat (`FUNDRAISE_ACTION_COST`, `calculateFundraisingAmount`, `fundraiseYieldAnchor`).

### Actions

- **Base per turn:** 4 (`baseActionsPerTurn`, with a code floor `MIN_BASE_ACTIONS_PER_TURN = 4` in `src/lib/stats/statsConstants.ts`, applied in `src/lib/turn/actionRefresh.ts`). **Starting grant:** 25 (35 if referred, `startingActions`).
- **Office bonus** (`officeActionBonus`, `src/lib/seeds/reference/gameConfig.ts`): House 1, State Senate 1, Senate 2, Governor 2, Vice President 2, President 4, UK Commons 1, Prime Minister 4, and each country's own table. Cabinet offices add 1 on top of a legislative seat.
- **Stacking roles:** central bank chair +3 (`chairActionBonus`), seated Supreme Court justice +2 (`JUSTICE_ACTION_BONUS`), chamber leadership (highest single role: presiding officer 3, majority and minority leaders 2, whips and president pro tempore 1; Leader of the Opposition 2, shadow cabinet 1; `src/lib/actions/positionNiBonus/rules.ts`).
- **Cap:** 200 at Energy 1 rising linearly to 250 at Energy 10 (`ENERGY_BASE_ACTION_CAP`, `ENERGY_MAX_ACTION_CAP`, `energyActionLimits`, `src/lib/stats/statDrift.ts`).
- **Hoarding penalty:** 4 actions lost per turn (`ACTION_HOARD_PENALTY`) when holding strictly more than the threshold, 100 at Energy 1 rising to 125 at Energy 10 (`ENERGY_BASE_HOARD_THRESHOLD`, `ENERGY_MAX_HOARD_THRESHOLD`).
- **Per-turn formula** (`src/lib/turn/actionRefresh.ts`): `actions' = min(cap, max(0, actions - (actions > threshold ? 4 : 0) + base + officeBonus + roleBonuses))`.

### Party Influence

- **Scale:** floor 0, no ceiling in code (values above 100 occur); independents and unknown parties are skipped.
- **Each turn** (`processPartyInfluenceTurn`, `src/lib/turn/partyInfluenceTurn.ts`): `influence' = max(0, influence x (1 - 0.04) + 3 x closeness + leadershipBonus - infamyPenalty)` using `partyInfluenceDecayRate` 0.04, `partyInfluenceBaseRate` 3, `partyInfluenceMaxPenalty` 4.
- **Closeness** is `max(0, 1 - distance / sqrt(200))` between the character's two policy positions and the party's. **Infamy penalty** is `4 x ln(1 + infamy) / ln(301)`, at most 4. **Leadership bonus:** National Chair +5, Vice Chair +2, Treasurer +2, National Committee +1, State Chair +2, State Vice Chair +1, Caucus Chair +2, Caucus Vice Chair +1.
- **Bonus actions:** the party pool is `3 x members` (`partyInfluencePoolMultiplier`). Each member gets `min(6, floor(influence / totalInfluence x pool x closeness))` actions that turn (`partyInfluenceMaxBonus`, `computeBonusActions`), added under the same Energy cap. Config can raise the pool multiplier and cap but not lower them below 3 and 6 (`Math.max` against the defaults).

### Available actions

#### Standard campaign actions

| Action | Actions | Funds | Effect |
| --- | --- | --- | --- |
| **Campaign** | 1 to 5 by PI tier: 20, 40, 60, 80 step up (`getCampaignActionCost`) | `round(20,000 x tier x (1 + (tier - 1) x 0.2) x gdpScalar / intellectMultiplier)`, `gdpScalar` 0.85-2.0 | PI gain, see Rules |
| **Fundraise** | 3 | Earns the quoted yield | Needs donor level 1+ |
| **Run Advertisements** | 5 to 9 by favorability tier: 30, 50, 70, 85 step up (`getAdvertiseActionCost`) | `100,000 x (1 + (tier index) x 0.2) x gdpScalar` | Favorability, see Rules |
| **Build Donor Network** | 4 to 20 | See Donor Base Level | +1 donor level |
| **Quick Poll** | 2 (`POLL_ACTION_COST`) | 25,000 / intellectMultiplier (`POLL_BASE_FUND_COST`) | Topline appeal plus best and worst 5 groups |
| **Full Demographic Poll** | 6 (`POLL_LARGE_ACTION_COST`) | 75,000 / intellectMultiplier (`POLL_LARGE_BASE_FUND_COST`) | Complete breakdown by demographic category |
| **Personal Campaign Donation** | 2 (`CONVERT_CASH_ACTION_COST`) | Converts chosen Cash on Hand at 50% (`CONVERT_CASH_RATE`) | Campaign Funds up; infamy scales with size |
| **Debate Prep** | 1 | None | 15% chance of +1 Debate |
| **Post news (player feed)** | 0 | None | Free article on `/news`; 12-hour cooldown per author |
| **Sponsored news post** | 5 | 100,000 personal cash | Paid placement; 30-minute cooldown per author (`src/lib/news/commands/newsCommands.ts`) |
| **Rest** | 0 | None | No effect |

All fund costs are in the era's money: a `priceLevel` deflator scales them in earlier-era worlds (`resolveCampaignPriceLevel`, `src/lib/campaigns/rules/priceLevel.ts`).

#### Out-of-state multipliers

Home state 1.0x, neighbouring state 1.25x, any other state 1.5x (`ACTION_COST_MULTIPLIERS`, `src/lib/states/adjacency.ts`). They apply to the action cost of Support and Attack. Campaign and Advertise use GDP-based fund scaling instead, and Barnstorm ignores distance.

#### Interpersonal actions (on other politicians)

Taken from the target's profile page (`src/lib/influence/simpleInfluence.ts`). Cross-country use is blocked and you cannot Support or Attack yourself.

| Action | Effect on target | Effect on you |
| --- | --- | --- |
| **Support** | +1 Favorability | None |
| **Attack** | -1 Favorability, unless the failure roll hits | +2 Infamy, always |
| **Barnstorm** | +1 PI, or +2 if your home state matches the target's; refused when the target is at 100 PI | None |

- **Pricing** (`src/lib/influence/rules.ts`): each price is built from the target's own equivalent self-action quote, so a low-stat booster cannot discount it. Support is the Advertise quote times 1.25 (`EXTERNAL_BOOST_PREMIUM`), Attack is the Advertise quote times 1.5 (`EXTERNAL_ATTACK_PREMIUM`), and Barnstorm is the Campaign quote times 1.25. Action points round down (`floor`) and funds round to the nearest unit. Support and Attack also take the distance multiplier.
- **Swing cap:** the net player-driven favorability change on one target is limited to 12 per turn in either direction (`MAX_NET_FAVORABILITY_SWING_PER_TURN`). A failed attack contributes 0 to it.
- **Rejected no-ops:** Support at favorability 100 and Attack at 0 are refused rather than debited.

#### Presidential travel (general election only)

| Action | Actions | Effect |
| --- | --- | --- |
| **Travel** | 3 to 10 by the destination's electoral votes: 5 or fewer cost 3, up to 10 cost 5, up to 20 cost 7, above 20 cost 10 (`getTravelActionCost`, `src/lib/constants/states.ts`) | Sets the travel state; +1 favorability per turn there |

US states only, one at a time. Switching costs the new destination's price again. Travel expires on withdrawal or when the election ends.

#### NPP direct actions

From an NPP profile. Deterministic once the gates are met (`src/lib/capital/actions.ts`).

| Action | Actions | Campaign Funds | Relationship gate | Effect |
| --- | --- | --- | --- | --- |
| **Request Endorsement** | 6 | 0 | policy fit and relationship | NPP endorses your candidacy |
| **Private Meeting** | 3 | 0 | -50 | +5 relationship |
| **Boost Favorability** | 5 | 10,000 | none | +3 favorability, +2 relationship |
| **Reduce Favorability** | 5 | 10,000 | none (floor -100) | -3 favorability, -2 relationship |
| **Boost Influence** | 6 | 20,000 | none | +2 PI, +2 relationship |
| **Reduce Influence** | 6 | 20,000 | none | -2 PI, -2 relationship |

See [NPP System](./npp-system.md). Party Chairs and Vice Chairs also draw on the party action pool for influence operations ([Political Parties](./parties.md), [Party Building](./party-building.md)).

## Data

Collections and fields (all on existing documents, no dedicated collection):

| Collection | Fields | Access | Player-visible |
| --- | --- | --- | --- |
| `characters` | `stats` (seven floats), `statXp`, `debateDecayAnchor`, `politicalInfluence`, `nationalInfluence`, `favorability`, `infamy`, `partyInfluence`, `actions`, `actionGrantLog`, `funds`, `cashOnHand`, `currencyBalances`, `donorBaseLevel`, `policies` (economic, social), `homeState`, `party`, `currentOffice`, `ceoNiTenure`, `ceoNiTier`, `roleActionBonus`, `positionNiBonus`, `politicalInfluenceDecayMultiplier` | Read and written by `actionRefresh`, `fundGeneration`, `partyInfluenceTurn` and the action commands | Stats, meters, funds, actions yes; `actionGrantLog`, `statXp` and the multiplier fields are internal |
| `npps` | `politicalInfluence`, `favorability` | Decay mirrored each turn | Yes (NPP pages) |
| `gameConfig` (`_id: "default"`) | `baseActionsPerTurn`, `officeActionBonus`, `chairActionBonus`, `startingActions`, `startingFunds`, `startingFavorability`, `startingInfamy`, `startingPoliticalInfluence`, `partyInfluence*` | Read | No |
| `gameState` (`_id: "current"`) | `currentTurn`, `isActive`, `rpgStatsEnabled` | Read | No |
| `centralBanks`, `supremeCourtSeats`, `congressLeaders`, `cabinetMembers`, `electedOfficials`, `politicalParties`, `statePartyOrg`, `caucuses` | Role holders for action and NPI bonuses, party leadership | Read | Yes |
| `states` | GDP, population (cost and income scaling) | Read | Yes |
| `newsPosts` | `authorId`, `feedType`, `createdAt` (cooldowns) | Read and write | Yes |
| `politicalParties`, `statePartyOrg` | Party treasury credit from member fund taxes | Write | Yes |

## Configuration

| Setting | Default | Where set |
| --- | --- | --- |
| `gameState.rpgStatsEnabled` | `true` for fresh worlds; the stat system is inert when false or absent (no allocation, no Debate Prep, neutral multipliers) | `src/lib/seeds/reference/featureFlagDefaults.ts`, checked by `isRpgStatsEnabled` in `src/lib/stats/featureFlag.ts` |
| `baseActionsPerTurn` | 4 (floored at 4 in code) | `src/lib/seeds/reference/gameConfig.ts` |
| `startingActions` | 25 | `src/lib/seeds/reference/gameConfig.ts` |
| `startingFunds` | 250,000 | `src/lib/seeds/reference/gameConfig.ts` |
| `startingFavorability` | 50 | `src/lib/seeds/reference/gameConfig.ts` |
| `startingInfamy` | 0 | `src/lib/seeds/reference/gameConfig.ts` |
| `startingPoliticalInfluence` | 0, raised to 10 at creation | `src/lib/seeds/reference/gameConfig.ts`, `shared/constants/formulas.ts` |
| `officeActionBonus` | per office table (house 1, senate 2, stateSenate 1, governor 2, president 4, vicePresident 2, commons 1, primeMinister 4, regionalCouncil 1, premier 2, bundestag 1, bundesrat 2, chancellor 4, ministerPresident 2, landtag 1, sangiin 1, shugiin 1, npcDelegate 1, peoplesCongress 1, parliamentaryCabinet 1, ukCabinet 1, usCabinet 1) | `src/lib/seeds/reference/gameConfig.ts` |
| `chairActionBonus` | 3 | `src/lib/seeds/reference/gameConfig.ts` |
| `partyInfluencePoolMultiplier` | 3 (floor 3) | `src/lib/seeds/reference/gameConfig.ts`, `src/lib/turn/partyInfluenceTurn.ts` |
| `partyInfluenceMaxBonus` | 6 (floor 6) | same |
| `partyInfluenceDecayRate`, `partyInfluenceBaseRate`, `partyInfluenceMaxPenalty` | 0.04, 3, 4 when unset | code defaults in `src/lib/turn/partyInfluenceTurn.ts`, fields in `src/lib/db/types/gameConfig.ts` |
| `campaignEraPriceLevelEnabled` | `true`; scales fund costs and incomes by the world era's price level | `src/lib/seeds/reference/featureFlagDefaults.ts`, `resolveCampaignPriceLevel` in `src/lib/campaigns/rules/priceLevel.ts` |
| World preset (`gameState.preset`) | selects the era GDP baseline and starting-wealth scaling | `src/lib/campaigns/rules/gdpBaseline.ts`, `src/lib/constants/characterWealth.ts` |

Per-country differences come only from the `officeActionBonus` table, the GDP baseline per country and era, the executive and legislature structure (for who counts as the governing party), and the adjacency map for out-of-state costs (US states only).

## Timing

All of this runs in the hourly turn (`src/simulation/phases/turnPhaseRegistry.ts`):

1. `actionRefresh` (`processActionRefresh`) runs concurrently with `fundGeneration`. Per character, in one pass: hoarding penalty then the actions refresh, PI decay, NPI decay plus gain, infamy decay, favorability decay and drains, stat drift, Debate decay. The action grant is applied against the live balance, so a spend made mid-turn is not lost.
2. `partyInfluenceTurn` runs later in the same turn, after `actionRefresh`, and adds party bonus actions to the live balance with the same cap.
3. Elections, bills and NPP behaviour run after, so they read the new stat values.

Player actions (Campaign, Advertise and the rest) execute immediately through `executeCharacterAction` (`src/lib/actions/commands/executeAction.ts`), not at a turn boundary. They are refused while the game is paused.

## Worked trace

A House member at Energy 1 with 105 actions, PI 60, NPI 40, favorability 70, infamy 30, charisma and intellect 5.5 (multiplier 1.0), donor level 5 in a medium state (population 5M, GDP per capita at the country baseline so `gdpScalar` is 1.0), in a party that does not hold the executive. The hourly turn runs.

1. **Hoarding:** Energy 1 gives threshold 100 and cap 200. 105 is strictly above 100, so the penalty is 4. Refresh `4 base + 1 House = 5`. `actions' = min(200, max(0, 105 - 4 + 5)) = 106`. At exactly 100 actions there is no penalty and the result is 105.
2. **PI:** decay `60 x 0.0075 = 0.45`, so PI is 59.55.
3. **NPI:** the state term uses the pre-decay PI of 60: `0.5 + (60 - 50) x 0.03 = 0.8`. The House position bonus is 1.0, so gain is 1.8. `NPI' = max(0, 40 - 0.4 + 1.8) = 41.4`.
4. **Infamy:** `30 x 0.95 = 28.5`.
5. **Favorability:** natural decay `(70 - 60) x 0.05 = 0.5`; infamy drain from the pre-decay value `(30 - 20) x 0.05 = 0.5`; no government drain. `70 - 0.5 - 0.5 = 69.0`.
6. **Fund generation** (PI read as 60): `round((10,000 + round(5 x 200 x (1 + 60/100))) x 1.0 x 1) + round(5,000 x 1) = (10,000 + 1,600) + 5,000 = 16,600` to Campaign Funds, before any party taxes.
7. **Party influence** (member influence 20, party of 10 members with total influence 100, closeness 0.8, no leadership role, infamy 30): penalty `4 x ln(31) / ln(301) = 2.407`; gain `3 x 0.8 + 0 - 2.407 = -0.007`; `influence' = max(0, 20 x 0.96 - 0.007) = 19.19`. Pool `3 x 10 = 30`; bonus actions `min(6, floor(20 / 100 x 30 x 0.8)) = floor(4.8) = 4`, so actions become 110 under the 200 cap.
8. **Stat drift:** if the member used Campaign once this turn, `statXp.charisma` and `statXp.energy` are each 0.03; the turn flushes them: charisma 5.53, energy 1.03. Debate decay is checked against its own 72-hour anchor.
9. **Next action, Campaign at PI 59.55:** the action cost tier is 3 because `59.55 < 60`. Fund cost `round(20,000 x 3 x (1 + 2 x 0.2) x 1.0) = 84,000`, divided by the Intellect multiplier (1.0). PI is above 50, so the gain is `1 - (59.55 - 50) / 75 = 0.873` times the Charisma multiplier (1.0).
10. **Fundraise** for comparison at donor level 5, PI 59.55, neutral Fundraising: `round((50,000 + 2,000 x 5) x (1 + 0.5955) x 1.0) = 95,730` for 3 actions.

## Edge cases and limits

- **Action cap:** actions above the cap are lost at the next refresh; the cap is `min(cap, ...)` so an overflowing grant is truncated, not queued.
- **Hoard line:** the penalty needs strictly more than the threshold and is a flat 4, applied before the refresh. Holding exactly the threshold costs nothing.
- **Zero cases:** PI, NPI, infamy and favorability floor at 0; favorability and infamy cap at 100; PI caps at 100. A character with no stat block uses the neutral 5.5 multiplier and the 200/100 baseline cap.
- **Campaign and Advertise quotes** reject (rather than guessing) when stats or home-state economic data are missing.
- **NPI** can fall (negative state term below PI 25) but never below 0.
- **Attack math:** high infamy makes the attack cost the same actions and funds but fail more often; failed attacks still cost 2 infamy.
- **Fundraise** is refused at donor level 0.
- **Cross-country** wires, Support, Attack and Barnstorm are blocked.
- **Reset to level 0 donor base** locks Fundraise until one level is built.
- **Stat system off:** with `rpgStatsEnabled` false no character has a stat block, every multiplier is neutral and Debate Prep is unavailable.

## Invariants

- **Stats stay in 1 to 10.** `clampStat` is applied in `statMultiplier`, `energyActionLimits` and `applyTurnDrift` (`src/lib/stats/__tests__/statDrift.test.ts`, `statMultiplier.test.ts`).
- **Actions never exceed the Energy cap or go below 0.** Enforced in the Mongo pipeline in `actionRefresh.ts` (`$min`, `$max`); covered by `src/lib/turn/actionRefresh.test.ts`.
- **A mid-turn spend is not lost.** The grant is applied to the live balance, not a snapshot (comment cites the earlier defect); tested in `actionRefresh.test.ts` ("grants personal AP from live actions even if the snapshot balance was spent mid-turn").
- **Meters stay in range.** PI is clamped 0 to 100 in `applyPoliticalInfluenceDecay`, favorability 0 to 100 in the refresh, infamy 0 to 100 in the attack and cash conversion paths, NPI floors at 0 (`shared/constants/formulas.test.ts`).
- **Quote equals charge.** Costs and yields come from one rules module per action (`src/lib/actions/rules.ts`, `src/lib/influence/rules.ts`) used by both the UI quote and the executor (`rules.test.ts`, `simpleInfluence.test.ts`).
- **Net favorability swing on a target is at most 12 per turn.** Enforced in `simpleInfluence.ts`; covered by `simpleInfluence.test.ts`.
- **Costs are debited atomically.** Support, Attack and Barnstorm use a conditional update on actions and funds; a concurrent change rejects the action.
- **Cross-currency stays isolated.** Not enforced by a single check beyond the cross-country blocks in the action routes.
- **No idle stat decay.** Enforced by `statDrift.test.ts` ("does not apply idle decay", "does not decay neglected stats").

## Failure and recovery

- **Missing turn:** if `actionRefresh` fails for a turn, characters keep their old meters and miss one grant. The next turn applies a normal grant; missed grants are not backfilled, and a repair grants actions directly if needed (the grant log records each applied grant).
- **Lost mid-turn spend:** avoided by the live-balance pipeline; an older defect where a party grant applied without the personal grant was fixed by the same change.
- **Wrong stat block** (missing or out-of-range `stats`): the character uses neutral multipliers and baseline limits; a heal re-allocates or repairs the block.
- **Action quote rejected:** Campaign, Advertise, polls, Build Donor Network and Debate Prep reject with an error when stats or home-state economic data are missing, instead of guessing. The fix is to allocate stats or repair the state data.
- **Meter out of range:** a data repair resets the value; the next turn clamps it.
- **Party influence drift:** values above 100 are legitimate; there is no ceiling to repair.

## Connections

**Driven by:**

- [Core Systems](./core-systems.md): the hourly turn and action refresh (`processActionRefresh`).
- [Political Parties](./parties.md): party influence, pool and bonus actions (`processPartyInfluenceTurn`).
- [Elections](./elections.md): office held sets action and fund bonuses; accountability drain on the governing party.
- [NPP System](./npp-system.md): relationship and direct-action gates.

**Affects:**

- [Elections](./elections.md): PI, NPI and favorability feed vote reach, appeal and primary scores (`src/lib/primaryScore.ts`, `src/lib/utils/normalizeNPI.ts`).
- [Player Progression](./player-progression.md): which stat matters at each career stage.
- Corporations: Business Acumen grows from running a profitable corporation (`businessAcumenGrowthMultiplier`).
- [NPP System](./npp-system.md): influence actions change NPP favorability and PI.

Related pages:

- [Core Systems](./core-systems.md) - Turn structure, action refresh, office bonuses
- [Player Progression](./player-progression.md) - Career path, when each stat matters
- [NPP System](./npp-system.md) - NPP influence details, success formulas
- [Political Parties](./parties.md) - Party influence, action pool, bonus actions
- [Election Mechanics](./elections.md) - How PI, NPI, Favorability feed into vote calculations

## Tests

- `src/lib/stats/__tests__/statDrift.test.ts`, `statMultiplier.test.ts`, `debateDecay.test.ts`, `businessAcumenGrowth.test.ts`, `suggestedBuild.test.ts`, and `src/components/stats/statAllocation.test.ts`.
- `src/lib/turn/actionRefresh.test.ts`, `actionRefreshRoles.test.ts`, `partyInfluenceTurn.test.ts`.
- `src/lib/actions/rules.test.ts`, `officeActionBonus.test.ts`, `officeBonusRegistry.test.ts`, `positionNiBonus.test.ts`, `pollCalculations.test.ts`, `sharedRules.test.ts`.
- `src/lib/influence/rules.test.ts`, `simpleInfluence.test.ts`, `src/lib/capital/actions.test.ts`.
- `src/lib/utils/fundGeneration.test.ts`, `normalizeNPI.test.ts`, `shared/constants/formulas.test.ts`, `src/lib/policyShift.test.ts`.
- Gaps: no end-to-end test of the whole hourly pass for one character; the travel cost table and the news cooldowns have no dedicated tests here.

## Known issues and history

- `statDrift.ts` and `statsConstants.ts` comments still describe an idle-decay rule (`IDLE_DECAY_RATE`, `ENERGY_MAINTENANCE_XP`) that the turn no longer applies. Behaviour: stats do not decay from idleness.
- `OFFICE_FUND_BONUS` has no entries for several offices that have action bonuses (Japanese, Canadian, Chinese and Bundesrat seats), so those offices earn no flat income bonus.
- A defect where a mid-turn spend cancelled the whole action refresh while the party grant still applied was fixed by applying grants against the live balance (code comments, issue references 4457 and 4649; covered by the live-balance and grant-log tests in `actionRefresh.test.ts`).
- The infamy favorability drain was advertised before it was applied; it is now applied each turn (code comment).
- Passive favorability gains above 80 are curved (`diminishPassiveFavorabilityGain`) so favorability stops pinning at 100 (code comment).
- No dated changelog is recorded on this page.

Last checked: 2026-10-29, version 1.18.0
